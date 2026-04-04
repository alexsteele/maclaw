import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import { TaskScheduler } from "../src/scheduler.js";

const createScheduler = async (): Promise<{
  cleanup: () => Promise<void>;
  scheduler: TaskScheduler;
}> => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "maclaw-scheduler-"));
  return {
    cleanup: async () => rm(dir, { recursive: true, force: true }),
    scheduler: new TaskScheduler(path.join(dir, "tasks.json")),
  };
};

test("deleteTask removes a task for the matching chat", async () => {
  const { cleanup, scheduler } = await createScheduler();

  try {
    const first = await scheduler.createTask({
      sessionId: "chat-a",
      title: "First task",
      prompt: "Do the first thing",
      runAt: "2026-04-05T09:00:00-07:00",
    });
    await scheduler.createTask({
      sessionId: "chat-b",
      title: "Second task",
      prompt: "Do the second thing",
      runAt: "2026-04-05T10:00:00-07:00",
    });

    const deleted = await scheduler.deleteTask(first.id, "chat-a");
    const remaining = await scheduler.listTasks();

    assert.equal(deleted, true);
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0]?.sessionId, "chat-b");
  } finally {
    await cleanup();
  }
});

test("deleteTask does not remove a task from another chat", async () => {
  const { cleanup, scheduler } = await createScheduler();

  try {
    const task = await scheduler.createTask({
      sessionId: "chat-a",
      title: "Keep task",
      prompt: "Leave this alone",
      runAt: "2026-04-05T09:00:00-07:00",
    });

    const deleted = await scheduler.deleteTask(task.id, "chat-b");
    const remaining = await scheduler.listTasks();

    assert.equal(deleted, false);
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0]?.id, task.id);
  } finally {
    await cleanup();
  }
});

test("createTask stores a one-time task with nextRunAt", async () => {
  const { cleanup, scheduler } = await createScheduler();

  try {
    const task = await scheduler.createTask({
      sessionId: "chat-a",
      title: "One time task",
      prompt: "Run once",
      runAt: "2026-04-05T09:00:00-07:00",
    });

    assert.equal(task.schedule.type, "once");
    assert.equal(task.nextRunAt, new Date("2026-04-05T09:00:00-07:00").toISOString());
  } finally {
    await cleanup();
  }
});

test("runDueTasks advances recurring tasks instead of completing them", async () => {
  const { cleanup, scheduler } = await createScheduler();

  try {
    const task = await scheduler.createTask({
      sessionId: "chat-a",
      title: "Hourly task",
      prompt: "Repeat every hour",
      schedule: {
        type: "hourly",
        minute: 0,
      },
    });

    await scheduler.markTask(task.id, {
      nextRunAt: new Date(Date.now() - 60_000).toISOString(),
      status: "pending",
    });

    let runCount = 0;
    await scheduler.runDueTasks(async () => {
      runCount += 1;
    });

    const tasks = await scheduler.listTasks("chat-a");
    assert.equal(runCount, 1);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0]?.status, "pending");
    assert.equal(tasks[0]?.schedule.type, "hourly");
    assert.ok(tasks[0]?.lastRunAt);
    assert.ok(Date.parse(tasks[0]?.nextRunAt ?? "") > Date.now());
  } finally {
    await cleanup();
  }
});

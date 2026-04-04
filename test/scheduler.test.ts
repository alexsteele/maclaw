import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import { TaskScheduler } from "../src/scheduler.js";
import { parseTaskSchedule } from "../src/task.js";

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

test("createTask stores a weekly task using AM/PM wall clock time", async () => {
  const { cleanup, scheduler } = await createScheduler();

  try {
    const task = await scheduler.createTask({
      sessionId: "chat-a",
      title: "Stock Updates",
      prompt: "Send me a monday market update",
      schedule: {
        type: "weekly",
        days: ["mon"],
        hour: 10,
        minute: 0,
      },
    });

    assert.equal(task.schedule.type, "weekly");
    if (task.schedule.type === "weekly") {
      assert.deepEqual(task.schedule.days, ["mon"]);
      assert.equal(task.schedule.hour, 10);
      assert.equal(task.schedule.minute, 0);
    }
  } finally {
    await cleanup();
  }
});

test("parseTaskSchedule parses a one-time task in US format", () => {
  const parsed = parseTaskSchedule(
    "once 4/5/2026 9:00 AM | Stock Updates | Send me a monday market update",
  );

  assert.ok(parsed);
  assert.equal(parsed?.title, "Stock Updates");
  assert.equal(parsed?.prompt, "Send me a monday market update");
  assert.equal(parsed?.schedule.type, "once");
});

test("parseTaskSchedule parses a daily task with AM/PM time", () => {
  const parsed = parseTaskSchedule(
    "daily 9:00 AM | Daily Summary | Give me a summary",
  );

  assert.ok(parsed);
  assert.equal(parsed?.schedule.type, "daily");
  if (parsed?.schedule.type === "daily") {
    assert.equal(parsed.schedule.hour, 9);
    assert.equal(parsed.schedule.minute, 0);
  }
});

test("parseTaskSchedule parses a weekly task with weekday and AM/PM time", () => {
  const parsed = parseTaskSchedule(
    "weekly mon 10:00 AM | Stock Updates | Send me a monday market update",
  );

  assert.ok(parsed);
  assert.equal(parsed?.schedule.type, "weekly");
  if (parsed?.schedule.type === "weekly") {
    assert.deepEqual(parsed.schedule.days, ["mon"]);
    assert.equal(parsed.schedule.hour, 10);
    assert.equal(parsed.schedule.minute, 0);
  }
});

test("parseTaskSchedule rejects invalid schedule text", () => {
  const parsed = parseTaskSchedule(
    "weekly someday 10:00 AM | Bad Task | This should fail",
  );

  assert.equal(parsed, null);
});

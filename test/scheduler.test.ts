import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import test from "node:test";
import { MemoryTaskStore, TaskScheduler } from "../src/scheduler.js";
import { JsonFileTaskStore } from "../src/storage/json.js";
import { SqliteTaskStore } from "../src/storage/sqlite.js";
import { parseTaskSchedule } from "../src/task.js";
import type { TaskRunLogEntry } from "../src/types.js";

const createScheduler = async (): Promise<{
  cleanup: () => Promise<void>;
  dir: string;
  scheduler: TaskScheduler;
}> => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "maclaw-scheduler-"));
  return {
    cleanup: async () => rm(dir, { recursive: true, force: true }),
    dir,
    scheduler: new TaskScheduler(
      new JsonFileTaskStore(
        path.join(dir, "tasks.json"),
        path.join(dir, "task-runs.jsonl"),
      ),
    ),
  };
};

test("deleteTask removes a task for the matching chat", async () => {
  const { cleanup, scheduler } = await createScheduler();

  try {
    const first = await scheduler.createTask({
      chatId: "chat-a",
      title: "First task",
      prompt: "Do the first thing",
      runAt: "2026-04-05T09:00:00-07:00",
    });
    await scheduler.createTask({
      chatId: "chat-b",
      title: "Second task",
      prompt: "Do the second thing",
      runAt: "2026-04-05T10:00:00-07:00",
    });

    const deleted = await scheduler.deleteTask(first.id, "chat-a");
    const remaining = await scheduler.listTasks();

    assert.equal(deleted, true);
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0]?.chatId, "chat-b");
  } finally {
    await cleanup();
  }
});

test("deleteTask does not remove a task from another chat", async () => {
  const { cleanup, scheduler } = await createScheduler();

  try {
    const task = await scheduler.createTask({
      chatId: "chat-a",
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
      chatId: "chat-a",
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
      chatId: "chat-a",
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
      chatId: "chat-a",
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

test("parseTaskSchedule defaults a one-time US date to 9:00 AM", () => {
  const parsed = parseTaskSchedule(
    "once 4/5/2026 | Stock Updates | Send me a monday market update",
  );

  assert.ok(parsed);
  assert.equal(parsed?.schedule.type, "once");
  if (parsed?.schedule.type === "once") {
    const runAt = new Date(parsed.schedule.runAt);
    assert.equal(runAt.getHours(), 9);
    assert.equal(runAt.getMinutes(), 0);
  }
});

test("parseTaskSchedule parses relative one-time dates", () => {
  const today = parseTaskSchedule(
    "once today | Daily Summary | Give me a summary",
  );
  const tomorrow = parseTaskSchedule(
    "once tomorrow 5:30 PM | Daily Summary | Give me a summary",
  );
  const now = parseTaskSchedule(
    "once now | Daily Summary | Give me a summary",
  );

  assert.ok(today);
  assert.ok(tomorrow);
  assert.ok(now);
  assert.equal(today?.schedule.type, "once");
  assert.equal(tomorrow?.schedule.type, "once");
  assert.equal(now?.schedule.type, "once");

  if (today?.schedule.type === "once") {
    const runAt = new Date(today.schedule.runAt);
    assert.equal(runAt.getHours(), 9);
    assert.equal(runAt.getMinutes(), 0);
  }

  if (tomorrow?.schedule.type === "once") {
    const runAt = new Date(tomorrow.schedule.runAt);
    assert.equal(runAt.getHours(), 17);
    assert.equal(runAt.getMinutes(), 30);
  }

  if (now?.schedule.type === "once") {
    assert.ok(Date.parse(now.schedule.runAt) <= Date.now() + 1_000);
  }
});

test("parseTaskSchedule uses a configurable default task time", () => {
  const parsed = parseTaskSchedule(
    "once tomorrow | Daily Summary | Give me a summary",
    "8:15 AM",
  );

  assert.ok(parsed);
  assert.equal(parsed?.schedule.type, "once");
  if (parsed?.schedule.type === "once") {
    const runAt = new Date(parsed.schedule.runAt);
    assert.equal(runAt.getHours(), 8);
    assert.equal(runAt.getMinutes(), 15);
  }
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

test("runDueTasks writes a JSONL execution log entry", async () => {
  const { cleanup, dir, scheduler } = await createScheduler();

  try {
    const task = await scheduler.createTask({
      chatId: "chat-a",
      title: "Log me",
      prompt: "Record this run",
      runAt: new Date(Date.now() - 60_000).toISOString(),
    });

    await scheduler.runDueTasks(async () => {
      return;
    });

    const raw = await readFile(path.join(dir, "task-runs.jsonl"), "utf8");
    const lines = raw.trim().split("\n");
    assert.equal(lines.length, 1);

    const entry = JSON.parse(lines[0] ?? "{}") as TaskRunLogEntry;
    assert.equal(entry.taskId, task.id);
    assert.equal(entry.chatId, "chat-a");
    assert.equal(entry.title, "Log me");
    assert.equal(entry.prompt, "Record this run");
    assert.equal(entry.status, "completed");
    assert.equal(entry.scheduledFor, task.nextRunAt);
  } finally {
    await cleanup();
  }
});

test("memory scheduler keeps tasks in memory without writing a task log", async () => {
  const scheduler = new TaskScheduler(new MemoryTaskStore());
  const task = await scheduler.createTask({
    chatId: "chat-a",
    title: "Temporary task",
    prompt: "Only keep this in memory",
    runAt: new Date(Date.now() - 60_000).toISOString(),
  });

  let runCount = 0;
  await scheduler.runDueTasks(async () => {
    runCount += 1;
  });

  const tasks = await scheduler.listTasks("chat-a");
  assert.equal(runCount, 1);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0]?.id, task.id);
  assert.equal(tasks[0]?.status, "completed");
});

test("sqlite scheduler stores tasks and task run logs", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "maclaw-scheduler-sqlite-"));
  const databasePath = path.join(dir, "maclaw.db");
  const scheduler = new TaskScheduler(new SqliteTaskStore(databasePath));

  try {
    const task = await scheduler.createTask({
      chatId: "chat-a",
      title: "SQLite task",
      prompt: "Store this in sqlite",
      runAt: new Date(Date.now() - 60_000).toISOString(),
    });

    await scheduler.runDueTasks(async () => {
      return;
    });

    const tasks = await scheduler.listTasks("chat-a");
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0]?.id, task.id);
    assert.equal(tasks[0]?.status, "completed");

    const database = new DatabaseSync(databasePath);
    const rows = database
      .prepare("select task_id, title, status from task_runs order by id asc")
      .all() as Array<{ task_id: string; title: string; status: string }>;
    database.close();

    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.task_id, task.id);
    assert.equal(rows[0]?.title, "SQLite task");
    assert.equal(rows[0]?.status, "completed");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

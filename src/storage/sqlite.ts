// SQLite-backed project stores.
// This starts with agents and inbox to prove the storage seam cleanly.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AgentStore } from "../agent.js";
import type { InboxStore } from "../inbox.js";
import type { TaskStore } from "../scheduler.js";
import type {
  AgentRecord,
  InboxEntry,
  NotificationPolicy,
  NotificationTarget,
  Origin,
  ScheduledTask,
  TaskRunLogEntry,
  TaskSchedule,
} from "../types.js";

const SQLITE_SCHEMA = `
  create table if not exists agents (
    id text primary key,
    name text not null,
    prompt text not null,
    chat_id text not null,
    origin_json text,
    notify_json text,
    notify_target_json text,
    status text not null,
    max_steps integer,
    timeout_ms integer not null,
    step_interval_ms integer,
    step_count integer not null,
    created_at text not null,
    started_at text,
    finished_at text,
    last_message text,
    last_error text
  );

  create table if not exists inbox (
    id text primary key,
    kind text not null,
    text text not null,
    origin_json text not null,
    source_type text not null,
    source_id text not null,
    source_name text,
    created_at text not null,
    sent_at text,
    read_at text
  );

  create table if not exists tasks (
    id text primary key,
    chat_id text not null,
    origin_json text,
    notify_json text,
    notify_target_json text,
    title text not null,
    prompt text not null,
    schedule_json text not null,
    next_run_at text not null,
    status text not null,
    created_at text not null,
    updated_at text not null,
    last_run_at text,
    last_error text
  );

  create table if not exists task_runs (
    id integer primary key autoincrement,
    timestamp text not null,
    task_id text not null,
    chat_id text not null,
    title text not null,
    prompt text not null,
    schedule_json text not null,
    scheduled_for text not null,
    started_at text not null,
    finished_at text not null,
    status text not null,
    error text
  );
`;

const parseJsonField = <T>(value: unknown): T | undefined => {
  if (value === null) {
    return undefined;
  }

  return JSON.parse(String(value)) as T;
};

const stringifyJsonField = (value: unknown): string | null =>
  value === undefined ? null : JSON.stringify(value);

const openDatabase = (filePath: string): DatabaseSync => {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const database = new DatabaseSync(filePath);
  database.exec(SQLITE_SCHEMA);
  return database;
};

const rowToAgentRecord = (row: Record<string, unknown>): AgentRecord => ({
  id: String(row.id),
  name: String(row.name),
  prompt: String(row.prompt),
  chatId: String(row.chat_id),
  origin: parseJsonField<Origin>(row.origin_json),
  notify: parseJsonField<NotificationPolicy>(row.notify_json),
  notifyTarget: parseJsonField<NotificationTarget>(row.notify_target_json),
  status: row.status as AgentRecord["status"],
  maxSteps: row.max_steps === null ? undefined : Number(row.max_steps),
  timeoutMs: Number(row.timeout_ms),
  stepIntervalMs: row.step_interval_ms === null ? undefined : Number(row.step_interval_ms),
  stepCount: Number(row.step_count),
  createdAt: String(row.created_at),
  startedAt: row.started_at === null ? undefined : String(row.started_at),
  finishedAt: row.finished_at === null ? undefined : String(row.finished_at),
  lastMessage: row.last_message === null ? undefined : String(row.last_message),
  lastError: row.last_error === null ? undefined : String(row.last_error),
});

const rowToInboxEntry = (row: Record<string, unknown>): InboxEntry => ({
  id: String(row.id),
  kind: row.kind as InboxEntry["kind"],
  text: String(row.text),
  origin: JSON.parse(String(row.origin_json)) as Origin,
  sourceType: row.source_type as InboxEntry["sourceType"],
  sourceId: String(row.source_id),
  sourceName: row.source_name === null ? undefined : String(row.source_name),
  createdAt: String(row.created_at),
  sentAt: row.sent_at === null ? undefined : String(row.sent_at),
  readAt: row.read_at === null ? undefined : String(row.read_at),
});

const rowToScheduledTask = (row: Record<string, unknown>): ScheduledTask => ({
  id: String(row.id),
  chatId: String(row.chat_id),
  origin: parseJsonField<Origin>(row.origin_json),
  notify: parseJsonField<NotificationPolicy>(row.notify_json),
  notifyTarget: parseJsonField<NotificationTarget>(row.notify_target_json),
  title: String(row.title),
  prompt: String(row.prompt),
  schedule: JSON.parse(String(row.schedule_json)) as TaskSchedule,
  nextRunAt: String(row.next_run_at),
  status: row.status as ScheduledTask["status"],
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
  lastRunAt: row.last_run_at === null ? undefined : String(row.last_run_at),
  lastError: row.last_error === null ? undefined : String(row.last_error),
});

export class SqliteAgentStore implements AgentStore {
  private readonly database: DatabaseSync;

  constructor(filePath: string) {
    this.database = openDatabase(filePath);
  }

  getAgent(agentId: string): AgentRecord | undefined {
    const row = this.database
      .prepare("select * from agents where id = ?")
      .get(agentId) as Record<string, unknown> | undefined;
    return row ? rowToAgentRecord(row) : undefined;
  }

  saveAgent(record: AgentRecord): void {
    this.database
      .prepare(`
        insert into agents (
          id, name, prompt, chat_id, origin_json, notify_json, notify_target_json,
          status, max_steps, timeout_ms, step_interval_ms, step_count, created_at,
          started_at, finished_at, last_message, last_error
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(id) do update set
          name = excluded.name,
          prompt = excluded.prompt,
          chat_id = excluded.chat_id,
          origin_json = excluded.origin_json,
          notify_json = excluded.notify_json,
          notify_target_json = excluded.notify_target_json,
          status = excluded.status,
          max_steps = excluded.max_steps,
          timeout_ms = excluded.timeout_ms,
          step_interval_ms = excluded.step_interval_ms,
          step_count = excluded.step_count,
          created_at = excluded.created_at,
          started_at = excluded.started_at,
          finished_at = excluded.finished_at,
          last_message = excluded.last_message,
          last_error = excluded.last_error
      `)
      .run(
        record.id,
        record.name,
        record.prompt,
        record.chatId,
        stringifyJsonField(record.origin),
        stringifyJsonField(record.notify),
        stringifyJsonField(record.notifyTarget),
        record.status,
        record.maxSteps ?? null,
        record.timeoutMs,
        record.stepIntervalMs ?? null,
        record.stepCount,
        record.createdAt,
        record.startedAt ?? null,
        record.finishedAt ?? null,
        record.lastMessage ?? null,
        record.lastError ?? null,
      );
  }

  listAgents(): AgentRecord[] {
    const rows = this.database
      .prepare("select * from agents order by created_at asc")
      .all() as Record<string, unknown>[];
    return rows.map(rowToAgentRecord);
  }
}

export class SqliteInboxStore implements InboxStore {
  private readonly database: DatabaseSync;

  constructor(filePath: string) {
    this.database = openDatabase(filePath);
  }

  async loadEntries(): Promise<InboxEntry[]> {
    const rows = this.database
      .prepare("select * from inbox order by created_at asc")
      .all() as Record<string, unknown>[];
    return rows.map(rowToInboxEntry);
  }

  async saveEntry(entry: InboxEntry): Promise<void> {
    this.database
      .prepare(`
        insert into inbox (
          id, kind, text, origin_json, source_type, source_id, source_name, created_at, sent_at, read_at
        )
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        entry.id,
        entry.kind,
        entry.text,
        JSON.stringify(entry.origin),
        entry.sourceType,
        entry.sourceId,
        entry.sourceName ?? null,
        entry.createdAt,
        entry.sentAt ?? null,
        entry.readAt ?? null,
      );
  }
}

export class SqliteTaskStore implements TaskStore {
  private readonly database: DatabaseSync;

  constructor(filePath: string) {
    this.database = openDatabase(filePath);
  }

  async loadTasks(): Promise<ScheduledTask[]> {
    const rows = this.database
      .prepare("select * from tasks order by next_run_at asc")
      .all() as Record<string, unknown>[];
    return rows.map(rowToScheduledTask);
  }

  async saveTasks(tasks: ScheduledTask[]): Promise<void> {
    this.database.exec("begin");
    try {
      this.database.prepare("delete from tasks").run();
      const insertTask = this.database.prepare(`
        insert into tasks (
          id, chat_id, origin_json, notify_json, notify_target_json,
          title, prompt, schedule_json, next_run_at, status,
          created_at, updated_at, last_run_at, last_error
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const task of tasks) {
        insertTask.run(
          task.id,
          task.chatId,
          stringifyJsonField(task.origin),
          stringifyJsonField(task.notify),
          stringifyJsonField(task.notifyTarget),
          task.title,
          task.prompt,
          JSON.stringify(task.schedule),
          task.nextRunAt,
          task.status,
          task.createdAt,
          task.updatedAt,
          task.lastRunAt ?? null,
          task.lastError ?? null,
        );
      }

      this.database.exec("commit");
    } catch (error) {
      this.database.exec("rollback");
      throw error;
    }
  }

  async logTaskRun(entry: TaskRunLogEntry): Promise<void> {
    this.database
      .prepare(`
        insert into task_runs (
          timestamp, task_id, chat_id, title, prompt, schedule_json,
          scheduled_for, started_at, finished_at, status, error
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        entry.timestamp,
        entry.taskId,
        entry.chatId,
        entry.title,
        entry.prompt,
        JSON.stringify(entry.schedule),
        entry.scheduledFor,
        entry.startedAt,
        entry.finishedAt,
        entry.status,
        entry.error ?? null,
      );
  }
}

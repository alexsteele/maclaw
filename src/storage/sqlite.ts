// SQLite-backed project stores.
// Note that chat transcripts are still stored in .jsonl.
import { mkdirSync } from "node:fs";
import path from "node:path";
import { readdir, rm, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import {
  defaultAgentsDir,
  defaultAgentsFile,
  defaultSqliteFile,
  type ProjectConfig,
} from "../config.js";
import type { AgentMemoryEntry, AgentMemoryStore, AgentStore } from "../agent.js";
import type { AgentInboxStore } from "../agent-inbox.js";
import type { ChatLoadOptions, ChatStore } from "../chats.js";
import { appendJsonLine, ensureDir, readJsonLines } from "../fs-utils.js";
import type { InboxStore } from "../inbox.js";
import type { TaskStore } from "../scheduler.js";
import {
  loadProjectSnapshot,
  restoreProjectSnapshot,
  type ProjectSnapshot,
  type ProjectStorage,
} from "./index.js";
import { logger } from "../logger.js";
import type {
  AgentInboxEntry,
  AgentRecord,
  ChatRecord,
  ChatSummary,
  Message,
  InboxEntry,
  NotificationPolicy,
  NotificationTarget,
  Origin,
  ScheduledTask,
  TaskRunLogEntry,
  TaskSchedule,
} from "../types.js";
import { JsonFileAgentMemoryStore, JsonFileAgentStore } from "./json.js";

const SQLITE_SCHEMA = `
  create table if not exists chats (
    id text primary key,
    created_at text not null,
    updated_at text not null,
    retention_days integer not null,
    compression_mode text not null,
    summary text,
    message_count integer not null
  );

  create table if not exists agents (
    id text primary key,
    name text not null,
    prompt text not null,
    chat_id text not null,
    toolsets_json text,
    source_chat_id text,
    created_by text,
    created_by_agent_id text,
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
    source_chat_id text,
    created_at text not null,
    sent_at text,
    read_at text
  );

  create table if not exists agent_inbox (
    id text primary key,
    agent_id text not null,
    text text not null,
    source_type text not null,
    source_id text not null,
    source_name text,
    source_chat_id text,
    created_at text not null,
    read_at text
  );

  create table if not exists tasks (
    id text primary key,
    chat_id text not null,
    source_chat_id text,
    created_by text,
    created_by_agent_id text,
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

const SQLITE_COLUMNS: Record<string, Record<string, string>> = {
  chats: {
    id: "text primary key",
    created_at: "text not null",
    updated_at: "text not null",
    retention_days: "integer not null",
    compression_mode: "text not null",
    summary: "text",
    message_count: "integer not null",
  },
  agents: {
    id: "text primary key",
    name: "text not null",
    prompt: "text not null",
    chat_id: "text not null",
    toolsets_json: "text",
    source_chat_id: "text",
    created_by: "text",
    created_by_agent_id: "text",
    origin_json: "text",
    notify_json: "text",
    notify_target_json: "text",
    status: "text not null",
    max_steps: "integer",
    timeout_ms: "integer not null",
    step_interval_ms: "integer",
    step_count: "integer not null",
    created_at: "text not null",
    started_at: "text",
    finished_at: "text",
    last_message: "text",
    last_error: "text",
  },
  inbox: {
    id: "text primary key",
    kind: "text not null",
    text: "text not null",
    origin_json: "text not null",
    source_type: "text not null",
    source_id: "text not null",
    source_name: "text",
    source_chat_id: "text",
    created_at: "text not null",
    sent_at: "text",
    read_at: "text",
  },
  agent_inbox: {
    id: "text primary key",
    agent_id: "text not null",
    text: "text not null",
    source_type: "text not null",
    source_id: "text not null",
    source_name: "text",
    source_chat_id: "text",
    created_at: "text not null",
    read_at: "text",
  },
  tasks: {
    id: "text primary key",
    chat_id: "text not null",
    source_chat_id: "text",
    created_by: "text",
    created_by_agent_id: "text",
    origin_json: "text",
    notify_json: "text",
    notify_target_json: "text",
    title: "text not null",
    prompt: "text not null",
    schedule_json: "text not null",
    next_run_at: "text not null",
    status: "text not null",
    created_at: "text not null",
    updated_at: "text not null",
    last_run_at: "text",
    last_error: "text",
  },
  task_runs: {
    id: "integer primary key autoincrement",
    timestamp: "text not null",
    task_id: "text not null",
    chat_id: "text not null",
    title: "text not null",
    prompt: "text not null",
    schedule_json: "text not null",
    scheduled_for: "text not null",
    started_at: "text not null",
    finished_at: "text not null",
    status: "text not null",
    error: "text",
  },
};

const parseJsonField = <T>(value: unknown): T | undefined => {
  if (value === null) {
    return undefined;
  }

  return JSON.parse(String(value)) as T;
};

const stringifyJsonField = (value: unknown): string | null =>
  value === undefined ? null : JSON.stringify(value);

const toText = (value: unknown): string => String(value);

const toNullableText = (value: unknown): string | null =>
  value === undefined || value === null ? null : String(value);

const loadTableColumns = (database: DatabaseSync, tableName: string): Set<string> => {
  const rows = database
    .prepare(`pragma table_info(${tableName})`)
    .all() as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
};

const migrateDatabase = (database: DatabaseSync): void => {
  for (const [tableName, columns] of Object.entries(SQLITE_COLUMNS)) {
    const existingColumns = loadTableColumns(database, tableName);
    for (const [columnName, columnType] of Object.entries(columns)) {
      if (existingColumns.has(columnName)) {
        continue;
      }

      logger.debug("storage", "sqlite-add-column", {
        table: tableName,
        column: columnName,
        type: columnType,
      });
      database.exec(
        `alter table ${tableName} add column ${columnName} ${columnType}`,
      );
    }
  }
};

const openDatabase = (filePath: string): DatabaseSync => {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const database = new DatabaseSync(filePath);
  database.exec(SQLITE_SCHEMA);
  migrateDatabase(database);
  return database;
};

const rowToAgentRecord = (row: Record<string, unknown>): AgentRecord => ({
  id: String(row.id),
  name: String(row.name),
  prompt: String(row.prompt),
  chatId: String(row.chat_id),
  toolsets: parseJsonField<string[]>(row.toolsets_json),
  sourceChatId: row.source_chat_id === null ? undefined : String(row.source_chat_id),
  createdBy: row.created_by === null ? undefined : (String(row.created_by) as AgentRecord["createdBy"]),
  createdByAgentId:
    row.created_by_agent_id === null ? undefined : String(row.created_by_agent_id),
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
  sourceChatId: row.source_chat_id === null ? undefined : String(row.source_chat_id),
  createdAt: String(row.created_at),
  sentAt: row.sent_at === null ? undefined : String(row.sent_at),
  readAt: row.read_at === null ? undefined : String(row.read_at),
});

const rowToAgentInboxEntry = (row: Record<string, unknown>): AgentInboxEntry => ({
  id: String(row.id),
  agentId: String(row.agent_id),
  text: String(row.text),
  sourceType: row.source_type as AgentInboxEntry["sourceType"],
  sourceId: String(row.source_id),
  sourceName: row.source_name === null ? undefined : String(row.source_name),
  sourceChatId: row.source_chat_id === null ? undefined : String(row.source_chat_id),
  createdAt: String(row.created_at),
  readAt: row.read_at === null ? undefined : String(row.read_at),
});

const rowToScheduledTask = (row: Record<string, unknown>): ScheduledTask => ({
  id: String(row.id),
  chatId: String(row.chat_id),
  sourceChatId: row.source_chat_id === null ? undefined : String(row.source_chat_id),
  createdBy: row.created_by === null ? undefined : (String(row.created_by) as ScheduledTask["createdBy"]),
  createdByAgentId:
    row.created_by_agent_id === null ? undefined : String(row.created_by_agent_id),
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

const chatTranscriptPath = (chatsDir: string, chatId: string): string =>
  path.join(chatsDir, `${chatId}.jsonl`);

const createEmptyChat = (chatId: string, options: ChatLoadOptions): ChatRecord => {
  const now = new Date().toISOString();
  return {
    id: chatId,
    createdAt: now,
    updatedAt: now,
    retentionDays: options.retentionDays,
    compressionMode: options.compressionMode,
    messages: [],
  };
};

const normalizeChat = (
  chat: ChatRecord,
  options: ChatLoadOptions,
): ChatRecord => ({
  ...chat,
  retentionDays: options.retentionDays,
  compressionMode: options.compressionMode,
});

const rowToChatMetadata = (
  row: Record<string, unknown>,
  messages: Message[],
  options: ChatLoadOptions,
): ChatRecord =>
  normalizeChat(
    {
      id: String(row.id),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      retentionDays: Number(row.retention_days),
      compressionMode: row.compression_mode as ChatRecord["compressionMode"],
      summary: row.summary === null ? undefined : String(row.summary),
      messages,
    },
    options,
  );

export class SqliteAgentStore implements AgentStore {
  private readonly database: DatabaseSync;
  private readonly fileStore: JsonFileAgentStore;

  constructor(filePath: string, projectFolder: string) {
    this.database = openDatabase(filePath);
    this.fileStore = new JsonFileAgentStore(defaultAgentsFile(projectFolder));
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
          id, name, prompt, chat_id, toolsets_json, source_chat_id, created_by, created_by_agent_id, origin_json, notify_json, notify_target_json,
          status, max_steps, timeout_ms, step_interval_ms, step_count, created_at,
          started_at, finished_at, last_message, last_error
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(id) do update set
          name = excluded.name,
          prompt = excluded.prompt,
          chat_id = excluded.chat_id,
          toolsets_json = excluded.toolsets_json,
          source_chat_id = excluded.source_chat_id,
          created_by = excluded.created_by,
          created_by_agent_id = excluded.created_by_agent_id,
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
        toText(record.id),
        toText(record.name),
        toText(record.prompt),
        toText(record.chatId),
        stringifyJsonField(record.toolsets),
        toNullableText(record.sourceChatId),
        toNullableText(record.createdBy),
        toNullableText(record.createdByAgentId),
        stringifyJsonField(record.origin),
        stringifyJsonField(record.notify),
        stringifyJsonField(record.notifyTarget),
        toText(record.status),
        record.maxSteps ?? null,
        record.timeoutMs,
        record.stepIntervalMs ?? null,
        record.stepCount,
        toText(record.createdAt),
        toNullableText(record.startedAt),
        toNullableText(record.finishedAt),
        toNullableText(record.lastMessage),
        toNullableText(record.lastError),
      );
    this.fileStore.saveAgent(record);
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
          id, kind, text, origin_json, source_type, source_id, source_name, source_chat_id, created_at, sent_at, read_at
        )
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        toText(entry.id),
        toText(entry.kind),
        toText(entry.text),
        JSON.stringify(entry.origin),
        toText(entry.sourceType),
        toText(entry.sourceId),
        toNullableText(entry.sourceName),
        toNullableText(entry.sourceChatId),
        toText(entry.createdAt),
        toNullableText(entry.sentAt),
        toNullableText(entry.readAt),
      );
  }

  async deleteEntry(entryId: string): Promise<boolean> {
    const result = this.database
      .prepare("delete from inbox where id = ?")
      .run(entryId);
    return result.changes > 0;
  }

  async clearEntries(): Promise<number> {
    const countRow = this.database
      .prepare("select count(*) as count from inbox")
      .get() as { count: number };
    this.database.prepare("delete from inbox").run();
    return Number(countRow.count);
  }
}

export class SqliteAgentInboxStore implements AgentInboxStore {
  private readonly database: DatabaseSync;

  constructor(filePath: string) {
    this.database = openDatabase(filePath);
  }

  async loadEntries(agentId: string): Promise<AgentInboxEntry[]> {
    const rows = this.database
      .prepare("select * from agent_inbox where agent_id = ? order by created_at asc")
      .all(agentId) as Record<string, unknown>[];
    return rows.map(rowToAgentInboxEntry);
  }

  async saveEntry(entry: AgentInboxEntry): Promise<void> {
    this.database
      .prepare(`
        insert into agent_inbox (
          id, agent_id, text, source_type, source_id, source_name, source_chat_id, created_at, read_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        toText(entry.id),
        toText(entry.agentId),
        toText(entry.text),
        toText(entry.sourceType),
        toText(entry.sourceId),
        toNullableText(entry.sourceName),
        toNullableText(entry.sourceChatId),
        toText(entry.createdAt),
        toNullableText(entry.readAt),
      );
  }

  async deleteEntry(agentId: string, entryId: string): Promise<boolean> {
    const result = this.database
      .prepare("delete from agent_inbox where agent_id = ? and id = ?")
      .run(agentId, entryId);
    return result.changes > 0;
  }

  async clearEntries(agentId: string): Promise<number> {
    const countRow = this.database
      .prepare("select count(*) as count from agent_inbox where agent_id = ?")
      .get(agentId) as { count: number };
    this.database.prepare("delete from agent_inbox where agent_id = ?").run(agentId);
    return Number(countRow.count);
  }
}

export class SqliteAgentMemoryStore implements AgentMemoryStore {
  private readonly fileStore: JsonFileAgentMemoryStore;

  constructor(projectFolder: string) {
    this.fileStore = new JsonFileAgentMemoryStore(projectFolder);
  }

  async loadEntry(agentId: string): Promise<AgentMemoryEntry | undefined> {
    return this.fileStore.loadEntry(agentId);
  }

  async saveEntry(entry: AgentMemoryEntry): Promise<void> {
    await this.fileStore.saveEntry(entry);
  }

  async deleteEntry(agentId: string): Promise<boolean> {
    return this.fileStore.deleteEntry(agentId);
  }

  async clearEntries(): Promise<number> {
    return this.fileStore.clearEntries();
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
          id, chat_id, source_chat_id, created_by, created_by_agent_id, origin_json, notify_json, notify_target_json,
          title, prompt, schedule_json, next_run_at, status,
          created_at, updated_at, last_run_at, last_error
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const task of tasks) {
        insertTask.run(
          toText(task.id),
          toText(task.chatId),
          toNullableText(task.sourceChatId),
          toNullableText(task.createdBy),
          toNullableText(task.createdByAgentId),
          stringifyJsonField(task.origin),
          stringifyJsonField(task.notify),
          stringifyJsonField(task.notifyTarget),
          toText(task.title),
          toText(task.prompt),
          JSON.stringify(task.schedule),
          toText(task.nextRunAt),
          toText(task.status),
          toText(task.createdAt),
          toText(task.updatedAt),
          toNullableText(task.lastRunAt),
          toNullableText(task.lastError),
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
        toText(entry.timestamp),
        toText(entry.taskId),
        toText(entry.chatId),
        toText(entry.title),
        toText(entry.prompt),
        JSON.stringify(entry.schedule),
        toText(entry.scheduledFor),
        toText(entry.startedAt),
        toText(entry.finishedAt),
        toText(entry.status),
        toNullableText(entry.error),
      );
  }
}

// note: chat transcripts stored in jsonl
// TODO: sepparate appendMessage() from saveChat()
export class SqliteChatStore implements ChatStore {
  private readonly database: DatabaseSync;
  private readonly chatsDir: string;

  constructor(filePath: string, chatsDir: string) {
    this.database = openDatabase(filePath);
    this.chatsDir = chatsDir;
  }

  async loadChat(chatId: string, options: ChatLoadOptions): Promise<ChatRecord> {
    await ensureDir(this.chatsDir);
    const row = this.database
      .prepare("select * from chats where id = ?")
      .get(chatId) as Record<string, unknown> | undefined;
    if (!row) {
      return createEmptyChat(chatId, options);
    }

    const transcript = await readJsonLines<Message>(chatTranscriptPath(this.chatsDir, chatId));
    return rowToChatMetadata(row, transcript, options);
  }

  async saveChat(chat: ChatRecord): Promise<void> {
    chat.updatedAt = new Date().toISOString();
    await ensureDir(this.chatsDir);
    const transcriptPath = chatTranscriptPath(this.chatsDir, chat.id);
    const existingRow = this.database
      .prepare("select message_count from chats where id = ?")
      .get(chat.id) as { message_count: number } | undefined;
    const existingMessageCount = existingRow?.message_count ?? 0;

    if (existingMessageCount > chat.messages.length) {
      const transcript = chat.messages.map((message) => JSON.stringify(message)).join("\n");
      await writeFile(transcriptPath, transcript.length > 0 ? `${transcript}\n` : "", "utf8");
    } else {
      for (const message of chat.messages.slice(existingMessageCount)) {
        await appendJsonLine(transcriptPath, message);
      }
    }

    this.database.prepare("delete from chats where id = ?").run(chat.id);
    this.database
      .prepare(`
        insert into chats (
          id, created_at, updated_at, retention_days, compression_mode, summary, message_count
        ) values (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        toText(chat.id),
        toText(chat.createdAt),
        toText(chat.updatedAt),
        chat.retentionDays,
        toText(chat.compressionMode),
        toNullableText(chat.summary),
        chat.messages.length,
      );
  }

  async deleteChat(chatId: string): Promise<boolean> {
    const result = this.database.prepare("delete from chats where id = ?").run(chatId);
    await rm(chatTranscriptPath(this.chatsDir, chatId), { force: true });
    return result.changes > 0;
  }

  async listChats(): Promise<ChatSummary[]> {
    const rows = this.database
      .prepare("select * from chats order by updated_at desc")
      .all() as Record<string, unknown>[];
    return rows.map((row) => ({
      id: String(row.id),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      messageCount: Number(row.message_count),
    }));
  }

  async pruneExpiredChats(retentionDays: number): Promise<number> {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    const staleRows = this.database
      .prepare("select id from chats where updated_at < ?")
      .all(cutoff) as Array<{ id: string }>;

    this.database.prepare("delete from chats where updated_at < ?").run(cutoff);
    for (const row of staleRows) {
      await rm(chatTranscriptPath(this.chatsDir, row.id), { force: true });
    }

    return staleRows.length;
  }
}

/**
 * SQLite-backed project storage with project-level snapshot and reset helpers.
 *
 * SQLite owns the metadata tables while chat transcripts still live on disk, so
 * the project storage wrapper coordinates both halves together.
 */
export class SqliteProjectStorage implements ProjectStorage {
  readonly chats: ChatStore;
  readonly tasks: TaskStore;
  readonly agents: AgentStore;
  readonly inbox: InboxStore;
  readonly agentInbox: AgentInboxStore;
  readonly agentMemory: AgentMemoryStore;
  private readonly sqliteFile: string;
  private readonly chatsDir: string;
  private readonly agentsDir: string;
  private readonly chatOptions: ChatLoadOptions;

  constructor(config: ProjectConfig) {
    this.sqliteFile = defaultSqliteFile(config.projectFolder);
    this.chatsDir = config.chatsDir;
    this.agentsDir = defaultAgentsDir(config.projectFolder);
    this.chats = new SqliteChatStore(this.sqliteFile, this.chatsDir);
    this.tasks = new SqliteTaskStore(this.sqliteFile);
    this.agents = new SqliteAgentStore(this.sqliteFile, config.projectFolder);
    this.inbox = new SqliteInboxStore(this.sqliteFile);
    this.agentInbox = new SqliteAgentInboxStore(this.sqliteFile);
    this.agentMemory = new SqliteAgentMemoryStore(config.projectFolder);
    this.chatOptions = {
      retentionDays: config.retentionDays,
      compressionMode: config.compressionMode,
    };
  }

  async loadSnapshot(activeChatId: string): Promise<ProjectSnapshot> {
    return loadProjectSnapshot(this, activeChatId, this.chatOptions);
  }

  async restoreSnapshot(snapshot: ProjectSnapshot): Promise<void> {
    await restoreProjectSnapshot(this, snapshot);
  }

  async clear(): Promise<void> {
    const database = openDatabase(this.sqliteFile);
    database.exec(`
      delete from chats;
      delete from agents;
      delete from inbox;
      delete from agent_inbox;
      delete from tasks;
      delete from task_runs;
    `);
    database.close();

    await ensureDir(this.chatsDir);
    const entries = await readdir(this.chatsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) {
        continue;
      }

      await rm(path.join(this.chatsDir, entry.name), { force: true });
    }

    await rm(this.agentsDir, { recursive: true, force: true });
  }

  // SQLite wipe removes the database file after clearing tables and transcripts.
  async wipe(): Promise<void> {
    await this.clear();
    await rm(this.sqliteFile, { force: true });
  }
}

export const createSqliteProjectStorage = (config: ProjectConfig): ProjectStorage =>
  new SqliteProjectStorage(config);

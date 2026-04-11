// JSON-backed storage implementations for project data.
// This keeps the concrete filesystem stores grouped by backend.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readdir, rm, writeFile } from "node:fs/promises";
import {
  defaultAgentsFile,
  defaultAgentInboxFile,
  defaultInboxFile,
  defaultTaskRunsFile,
  defaultTasksFile,
  type ProjectConfig,
} from "../config.js";
import type { AgentStore } from "../agent.js";
import type { AgentInboxStore } from "../agent-inbox.js";
import type { ChatLoadOptions, ChatStore } from "../chats.js";
import {
  appendJsonLine,
  ensureDir,
  readJsonFile,
  readJsonLines,
  writeJsonFile,
} from "../fs-utils.js";
import type { InboxStore } from "../inbox.js";
import type { TaskStore } from "../scheduler.js";
import {
  loadProjectSnapshot,
  restoreProjectSnapshot,
  type ProjectSnapshot,
  type ProjectStorage,
} from "./index.js";
import type {
  AgentRecord,
  AgentInboxEntry,
  ChatRecord,
  ChatSummary,
  InboxEntry,
  Message,
  ScheduledTask,
  TaskRunLogEntry,
} from "../types.js";

export class JsonFileAgentStore implements AgentStore {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  getAgent(agentId: string): AgentRecord | undefined {
    const record = this.readAgents()[agentId];
    return record ? structuredClone(record) : undefined;
  }

  saveAgent(record: AgentRecord): void {
    const agents = this.readAgents();
    agents[record.id] = structuredClone(record);
    this.writeAgents(agents);
  }

  listAgents(): AgentRecord[] {
    return Object.values(this.readAgents()).map((record) => structuredClone(record));
  }

  private readAgents(): Record<string, AgentRecord> {
    if (!existsSync(this.filePath)) {
      return {};
    }

    const raw = readFileSync(this.filePath, "utf8");
    return JSON.parse(raw) as Record<string, AgentRecord>;
  }

  private writeAgents(agents: Record<string, AgentRecord>): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, `${JSON.stringify(agents, null, 2)}\n`, "utf8");
  }
}

export class JsonFileTaskStore implements TaskStore {
  private readonly tasksFile: string;
  private readonly taskRunsFile?: string;

  constructor(tasksFile: string, taskRunsFile?: string) {
    this.tasksFile = tasksFile;
    this.taskRunsFile = taskRunsFile;
  }

  async loadTasks(): Promise<ScheduledTask[]> {
    return readJsonFile<ScheduledTask[]>(this.tasksFile, []);
  }

  async saveTasks(tasks: ScheduledTask[]): Promise<void> {
    await writeJsonFile(this.tasksFile, tasks);
  }

  async logTaskRun(entry: TaskRunLogEntry): Promise<void> {
    if (!this.taskRunsFile) {
      return;
    }

    await appendJsonLine(this.taskRunsFile, entry);
  }
}

export class JsonFileInboxStore implements InboxStore {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  loadEntries(): Promise<InboxEntry[]> {
    return readJsonLines<InboxEntry>(this.filePath);
  }

  saveEntry(entry: InboxEntry): Promise<void> {
    return appendJsonLine(this.filePath, entry);
  }

  async deleteEntry(entryId: string): Promise<boolean> {
    const entries = await this.loadEntries();
    const nextEntries = entries.filter((entry) => entry.id !== entryId);
    if (nextEntries.length === entries.length) {
      return false;
    }

    await writeJsonFile(this.filePath, nextEntries);
    return true;
  }

  async clearEntries(): Promise<number> {
    const entries = await this.loadEntries();
    await writeJsonFile(this.filePath, []);
    return entries.length;
  }
}

export class JsonFileAgentInboxStore implements AgentInboxStore {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async loadEntries(agentId: string): Promise<AgentInboxEntry[]> {
    const entries = await readJsonLines<AgentInboxEntry>(this.filePath);
    return entries.filter((entry) => entry.agentId === agentId);
  }

  saveEntry(entry: AgentInboxEntry): Promise<void> {
    return appendJsonLine(this.filePath, entry);
  }

  async deleteEntry(agentId: string, entryId: string): Promise<boolean> {
    const entries = await readJsonLines<AgentInboxEntry>(this.filePath);
    const nextEntries = entries.filter(
      (entry) => !(entry.agentId === agentId && entry.id === entryId),
    );
    if (nextEntries.length === entries.length) {
      return false;
    }

    await writeJsonFile(this.filePath, nextEntries);
    return true;
  }

  async clearEntries(agentId: string): Promise<number> {
    const entries = await readJsonLines<AgentInboxEntry>(this.filePath);
    const nextEntries = entries.filter((entry) => entry.agentId !== agentId);
    await writeJsonFile(this.filePath, nextEntries);
    return entries.length - nextEntries.length;
  }
}

type ChatMetadata = Omit<ChatRecord, "messages"> & {
  messageCount: number;
};

const chatPath = (chatsDir: string, chatId: string): string =>
  path.join(chatsDir, `${chatId}.json`);

const chatTranscriptPath = (chatsDir: string, chatId: string): string =>
  path.join(chatsDir, `${chatId}.jsonl`);

const createEmptyChat = (
  chatId: string,
  options: ChatLoadOptions,
): ChatRecord => {
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

const toChatMetadata = (chat: ChatRecord): ChatMetadata => ({
  id: chat.id,
  createdAt: chat.createdAt,
  updatedAt: chat.updatedAt,
  retentionDays: chat.retentionDays,
  compressionMode: chat.compressionMode,
  summary: chat.summary,
  messageCount: chat.messages.length,
});

const normalizeChat = (
  chat: ChatRecord,
  options: ChatLoadOptions,
): ChatRecord => {
  chat.retentionDays = options.retentionDays;
  chat.compressionMode = options.compressionMode;
  return chat;
};

export class JsonFileChatStore implements ChatStore {
  private readonly chatsDir: string;

  constructor(chatsDir: string) {
    this.chatsDir = chatsDir;
  }

  async loadChat(
    chatId: string,
    options: ChatLoadOptions,
  ): Promise<ChatRecord> {
    await ensureDir(this.chatsDir);
    const metadata = await readJsonFile<ChatMetadata | null>(
      chatPath(this.chatsDir, chatId),
      null,
    );
    if (!metadata) {
      return createEmptyChat(chatId, options);
    }

    const messages = await readJsonLines<Message>(chatTranscriptPath(this.chatsDir, chatId));
    return normalizeChat(
      {
        ...metadata,
        messages,
      },
      options,
    );
  }

  async saveChat(chat: ChatRecord): Promise<void> {
    chat.updatedAt = new Date().toISOString();
    await ensureDir(this.chatsDir);

    const metadataPath = chatPath(this.chatsDir, chat.id);
    const transcriptPath = chatTranscriptPath(this.chatsDir, chat.id);
    const existingMetadata = await readJsonFile<ChatMetadata | null>(metadataPath, null);
    const existingMessageCount = existingMetadata?.messageCount ?? 0;

    if (existingMessageCount > chat.messages.length) {
      const transcript = chat.messages.map((message) => JSON.stringify(message)).join("\n");
      await writeFile(transcriptPath, transcript.length > 0 ? `${transcript}\n` : "", "utf8");
    } else {
      for (const message of chat.messages.slice(existingMessageCount)) {
        await appendJsonLine(transcriptPath, message);
      }
    }

    await writeJsonFile(metadataPath, toChatMetadata(chat));
  }

  async deleteChat(chatId: string): Promise<boolean> {
    const metadataPath = chatPath(this.chatsDir, chatId);
    const transcriptPath = chatTranscriptPath(this.chatsDir, chatId);
    if (!existsSync(metadataPath) && !existsSync(transcriptPath)) {
      return false;
    }

    await rm(metadataPath, { force: true });
    await rm(transcriptPath, { force: true });
    return true;
  }

  async listChats(): Promise<ChatSummary[]> {
    await ensureDir(this.chatsDir);
    const entries = await readdir(this.chatsDir, { withFileTypes: true });
    const chats: ChatSummary[] = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }

      const fullPath = path.join(this.chatsDir, entry.name);
      const metadata = await readJsonFile<ChatMetadata | null>(fullPath, null);
      if (!metadata) {
        continue;
      }

      chats.push({
        id: metadata.id,
        createdAt: metadata.createdAt,
        updatedAt: metadata.updatedAt,
        messageCount: metadata.messageCount,
      });
    }

    return chats.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async pruneExpiredChats(retentionDays: number): Promise<number> {
    await ensureDir(this.chatsDir);
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const entries = await readdir(this.chatsDir, { withFileTypes: true });

    let removed = 0;
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }

      const fullPath = path.join(this.chatsDir, entry.name);
      const metadata = await readJsonFile<ChatMetadata | null>(fullPath, null);
      if (!metadata) {
        continue;
      }

      const updatedAt = Date.parse(metadata.updatedAt);
      if (Number.isFinite(updatedAt) && updatedAt < cutoff) {
        await rm(fullPath, { force: true });
        await rm(
          chatTranscriptPath(this.chatsDir, entry.name.replace(/\.json$/u, "")),
          { force: true },
        );
        removed += 1;
      }
    }

    return removed;
  }
}

/**
 * JSON-backed project storage with project-level snapshot and reset helpers.
 *
 * This keeps migration behavior close to the backend that owns the underlying
 * file layout.
 */
export class JsonProjectStorage implements ProjectStorage {
  readonly chats: ChatStore;
  readonly tasks: TaskStore;
  readonly agents: AgentStore;
  readonly inbox: InboxStore;
  readonly agentInbox: AgentInboxStore;
  private readonly chatsDir: string;
  private readonly tasksFile: string;
  private readonly taskRunsFile: string;
  private readonly agentsFile: string;
  private readonly inboxFile: string;
  private readonly agentInboxFile: string;
  private readonly chatOptions: ChatLoadOptions;

  constructor(
    chats: ChatStore,
    tasks: TaskStore,
    agents: AgentStore,
    inbox: InboxStore,
    agentInbox: AgentInboxStore,
    chatsDir: string,
    tasksFile: string,
    taskRunsFile: string,
    agentsFile: string,
    inboxFile: string,
    agentInboxFile: string,
    chatOptions: ChatLoadOptions,
  ) {
    this.chats = chats;
    this.tasks = tasks;
    this.agents = agents;
    this.inbox = inbox;
    this.agentInbox = agentInbox;
    this.chatsDir = chatsDir;
    this.tasksFile = tasksFile;
    this.taskRunsFile = taskRunsFile;
    this.agentsFile = agentsFile;
    this.inboxFile = inboxFile;
    this.agentInboxFile = agentInboxFile;
    this.chatOptions = chatOptions;
  }

  async loadSnapshot(activeChatId: string): Promise<ProjectSnapshot> {
    return loadProjectSnapshot(this, activeChatId, this.chatOptions);
  }

  async restoreSnapshot(snapshot: ProjectSnapshot): Promise<void> {
    await restoreProjectSnapshot(this, snapshot);
  }

  async clear(): Promise<void> {
    await rm(this.agentsFile, { force: true });
    await rm(this.inboxFile, { force: true });
    await rm(this.agentInboxFile, { force: true });
    await rm(this.tasksFile, { force: true });
    await rm(this.taskRunsFile, { force: true });

    if (!existsSync(this.chatsDir)) {
      return;
    }

    const entries = await readdir(this.chatsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (
        !entry.isFile() ||
        (!entry.name.endsWith(".json") && !entry.name.endsWith(".jsonl"))
      ) {
        continue;
      }

      await rm(path.join(this.chatsDir, entry.name), { force: true });
    }
  }

  // JSON storage clears by deleting the backend files in place.
  async wipe(): Promise<void> {
    await this.clear();
  }
}

export const createJsonProjectStorage = (config: ProjectConfig): ProjectStorage =>
  new JsonProjectStorage(
    new JsonFileChatStore(config.chatsDir),
    new JsonFileTaskStore(
      defaultTasksFile(config.projectFolder),
      defaultTaskRunsFile(config.projectFolder),
    ),
    new JsonFileAgentStore(defaultAgentsFile(config.projectFolder)),
    new JsonFileInboxStore(defaultInboxFile(config.projectFolder)),
    new JsonFileAgentInboxStore(defaultAgentInboxFile(config.projectFolder)),
    config.chatsDir,
    defaultTasksFile(config.projectFolder),
    defaultTaskRunsFile(config.projectFolder),
    defaultAgentsFile(config.projectFolder),
    defaultInboxFile(config.projectFolder),
    defaultAgentInboxFile(config.projectFolder),
    {
      retentionDays: config.retentionDays,
      compressionMode: config.compressionMode,
    },
  );

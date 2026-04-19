import type { ChatLoadOptions, ChatRuntime } from "./chats.js";
import type { Tool } from "./tools/types.js";
import type { AgentRecord, ChatRecord, Message } from "./types.js";

export const AGENT_DONE_INSTRUCTIONS =
  "If you are finished, end your response with a final line that contains only <AGENT_DONE>.";

const CONTINUE_PROMPT =
  `Continue working on the task. ${AGENT_DONE_INSTRUCTIONS}`;

export const formatAgentPrompt = (prompt: string): string =>
  prompt.includes("<AGENT_DONE>")
    ? prompt
    : `${prompt.trim()}\n\n${AGENT_DONE_INSTRUCTIONS}`;

const isDoneMessage = (content: string): boolean => {
  const lines = content.trim().split("\n").map((line) => line.trim());
  return lines[lines.length - 1] === "<AGENT_DONE>";
};

export type AgentMemoryEntry = {
  agentId: string;
  text: string;
  updatedAt: string;
};

export interface AgentStore {
  getAgent(agentId: string): AgentRecord | undefined;
  saveAgent(record: AgentRecord): void;
  deleteAgent(agentId: string): boolean;
  listAgents(): AgentRecord[];
  loadAgentChat(agentId: string, options: ChatLoadOptions): Promise<ChatRecord>;
  saveAgentChat(agentId: string, chat: ChatRecord): Promise<void>;
  deleteAgentChat(agentId: string): Promise<boolean>;
}

export interface AgentMemoryStore {
  loadEntry(agentId: string): Promise<AgentMemoryEntry | undefined>;
  saveEntry(entry: AgentMemoryEntry): Promise<void>;
  deleteEntry(agentId: string): Promise<boolean>;
  clearEntries(): Promise<number>;
}

export class MemoryAgentStore implements AgentStore {
  private readonly agents = new Map<string, AgentRecord>();
  private readonly chats = new Map<string, ChatRecord>();

  getAgent(agentId: string): AgentRecord | undefined {
    const record = this.agents.get(agentId);
    return record ? structuredClone(record) : undefined;
  }

  saveAgent(record: AgentRecord): void {
    this.agents.set(record.id, structuredClone(record));
  }

  deleteAgent(agentId: string): boolean {
    return this.agents.delete(agentId);
  }

  listAgents(): AgentRecord[] {
    return Array.from(this.agents.values()).map((record) => structuredClone(record));
  }

  async loadAgentChat(
    agentId: string,
    options: ChatLoadOptions,
  ): Promise<ChatRecord> {
    const existing = this.chats.get(agentId);
    if (existing) {
      const normalized = structuredClone(existing);
      normalized.retentionDays = options.retentionDays;
      normalized.compressionMode = options.compressionMode;
      this.chats.set(agentId, structuredClone(normalized));
      return normalized;
    }

    const chatId = this.getAgent(agentId)?.chatId ?? agentId;
    const now = new Date().toISOString();
    const chat: ChatRecord = {
      id: chatId,
      createdAt: now,
      updatedAt: now,
      retentionDays: options.retentionDays,
      compressionMode: options.compressionMode,
      messages: [],
    };
    this.chats.set(agentId, structuredClone(chat));
    return chat;
  }

  async saveAgentChat(agentId: string, chat: ChatRecord): Promise<void> {
    chat.updatedAt = new Date().toISOString();
    this.chats.set(agentId, structuredClone(chat));
  }

  async deleteAgentChat(agentId: string): Promise<boolean> {
    return this.chats.delete(agentId);
  }
}

export class MemoryAgentMemoryStore implements AgentMemoryStore {
  private readonly entries = new Map<string, AgentMemoryEntry>();

  async loadEntry(agentId: string): Promise<AgentMemoryEntry | undefined> {
    const entry = this.entries.get(agentId);
    return entry ? structuredClone(entry) : undefined;
  }

  async saveEntry(entry: AgentMemoryEntry): Promise<void> {
    this.entries.set(entry.agentId, structuredClone(entry));
  }

  async deleteEntry(agentId: string): Promise<boolean> {
    return this.entries.delete(agentId);
  }

  async clearEntries(): Promise<number> {
    const count = this.entries.size;
    this.entries.clear();
    return count;
  }
}

export const createAgentMemoryEntry = (input: {
  agentId: string;
  text: string;
}): AgentMemoryEntry => ({
  agentId: input.agentId,
  text: input.text,
  updatedAt: new Date().toISOString(),
});

// Agent runs tasks autonomously in a loop.
// An agent runs in a single project with its own chat (or user provided chat ID).
// An agent can be "steered" by sending it prompts which are inserted in the loop.
export class Agent {
  private readonly agentStore: AgentStore;
  private readonly chatOptions: ChatLoadOptions;
  private readonly chatRuntime: Pick<ChatRuntime, "runStep">;
  private readonly tools: Tool[];
  private readonly record: AgentRecord;
  private readonly steerPrompts: string[] = [];
  private readonly onStopped?: () => void;

  constructor(
    record: AgentRecord,
    agentStore: AgentStore,
    chatOptions: ChatLoadOptions,
    chatRuntime: Pick<ChatRuntime, "runStep">,
    tools: Tool[],
    onStopped?: () => void,
  ) {
    this.record = record;
    this.agentStore = agentStore;
    this.chatOptions = chatOptions;
    this.chatRuntime = chatRuntime;
    this.tools = tools;
    this.onStopped = onStopped;
  }

  get info(): AgentRecord {
    return structuredClone(this.getRecord());
  }

  cancel(): AgentRecord {
    const record = this.getRecord();
    if (record.status === "pending" || record.status === "running" || record.status === "paused") {
      record.status = "cancelled";
      record.finishedAt = new Date().toISOString();
      this.saveRecord(record);
      this.onStopped?.();
    }

    return this.info;
  }

  pause(): AgentRecord {
    const record = this.getRecord();
    if (record.status === "pending" || record.status === "running") {
      record.status = "paused";
      this.saveRecord(record);
    }

    return this.info;
  }

  resume(): AgentRecord {
    const record = this.getRecord();
    if (record.status !== "paused") {
      return structuredClone(record);
    }

    record.status = "running";
    this.saveRecord(record);
    this.scheduleIteration();
    return structuredClone(record);
  }

  steer(prompt: string): AgentRecord {
    const trimmed = prompt.trim();
    const record = this.getRecord();
    if (
      trimmed.length === 0 ||
      (record.status !== "pending" && record.status !== "running")
    ) {
      return this.info;
    }

    this.steerPrompts.push(trimmed);
    return this.info;
  }

  start(): AgentRecord {
    const record = this.getRecord();
    if (record.status !== "pending") {
      return structuredClone(record);
    }

    record.status = "running";
    record.startedAt = new Date().toISOString();
    this.saveRecord(record);
    this.scheduleIteration();
    return structuredClone(record);
  }

  restore(): AgentRecord {
    const record = this.getRecord();
    if (record.status === "pending") {
      return this.start();
    }

    if (record.status === "running") {
      this.scheduleIteration();
    }

    return structuredClone(record);
  }

  private consumeSteerPrompt(): string | undefined {
    return this.steerPrompts.shift();
  }

  private getRecord(): AgentRecord {
    return this.agentStore.getAgent(this.record.id) ?? structuredClone(this.record);
  }

  private saveRecord(record: AgentRecord): void {
    this.agentStore.saveAgent(record);
  }

  private scheduleIteration(delayMs?: number): void {
    const timer = setTimeout(() => {
      void this.runNextIteration();
    }, delayMs ?? 0);
    timer.unref?.();
  }

  private async runNextIteration(): Promise<void> {
    const record = this.getRecord();
    if (record.status !== "running") {
      return;
    }

    if (this.isTimedOut(record)) {
      this.finish(record, "stopped");
      return;
    }

    if (record.maxSteps !== undefined && record.stepCount >= record.maxSteps) {
      this.finish(record, "stopped");
      return;
    }

    const input =
      record.stepCount === 0 ? record.prompt : this.consumeSteerPrompt() ?? CONTINUE_PROMPT;

    try {
      const chat = await this.agentStore.loadAgentChat(record.id, this.chatOptions);
      const reply = await this.chatRuntime.runStep(
        chat,
        input,
        () => this.agentStore.saveAgentChat(record.id, chat),
        undefined,
        this.tools,
      );
      const latest = this.getRecord();
      if (latest.status !== "running" && latest.status !== "paused") {
        return;
      }

      latest.stepCount += 1;
      latest.lastMessage = reply.message.content;
      this.saveRecord(latest);

      if (latest.status === "paused") {
        return;
      }

      if (isDoneMessage(reply.message.content)) {
        this.finish(latest, "completed");
        return;
      }

      if (this.isTimedOut(latest)) {
        this.finish(latest, "stopped");
        return;
      }

      if (latest.maxSteps !== undefined && latest.stepCount >= latest.maxSteps) {
        this.finish(latest, "stopped");
        return;
      }

      this.scheduleIteration(latest.stepIntervalMs);
    } catch (error) {
      this.finish(record, "failed", error instanceof Error ? error.message : String(error));
    }
  }

  private finish(
    record: AgentRecord,
    status: AgentRecord["status"],
    lastError?: string,
  ): void {
    record.status = status;
    record.finishedAt = new Date().toISOString();
    record.lastError = lastError;
    this.saveRecord(record);
    this.onStopped?.();
  }

  private isTimedOut(record: AgentRecord): boolean {
    if (!record.startedAt) {
      return false;
    }

    const startedAt = Date.parse(record.startedAt);
    if (!Number.isFinite(startedAt)) {
      return false;
    }

    return Date.now() - startedAt >= record.timeoutMs;
  }
}

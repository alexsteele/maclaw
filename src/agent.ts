import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { AgentRecord, Message } from "./types.js";

const CONTINUE_PROMPT =
  "Continue working on the task. If you are finished, end your response with a final line that contains only <AGENT_DONE>.";

const isDoneMessage = (content: string): boolean => {
  const lines = content.trim().split("\n").map((line) => line.trim());
  return lines[lines.length - 1] === "<AGENT_DONE>";
};

type RunStep = (chatId: string, input: string) => Promise<Message>;

export interface AgentStore {
  getAgent(agentId: string): AgentRecord | undefined;
  saveAgent(record: AgentRecord): void;
  listAgents(): AgentRecord[];
}

export class MemoryAgentStore implements AgentStore {
  private readonly agents = new Map<string, AgentRecord>();

  getAgent(agentId: string): AgentRecord | undefined {
    const record = this.agents.get(agentId);
    return record ? structuredClone(record) : undefined;
  }

  saveAgent(record: AgentRecord): void {
    this.agents.set(record.id, structuredClone(record));
  }

  listAgents(): AgentRecord[] {
    return Array.from(this.agents.values()).map((record) => structuredClone(record));
  }
}

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

// TODO:
// - Resume runnable agents from storage on harness/server startup.
// - Support pausing agents in addition to cancelling them.

// Agent runs tasks autonomously in a loop.
// An agent runs in a single project with its own chat (or user provided chat ID).
// An agent can be "steered" by sending it prompts which are inserted in the loop.
export class Agent {
  private readonly agentStore: AgentStore;
  private readonly runStep: RunStep;
  private readonly record: AgentRecord;
  private readonly steerQueue: string[] = [];
  private readonly onStopped?: () => void;

  constructor(
    record: AgentRecord,
    agentStore: AgentStore,
    runStep: RunStep,
    onStopped?: () => void,
  ) {
    this.record = record;
    this.agentStore = agentStore;
    this.runStep = runStep;
    this.onStopped = onStopped;
  }

  get info(): AgentRecord {
    return structuredClone(this.getRecord());
  }

  cancel(): AgentRecord {
    const record = this.getRecord();
    if (record.status === "pending" || record.status === "running") {
      record.status = "cancelled";
      record.finishedAt = new Date().toISOString();
      this.saveRecord(record);
      this.onStopped?.();
    }

    return this.info;
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

    this.steerQueue.push(trimmed);
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

  private consumeSteerPrompt(): string | undefined {
    return this.steerQueue.shift();
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
      const reply = await this.runStep(record.chatId, input);
      const latest = this.getRecord();
      if (latest.status !== "running") {
        return;
      }

      latest.stepCount += 1;
      latest.lastMessage = reply.content;
      this.saveRecord(latest);

      if (isDoneMessage(reply.content)) {
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

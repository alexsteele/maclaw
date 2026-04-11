// Agent inbox stores durable messages addressed to specific agents.
// This is kept separate from chats so agents can coordinate asynchronously and
// resume later with persisted incoming work.
import { makeId } from "./fs-utils.js";
import type { AgentInboxEntry } from "./types.js";

export const createAgentInboxEntry = (input: {
  agentId: string;
  text: string;
  sourceType: AgentInboxEntry["sourceType"];
  sourceId: string;
  sourceName?: string;
  sourceChatId?: string;
}): AgentInboxEntry => ({
  id: makeId("agent_msg"),
  agentId: input.agentId,
  text: input.text,
  sourceType: input.sourceType,
  sourceId: input.sourceId,
  sourceName: input.sourceName,
  sourceChatId: input.sourceChatId,
  createdAt: new Date().toISOString(),
});

export interface AgentInboxStore {
  loadEntries(agentId: string): Promise<AgentInboxEntry[]>;
  saveEntry(entry: AgentInboxEntry): Promise<void>;
  deleteEntry(agentId: string, entryId: string): Promise<boolean>;
  clearEntries(agentId: string): Promise<number>;
}

export class MemoryAgentInboxStore implements AgentInboxStore {
  private entries: AgentInboxEntry[] = [];

  async loadEntries(agentId: string): Promise<AgentInboxEntry[]> {
    return structuredClone(this.entries.filter((entry) => entry.agentId === agentId));
  }

  async saveEntry(entry: AgentInboxEntry): Promise<void> {
    this.entries.push(structuredClone(entry));
  }

  async deleteEntry(agentId: string, entryId: string): Promise<boolean> {
    const nextEntries = this.entries.filter(
      (entry) => !(entry.agentId === agentId && entry.id === entryId),
    );
    const deleted = nextEntries.length !== this.entries.length;
    this.entries = nextEntries;
    return deleted;
  }

  async clearEntries(agentId: string): Promise<number> {
    const count = this.entries.filter((entry) => entry.agentId === agentId).length;
    this.entries = this.entries.filter((entry) => entry.agentId !== agentId);
    return count;
  }
}

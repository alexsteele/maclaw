// Agent memory stores a small durable working note for each agent.
// This gives long-running agents a place to keep concise state across restarts
// without turning the host filesystem into a writable scratchpad.
import type { AgentMemoryEntry } from "./types.js";

export interface AgentMemoryStore {
  loadEntry(agentId: string): Promise<AgentMemoryEntry | undefined>;
  saveEntry(entry: AgentMemoryEntry): Promise<void>;
  deleteEntry(agentId: string): Promise<boolean>;
  clearEntries(): Promise<number>;
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

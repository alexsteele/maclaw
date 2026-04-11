// Helpers for creating durable agent memory entries.
import type { AgentMemoryEntry } from "./types.js";

export const createAgentMemoryEntry = (input: {
  agentId: string;
  text: string;
}): AgentMemoryEntry => ({
  agentId: input.agentId,
  text: input.text,
  updatedAt: new Date().toISOString(),
});

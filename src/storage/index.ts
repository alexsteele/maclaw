/**
 * Project storage composition and migration helpers.
 *
 * This module groups the per-domain stores into one backend-shaped object so
 * the harness can orchestrate storage changes without knowing backend-specific
 * file layouts. See `docs/design.md` for the higher-level architecture.
 */
import { type ProjectConfig } from "../config.js";
import type { AgentMemoryEntry, AgentMemoryStore, AgentStore } from "../agent.js";
import type { AgentInboxStore } from "../agent-inbox.js";
import type { ChatStore } from "../chats.js";
import type { InboxStore } from "../inbox.js";
import type { TaskStore } from "../scheduler.js";
import type {
  AgentInboxEntry,
  AgentRecord,
  ChatRecord,
  InboxEntry,
  ScheduledTask,
} from "../types.js";
import { createJsonProjectStorage } from "./json.js";
import { createMemoryProjectStorage } from "./memory.js";
import { createSqliteProjectStorage } from "./sqlite.js";

export type ProjectSnapshot = {
  chats: ChatRecord[];
  tasks: ScheduledTask[];
  agents: AgentRecord[];
  inbox: InboxEntry[];
  agentInbox: AgentInboxEntry[];
  agentMemory: AgentMemoryEntry[];
};

export interface ProjectStorage {
  chats: ChatStore;
  tasks: TaskStore;
  agents: AgentStore;
  inbox: InboxStore;
  agentInbox: AgentInboxStore;
  agentMemory: AgentMemoryStore;
  // Load/restore a snapshot of all project data.
  loadSnapshot(activeChatId: string): Promise<ProjectSnapshot>;
  restoreSnapshot(snapshot: ProjectSnapshot): Promise<void>;
  // Clear stored project data while keeping the backend ready for reuse.
  clear(): Promise<void>;
  // Fully remove backend-managed project persistence when supported.
  wipe(): Promise<void>;
}

export const loadProjectSnapshot = async (
  storage: ProjectStorage,
  activeChatId: string,
  chatOptions: { retentionDays: number; compressionMode: "none" | "planned" },
): Promise<ProjectSnapshot> => {
  const chats = await storage.chats.listChats();
  const chatIds = new Set(chats.map((chat) => chat.id));
  chatIds.add(activeChatId);

  return {
    chats: await Promise.all(
      Array.from(chatIds, (chatId) => storage.chats.loadChat(chatId, chatOptions)),
    ),
    tasks: await storage.tasks.loadTasks(),
    agents: storage.agents.listAgents(),
    inbox: await storage.inbox.loadEntries(),
    agentInbox: (
      await Promise.all(
        storage.agents.listAgents().map((agent) => storage.agentInbox.loadEntries(agent.id)),
      )
    ).flat(),
    agentMemory: (
      await Promise.all(
        storage.agents.listAgents().map((agent) => storage.agentMemory.loadEntry(agent.id)),
      )
    ).flatMap((entry) => (entry ? [entry] : [])),
  };
};

export const restoreProjectSnapshot = async (
  storage: ProjectStorage,
  snapshot: ProjectSnapshot,
): Promise<void> => {
  for (const chat of snapshot.chats) {
    await storage.chats.saveChat(structuredClone(chat));
  }

  await storage.tasks.saveTasks(snapshot.tasks);

  for (const agent of snapshot.agents) {
    storage.agents.saveAgent(structuredClone(agent));
  }

  await storage.inbox.clearEntries();
  for (const entry of snapshot.inbox) {
    await storage.inbox.saveEntry(structuredClone(entry));
  }

  const agentIds = new Set(snapshot.agentInbox.map((entry) => entry.agentId));
  for (const agentId of agentIds) {
    await storage.agentInbox.clearEntries(agentId);
  }
  for (const entry of snapshot.agentInbox) {
    await storage.agentInbox.saveEntry(structuredClone(entry));
  }

  await storage.agentMemory.clearEntries();
  for (const entry of snapshot.agentMemory) {
    await storage.agentMemory.saveEntry(structuredClone(entry));
  }
};

export const createProjectStorage = (config: ProjectConfig): ProjectStorage => {
  if (config.storage === "sqlite") {
    return createSqliteProjectStorage(config);
  }

  if (config.storage === "json") {
    return createJsonProjectStorage(config);
  }

  return createMemoryProjectStorage(config);
};

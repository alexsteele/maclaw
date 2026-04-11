/**
 * In-memory project storage for headless and test-only harnesses.
 *
 * This backend keeps all project state in process memory and supports the same
 * project-level snapshot operations as the persistent backends.
 */
import { type ProjectConfig } from "../config.js";
import {
  MemoryAgentMemoryStore,
  MemoryAgentStore,
  type AgentMemoryStore,
  type AgentStore,
} from "../agent.js";
import { MemoryAgentInboxStore, type AgentInboxStore } from "../agent-inbox.js";
import { MemoryChatStore, type ChatStore } from "../chats.js";
import { MemoryInboxStore, type InboxStore } from "../inbox.js";
import { MemoryTaskStore, type TaskStore } from "../scheduler.js";
import {
  loadProjectSnapshot,
  restoreProjectSnapshot,
  type ProjectSnapshot,
  type ProjectStorage,
} from "./index.js";

export class MemoryProjectStorage implements ProjectStorage {
  readonly chats: ChatStore;
  readonly tasks: TaskStore;
  readonly agents: AgentStore;
  readonly inbox: InboxStore;
  readonly agentInbox: AgentInboxStore;
  readonly agentMemory: AgentMemoryStore;
  private readonly config: ProjectConfig;

  constructor(config: ProjectConfig) {
    this.config = config;
    this.chats = new MemoryChatStore();
    this.tasks = new MemoryTaskStore();
    this.agents = new MemoryAgentStore();
    this.inbox = new MemoryInboxStore();
    this.agentInbox = new MemoryAgentInboxStore();
    this.agentMemory = new MemoryAgentMemoryStore();
  }

  async loadSnapshot(activeChatId: string): Promise<ProjectSnapshot> {
    return loadProjectSnapshot(this, activeChatId, {
      retentionDays: this.config.retentionDays,
      compressionMode: this.config.compressionMode,
    });
  }

  async restoreSnapshot(snapshot: ProjectSnapshot): Promise<void> {
    await restoreProjectSnapshot(this, snapshot);
  }

  // Clear stored project data while keeping the backend ready for reuse.
  async clear(): Promise<void> {
    await this.tasks.saveTasks([]);
    await this.inbox.clearEntries();
    for (const agent of this.agents.listAgents()) {
      await this.agentInbox.clearEntries(agent.id);
    }
    await this.agentMemory.clearEntries();
  }

  // Fully remove backend-managed project persistence when supported.
  async wipe(): Promise<void> {
    await this.clear();
  }
}

export const createMemoryProjectStorage = (config: ProjectConfig): ProjectStorage =>
  new MemoryProjectStorage(config);

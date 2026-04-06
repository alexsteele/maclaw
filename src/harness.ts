import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import {
  defaultProjectDataDir,
  defaultAgentsFile,
  defaultTaskRunsFile,
  defaultTasksFile,
  initProjectConfig,
  loadConfig,
  type ProjectConfig,
} from "./config.js";
import { Agent, JsonFileAgentStore, MemoryAgentStore, type AgentStore } from "./agent.js";
import { loadSkills } from "./skills.js";
import {
  JsonFileTaskStore,
  MemoryTaskStore,
  TaskScheduler,
} from "./scheduler.js";
import {
  ChatRuntime,
  type ChatReply,
  JsonFileChatStore,
  MemoryChatStore,
  type ChatLoadOptions,
  type ChatStore,
} from "./chats.js";
import type {
  AgentRecord,
  ChatRecord,
  ChatSummary,
  Message,
  ScheduledTask,
  Skill,
} from "./types.js";

type ForkChatResult =
  | { chat: ChatRecord; error?: undefined }
  | { chat?: undefined; error: string };

const createChatStore = (config: ProjectConfig): ChatStore => {
  return config.storage === "json"
    ? new JsonFileChatStore(config.chatsDir)
    : new MemoryChatStore();
};

const createScheduler = (config: ProjectConfig): TaskScheduler => {
  return config.storage === "json"
    ? new TaskScheduler(
        new JsonFileTaskStore(
          defaultTasksFile(config.projectFolder),
          defaultTaskRunsFile(config.projectFolder),
        ),
      )
    : new TaskScheduler(new MemoryTaskStore());
};

const createAgentStore = (config: ProjectConfig): AgentStore => {
  return config.storage === "json"
    ? new JsonFileAgentStore(defaultAgentsFile(config.projectFolder))
    : new MemoryAgentStore();
};

const AGENT_ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

const createShortAgentId = (): string => {
  let id = "";
  for (let index = 0; index < 6; index += 1) {
    const offset = Math.floor(Math.random() * AGENT_ID_ALPHABET.length);
    id += AGENT_ID_ALPHABET[offset];
  }

  return id;
};

// Harness orchestrates user interactions with a project.
// A default harness has no project. initProject() creates one.
export class Harness {
  private _config: ProjectConfig;
  private _scheduler: TaskScheduler;
  private _chatStore: ChatStore;
  private _chatRuntime: ChatRuntime;
  private _agentStore: AgentStore;
  private _runningAgents = new Map<string, Agent>();
  private _taskListener?: (task: ScheduledTask, message: Message) => void | Promise<void>;

  constructor(config: ProjectConfig) {
    this._config = config;
    this._scheduler = createScheduler(config);
    this._chatStore = createChatStore(config);
    this._chatRuntime = new ChatRuntime(config, this._scheduler, this._chatStore);
    this._agentStore = createAgentStore(config);
  }

  static load(cwd?: string): Harness {
    return new Harness(loadConfig(cwd));
  }

  get config(): ProjectConfig {
    return this._config;
  }

  isProjectInitialized(): boolean {
    return existsSync(this._config.projectConfigFile);
  }

  start(
    onTaskMessage: (task: ScheduledTask, message: Message) => void | Promise<void>,
  ): Promise<void> {
    this._taskListener = onTaskMessage;
    return this.pruneExpiredChats().then(() => {
      this._scheduler.start(this._config.schedulerPollMs, async (task) => {
        const message = await this.handleScheduledTask(task.chatId, task.prompt);
        await onTaskMessage(task, message);
      });
    });
  }

  teardown(): void {
    for (const agent of this._runningAgents.values()) {
      agent.cancel();
    }
    this._runningAgents.clear();
    this._scheduler.stop();
  }

  async initProject(configPatch: Partial<ProjectConfig> = {}): Promise<Harness> {
    if (this.isProjectInitialized()) {
      return this;
    }

    await initProjectConfig(this.config.projectFolder, {
      ...configPatch,
      createdAt: this.config.createdAt ?? new Date().toISOString(),
    });
    const nextConfig: ProjectConfig = {
      ...loadConfig(this._config.projectFolder),
      chatId: this.getCurrentChatId(),
    };
    const nextChatStore = createChatStore(nextConfig);
    const nextScheduler = createScheduler(nextConfig);
    const nextChatRuntime = new ChatRuntime(nextConfig, nextScheduler, nextChatStore);
    const nextAgentStore = createAgentStore(nextConfig);

    const activeChat = await this.loadCurrentChat();
    await nextChatStore.saveChat(activeChat);

    const chats = await this.listChats();
    for (const summary of chats) {
      const chat = await this.loadChat(summary.id);
      await nextChatStore.saveChat(chat);
    }

    const tasks = await this.listTasks();
    await nextScheduler.replaceTasks(tasks);

    if (this._taskListener) {
      this.teardown();
    }

    this._config = nextConfig;
    this._chatStore = nextChatStore;
    this._scheduler = nextScheduler;
    this._chatRuntime = nextChatRuntime;
    this._agentStore = nextAgentStore;

    if (this._taskListener) {
      await this.start(this._taskListener);
    }

    return this;
  }

  async wipeProject(): Promise<boolean> {
    if (!this.isProjectInitialized()) {
      return false;
    }

    this.teardown();
    await rm(defaultProjectDataDir(this._config.projectFolder), {
      recursive: true,
      force: true,
    });

    const nextConfig = loadConfig(this._config.projectFolder);
    this._config = nextConfig;
    this._scheduler = createScheduler(nextConfig);
    this._chatStore = createChatStore(nextConfig);
    this._chatRuntime = new ChatRuntime(nextConfig, this._scheduler, this._chatStore);
    this._agentStore = createAgentStore(nextConfig);

    if (this._taskListener) {
      await this.start(this._taskListener);
    }

    return true;
  }

  getCurrentChatId(): string {
    return this._chatRuntime.getCurrentChatId();
  }

  getChatOptions(): ChatLoadOptions {
    return {
      retentionDays: this.config.retentionDays,
      compressionMode: this.config.compressionMode,
    };
  }

  async pruneExpiredChats(): Promise<number> {
    return this._chatStore.pruneExpiredChats(this._config.retentionDays);
  }

  async listChats(): Promise<ChatSummary[]> {
    return this._chatRuntime.listChats();
  }

  async listSkills(): Promise<Skill[]> {
    return loadSkills(this._config.skillsDir);
  }

  async switchChat(chatId: string): Promise<ChatRecord> {
    return this._chatRuntime.switchChat(chatId);
  }

  private parseRequestedChatId(value: string): string | null {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return null;
    }

    return /^[A-Za-z0-9._-]+$/u.test(trimmed) ? trimmed : null;
  }

  private async buildForkChatId(requestedId?: string): Promise<string | null> {
    if (requestedId && requestedId.trim().length > 0) {
      return this.parseRequestedChatId(requestedId);
    }

    const baseId = `${this.getCurrentChatId()}-fork`;
    const existingIds = new Set((await this.listChats()).map((chat) => chat.id));
    if (!existingIds.has(baseId)) {
      return baseId;
    }

    for (let index = 2; index < 10_000; index += 1) {
      const candidate = `${baseId}-${index}`;
      if (!existingIds.has(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  async forkChat(requestedId?: string): Promise<ForkChatResult> {
    const newChatId = await this.buildForkChatId(requestedId);
    if (!newChatId) {
      return { error: "Could not create a valid chat id for the fork." };
    }

    const existingChats = await this.listChats();
    if (existingChats.some((chat) => chat.id === newChatId)) {
      return { error: `chat already exists: ${newChatId}` };
    }

    return { chat: await this._chatRuntime.forkChat(newChatId) };
  }

  async loadCurrentChat(): Promise<ChatRecord> {
    return this._chatRuntime.loadActiveChat();
  }

  async getCurrentChatTranscript(): Promise<string> {
    return this.getChatTranscript();
  }

  async getChatTranscript(chatId?: string): Promise<string> {
    const chat = chatId ? await this.loadChat(chatId) : await this.loadCurrentChat();
    return chat.messages.length === 0
      ? "No history yet."
      : chat.messages.map((message) => `[${message.role}] ${message.content}`).join("\n");
  }

  async loadChat(chatId: string): Promise<ChatRecord> {
    return this._chatStore.loadChat(chatId, this.getChatOptions());
  }

  async listTasks(chatId?: string): Promise<ScheduledTask[]> {
    return this._scheduler.listTasks(chatId);
  }

  async listCurrentChatTasks(): Promise<ScheduledTask[]> {
    return this.listTasks(this.getCurrentChatId());
  }

  async replaceTasks(tasks: ScheduledTask[]): Promise<void> {
    await this._scheduler.replaceTasks(tasks);
  }

  async createTask(input: {
    chatId?: string;
    title: string;
    prompt: string;
    schedule?: ScheduledTask["schedule"];
    runAt?: string;
  }): Promise<ScheduledTask> {
    return this._scheduler.createTask({
      chatId: input.chatId ?? this.getCurrentChatId(),
      ...input,
    });
  }

  async deleteTask(taskId: string, chatId?: string): Promise<boolean> {
    return this._scheduler.deleteTask(taskId, chatId);
  }

  async deleteTaskForCurrentChat(taskId: string): Promise<boolean> {
    return this.deleteTask(taskId, this.getCurrentChatId());
  }

  async deleteChat(chatId: string): Promise<boolean> {
    if (chatId === this.getCurrentChatId()) {
      return false;
    }

    const tasks = await this.listTasks(chatId);
    for (const task of tasks) {
      await this.deleteTask(task.id, chatId);
    }

    return this._chatStore.deleteChat(chatId);
  }

  async handleUserInput(userInput: string): Promise<Message> {
    return this._chatRuntime.handleUserInput(userInput);
  }

  async handleUserInputDetailed(userInput: string): Promise<ChatReply> {
    return this._chatRuntime.handleUserInputDetailed(userInput);
  }

  async handleUserInputForChat(chatId: string, userInput: string): Promise<Message> {
    return this._chatRuntime.handleUserInputForChat(chatId, userInput);
  }

  async handleScheduledTask(chatId: string, prompt: string): Promise<Message> {
    return this._chatRuntime.handleScheduledTask(chatId, prompt);
  }

  private createAgentId(): string {
    const existingIds = new Set(this._agentStore.listAgents().map((agent) => agent.id));

    for (let attempt = 0; attempt < 10_000; attempt += 1) {
      const candidate = `agent_${createShortAgentId()}`;
      if (!existingIds.has(candidate)) {
        return candidate;
      }
    }

    throw new Error("Could not create a unique agent id.");
  }

  createAgent(input: {
    name: string;
    prompt: string;
    maxSteps?: number;
    timeoutMs?: number;
    stepIntervalMs?: number;
    chatId?: string;
  }): AgentRecord {
    const now = new Date().toISOString();
    const id = this.createAgentId();
    const record: AgentRecord = {
      id,
      name: input.name,
      prompt: input.prompt,
      chatId: input.chatId ?? id,
      status: "pending",
      maxSteps: input.maxSteps ?? 100,
      timeoutMs: input.timeoutMs ?? 60 * 60 * 1000,
      stepIntervalMs: input.stepIntervalMs ?? 0,
      stepCount: 0,
      createdAt: now,
    };

    const agent = new Agent(
      record,
      this._agentStore,
      this.handleUserInputForChat.bind(this),
      () => {
        this._runningAgents.delete(record.id);
      },
    );
    this._runningAgents.set(record.id, agent);
    return agent.start();
  }

  listAgents(): AgentRecord[] {
    return this._agentStore.listAgents();
  }

  getAgent(agentId: string): AgentRecord | undefined {
    return this._agentStore.getAgent(agentId);
  }

  cancelAgent(agentId: string): AgentRecord | undefined {
    return this._runningAgents.get(agentId)?.cancel();
  }

  steerAgent(agentId: string, prompt: string): AgentRecord | undefined {
    return this._runningAgents.get(agentId)?.steer(prompt);
  }

  async runDueTasks(
    onTask: (task: ScheduledTask) => Promise<void>,
  ): Promise<void> {
    return this._scheduler.runDueTasks(onTask);
  }
}

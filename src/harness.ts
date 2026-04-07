import os from "node:os";
import path from "node:path";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import {
  defaultProjectDataDir,
  defaultAgentsFile,
  defaultInboxFile,
  defaultSqliteFile,
  defaultTaskRunsFile,
  defaultTasksFile,
  initProjectConfig,
  loadConfig,
  type ProjectConfig,
} from "./config.js";
import { Agent, JsonFileAgentStore, MemoryAgentStore, type AgentStore } from "./agent.js";
import { ensureDir } from "./fs-utils.js";
import {
  createInboxEntry,
  JsonFileInboxStore,
  MemoryInboxStore,
  type InboxStore,
} from "./inbox.js";
import { loadSkills } from "./skills.js";
import { expandNotificationPolicy } from "./notifications.js";
import { resolvePromptText } from "./prompt.js";
import { SqliteAgentStore, SqliteInboxStore } from "./storage/sqlite.js";
import { createTools } from "./tools/index.js";
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
  MessageContext,
  NotificationKind,
  NotificationOverride,
  NotificationPolicy,
  NotificationTarget,
  Origin,
  InboxEntry,
  Message,
  ScheduledTask,
  Skill,
  ToolDefinition,
  UsageSummary,
} from "./types.js";
import { writeFile } from "node:fs/promises";

type ForkChatResult =
  | { chat: ChatRecord; error?: undefined }
  | { chat?: undefined; error: string };

export type HarnessNotification = {
  kind: NotificationKind;
  origin: Origin;
  text: string;
  sourceType: InboxEntry["sourceType"];
  sourceId: string;
  sourceName?: string;
};

export type AgentCreateOptions = {
  name: string;
  prompt: string;
  maxSteps?: number;
  timeoutMs?: number;
  stepIntervalMs?: number;
  chatId?: string;
  origin?: AgentRecord["origin"];
} & NotificationOverride;

type AgentCreateResult =
  | { agent: AgentRecord; error?: undefined }
  | { agent?: undefined; error: string };

type AgentChatResult =
  | { agent: AgentRecord; chatId: string; error?: undefined }
  | { agent?: undefined; chatId?: undefined; error: string };

const createUsageSummary = (): UsageSummary => ({
  messageCount: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  cachedInputTokens: 0,
  reasoningTokens: 0,
});

const addUsage = (summary: UsageSummary, chat: ChatRecord): UsageSummary => {
  for (const message of chat.messages) {
    if (!message.usage) {
      continue;
    }

    summary.messageCount += 1;
    summary.inputTokens += message.usage.inputTokens ?? 0;
    summary.outputTokens += message.usage.outputTokens ?? 0;
    summary.totalTokens += message.usage.totalTokens ?? 0;
    summary.cachedInputTokens += message.usage.cachedInputTokens ?? 0;
    summary.reasoningTokens += message.usage.reasoningTokens ?? 0;
  }

  return summary;
};

const isOriginTarget = (value: NotificationTarget): value is Origin => {
  return typeof value === "object" && "userId" in value;
};

const createChatStore = (config: ProjectConfig): ChatStore => {
  return config.storage === "json" || config.storage === "sqlite"
    ? new JsonFileChatStore(config.chatsDir)
    : new MemoryChatStore();
};

const createScheduler = (config: ProjectConfig): TaskScheduler => {
  return config.storage === "json" || config.storage === "sqlite"
    ? new TaskScheduler(
        new JsonFileTaskStore(
          defaultTasksFile(config.projectFolder),
          defaultTaskRunsFile(config.projectFolder),
        ),
      )
    : new TaskScheduler(new MemoryTaskStore());
};

const createAgentStore = (config: ProjectConfig): AgentStore => {
  if (config.storage === "sqlite") {
    return new SqliteAgentStore(defaultSqliteFile(config.projectFolder));
  }

  return config.storage === "json"
    ? new JsonFileAgentStore(defaultAgentsFile(config.projectFolder))
    : new MemoryAgentStore();
};

const createInboxStore = (config: ProjectConfig): InboxStore => {
  if (config.storage === "sqlite") {
    return new SqliteInboxStore(defaultSqliteFile(config.projectFolder));
  }

  return config.storage === "json"
    ? new JsonFileInboxStore(defaultInboxFile(config.projectFolder))
    : new MemoryInboxStore();
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

const resolveOutputPath = (projectFolder: string, chatId: string, outputPath?: string): string => {
  if (!outputPath || outputPath.trim().length === 0) {
    return path.join(projectFolder, ".maclaw", "exports", `${chatId}.md`);
  }

  const trimmed = outputPath.trim();
  const expandedPath = trimmed.startsWith("~/")
    ? path.join(os.homedir(), trimmed.slice(2))
    : trimmed === "~"
      ? os.homedir()
      : trimmed;

  return path.isAbsolute(expandedPath)
    ? expandedPath
    : path.resolve(projectFolder, expandedPath);
};

// Harness orchestrates user interactions with a project.
// A default harness has no project. initProject() creates one.
export class Harness {
  private _config: ProjectConfig;
  private _allowedNotifications: Set<NotificationKind>;
  private _scheduler: TaskScheduler;
  private _chatStore: ChatStore;
  private _tools: ToolDefinition[];
  private _chatRuntime: ChatRuntime;
  private _agentStore: AgentStore;
  private _inboxStore: InboxStore;
  private _runningAgents = new Map<string, Agent>();
  private _taskListener?: (task: ScheduledTask, message: Message) => void | Promise<void>;
  private _notificationListener?: (
    notification: HarnessNotification,
  ) => void | Promise<void>;

  constructor(config: ProjectConfig) {
    this._config = config;
    this._allowedNotifications = expandNotificationPolicy(config.notifications);
    this._scheduler = createScheduler(config);
    this._chatStore = createChatStore(config);
    this._tools = createTools(config);
    this._chatRuntime = new ChatRuntime(config, this._chatStore, this._tools);
    this._agentStore = createAgentStore(config);
    this._inboxStore = createInboxStore(config);
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
    onNotification?: (notification: HarnessNotification) => void | Promise<void>,
  ): Promise<void> {
    this._taskListener = onTaskMessage;
    this._notificationListener = onNotification;
    return this.pruneExpiredChats().then(() => {
      this._scheduler.start(
        this._config.schedulerPollMs,
        this.executeScheduledTask.bind(this, onTaskMessage),
      );
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
    const nextTools = createTools(nextConfig);
    const nextChatRuntime = new ChatRuntime(nextConfig, nextChatStore, nextTools);
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
    this._allowedNotifications = expandNotificationPolicy(nextConfig.notifications);
    this._chatStore = nextChatStore;
    this._scheduler = nextScheduler;
    this._tools = nextTools;
    this._chatRuntime = nextChatRuntime;
    this._agentStore = nextAgentStore;
    this._inboxStore = createInboxStore(nextConfig);

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
    this._allowedNotifications = expandNotificationPolicy(nextConfig.notifications);
    this._scheduler = createScheduler(nextConfig);
    this._chatStore = createChatStore(nextConfig);
    this._tools = createTools(nextConfig);
    this._chatRuntime = new ChatRuntime(nextConfig, this._chatStore, this._tools);
    this._agentStore = createAgentStore(nextConfig);
    this._inboxStore = createInboxStore(nextConfig);

    if (this._taskListener) {
      await this.start(this._taskListener);
    }

    return true;
  }

  getCurrentChatId(): string {
    return this._chatRuntime.getCurrentChatId();
  }

  getPreviousChatId(): string | undefined {
    return this._chatRuntime.getPreviousChatId();
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

  listTools() {
    return this._tools;
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

  async saveChatTranscript(outputPath?: string, chatId?: string): Promise<string> {
    const requestedChatId = chatId ?? this.getCurrentChatId();
    const resolvedPath = resolveOutputPath(this.config.projectFolder, requestedChatId, outputPath);
    const transcript = await this.getChatTranscript(requestedChatId);
    await ensureDir(path.dirname(resolvedPath));
    await writeFile(resolvedPath, `${transcript}\n`, "utf8");
    return resolvedPath;
  }

  async getChatUsage(chatId?: string): Promise<UsageSummary> {
    const chat = chatId ? await this.loadChat(chatId) : await this.loadCurrentChat();
    return addUsage(createUsageSummary(), chat);
  }

  async getProjectUsage(): Promise<UsageSummary> {
    const summary = createUsageSummary();
    const chats = await this.listChats();
    for (const chat of chats) {
      addUsage(summary, await this.loadChat(chat.id));
    }

    return summary;
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
    origin?: ScheduledTask["origin"];
    notify?: NotificationPolicy;
    notifyTarget?: NotificationTarget;
    title: string;
    prompt: string;
    schedule?: ScheduledTask["schedule"];
    runAt?: string;
  }): Promise<ScheduledTask> {
    const prompt = await resolvePromptText(this.config.projectFolder, input.prompt);
    return this._scheduler.createTask({
      ...input,
      chatId: input.chatId ?? this.getCurrentChatId(),
      prompt,
    });
  }

  private async executeScheduledTask(
    onTaskMessage: ((task: ScheduledTask, message: Message) => void | Promise<void>) | undefined,
    task: ScheduledTask,
  ): Promise<void> {
    try {
      const message = await this.handleScheduledTask(
        task.chatId,
        task.prompt,
        task.origin ? { origin: task.origin } : undefined,
      );
      await onTaskMessage?.(task, message);
      await this.emitTaskNotification(task, "taskCompleted", `Task ${task.title} completed.`);
    } catch (error) {
      await this.emitTaskNotification(
        task,
        "taskFailed",
        error instanceof Error
          ? `Task ${task.title} failed: ${error.message}`
          : `Task ${task.title} failed: ${String(error)}`,
      );

      throw error;
    }
  }

  async deleteTask(taskId: string, chatId?: string): Promise<boolean> {
    return this._scheduler.deleteTask(taskId, chatId);
  }

  async deleteTaskForCurrentChat(taskId: string): Promise<boolean> {
    return this.deleteTask(taskId, this.getCurrentChatId());
  }

  private async emitNotification(notification: HarnessNotification): Promise<void> {
    if (!this._allowedNotifications.has(notification.kind)) {
      return;
    }

    await this.saveNotificationToInbox(notification);
    await Promise.resolve(this._notificationListener?.(notification));
  }

  private async saveNotificationToInbox(
    notification: HarnessNotification,
  ): Promise<void> {
    await this._inboxStore.saveEntry(
      createInboxEntry({
        kind: notification.kind,
        text: notification.text,
        origin: notification.origin,
        sourceType: notification.sourceType,
        sourceId: notification.sourceId,
        sourceName: notification.sourceName,
      }),
    );
  }

  private resolveNotificationTarget(
    origin: Origin | undefined,
    notifyTarget: NotificationTarget | undefined,
  ): Origin | undefined {
    if (!notifyTarget || notifyTarget === "origin") {
      return origin;
    }

    if (isOriginTarget(notifyTarget)) {
      return notifyTarget;
    }

    return origin?.channel === notifyTarget.channel ? origin : undefined;
  }

  private async emitTaskNotification(
    task: ScheduledTask,
    kind: NotificationKind,
    text: string,
  ): Promise<void> {
    const allowed = expandNotificationPolicy(task.notify ?? this._config.notifications);
    if (!allowed.has(kind)) {
      return;
    }

    const target = this.resolveNotificationTarget(task.origin, task.notifyTarget);
    if (!target) {
      return;
    }

    await this.emitNotification({
      kind,
      origin: target,
      text,
      sourceType: "task",
      sourceId: task.id,
      sourceName: task.title,
    });
  }

  private emitAgentNotification(
    agent: AgentRecord,
    kind: NotificationKind,
    text: string,
  ): void {
    const allowed = expandNotificationPolicy(agent.notify ?? this._config.notifications);
    if (!allowed.has(kind)) {
      return;
    }

    const target = this.resolveNotificationTarget(agent.origin, agent.notifyTarget);
    if (!target) {
      return;
    }

    void this.emitNotification({
      kind,
      origin: target,
      text,
      sourceType: "agent",
      sourceId: agent.id,
      sourceName: agent.name,
    });
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

  async prompt(userInput: string, context?: MessageContext): Promise<Message> {
    const prompt = await resolvePromptText(this.config.projectFolder, userInput);
    return this._chatRuntime.prompt(prompt, context);
  }

  async promptDetailed(userInput: string, context?: MessageContext): Promise<ChatReply> {
    const prompt = await resolvePromptText(this.config.projectFolder, userInput);
    return this._chatRuntime.promptDetailed(prompt, context);
  }

  async promptChat(
    chatId: string,
    userInput: string,
    context?: MessageContext,
  ): Promise<Message> {
    const prompt = await resolvePromptText(this.config.projectFolder, userInput);
    return this._chatRuntime.promptChat(chatId, prompt, context);
  }

  async handleScheduledTask(
    chatId: string,
    prompt: string,
    context?: MessageContext,
  ): Promise<Message> {
    return this._chatRuntime.handleScheduledTask(chatId, prompt, context);
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

  private isLiveAgentStatus(status: AgentRecord["status"]): boolean {
    return status === "pending" || status === "running" || status === "paused";
  }

  private findLiveAgentByName(name: string): AgentRecord | undefined {
    return this._agentStore
      .listAgents()
      .find((agent) => agent.name === name && this.isLiveAgentStatus(agent.status));
  }

  findAgent(agentRef: string): AgentRecord | undefined {
    return (
      this._agentStore
        .listAgents()
        .find((agent) => agent.name === agentRef) ?? this._agentStore.getAgent(agentRef)
    );
  }

  async attachAgentChat(agentRef: string): Promise<AgentChatResult> {
    const agent = this.findAgent(agentRef);
    if (!agent) {
      return { error: `agent not found: ${agentRef}` };
    }

    this.pauseAgent(agentRef);
    await this.switchChat(agent.chatId);
    return { agent: this.findAgent(agent.id) ?? agent, chatId: agent.chatId };
  }

  async returnAgentChat(agentRef: string): Promise<AgentChatResult> {
    const agent = this.findAgent(agentRef);
    if (!agent) {
      return { error: `agent not found: ${agentRef}` };
    }

    const returnChatId = this.getPreviousChatId();
    if (!returnChatId) {
      return { error: `no return chat recorded for agent: ${agent.name}` };
    }

    await this.switchChat(returnChatId);
    const resumed = this.resumeAgent(agentRef);
    return { agent: resumed ?? agent, chatId: returnChatId };
  }

  private handleAgentStopped(agentId: string): void {
    this._runningAgents.delete(agentId);
    const latest = this._agentStore.getAgent(agentId);
    if (!latest) {
      return;
    }

    if (latest.status === "completed") {
      this.emitAgentNotification(latest, "agentCompleted", `Agent ${latest.name} completed.`);
      return;
    }

    if (latest.status === "failed") {
      this.emitAgentNotification(
        latest,
        "agentFailed",
        latest.lastError
          ? `Agent ${latest.name} failed: ${latest.lastError}`
          : `Agent ${latest.name} failed.`,
      );
    }
  }

  async createAgent(input: AgentCreateOptions): Promise<AgentCreateResult> {
    if (this.findLiveAgentByName(input.name)) {
      return { error: `agent already running: ${input.name}` };
    }

    const prompt = await resolvePromptText(this.config.projectFolder, input.prompt);
    const now = new Date().toISOString();
    const id = this.createAgentId();
    const record: AgentRecord = {
      id,
      name: input.name,
      prompt,
      chatId: input.chatId ?? id,
      origin: input.origin,
      notify: input.notify,
      notifyTarget: input.notifyTarget,
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
      this.promptChat.bind(this),
      this.handleAgentStopped.bind(this, record.id),
    );
    this._runningAgents.set(record.id, agent);
    return { agent: agent.start() };
  }

  listAgents(): AgentRecord[] {
    return this._agentStore.listAgents();
  }

  async listInbox(): Promise<InboxEntry[]> {
    return this._inboxStore.loadEntries();
  }

  getAgent(agentId: string): AgentRecord | undefined {
    return this._agentStore.getAgent(agentId);
  }

  cancelAgent(agentRef: string): AgentRecord | undefined {
    const agent = this.findAgent(agentRef);
    return agent ? this._runningAgents.get(agent.id)?.cancel() : undefined;
  }

  pauseAgent(agentRef: string): AgentRecord | undefined {
    const agent = this.findAgent(agentRef);
    return agent ? this._runningAgents.get(agent.id)?.pause() : undefined;
  }

  resumeAgent(agentRef: string): AgentRecord | undefined {
    const agent = this.findAgent(agentRef);
    return agent ? this._runningAgents.get(agent.id)?.resume() : undefined;
  }

  async steerAgent(agentRef: string, prompt: string): Promise<AgentRecord | undefined> {
    const agent = this.findAgent(agentRef);
    if (!agent) {
      return undefined;
    }

    const resolvedPrompt = await resolvePromptText(this.config.projectFolder, prompt);
    return this._runningAgents.get(agent.id)?.steer(resolvedPrompt);
  }

  async runDueTasks(
    onTask: (task: ScheduledTask) => Promise<void>,
  ): Promise<void> {
    return this._scheduler.runDueTasks(async (task) => {
      await this.executeScheduledTask(undefined, task);
      await onTask(task);
    });
  }
}

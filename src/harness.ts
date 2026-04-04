import {
  initProjectConfig,
  loadConfig,
  type AppConfig,
  type ProjectConfig,
} from "./config.js";
import { MaclawAgent } from "./agent.js";
import { loadSkills } from "./skills.js";
import {
  JsonFileTaskStore,
  MemoryTaskStore,
  TaskScheduler,
} from "./scheduler.js";
import {
  JsonFileSessionStore,
  MemorySessionStore,
  type SessionLoadOptions,
  type SessionStore,
} from "./sessions.js";
import type {
  Message,
  ScheduledTask,
  SessionRecord,
  SessionSummary,
  Skill,
} from "./types.js";

export type ProjectInfo = {
  name: string;
  initialized: boolean;
  createdAt?: string;
  folder: string;
  configFile?: string;
  provider: AppConfig["provider"];
  model: string;
  retentionDays: number;
  currentChat: string;
  skillsDir: string;
};

const createSessionStore = (config: AppConfig): SessionStore => {
  return config.isProjectInitialized
    ? new JsonFileSessionStore(config.sessionsDir)
    : new MemorySessionStore();
};

const createScheduler = (config: AppConfig): TaskScheduler => {
  return config.isProjectInitialized
    ? new TaskScheduler(new JsonFileTaskStore(config.schedulerFile, config.taskRunsFile))
    : new TaskScheduler(new MemoryTaskStore());
};

export class Harness {
  private _config: AppConfig;
  private _scheduler: TaskScheduler;
  private _sessionStore: SessionStore;
  private _agent: MaclawAgent;
  private _taskListener?: (task: ScheduledTask, message: Message) => void | Promise<void>;

  constructor(config: AppConfig) {
    this._config = config;
    this._scheduler = createScheduler(config);
    this._sessionStore = createSessionStore(config);
    this._agent = new MaclawAgent(config, this._scheduler, this._sessionStore);
  }

  static load(cwd?: string): Harness {
    return new Harness(loadConfig(cwd));
  }

  get config(): AppConfig {
    return this._config;
  }

  start(
    onTaskMessage: (task: ScheduledTask, message: Message) => void | Promise<void>,
  ): void {
    this._taskListener = onTaskMessage;
    this._scheduler.start(this._config.schedulerPollMs, async (task) => {
      const message = await this.handleScheduledTask(task.sessionId, task.prompt);
      await onTaskMessage(task, message);
    });
  }

  teardown(): void {
    this._scheduler.stop();
  }

  async initProject(configPatch: Partial<ProjectConfig> = {}): Promise<Harness> {
    if (this.config.isProjectInitialized) {
      return this;
    }

    await initProjectConfig(this.config.projectFolder, {
      ...configPatch,
      createdAt: this.config.createdAt ?? new Date().toISOString(),
    });
    const nextConfig: AppConfig = {
      ...loadConfig(this._config.projectFolder),
      sessionId: this.getCurrentChatId(),
    };
    const nextSessionStore = createSessionStore(nextConfig);
    const nextScheduler = createScheduler(nextConfig);
    const nextAgent = new MaclawAgent(nextConfig, nextScheduler, nextSessionStore);

    const activeSession = await this.loadCurrentChat();
    await nextSessionStore.saveSession(activeSession);

    const sessions = await this.listChats();
    for (const summary of sessions) {
      const session = await this.loadChat(summary.id);
      await nextSessionStore.saveSession(session);
    }

    const tasks = await this.listTasks();
    await nextScheduler.replaceTasks(tasks);

    if (this._taskListener) {
      this.teardown();
    }

    this._config = nextConfig;
    this._sessionStore = nextSessionStore;
    this._scheduler = nextScheduler;
    this._agent = nextAgent;

    if (this._taskListener) {
      this.start(this._taskListener);
    }

    return this;
  }

  getCurrentChatId(): string {
    return this._agent.getCurrentSessionId();
  }

  getProjectInfo(): ProjectInfo {
    return {
      name: this.config.projectName,
      initialized: this.config.isProjectInitialized,
      createdAt: this.config.createdAt,
      folder: this.config.projectFolder,
      configFile: this.config.isProjectInitialized
        ? this.config.projectConfigFile
        : undefined,
      provider: this.config.provider,
      model: this.config.model,
      retentionDays: this.config.retentionDays,
      currentChat: this.getCurrentChatId(),
      skillsDir: this.config.skillsDir,
    };
  }

  getSessionOptions(): SessionLoadOptions {
    return {
      retentionDays: this.config.retentionDays,
      compressionMode: this.config.compressionMode,
    };
  }

  async pruneExpiredChats(): Promise<number> {
    return this._sessionStore.pruneExpiredSessions(this._config.retentionDays);
  }

  async listChats(): Promise<SessionSummary[]> {
    return this._agent.listSessions();
  }

  async listSkills(): Promise<Skill[]> {
    return loadSkills(this._config.skillsDir);
  }

  async switchChat(chatId: string): Promise<SessionRecord> {
    return this._agent.switchSession(chatId);
  }

  async forkChat(newChatId: string): Promise<SessionRecord> {
    return this._agent.forkSession(newChatId);
  }

  async loadCurrentChat(): Promise<SessionRecord> {
    return this._agent.loadActiveSession();
  }

  async getCurrentChatTranscript(): Promise<string> {
    const session = await this.loadCurrentChat();
    return session.messages.length === 0
      ? "No history yet."
      : session.messages.map((message) => `[${message.role}] ${message.content}`).join("\n");
  }

  async loadChat(chatId: string): Promise<SessionRecord> {
    return this._sessionStore.loadSession(chatId, this.getSessionOptions());
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
    sessionId: string;
    title: string;
    prompt: string;
    schedule?: ScheduledTask["schedule"];
    runAt?: string;
  }): Promise<ScheduledTask> {
    return this._scheduler.createTask(input);
  }

  async createTaskForCurrentChat(input: {
    title: string;
    prompt: string;
    schedule?: ScheduledTask["schedule"];
    runAt?: string;
  }): Promise<ScheduledTask> {
    return this.createTask({
      sessionId: this.getCurrentChatId(),
      ...input,
    });
  }

  async deleteTask(taskId: string, chatId?: string): Promise<boolean> {
    return this._scheduler.deleteTask(taskId, chatId);
  }

  async deleteTaskForCurrentChat(taskId: string): Promise<boolean> {
    return this.deleteTask(taskId, this.getCurrentChatId());
  }

  async handleUserInput(userInput: string): Promise<Message> {
    return this._agent.handleUserInput(userInput);
  }

  async handleScheduledTask(sessionId: string, prompt: string): Promise<Message> {
    return this._agent.handleScheduledTask(sessionId, prompt);
  }

  async runDueTasks(
    onTask: (task: ScheduledTask) => Promise<void>,
  ): Promise<void> {
    return this._scheduler.runDueTasks(onTask);
  }
}

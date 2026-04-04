import { initProjectConfig, loadConfig, type AppConfig } from "./config.js";
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
  readonly config: AppConfig;
  readonly scheduler: TaskScheduler;
  readonly sessionStore: SessionStore;
  readonly agent: MaclawAgent;

  constructor(config: AppConfig) {
    this.config = config;
    this.scheduler = createScheduler(config);
    this.sessionStore = createSessionStore(config);
    this.agent = new MaclawAgent(config, this.scheduler, this.sessionStore);
  }

  static load(cwd?: string): Harness {
    return new Harness(loadConfig(cwd));
  }

  getCurrentChatId(): string {
    return this.agent.getCurrentSessionId();
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
    return this.sessionStore.pruneExpiredSessions(this.config.retentionDays);
  }

  async listChats(): Promise<SessionSummary[]> {
    return this.agent.listSessions();
  }

  async listSkills(): Promise<Skill[]> {
    return loadSkills(this.config.skillsDir);
  }

  async switchChat(chatId: string): Promise<SessionRecord> {
    return this.agent.switchSession(chatId);
  }

  async forkChat(newChatId: string): Promise<SessionRecord> {
    return this.agent.forkSession(newChatId);
  }

  async loadCurrentChat(): Promise<SessionRecord> {
    return this.agent.loadActiveSession();
  }

  async getCurrentChatTranscript(): Promise<string> {
    const session = await this.loadCurrentChat();
    return session.messages.length === 0
      ? "No history yet."
      : session.messages.map((message) => `[${message.role}] ${message.content}`).join("\n");
  }

  async loadChat(chatId: string): Promise<SessionRecord> {
    return this.sessionStore.loadSession(chatId, this.getSessionOptions());
  }

  async listTasks(chatId?: string): Promise<ScheduledTask[]> {
    return this.scheduler.listTasks(chatId);
  }

  async listCurrentChatTasks(): Promise<ScheduledTask[]> {
    return this.listTasks(this.getCurrentChatId());
  }

  async replaceTasks(tasks: ScheduledTask[]): Promise<void> {
    await this.scheduler.replaceTasks(tasks);
  }

  async createTask(input: {
    sessionId: string;
    title: string;
    prompt: string;
    schedule?: ScheduledTask["schedule"];
    runAt?: string;
  }): Promise<ScheduledTask> {
    return this.scheduler.createTask(input);
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
    return this.scheduler.deleteTask(taskId, chatId);
  }

  async deleteTaskForCurrentChat(taskId: string): Promise<boolean> {
    return this.deleteTask(taskId, this.getCurrentChatId());
  }

  async handleUserInput(userInput: string): Promise<Message> {
    return this.agent.handleUserInput(userInput);
  }

  async handleScheduledTask(sessionId: string, prompt: string): Promise<Message> {
    return this.agent.handleScheduledTask(sessionId, prompt);
  }

  async runDueTasks(
    onTask: (task: ScheduledTask) => Promise<void>,
  ): Promise<void> {
    return this.scheduler.runDueTasks(onTask);
  }

  async initializeProject(): Promise<Harness> {
    if (this.config.isProjectInitialized) {
      return this;
    }

    await initProjectConfig(this.config.projectFolder);
    const nextHarness = new Harness({
      ...loadConfig(this.config.projectFolder),
      sessionId: this.getCurrentChatId(),
    });

    const activeSession = await this.loadCurrentChat();
    await nextHarness.sessionStore.saveSession(activeSession);

    const sessions = await this.listChats();
    for (const summary of sessions) {
      const session = await this.loadChat(summary.id);
      await nextHarness.sessionStore.saveSession(session);
    }

    const tasks = await this.listTasks();
    await nextHarness.replaceTasks(tasks);

    return nextHarness;
  }
}

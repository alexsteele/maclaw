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
  JsonFileChatStore,
  MemoryChatStore,
  type ChatLoadOptions,
  type ChatStore,
} from "./chats.js";
import type {
  ChatRecord,
  ChatSummary,
  Message,
  ScheduledTask,
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

const createChatStore = (config: AppConfig): ChatStore => {
  return config.isProjectInitialized
    ? new JsonFileChatStore(config.chatsDir)
    : new MemoryChatStore();
};

const createScheduler = (config: AppConfig): TaskScheduler => {
  return config.isProjectInitialized
    ? new TaskScheduler(new JsonFileTaskStore(config.schedulerFile, config.taskRunsFile))
    : new TaskScheduler(new MemoryTaskStore());
};

// Harness orchestrates user interactions with a project.
// A default harness has no project. initProject() creates one.
export class Harness {
  private _config: AppConfig;
  private _scheduler: TaskScheduler;
  private _chatStore: ChatStore;
  private _agent: MaclawAgent;
  private _taskListener?: (task: ScheduledTask, message: Message) => void | Promise<void>;

  constructor(config: AppConfig) {
    this._config = config;
    this._scheduler = createScheduler(config);
    this._chatStore = createChatStore(config);
    this._agent = new MaclawAgent(config, this._scheduler, this._chatStore);
  }

  static load(cwd?: string): Harness {
    return new Harness(loadConfig(cwd));
  }

  get config(): AppConfig {
    return this._config;
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
      chatId: this.getCurrentChatId(),
    };
    const nextChatStore = createChatStore(nextConfig);
    const nextScheduler = createScheduler(nextConfig);
    const nextAgent = new MaclawAgent(nextConfig, nextScheduler, nextChatStore);

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
    this._agent = nextAgent;

    if (this._taskListener) {
      await this.start(this._taskListener);
    }

    return this;
  }

  getCurrentChatId(): string {
    return this._agent.getCurrentChatId();
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
    return this._agent.listChats();
  }

  async listSkills(): Promise<Skill[]> {
    return loadSkills(this._config.skillsDir);
  }

  async switchChat(chatId: string): Promise<ChatRecord> {
    return this._agent.switchChat(chatId);
  }

  async forkChat(newChatId: string): Promise<ChatRecord> {
    return this._agent.forkChat(newChatId);
  }

  async loadCurrentChat(): Promise<ChatRecord> {
    return this._agent.loadActiveChat();
  }

  async getCurrentChatTranscript(): Promise<string> {
    const chat = await this.loadCurrentChat();
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
    chatId: string;
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
      chatId: this.getCurrentChatId(),
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

  async handleUserInputForChat(chatId: string, userInput: string): Promise<Message> {
    return this._agent.handleUserInputForChat(chatId, userInput);
  }

  async handleScheduledTask(chatId: string, prompt: string): Promise<Message> {
    return this._agent.handleScheduledTask(chatId, prompt);
  }

  async runDueTasks(
    onTask: (task: ScheduledTask) => Promise<void>,
  ): Promise<void> {
    return this._scheduler.runDueTasks(onTask);
  }
}

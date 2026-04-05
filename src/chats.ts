import { existsSync } from "node:fs";
import path from "node:path";
import { readdir, rm } from "node:fs/promises";
import type { ProjectConfig } from "./config.js";
import { ensureDir, makeId, readJsonFile, writeJsonFile } from "./fs-utils.js";
import { OpenAIResponsesProvider, LocalFallbackProvider, type Provider } from "./providers.js";
import { loadSkills } from "./skills.js";
import { createTools } from "./tools.js";
import type { ChatRecord, ChatSummary, Message } from "./types.js";
import { TaskScheduler } from "./scheduler.js";

export type ChatLoadOptions = {
  retentionDays: number;
  compressionMode: "none" | "planned";
};

export interface ChatStore {
  loadChat(chatId: string, options: ChatLoadOptions): Promise<ChatRecord>;
  saveChat(chat: ChatRecord): Promise<void>;
  listChats(): Promise<ChatSummary[]>;
  pruneExpiredChats(retentionDays: number): Promise<number>;
}

const buildSystemPrompt = async (
  config: ProjectConfig,
  chat: ChatRecord,
): Promise<string> => {
  const skills = await loadSkills(config.skillsDir);
  const skillsBlock =
    skills.length === 0
      ? "No local skills are available."
      : skills.map((skill) => `- ${skill.name}: ${skill.description}`).join("\n");

  return [
    "You are maclaw, a small local LLM harness.",
    "Your goal is to help the user answer questions and complete tasks.",
    "Keep answers concise and practical.",
    "Use tools when needed.",
    "Local skills are available as user-authored task descriptions. Read them when useful.",
    `Project initialized: ${existsSync(config.projectConfigFile) ? "yes" : "no"}.`,
    `Chat retention: ${config.retentionDays} days.`,
    `Compression mode: ${config.compressionMode}. If set to planned, compression is not implemented yet.`,
    "",
    "Available skills:",
    skillsBlock,
    "",
    `Current chat id: ${chat.id}`,
    `Current time: ${new Date().toISOString()}`,
  ].join("\n");
};

const createProvider = (config: ProjectConfig): Provider => {
  if (config.provider === "openai" && config.openAiApiKey) {
    return new OpenAIResponsesProvider(config.openAiApiKey, config.model);
  }

  return new LocalFallbackProvider();
};

const chatPath = (chatsDir: string, chatId: string): string => {
  return path.join(chatsDir, `${chatId}.json`);
};

const createEmptyChat = (
  chatId: string,
  options: ChatLoadOptions,
): ChatRecord => {
  const now = new Date().toISOString();
  return {
    id: chatId,
    createdAt: now,
    updatedAt: now,
    retentionDays: options.retentionDays,
    compressionMode: options.compressionMode,
    messages: [],
  };
};

const normalizeChat = (
  chat: ChatRecord,
  options: ChatLoadOptions,
): ChatRecord => {
  chat.retentionDays = options.retentionDays;
  chat.compressionMode = options.compressionMode;
  return chat;
};

const toChatSummary = (chat: ChatRecord): ChatSummary => ({
  id: chat.id,
  createdAt: chat.createdAt,
  updatedAt: chat.updatedAt,
  messageCount: chat.messages.length,
});

export class JsonFileChatStore implements ChatStore {
  private readonly chatsDir: string;

  constructor(chatsDir: string) {
    this.chatsDir = chatsDir;
  }

  async loadChat(
    chatId: string,
    options: ChatLoadOptions,
  ): Promise<ChatRecord> {
    await ensureDir(this.chatsDir);

    const chat = await readJsonFile<ChatRecord>(
      chatPath(this.chatsDir, chatId),
      createEmptyChat(chatId, options),
    );

    return normalizeChat(chat, options);
  }

  async saveChat(chat: ChatRecord): Promise<void> {
    chat.updatedAt = new Date().toISOString();
    await writeJsonFile(chatPath(this.chatsDir, chat.id), chat);
  }

  async listChats(): Promise<ChatSummary[]> {
    await ensureDir(this.chatsDir);
    const entries = await readdir(this.chatsDir, { withFileTypes: true });
    const chats: ChatSummary[] = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }

      const fullPath = path.join(this.chatsDir, entry.name);
      const chat = await readJsonFile<ChatRecord | null>(fullPath, null);
      if (!chat) {
        continue;
      }

      chats.push(toChatSummary(chat));
    }

    return chats.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async pruneExpiredChats(retentionDays: number): Promise<number> {
    await ensureDir(this.chatsDir);
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const entries = await readdir(this.chatsDir, { withFileTypes: true });

    let removed = 0;
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }

      const fullPath = path.join(this.chatsDir, entry.name);
      const chat = await readJsonFile<ChatRecord | null>(fullPath, null);
      if (!chat) {
        continue;
      }

      const updatedAt = Date.parse(chat.updatedAt);
      if (Number.isFinite(updatedAt) && updatedAt < cutoff) {
        await rm(fullPath, { force: true });
        removed += 1;
      }
    }

    return removed;
  }
}

export class MemoryChatStore implements ChatStore {
  private readonly chats = new Map<string, ChatRecord>();

  async loadChat(
    chatId: string,
    options: ChatLoadOptions,
  ): Promise<ChatRecord> {
    const existing = this.chats.get(chatId);
    if (!existing) {
      const created = createEmptyChat(chatId, options);
      this.chats.set(chatId, structuredClone(created));
      return created;
    }

    const normalized = normalizeChat(structuredClone(existing), options);
    this.chats.set(chatId, structuredClone(normalized));
    return normalized;
  }

  async saveChat(chat: ChatRecord): Promise<void> {
    chat.updatedAt = new Date().toISOString();
    this.chats.set(chat.id, structuredClone(chat));
  }

  async listChats(): Promise<ChatSummary[]> {
    return Array.from(this.chats.values())
      .map((chat) => toChatSummary(chat))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async pruneExpiredChats(retentionDays: number): Promise<number> {
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    let removed = 0;

    for (const [chatId, chat] of this.chats.entries()) {
      const updatedAt = Date.parse(chat.updatedAt);
      if (Number.isFinite(updatedAt) && updatedAt < cutoff) {
        this.chats.delete(chatId);
        removed += 1;
      }
    }

    return removed;
  }
}

export class ChatRuntime {
  private readonly config: ProjectConfig;
  private readonly scheduler: TaskScheduler;
  private readonly chatStore: ChatStore;
  private readonly provider: Provider;
  private activeChatId: string;
  private activeChat?: ChatRecord;

  constructor(config: ProjectConfig, scheduler: TaskScheduler, chatStore: ChatStore) {
    this.config = config;
    this.scheduler = scheduler;
    this.chatStore = chatStore;
    this.provider = createProvider(config);
    this.activeChatId = config.chatId;
  }

  private getChatLoadOptions() {
    return {
      retentionDays: this.config.retentionDays,
      compressionMode: this.config.compressionMode,
    } as const;
  }

  private async loadChat(chatId: string): Promise<ChatRecord> {
    return this.chatStore.loadChat(chatId, this.getChatLoadOptions());
  }

  getCurrentChatId(): string {
    return this.activeChatId;
  }

  async listChats(): Promise<ChatSummary[]> {
    return this.chatStore.listChats();
  }

  async switchChat(chatId: string): Promise<ChatRecord> {
    this.activeChatId = chatId;
    this.activeChat = await this.loadChat(chatId);
    return this.activeChat;
  }

  async forkChat(newChatId: string): Promise<ChatRecord> {
    const sourceChat = await this.loadActiveChat();
    const now = new Date().toISOString();
    const forkedChat: ChatRecord = {
      ...structuredClone(sourceChat),
      id: newChatId,
      createdAt: now,
      updatedAt: now,
    };

    await this.chatStore.saveChat(forkedChat);
    this.activeChatId = newChatId;
    this.activeChat = forkedChat;
    return forkedChat;
  }

  async loadActiveChat(): Promise<ChatRecord> {
    if (!this.activeChat) {
      this.activeChat = await this.loadChat(this.activeChatId);
    }

    return this.activeChat;
  }

  async handleUserInput(userInput: string): Promise<Message> {
    const chat = await this.loadActiveChat();
    return this.handleUserInputForChat(chat.id, userInput);
  }

  async handleUserInputForChat(chatId: string, userInput: string): Promise<Message> {
    const chat =
      chatId === this.activeChatId ? await this.loadActiveChat() : await this.loadChat(chatId);

    appendMessage(chat, "user", userInput);
    await this.chatStore.saveChat(chat);

    let assistantMessage: Message;
    try {
      const systemPrompt = await buildSystemPrompt(this.config, chat);
      const tools = createTools(this.config, this.scheduler, chat.id);
      const result = await this.provider.generate({
        chat,
        userInput,
        systemPrompt,
        tools,
      });

      assistantMessage = appendMessage(chat, "assistant", result.outputText);
    } catch (error) {
      const content = `Request failed: ${
        error instanceof Error ? error.message : String(error)
      }`;
      assistantMessage = appendMessage(chat, "assistant", content);
    }

    await this.chatStore.saveChat(chat);
    if (this.activeChatId === chat.id) {
      this.activeChat = chat;
    }
    return assistantMessage;
  }

  async handleScheduledTask(
    chatId: string,
    prompt: string,
  ): Promise<Message> {
    const chat = await this.loadChat(chatId);

    appendMessage(chat, "system", `Scheduled task triggered: ${prompt}`, "scheduler");
    await this.chatStore.saveChat(chat);

    let assistantMessage: Message;
    try {
      const systemPrompt = await buildSystemPrompt(this.config, chat);
      const tools = createTools(this.config, this.scheduler, chat.id);
      const result = await this.provider.generate({
        chat,
        userInput: prompt,
        systemPrompt,
        tools,
      });

      assistantMessage = appendMessage(
        chat,
        "assistant",
        result.outputText,
        "scheduler",
      );
    } catch (error) {
      const content = `Scheduled task failed: ${
        error instanceof Error ? error.message : String(error)
      }`;
      assistantMessage = appendMessage(chat, "assistant", content, "scheduler");
    }

    await this.chatStore.saveChat(chat);
    if (this.activeChatId === chat.id) {
      this.activeChat = chat;
    }
    return assistantMessage;
  }
}

export const appendMessage = (
  chat: ChatRecord,
  role: Message["role"],
  content: string,
  name?: string,
): Message => {
  const message: Message = {
    id: makeId(role),
    role,
    content,
    createdAt: new Date().toISOString(),
    name,
  };

  chat.messages.push(message);
  chat.updatedAt = message.createdAt;
  return message;
};

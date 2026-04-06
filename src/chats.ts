import { existsSync } from "node:fs";
import path from "node:path";
import { readdir, rm, writeFile } from "node:fs/promises";
import type { ProjectConfig } from "./config.js";
import {
  appendJsonLine,
  ensureDir,
  makeId,
  readJsonFile,
  readJsonLines,
  writeJsonFile,
} from "./fs-utils.js";
import { OpenAIResponsesProvider, DummyProvider, type Provider } from "./providers.js";
import { loadSkills } from "./skills.js";
import { createTools } from "./tools.js";
import type {
  ChatRecord,
  ChatSummary,
  Message,
  MessageContext,
  ProviderResult,
} from "./types.js";
import { TaskScheduler } from "./scheduler.js";

export type ChatLoadOptions = {
  retentionDays: number;
  compressionMode: "none" | "planned";
};

export interface ChatStore {
  loadChat(chatId: string, options: ChatLoadOptions): Promise<ChatRecord>;
  saveChat(chat: ChatRecord): Promise<void>;
  deleteChat(chatId: string): Promise<boolean>;
  listChats(): Promise<ChatSummary[]>;
  pruneExpiredChats(retentionDays: number): Promise<number>;
}

export type ChatReply = {
  message: Message;
  providerResult?: ProviderResult;
};

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
    return new OpenAIResponsesProvider(
      config.openAiApiKey,
      config.model,
      config.maxToolIterations,
    );
  }

  return new DummyProvider();
};

const buildPromptChat = (chat: ChatRecord, contextMessages: number): ChatRecord => {
  return {
    ...chat,
    messages: chat.messages.slice(-contextMessages),
  };
};

const chatPath = (chatsDir: string, chatId: string): string => {
  return path.join(chatsDir, `${chatId}.json`);
};

const chatTranscriptPath = (chatsDir: string, chatId: string): string => {
  return path.join(chatsDir, `${chatId}.jsonl`);
};

type ChatMetadata = Omit<ChatRecord, "messages"> & {
  messageCount: number;
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

const toChatMetadata = (chat: ChatRecord): ChatMetadata => ({
  id: chat.id,
  createdAt: chat.createdAt,
  updatedAt: chat.updatedAt,
  retentionDays: chat.retentionDays,
  compressionMode: chat.compressionMode,
  summary: chat.summary,
  messageCount: chat.messages.length,
});

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
    const metadata = await readJsonFile<ChatMetadata | null>(
      chatPath(this.chatsDir, chatId),
      null,
    );
    if (!metadata) {
      return createEmptyChat(chatId, options);
    }

    const messages = await readJsonLines<Message>(chatTranscriptPath(this.chatsDir, chatId));
    return normalizeChat(
      {
        ...metadata,
        messages,
      },
      options,
    );
  }

  async saveChat(chat: ChatRecord): Promise<void> {
    chat.updatedAt = new Date().toISOString();
    await ensureDir(this.chatsDir);

    const metadataPath = chatPath(this.chatsDir, chat.id);
    const transcriptPath = chatTranscriptPath(this.chatsDir, chat.id);
    const existingMetadata = await readJsonFile<ChatMetadata | null>(metadataPath, null);
    const existingMessageCount = existingMetadata?.messageCount ?? 0;

    if (existingMessageCount > chat.messages.length) {
      const transcript = chat.messages.map((message) => JSON.stringify(message)).join("\n");
      await writeFile(transcriptPath, transcript.length > 0 ? `${transcript}\n` : "", "utf8");
    } else {
      for (const message of chat.messages.slice(existingMessageCount)) {
        await appendJsonLine(transcriptPath, message);
      }
    }

    await writeJsonFile(metadataPath, toChatMetadata(chat));
  }

  async deleteChat(chatId: string): Promise<boolean> {
    const metadataPath = chatPath(this.chatsDir, chatId);
    const transcriptPath = chatTranscriptPath(this.chatsDir, chatId);
    if (!existsSync(metadataPath) && !existsSync(transcriptPath)) {
      return false;
    }

    await rm(metadataPath, { force: true });
    await rm(transcriptPath, { force: true });
    return true;
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
      const metadata = await readJsonFile<ChatMetadata | null>(fullPath, null);
      if (!metadata) {
        continue;
      }

      chats.push({
        id: metadata.id,
        createdAt: metadata.createdAt,
        updatedAt: metadata.updatedAt,
        messageCount: metadata.messageCount,
      });
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
      const metadata = await readJsonFile<ChatMetadata | null>(fullPath, null);
      if (!metadata) {
        continue;
      }

      const updatedAt = Date.parse(metadata.updatedAt);
      if (Number.isFinite(updatedAt) && updatedAt < cutoff) {
        await rm(fullPath, { force: true });
        await rm(
          chatTranscriptPath(this.chatsDir, entry.name.replace(/\.json$/u, "")),
          { force: true },
        );
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

  async deleteChat(chatId: string): Promise<boolean> {
    return this.chats.delete(chatId);
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

  async prompt(userInput: string, _context?: MessageContext): Promise<Message> {
    const chat = await this.loadActiveChat();
    const reply = await this.promptChatDetailed(chat.id, userInput);
    return reply.message;
  }

  async promptChat(
    chatId: string,
    userInput: string,
    _context?: MessageContext,
  ): Promise<Message> {
    const reply = await this.promptChatDetailed(chatId, userInput);
    return reply.message;
  }

  async promptDetailed(
    userInput: string,
    _context?: MessageContext,
  ): Promise<ChatReply> {
    const chat = await this.loadActiveChat();
    return this.promptChatDetailed(chat.id, userInput);
  }

  async promptChatDetailed(
    chatId: string,
    userInput: string,
  ): Promise<ChatReply> {
    const chat =
      chatId === this.activeChatId ? await this.loadActiveChat() : await this.loadChat(chatId);

    appendMessage(chat, "user", userInput);
    await this.chatStore.saveChat(chat);

    let assistantMessage: Message;
    let providerResult: ProviderResult | undefined;
    try {
      const systemPrompt = await buildSystemPrompt(this.config, chat);
      const tools = createTools(this.config, this.scheduler, chat.id);
      const promptChat = buildPromptChat(chat, this.config.contextMessages);
      providerResult = await this.provider.generate({
        chat: promptChat,
        userInput,
        systemPrompt,
        tools,
      });

      assistantMessage = appendMessage(chat, "assistant", providerResult.outputText);
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
    return {
      message: assistantMessage,
      providerResult,
    };
  }

  async handleScheduledTask(
    chatId: string,
    prompt: string,
    _context?: MessageContext,
  ): Promise<Message> {
    const chat = await this.loadChat(chatId);

    appendMessage(chat, "system", `Scheduled task triggered: ${prompt}`, "scheduler");
    await this.chatStore.saveChat(chat);

    let assistantMessage: Message;
    try {
      const systemPrompt = await buildSystemPrompt(this.config, chat);
      const tools = createTools(this.config, this.scheduler, chat.id);
      const promptChat = buildPromptChat(chat, this.config.contextMessages);
      const result = await this.provider.generate({
        chat: promptChat,
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
      await this.chatStore.saveChat(chat);
      if (this.activeChatId === chat.id) {
        this.activeChat = chat;
      }
      throw error;
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

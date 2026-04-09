import { existsSync, readFileSync } from "node:fs";
import { parseConfiguredModel, type ProjectConfig } from "./config.js";
import { makeId } from "./fs-utils.js";
import { OpenAIResponsesProvider, DummyProvider, type Provider } from "./providers.js";
import { loadSkills } from "./skills.js";
import type {
  ChatRecord,
  ChatSummary,
  Message,
  MessageContext,
  ProviderResult,
  ToolCallLogEntry,
  ProviderUsage,
  ToolDefinition,
} from "./types.js";

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

type ChatCreateResult =
  | { chat: ChatRecord; error?: undefined }
  | { chat?: undefined; error: string };

type ChatCompressionResult = {
  chat: ChatRecord;
  keptMessages: number;
  removedMessages: number;
  summary: string;
};

type ResponseTelemetry = {
  latencyMs: number;
  toolIterations?: number;
};

const formatLocalDateTime = (date: Date): string => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  });

  return formatter.format(date);
};

const getLocalTimeZone = (): string => {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "unknown";
};

const buildSystemPrompt = async (
  config: ProjectConfig,
  chat: ChatRecord,
): Promise<string> => {
  const now = new Date();
  const skills = await loadSkills(config.skillsDir);
  const skillsBlock =
    skills.length === 0
      ? "No local skills are available."
      : skills.map((skill) => `- ${skill.name}: ${skill.description}`).join("\n");
  const basePrompt =
    config.basePromptFile && existsSync(config.basePromptFile)
      ? readFileSync(config.basePromptFile, "utf8").trim()
      : "";

  return [
    "You are maclaw, a small local LLM harness.",
    "Your goal is to help the user answer questions and complete tasks.",
    "Keep answers concise and practical.",
    "Use tools when needed.",
    "Local skills are available as user-authored task descriptions. Read them when useful.",
    `Project initialized: ${existsSync(config.projectConfigFile) ? "yes" : "no"}.`,
    `Chat retention: ${config.retentionDays} days.`,
    `Compression mode: ${config.compressionMode}.`,
    "",
    "Available skills:",
    skillsBlock,
    "",
    `Current chat id: ${chat.id}`,
    `Current time: ${now.toISOString()}`,
    `Current local time: ${formatLocalDateTime(now)}`,
    `Local timezone: ${getLocalTimeZone()}`,
    ...(chat.summary
      ? [
          "",
          "Compressed chat summary:",
          chat.summary,
        ]
      : []),
    ...(basePrompt
      ? [
          "",
          "Base project prompt:",
          basePrompt,
        ]
      : []),
  ].join("\n");
};

const buildCompressionPrompt = (existingSummary?: string): string =>
  [
    "You are compressing an older chat transcript for maclaw.",
    "Write a concise plain-text summary of the conversation so far.",
    "Preserve goals, decisions, constraints, important files, pending work, and unresolved questions.",
    "Do not mention that this is a summary.",
    ...(existingSummary
      ? [
          "",
          "Existing summary to preserve and refine:",
          existingSummary,
        ]
      : []),
  ].join("\n");

const createProvider = (config: ProjectConfig): Provider => {
  const configuredModel = parseConfiguredModel(config.model);
  if (configuredModel.provider === "openai" && config.openAiApiKey) {
    return new OpenAIResponsesProvider(
      config.openAiApiKey,
      configuredModel.modelName,
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

const buildCompressionChat = (chat: ChatRecord, messages: Message[]): ChatRecord => {
  return {
    ...chat,
    messages,
  };
};

const formatToolCall = (entry: ToolCallLogEntry): string => {
  return JSON.stringify(entry.input ?? {});
};

const measureProviderCall = async (
  run: () => Promise<ProviderResult>,
): Promise<{ result: ProviderResult; telemetry: ResponseTelemetry }> => {
  const startedAt = performance.now();
  const result = await run();

  return {
    result,
    telemetry: {
      latencyMs: Math.round(performance.now() - startedAt),
      toolIterations: result.toolIterations,
    },
  };
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
  private readonly chatStore: ChatStore;
  private readonly provider: Provider;
  private readonly tools: ToolDefinition[];
  private activeChatId: string;
  private previousChatId?: string;
  private activeChat?: ChatRecord;

  constructor(config: ProjectConfig, chatStore: ChatStore, tools: ToolDefinition[]) {
    this.config = config;
    this.chatStore = chatStore;
    this.tools = tools;
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

  getPreviousChatId(): string | undefined {
    return this.previousChatId;
  }

  async listChats(): Promise<ChatSummary[]> {
    return this.chatStore.listChats();
  }

  async switchChat(chatId: string): Promise<ChatRecord> {
    if (chatId !== this.activeChatId) {
      this.previousChatId = this.activeChatId;
    }
    this.activeChatId = chatId;
    this.activeChat = await this.loadChat(chatId);
    await this.chatStore.saveChat(this.activeChat);
    return this.activeChat;
  }

  async createChat(chatId: string): Promise<ChatCreateResult> {
    const existingChats = await this.listChats();
    if (existingChats.some((chat) => chat.id === chatId)) {
      return { error: `chat already exists: ${chatId}` };
    }

    const chat = await this.loadChat(chatId);
    await this.chatStore.saveChat(chat);
    return { chat };
  }

  async forkChatFrom(sourceChatId: string, newChatId: string): Promise<ChatCreateResult> {
    const existingChats = await this.listChats();
    if (existingChats.some((chat) => chat.id === newChatId)) {
      return { error: `chat already exists: ${newChatId}` };
    }

    const sourceChat =
      sourceChatId === this.activeChatId ? await this.loadActiveChat() : await this.loadChat(sourceChatId);
    const now = new Date().toISOString();
    const forkedChat: ChatRecord = {
      ...structuredClone(sourceChat),
      id: newChatId,
      createdAt: now,
      updatedAt: now,
    };

    await this.chatStore.saveChat(forkedChat);
    return { chat: forkedChat };
  }

  async resetChat(chatId: string): Promise<ChatRecord> {
    const chat = createEmptyChat(chatId, this.getChatLoadOptions());
    await this.chatStore.saveChat(chat);

    if (chatId === this.activeChatId) {
      this.activeChat = chat;
    }

    return chat;
  }

  async compressChat(chatId: string): Promise<ChatCompressionResult> {
    const chat =
      chatId === this.activeChatId ? await this.loadActiveChat() : await this.loadChat(chatId);
    const keepMessages = Math.max(this.config.contextMessages, 1);
    const recentMessages = chat.messages.slice(-keepMessages);
    const olderMessages = chat.messages.slice(0, Math.max(chat.messages.length - keepMessages, 0));

    if (olderMessages.length === 0) {
      return {
        chat,
        keptMessages: recentMessages.length,
        removedMessages: 0,
        summary: chat.summary ?? "",
      };
    }

    const result = await this.provider.generate({
      chat: buildCompressionChat(chat, olderMessages),
      userInput: "Summarize this chat history.",
      systemPrompt: buildCompressionPrompt(chat.summary),
      tools: [],
    });
    const summary = result.outputText.trim();
    if (summary.length === 0) {
      throw new Error("The model returned an empty compression summary.");
    }

    chat.summary = summary;
    chat.messages = recentMessages;
    chat.updatedAt = new Date().toISOString();
    await this.chatStore.saveChat(chat);

    if (chatId === this.activeChatId) {
      this.activeChat = chat;
    }

    return {
      chat,
      keptMessages: recentMessages.length,
      removedMessages: olderMessages.length,
      summary,
    };
  }

  async forkChat(newChatId: string): Promise<ChatRecord> {
    const result = await this.forkChatFrom(this.activeChatId, newChatId);
    if (!result.chat) {
      throw new Error(result.error ?? `Could not fork chat: ${newChatId}`);
    }

    const forkedChat = result.chat;
    this.previousChatId = this.activeChatId;
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
      const promptChat = buildPromptChat(chat, this.config.contextMessages);
      const measured = await measureProviderCall(() =>
        this.provider.generate({
          chat: promptChat,
          userInput,
          systemPrompt,
          tools: this.tools,
          onToolCall: async (entry) => {
            appendMessage(chat, "tool", formatToolCall(entry), entry.name);
            await this.chatStore.saveChat(chat);
          },
        }),
      );
      providerResult = {
        ...measured.result,
        latencyMs: measured.telemetry.latencyMs,
      };

      assistantMessage = appendMessage(chat, "assistant", providerResult.outputText, undefined, {
        model: providerResult.model,
        usage: providerResult.usage,
        latencyMs: measured.telemetry.latencyMs,
        toolIterations: measured.telemetry.toolIterations,
      });
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
      const promptChat = buildPromptChat(chat, this.config.contextMessages);
      const measured = await measureProviderCall(() =>
        this.provider.generate({
          chat: promptChat,
          userInput: prompt,
          systemPrompt,
          tools: this.tools,
          onToolCall: async (entry) => {
            appendMessage(chat, "tool", formatToolCall(entry), entry.name);
            await this.chatStore.saveChat(chat);
          },
        }),
      );
      const result = measured.result;

      assistantMessage = appendMessage(chat, "assistant", result.outputText, "scheduler", {
        model: result.model,
        usage: result.usage,
        latencyMs: measured.telemetry.latencyMs,
        toolIterations: measured.telemetry.toolIterations,
      });
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
  metadata?: {
    model?: string;
    usage?: ProviderUsage;
    latencyMs?: number;
    toolIterations?: number;
  },
): Message => {
  const message: Message = {
    id: makeId(role),
    role,
    content,
    createdAt: new Date().toISOString(),
    name,
    model: metadata?.model,
    usage: metadata?.usage,
    latencyMs: metadata?.latencyMs,
    toolIterations: metadata?.toolIterations,
  };

  chat.messages.push(message);
  chat.updatedAt = message.createdAt;
  return message;
};

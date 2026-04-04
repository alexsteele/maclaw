import type { AppConfig } from "./config.js";
import { OpenAIResponsesProvider, LocalFallbackProvider, type Provider } from "./providers.js";
import { appendMessage, type ChatStore } from "./chats.js";
import { loadSkills } from "./skills.js";
import { createTools } from "./tools.js";
import type { ChatRecord, ChatSummary, Message } from "./types.js";
import { TaskScheduler } from "./scheduler.js";

const buildSystemPrompt = async (
  config: AppConfig,
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
    `Project initialized: ${config.isProjectInitialized ? "yes" : "no"}.`,
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

const createProvider = (config: AppConfig): Provider => {
  if (config.provider === "openai" && config.openAiApiKey) {
    return new OpenAIResponsesProvider(config.openAiApiKey, config.model);
  }

  return new LocalFallbackProvider();
};

export class MaclawAgent {
  private readonly config: AppConfig;
  private readonly scheduler: TaskScheduler;
  private readonly chatStore: ChatStore;
  private readonly provider: Provider;
  private activeChatId: string;
  private activeChat?: ChatRecord;

  constructor(config: AppConfig, scheduler: TaskScheduler, chatStore: ChatStore) {
    this.config = config;
    this.scheduler = scheduler;
    this.chatStore = chatStore;
    this.provider = createProvider(config);
    this.activeChatId = config.chatId;
  }

  getCurrentChatId(): string {
    return this.activeChatId;
  }

  async listChats(): Promise<ChatSummary[]> {
    return this.chatStore.listChats();
  }

  async switchChat(chatId: string): Promise<ChatRecord> {
    this.activeChatId = chatId;
    this.activeChat = await this.chatStore.loadChat(chatId, {
      retentionDays: this.config.retentionDays,
      compressionMode: this.config.compressionMode,
    });
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
      this.activeChat = await this.chatStore.loadChat(
        this.activeChatId,
        {
          retentionDays: this.config.retentionDays,
          compressionMode: this.config.compressionMode,
        },
      );
    }

    return this.activeChat;
  }

  async handleUserInput(userInput: string): Promise<Message> {
    const chat = await this.loadActiveChat();
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
    this.activeChat = chat;
    return assistantMessage;
  }

  async handleScheduledTask(
    chatId: string,
    prompt: string,
  ): Promise<Message> {
    const chat = await this.chatStore.loadChat(
      chatId,
      {
        retentionDays: this.config.retentionDays,
        compressionMode: this.config.compressionMode,
      },
    );

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

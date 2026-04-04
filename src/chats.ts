import path from "node:path";
import { readdir, rm } from "node:fs/promises";
import { ensureDir, makeId, readJsonFile, writeJsonFile } from "./fs-utils.js";
import type { ChatRecord, ChatSummary, Message } from "./types.js";

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

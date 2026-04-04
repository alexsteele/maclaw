import path from "node:path";
import { readdir, rm } from "node:fs/promises";
import { ensureDir, makeId, readJsonFile, writeJsonFile } from "./fs-utils.js";
import type { Message, SessionRecord, SessionSummary } from "./types.js";

export type SessionLoadOptions = {
  retentionDays: number;
  compressionMode: "none" | "planned";
};

export interface SessionStore {
  loadSession(sessionId: string, options: SessionLoadOptions): Promise<SessionRecord>;
  saveSession(session: SessionRecord): Promise<void>;
  listSessions(): Promise<SessionSummary[]>;
  pruneExpiredSessions(retentionDays: number): Promise<number>;
}

const sessionPath = (sessionsDir: string, sessionId: string): string => {
  return path.join(sessionsDir, `${sessionId}.json`);
};

const createEmptySession = (
  sessionId: string,
  options: SessionLoadOptions,
): SessionRecord => {
  const now = new Date().toISOString();
  return {
    id: sessionId,
    createdAt: now,
    updatedAt: now,
    retentionDays: options.retentionDays,
    compressionMode: options.compressionMode,
    messages: [],
  };
};

const normalizeSession = (
  session: SessionRecord,
  options: SessionLoadOptions,
): SessionRecord => {
  session.retentionDays = options.retentionDays;
  session.compressionMode = options.compressionMode;
  return session;
};

const toSessionSummary = (session: SessionRecord): SessionSummary => ({
  id: session.id,
  createdAt: session.createdAt,
  updatedAt: session.updatedAt,
  messageCount: session.messages.length,
});

export class JsonFileSessionStore implements SessionStore {
  private readonly sessionsDir: string;

  constructor(sessionsDir: string) {
    this.sessionsDir = sessionsDir;
  }

  async loadSession(
    sessionId: string,
    options: SessionLoadOptions,
  ): Promise<SessionRecord> {
    await ensureDir(this.sessionsDir);

    const session = await readJsonFile<SessionRecord>(
      sessionPath(this.sessionsDir, sessionId),
      createEmptySession(sessionId, options),
    );

    return normalizeSession(session, options);
  }

  async saveSession(session: SessionRecord): Promise<void> {
    session.updatedAt = new Date().toISOString();
    await writeJsonFile(sessionPath(this.sessionsDir, session.id), session);
  }

  async listSessions(): Promise<SessionSummary[]> {
    await ensureDir(this.sessionsDir);
    const entries = await readdir(this.sessionsDir, { withFileTypes: true });
    const sessions: SessionSummary[] = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }

      const fullPath = path.join(this.sessionsDir, entry.name);
      const session = await readJsonFile<SessionRecord | null>(fullPath, null);
      if (!session) {
        continue;
      }

      sessions.push(toSessionSummary(session));
    }

    return sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async pruneExpiredSessions(retentionDays: number): Promise<number> {
    await ensureDir(this.sessionsDir);
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const entries = await readdir(this.sessionsDir, { withFileTypes: true });

    let removed = 0;
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }

      const fullPath = path.join(this.sessionsDir, entry.name);
      const session = await readJsonFile<SessionRecord | null>(fullPath, null);
      if (!session) {
        continue;
      }

      const updatedAt = Date.parse(session.updatedAt);
      if (Number.isFinite(updatedAt) && updatedAt < cutoff) {
        await rm(fullPath, { force: true });
        removed += 1;
      }
    }

    return removed;
  }
}

export const appendMessage = (
  session: SessionRecord,
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

  session.messages.push(message);
  session.updatedAt = message.createdAt;
  return message;
};

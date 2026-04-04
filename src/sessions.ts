import path from "node:path";
import { readdir, rm } from "node:fs/promises";
import { ensureDir, makeId, readJsonFile, writeJsonFile } from "./fs-utils.js";
import type { Message, SessionRecord } from "./types.js";

const sessionPath = (sessionsDir: string, sessionId: string): string => {
  return path.join(sessionsDir, `${sessionId}.json`);
};

export const loadSession = async (
  sessionsDir: string,
  sessionId: string,
  retentionDays: number,
  compressionMode: "none" | "planned",
): Promise<SessionRecord> => {
  await ensureDir(sessionsDir);

  const now = new Date().toISOString();
  const session = await readJsonFile<SessionRecord>(sessionPath(sessionsDir, sessionId), {
    id: sessionId,
    createdAt: now,
    updatedAt: now,
    retentionDays,
    compressionMode,
    messages: [],
  });

  session.retentionDays = retentionDays;
  session.compressionMode = compressionMode;
  return session;
};

export const saveSession = async (
  sessionsDir: string,
  session: SessionRecord,
): Promise<void> => {
  session.updatedAt = new Date().toISOString();
  await writeJsonFile(sessionPath(sessionsDir, session.id), session);
};

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

export const pruneExpiredSessions = async (
  sessionsDir: string,
  retentionDays: number,
): Promise<number> => {
  await ensureDir(sessionsDir);
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const entries = await readdir(sessionsDir, { withFileTypes: true });

  let removed = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }

    const fullPath = path.join(sessionsDir, entry.name);
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
};

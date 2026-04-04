import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { JsonFileSessionStore, appendMessage } from "../src/sessions.js";

const createStore = async (): Promise<{
  cleanup: () => Promise<void>;
  dir: string;
  store: JsonFileSessionStore;
}> => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "maclaw-sessions-"));
  return {
    cleanup: async () => rm(dir, { recursive: true, force: true }),
    dir,
    store: new JsonFileSessionStore(dir),
  };
};

test("loadSession creates a new session with the requested options", async () => {
  const { cleanup, store } = await createStore();

  try {
    const session = await store.loadSession("alpha", {
      retentionDays: 14,
      compressionMode: "planned",
    });

    assert.equal(session.id, "alpha");
    assert.equal(session.retentionDays, 14);
    assert.equal(session.compressionMode, "planned");
    assert.deepEqual(session.messages, []);
    assert.ok(session.createdAt);
    assert.ok(session.updatedAt);
  } finally {
    await cleanup();
  }
});

test("saveSession persists messages and loadSession reapplies current options", async () => {
  const { cleanup, store } = await createStore();

  try {
    const session = await store.loadSession("beta", {
      retentionDays: 30,
      compressionMode: "none",
    });

    appendMessage(session, "user", "hello");
    await store.saveSession(session);

    const reloaded = await store.loadSession("beta", {
      retentionDays: 7,
      compressionMode: "planned",
    });

    assert.equal(reloaded.messages.length, 1);
    assert.equal(reloaded.messages[0]?.content, "hello");
    assert.equal(reloaded.retentionDays, 7);
    assert.equal(reloaded.compressionMode, "planned");
  } finally {
    await cleanup();
  }
});

test("pruneExpiredSessions removes stale session files and keeps fresh ones", async () => {
  const { cleanup, dir, store } = await createStore();

  try {
    const staleSession = await store.loadSession("stale", {
      retentionDays: 1,
      compressionMode: "none",
    });
    await store.saveSession(staleSession);

    const freshSession = await store.loadSession("fresh", {
      retentionDays: 1,
      compressionMode: "none",
    });
    await store.saveSession(freshSession);

    const stalePath = path.join(dir, "stale.json");
    const staleRaw = await readFile(stalePath, "utf8");
    const staleJson = JSON.parse(staleRaw) as { updatedAt: string };
    staleJson.updatedAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    await writeFile(stalePath, `${JSON.stringify(staleJson, null, 2)}\n`, "utf8");

    const removed = await store.pruneExpiredSessions(1);

    assert.equal(removed, 1);

    const staleExists = await store.loadSession("stale", {
      retentionDays: 1,
      compressionMode: "none",
    });
    const freshExists = await store.loadSession("fresh", {
      retentionDays: 1,
      compressionMode: "none",
    });

    assert.equal(staleExists.messages.length, 0);
    assert.equal(freshExists.id, "fresh");
  } finally {
    await cleanup();
  }
});

test("listSessions returns saved sessions sorted by most recent update", async () => {
  const { cleanup, store } = await createStore();

  try {
    const older = await store.loadSession("older", {
      retentionDays: 30,
      compressionMode: "none",
    });
    appendMessage(older, "user", "first");
    await store.saveSession(older);

    const newer = await store.loadSession("newer", {
      retentionDays: 30,
      compressionMode: "none",
    });
    appendMessage(newer, "assistant", "second");
    await store.saveSession(newer);

    const sessions = await store.listSessions();

    assert.equal(sessions.length, 2);
    assert.equal(sessions[0]?.id, "newer");
    assert.equal(sessions[0]?.messageCount, 1);
    assert.equal(sessions[1]?.id, "older");
  } finally {
    await cleanup();
  }
});

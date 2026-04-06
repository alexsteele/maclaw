import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { JsonFileChatStore, MemoryChatStore, appendMessage } from "../src/chats.js";

const createStore = async (): Promise<{
  cleanup: () => Promise<void>;
  dir: string;
  store: JsonFileChatStore;
}> => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "maclaw-sessions-"));
  return {
    cleanup: async () => rm(dir, { recursive: true, force: true }),
    dir,
    store: new JsonFileChatStore(dir),
  };
};

test("loadChat creates a new chat with the requested options", async () => {
  const { cleanup, store } = await createStore();

  try {
    const chat = await store.loadChat("alpha", {
      retentionDays: 14,
      compressionMode: "planned",
    });

    assert.equal(chat.id, "alpha");
    assert.equal(chat.retentionDays, 14);
    assert.equal(chat.compressionMode, "planned");
    assert.deepEqual(chat.messages, []);
    assert.ok(chat.createdAt);
    assert.ok(chat.updatedAt);
  } finally {
    await cleanup();
  }
});

test("saveChat persists messages and loadChat reapplies current options", async () => {
  const { cleanup, dir, store } = await createStore();

  try {
    const chat = await store.loadChat("beta", {
      retentionDays: 30,
      compressionMode: "none",
    });

    appendMessage(chat, "user", "hello");
    await store.saveChat(chat);

    const reloaded = await store.loadChat("beta", {
      retentionDays: 7,
      compressionMode: "planned",
    });

    assert.equal(reloaded.messages.length, 1);
    assert.equal(reloaded.messages[0]?.content, "hello");
    assert.equal(reloaded.retentionDays, 7);
    assert.equal(reloaded.compressionMode, "planned");

    const metadataRaw = await readFile(path.join(dir, "beta.json"), "utf8");
    const metadata = JSON.parse(metadataRaw) as { id: string; messageCount: number };
    assert.equal(metadata.id, "beta");
    assert.equal(metadata.messageCount, 1);

    const transcriptRaw = await readFile(path.join(dir, "beta.jsonl"), "utf8");
    const transcriptLines = transcriptRaw.trim().split("\n").map((line) => JSON.parse(line) as { content: string });
    assert.equal(transcriptLines.length, 1);
    assert.equal(transcriptLines[0]?.content, "hello");
  } finally {
    await cleanup();
  }
});

test("pruneExpiredChats removes stale chat files and keeps fresh ones", async () => {
  const { cleanup, dir, store } = await createStore();

  try {
    const staleChat = await store.loadChat("stale", {
      retentionDays: 1,
      compressionMode: "none",
    });
    await store.saveChat(staleChat);

    const freshChat = await store.loadChat("fresh", {
      retentionDays: 1,
      compressionMode: "none",
    });
    await store.saveChat(freshChat);

    const stalePath = path.join(dir, "stale.json");
    const staleRaw = await readFile(stalePath, "utf8");
    const staleJson = JSON.parse(staleRaw) as { updatedAt: string };
    staleJson.updatedAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    await writeFile(stalePath, `${JSON.stringify(staleJson, null, 2)}\n`, "utf8");

    const removed = await store.pruneExpiredChats(1);

    assert.equal(removed, 1);

    const staleExists = await store.loadChat("stale", {
      retentionDays: 1,
      compressionMode: "none",
    });
    const freshExists = await store.loadChat("fresh", {
      retentionDays: 1,
      compressionMode: "none",
    });

    assert.equal(staleExists.messages.length, 0);
    assert.equal(freshExists.id, "fresh");
  } finally {
    await cleanup();
  }
});

test("listChats returns saved chats sorted by most recent update", async () => {
  const { cleanup, store } = await createStore();

  try {
    const older = await store.loadChat("older", {
      retentionDays: 30,
      compressionMode: "none",
    });
    appendMessage(older, "user", "first");
    await store.saveChat(older);

    const newer = await store.loadChat("newer", {
      retentionDays: 30,
      compressionMode: "none",
    });
    appendMessage(newer, "assistant", "second");
    await store.saveChat(newer);

    const chats = await store.listChats();

    assert.equal(chats.length, 2);
    assert.equal(chats[0]?.id, "newer");
    assert.equal(chats[0]?.messageCount, 1);
    assert.equal(chats[1]?.id, "older");
  } finally {
    await cleanup();
  }
});

test("MemoryChatStore keeps chats in memory without filesystem backing", async () => {
  const store = new MemoryChatStore();

  const chat = await store.loadChat("alpha", {
    retentionDays: 30,
    compressionMode: "none",
  });
  appendMessage(chat, "user", "hello");
  await store.saveChat(chat);

  const reloaded = await store.loadChat("alpha", {
    retentionDays: 7,
    compressionMode: "planned",
  });
  const chats = await store.listChats();

  assert.equal(reloaded.messages.length, 1);
  assert.equal(reloaded.retentionDays, 7);
  assert.equal(reloaded.compressionMode, "planned");
  assert.equal(chats.length, 1);
  assert.equal(chats[0]?.id, "alpha");
});

test("deleteChat removes a saved chat from the JSON store", async () => {
  const { cleanup, dir, store } = await createStore();

  try {
    const chat = await store.loadChat("alpha", {
      retentionDays: 30,
      compressionMode: "none",
    });
    appendMessage(chat, "user", "hello");
    await store.saveChat(chat);

    const deleted = await store.deleteChat("alpha");
    const chats = await store.listChats();

    assert.equal(deleted, true);
    assert.equal(chats.length, 0);
    assert.equal(existsSync(path.join(dir, "alpha.json")), false);
    assert.equal(existsSync(path.join(dir, "alpha.jsonl")), false);
  } finally {
    await cleanup();
  }
});

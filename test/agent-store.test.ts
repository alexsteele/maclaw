import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import { JsonFileAgentStore } from "../src/storage/json.js";
import { SqliteAgentStore } from "../src/storage/sqlite.js";

test("JsonFileAgentStore persists and reloads agent records", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-agent-store-"));

  try {
    const filePath = path.join(rootDir, "agents.json");
    const store = new JsonFileAgentStore(filePath);

    store.saveAgent({
      id: "agent_ab12cd",
      name: "test-agent",
      prompt: "Do the thing",
      chatId: "agent_ab12cd",
      status: "running",
      maxSteps: 100,
      timeoutMs: 60 * 60 * 1000,
      stepCount: 3,
      createdAt: "2026-04-04T10:00:00.000Z",
      startedAt: "2026-04-04T10:01:00.000Z",
    });

    const reloaded = new JsonFileAgentStore(filePath);
    const agent = reloaded.getAgent("agent_ab12cd");

    assert.equal(agent?.name, "test-agent");
    assert.equal(agent?.chatId, "agent_ab12cd");
    assert.equal(agent?.stepCount, 3);
    assert.equal(reloaded.listAgents().length, 1);
    assert.equal(
      existsSync(path.join(rootDir, "agents", "agent_ab12cd", "agent.json")),
      true,
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("JsonFileAgentStore deletes persisted agent records", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-agent-store-delete-"));

  try {
    const filePath = path.join(rootDir, "agents.json");
    const store = new JsonFileAgentStore(filePath);

    store.saveAgent({
      id: "agent_delete",
      name: "delete-agent",
      prompt: "Do the thing",
      chatId: "agent_delete",
      status: "completed",
      timeoutMs: 60 * 60 * 1000,
      stepCount: 1,
      createdAt: "2026-04-16T10:00:00.000Z",
    });

    assert.equal(store.deleteAgent("agent_delete"), true);
    assert.equal(store.getAgent("agent_delete"), undefined);
    assert.equal(
      existsSync(path.join(rootDir, "agents", "agent_delete", "agent.json")),
      false,
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("SqliteAgentStore adds missing agent columns for older databases", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-agent-store-sqlite-"));

  try {
    const databasePath = path.join(rootDir, "maclaw.db");
    const database = new DatabaseSync(databasePath);
    database.exec(`
      create table agents (
        id text primary key,
        name text not null,
        prompt text not null,
        chat_id text not null,
        status text not null,
        max_steps integer,
        timeout_ms integer not null,
        step_interval_ms integer,
        step_count integer not null,
        created_at text not null,
        started_at text,
        finished_at text,
        last_message text,
        last_error text
      );
    `);
    database.close();

    const store = new SqliteAgentStore(databasePath, rootDir);
    store.saveAgent({
      id: "agent_sqlite",
      name: "sqlite-agent",
      prompt: "Do the thing",
      chatId: "agent_sqlite",
      toolsets: ["maclaw"],
      sourceChatId: "main",
      createdBy: "agent",
      createdByAgentId: "agent_parent",
      notifyTarget: { channel: "inbox" },
      status: "pending",
      maxSteps: 3,
      timeoutMs: 60 * 60 * 1000,
      stepCount: 0,
      createdAt: "2026-04-16T10:00:00.000Z",
    });

    const reloaded = store.getAgent("agent_sqlite");
    assert.equal(reloaded?.name, "sqlite-agent");
    assert.deepEqual(reloaded?.toolsets, ["maclaw"]);
    assert.equal(reloaded?.sourceChatId, "main");
    assert.equal(reloaded?.createdByAgentId, "agent_parent");
    assert.equal(reloaded?.notifyTarget?.channel, "inbox");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

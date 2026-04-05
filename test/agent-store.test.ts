import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import { JsonFileAgentStore } from "../src/agent.js";

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
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import { defaultAgentsFile, initProjectConfig } from "../src/config.js";
import { Harness } from "../src/harness.js";
import { JsonFileAgentStore } from "../src/storage/json.js";

test("agent coordination state survives restart through inbox, memory, and paused agents", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-agent-coordination-"));

  try {
    const startedAt = new Date().toISOString();
    await initProjectConfig(projectDir, {
      name: "coordination-project",
      model: "dummy/test-model",
      storage: "json",
      tools: ["read", "act"],
    });

    const agentStore = new JsonFileAgentStore(defaultAgentsFile(projectDir));
    agentStore.saveAgent({
      id: "agent_parent",
      name: "parent",
      prompt: "Coordinate the work",
      chatId: "agent_parent",
      status: "paused",
      maxSteps: 10,
      timeoutMs: 60 * 60 * 1000,
      stepCount: 1,
      createdAt: startedAt,
      startedAt,
    });
    agentStore.saveAgent({
      id: "agent_child",
      name: "child",
      prompt: "Handle the delegated task",
      chatId: "agent_child",
      status: "paused",
      maxSteps: 10,
      timeoutMs: 60 * 60 * 1000,
      stepCount: 1,
      createdAt: startedAt,
      startedAt,
    });

    const harness = Harness.load(projectDir);
    await harness.start();

    assert.equal(harness.getAgent("agent_parent")?.status, "paused");
    assert.equal(harness.getAgent("agent_child")?.status, "paused");

    await harness.switchChat("agent_child");
    const childTools = harness.listTools();
    const writeAgentMemory = childTools.find((tool) => tool.name === "write_agent_memory");
    const sendAgentMessage = childTools.find((tool) => tool.name === "send_agent_message");

    assert.ok(writeAgentMemory);
    assert.ok(sendAgentMessage);

    const writeReply = await writeAgentMemory.execute({
      text: "Investigated the issue, narrowed it to the portal command path, and have a fix ready.",
    });
    const sendReply = await sendAgentMessage.execute({
      agent: "parent",
      text: "I finished the investigation and captured the result in my memory.",
    });

    assert.equal(writeReply, "updated agent memory: agent_child");
    assert.equal(sendReply, "sent message to agent: parent");
    assert.equal(
      await harness.readAgentMemory("child"),
      "Investigated the issue, narrowed it to the portal command path, and have a fix ready.",
    );
    assert.equal((await harness.listAgentInbox("parent"))?.length, 1);

    await harness.teardown();

    const restarted = Harness.load(projectDir);
    await restarted.start();

    assert.equal(restarted.getAgent("agent_parent")?.status, "paused");
    assert.equal(restarted.getAgent("agent_child")?.status, "paused");
    assert.equal(
      await restarted.readAgentMemory("child"),
      "Investigated the issue, narrowed it to the portal command path, and have a fix ready.",
    );

    await restarted.switchChat("agent_parent");
    const parentTools = restarted.listTools();
    const readAgentInbox = parentTools.find((tool) => tool.name === "read_agent_inbox");
    const readAgentMemory = parentTools.find((tool) => tool.name === "read_agent_memory");

    assert.ok(readAgentInbox);
    assert.ok(readAgentMemory);

    const inboxReply = await readAgentInbox.execute({});
    const memoryReply = await readAgentMemory.execute({ agent: "child" });

    assert.match(inboxReply, /I finished the investigation and captured the result in my memory\./u);
    assert.match(inboxReply, /from: agent child/u);
    assert.equal(
      memoryReply,
      "Investigated the issue, narrowed it to the portal command path, and have a fix ready.",
    );
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

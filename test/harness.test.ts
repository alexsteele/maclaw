import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import test from "node:test";
import { Harness } from "../src/harness.js";
import type { AgentRecord } from "../src/types.js";
import { useDummyProviderEnv } from "./provider-env.js";

useDummyProviderEnv();

const waitForAgentToSettle = async (
  harness: Harness,
  agentId: string,
): Promise<AgentRecord> => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const record = harness.getAgent(agentId);
    if (
      record &&
      record.status !== "pending" &&
      record.status !== "running"
    ) {
      return record;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`Timed out waiting for agent ${agentId} to settle`);
};

test("initProject upgrades a headless harness and preserves chats and tasks", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-harness-"));

  try {
    const harness = Harness.load(projectDir);

    await harness.prompt("remember this");
    await harness.createTask({
      title: "Follow up",
      prompt: "Check back later",
      runAt: "2026-04-05T09:00:00-07:00",
    });

    const upgraded = await harness.initProject({
      name: "test-project",
      provider: "dummy",
      model: "test-model",
    });

    assert.equal(upgraded, harness);
    assert.equal(harness.isProjectInitialized(), true);
    assert.equal(harness.config.name, "test-project");
    assert.equal(harness.config.provider, "dummy");
    assert.equal(harness.config.model, "test-model");

    const transcript = await harness.getCurrentChatTranscript();
    assert.match(transcript, /remember this/u);

    const tasks = await harness.listCurrentChatTasks();
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0]?.title, "Follow up");

    const configRaw = await readFile(path.join(projectDir, ".maclaw", "maclaw.json"), "utf8");
    const savedConfig = JSON.parse(configRaw) as { createdAt?: string; name?: string };
    assert.ok(savedConfig.createdAt);
    assert.equal(savedConfig.name, "test-project");
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("forkChat creates a default fork id when none is provided", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-harness-fork-"));

  try {
    const harness = Harness.load(projectDir);

    const result = await harness.forkChat();

    assert.ok(result.chat);
    assert.equal(result.chat.id, "default-fork");
    assert.equal(harness.getCurrentChatId(), "default-fork");
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("harness createAgent starts a simple agent loop in the background", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-harness-agent-"));

  try {
    const harness = Harness.load(projectDir);

    const created = harness.createAgent({
      name: "simple-agent",
      prompt: "Work on this task",
      maxSteps: 2,
    });
    assert.ok(created.agent);

    const initial = harness.getAgent(created.agent.id);
    assert.ok(initial);
    assert.match(initial.status, /pending|running/u);

    const result = await waitForAgentToSettle(harness, created.agent.id);

    assert.equal(result.id, created.agent.id);
    assert.equal(result.status, "stopped");
    assert.equal(result.stepCount, 2);

    const transcript = await harness.getChatTranscript(created.agent.chatId);
    assert.match(transcript, /Work on this task/u);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("harness stores and cancels agents through the agent store", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-harness-agent-store-"));

  try {
    const harness = Harness.load(projectDir);

    const created = harness.createAgent({
      name: "queued-agent",
      prompt: "Wait here",
    });
    assert.ok(created.agent);

    const listed = harness.listAgents();
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.id, created.agent.id);

    const loaded = harness.getAgent(created.agent.id);
    assert.equal(loaded?.name, "queued-agent");

    const cancelled = harness.cancelAgent("queued-agent");
    assert.equal(cancelled?.status, "cancelled");
    assert.equal(harness.getAgent(created.agent.id)?.status, "cancelled");
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("harness can queue a steer prompt for an agent", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-harness-agent-steer-"));

  try {
    const harness = Harness.load(projectDir);
    const created = harness.createAgent({
      name: "steerable-agent",
      prompt: "Start here",
    });
    assert.ok(created.agent);

    const steered = harness.steerAgent("steerable-agent", "Try a different direction");

    assert.equal(steered?.id, created.agent.id);
    assert.ok(steered);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("harness can pause and resume an agent", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-harness-agent-pause-"));

  try {
    const harness = Harness.load(projectDir);
    const created = harness.createAgent({
      name: "pauseable-agent",
      prompt: "Start here",
    });
    assert.ok(created.agent);

    const paused = harness.pauseAgent("pauseable-agent");
    assert.equal(paused?.status, "paused");
    assert.equal(harness.getAgent(created.agent.id)?.status, "paused");

    const resumed = harness.resumeAgent("pauseable-agent");
    assert.equal(resumed?.status, "running");
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("teardown cancels running agents", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-harness-agent-teardown-"));

  try {
    const harness = Harness.load(projectDir);
    const created = harness.createAgent({
      name: "long-agent",
      prompt: "Keep going",
      maxSteps: 50,
    });
    assert.ok(created.agent);

    harness.teardown();

    const settled = await waitForAgentToSettle(harness, created.agent.id);
    assert.equal(settled.status, "cancelled");
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("wipeProject deletes .maclaw and returns the harness to headless mode", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-harness-wipeout-"));

  try {
    const harness = Harness.load(projectDir);
    await harness.initProject({
      name: "wipe-me",
      provider: "dummy",
      model: "test-model",
    });
    await harness.prompt("remember this");
    await harness.createTask({
      title: "Follow up",
      prompt: "Check back later",
      runAt: "2026-04-05T09:00:00-07:00",
    });

    const wiped = await harness.wipeProject();

    assert.equal(wiped, true);
    assert.equal(harness.isProjectInitialized(), false);
    assert.equal(harness.config.storage, "none");
    assert.equal(existsSync(path.join(projectDir, ".maclaw")), false);
    assert.equal((await harness.listCurrentChatTasks()).length, 0);
    assert.equal(await harness.getCurrentChatTranscript(), "No history yet.");
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("harness emits a notification when an origin-backed agent fails", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-harness-agent-notify-"));

  try {
    const harness = Harness.load(projectDir);
    const notifications: Array<{ kind: string; text: string; originUserId?: string }> = [];

    await harness.start(
      async () => {},
      async (notification) => {
        notifications.push({
          kind: notification.kind,
          text: notification.text,
          originUserId: notification.origin.userId,
        });
      },
    );

    harness.promptChat = async () => {
      throw new Error("boom");
    };

    const created = harness.createAgent({
      name: "notifier-agent",
      prompt: "Do the thing",
      origin: {
        channel: "slack",
        conversationId: "C123",
        threadId: "171234.5678",
        userId: "slack-T123-U123",
      },
    });
    assert.ok(created.agent);

    const settled = await waitForAgentToSettle(harness, created.agent.id);

    assert.equal(settled.status, "failed");
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0]?.kind, "agentFailed");
    assert.equal(notifications[0]?.originUserId, "slack-T123-U123");
    assert.match(notifications[0]?.text ?? "", /notifier-agent failed: boom/u);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("harness emits a notification when an origin-backed task completes", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-harness-task-notify-"));

  try {
    const harness = Harness.load(projectDir);
    const notifications: Array<{ kind: string; text: string; originUserId?: string }> = [];

    await harness.start(
      async () => {},
      async (notification) => {
        notifications.push({
          kind: notification.kind,
          text: notification.text,
          originUserId: notification.origin.userId,
        });
      },
    );

    await harness.createTask({
      chatId: "slack-T123-U123",
      origin: {
        channel: "slack",
        conversationId: "C123",
        threadId: "171234.5678",
        userId: "slack-T123-U123",
      },
      title: "Branch Task",
      prompt: "Follow up on branch",
      runAt: new Date(Date.now() - 60_000).toISOString(),
    });

    await harness.runDueTasks(async () => {});

    assert.equal(notifications.length, 1);
    assert.equal(notifications[0]?.kind, "taskCompleted");
    assert.equal(notifications[0]?.originUserId, "slack-T123-U123");
    assert.match(notifications[0]?.text ?? "", /Branch Task completed/u);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("harness emits a notification when an origin-backed task fails", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-harness-task-fail-notify-"));

  try {
    const harness = Harness.load(projectDir);
    const notifications: Array<{ kind: string; text: string; originUserId?: string }> = [];

    await harness.start(
      async () => {},
      async (notification) => {
        notifications.push({
          kind: notification.kind,
          text: notification.text,
          originUserId: notification.origin.userId,
        });
      },
    );

    harness.handleScheduledTask = async () => {
      throw new Error("task boom");
    };

    await harness.createTask({
      chatId: "slack-T123-U123",
      origin: {
        channel: "slack",
        conversationId: "C123",
        threadId: "171234.5678",
        userId: "slack-T123-U123",
      },
      title: "Broken Task",
      prompt: "This will fail",
      runAt: new Date(Date.now() - 60_000).toISOString(),
    });

    await harness.runDueTasks(async () => {});

    assert.equal(notifications.length, 1);
    assert.equal(notifications[0]?.kind, "taskFailed");
    assert.equal(notifications[0]?.originUserId, "slack-T123-U123");
    assert.match(notifications[0]?.text ?? "", /Broken Task failed: task boom/u);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("harness suppresses notifications when project notifications are none", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-harness-no-notify-"));

  try {
    const harness = Harness.load(projectDir);
    await harness.initProject({
      name: "quiet-project",
      provider: "dummy",
      model: "test-model",
      notifications: "none",
    });
    const notifications: Array<{ kind: string }> = [];

    await harness.start(
      async () => {},
      async (notification) => {
        notifications.push({ kind: notification.kind });
      },
    );

    harness.promptChat = async () => {
      throw new Error("boom");
    };

    const created = harness.createAgent({
      name: "quiet-agent",
      prompt: "Do the thing",
      origin: {
        channel: "slack",
        conversationId: "C123",
        userId: "slack-T123-U123",
      },
    });
    assert.ok(created.agent);

    await waitForAgentToSettle(harness, created.agent.id);
    assert.equal(notifications.length, 0);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("harness applies notification allow and deny selectors", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-harness-selective-notify-"));

  try {
    const harness = Harness.load(projectDir);
    await harness.initProject({
      name: "selective-project",
      provider: "dummy",
      model: "test-model",
      notifications: {
        allow: ["agent:*", "task:*"],
        deny: ["taskCompleted"],
      },
    });
    const notifications: Array<{ kind: string; text: string }> = [];

    await harness.start(
      async () => {},
      async (notification) => {
        notifications.push({
          kind: notification.kind,
          text: notification.text,
        });
      },
    );

    await harness.createTask({
      chatId: "slack-T123-U123",
      origin: {
        channel: "slack",
        conversationId: "C123",
        userId: "slack-T123-U123",
      },
      title: "Completed Task",
      prompt: "This should be quiet",
      runAt: new Date(Date.now() - 60_000).toISOString(),
    });

    await harness.runDueTasks(async () => {});

    harness.handleScheduledTask = async () => {
      throw new Error("task boom");
    };

    await harness.createTask({
      chatId: "slack-T123-U123",
      origin: {
        channel: "slack",
        conversationId: "C123",
        userId: "slack-T123-U123",
      },
      title: "Broken Task",
      prompt: "This should notify",
      runAt: new Date(Date.now() - 60_000).toISOString(),
    });

    await harness.runDueTasks(async () => {});

    assert.deepEqual(
      notifications.map((notification) => notification.kind),
      ["taskFailed"],
    );
    assert.match(notifications[0]?.text ?? "", /Broken Task failed: task boom/u);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

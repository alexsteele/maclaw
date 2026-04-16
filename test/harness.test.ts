import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import test from "node:test";
import { Harness } from "../src/harness.js";
import {
  defaultAgentFile,
  defaultAgentMemoryFile,
  defaultAgentsFile,
  defaultInboxFile,
  defaultProjectLockFile,
  initProjectConfig,
} from "../src/config.js";
import { JsonFileAgentStore, JsonFileInboxStore } from "../src/storage/json.js";
import type { AgentRecord } from "../src/types.js";
import { useDummyProviderEnv } from "./provider-env.js";

useDummyProviderEnv();

const noopTaskMessage = async (): Promise<void> => {};

const createRecordingRouter = <T>(
  onSend: (notification: {
    kind: string;
    text: string;
    originUserId?: string;
  }) => T,
) => ({
  async send(notification: {
    kind: string;
    text: string;
    target: unknown;
    origin?: { userId?: string };
  }) {
    onSend({
      kind: notification.kind,
      text: notification.text,
      originUserId: notification.origin?.userId,
    });
    return {
      delivered: true,
      target: notification.origin,
    };
  },
});

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
      model: "dummy/test-model",
    });

    assert.equal(upgraded, harness);
    assert.equal(harness.isProjectInitialized(), true);
    assert.equal(harness.config.name, "test-project");
    assert.equal(harness.config.model, "dummy/test-model");

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

test("harness loads normal prompts from @files", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-harness-prompt-file-"));

  try {
    const harness = Harness.load(projectDir);
    await writeFile(path.join(projectDir, "note.md"), "remember this from file\n", "utf8");

    await harness.prompt("@note.md");

    const transcript = await harness.getCurrentChatTranscript();
    assert.match(transcript, /remember this from file/u);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("harness createAgent starts a simple agent loop in the background", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-harness-agent-"));

  try {
    const harness = Harness.load(projectDir);

    const created = await harness.createAgent({
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

    const created = await harness.createAgent({
      name: "queued-agent",
      prompt: "Wait here",
    });
    assert.ok(created.agent);

    const listed = harness.listAgents();
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.id, created.agent.id);

    const loaded = harness.getAgent(created.agent.id);
    assert.equal(loaded?.name, "queued-agent");
    assert.equal(loaded?.sourceChatId, "default");
    assert.equal(loaded?.createdBy, "user");

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
    const created = await harness.createAgent({
      name: "steerable-agent",
      prompt: "Start here",
    });
    assert.ok(created.agent);

    const steered = await harness.steerAgent("steerable-agent", "Try a different direction");

    assert.equal(steered?.id, created.agent.id);
    assert.ok(steered);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("harness stores task provenance", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-harness-task-provenance-"));

  try {
    const harness = Harness.load(projectDir);
    const task = await harness.createTask({
      title: "Follow up",
      prompt: "Check back later",
      runAt: "2026-04-05T09:00:00-07:00",
    });

    assert.equal(task.sourceChatId, "default");
    assert.equal(task.createdBy, "user");
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("harness can pause and resume an agent", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-harness-agent-pause-"));

  try {
    const harness = Harness.load(projectDir);
    const created = await harness.createAgent({
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
    const created = await harness.createAgent({
      name: "long-agent",
      prompt: "Keep going",
      maxSteps: 50,
    });
    assert.ok(created.agent);

    await harness.teardown();

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
      model: "dummy/test-model",
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

test("harness start acquires and teardown releases the project lock", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-harness-lock-"));

  try {
    const harness = Harness.load(projectDir);
    await harness.initProject({
      name: "lock-project",
      model: "dummy/test-model",
    });

    const lockFile = defaultProjectLockFile(projectDir);
    assert.equal(existsSync(lockFile), false);

    await harness.start();
    assert.equal(existsSync(lockFile), true);

    await harness.teardown();
    assert.equal(existsSync(lockFile), false);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("harness start refuses to open a project already locked by another runtime", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-harness-lock-busy-"));

  try {
    await initProjectConfig(projectDir, {
      name: "busy-project",
      model: "dummy/test-model",
    });

    const firstHarness = Harness.load(projectDir);
    const secondHarness = Harness.load(projectDir);

    await firstHarness.start();

    await assert.rejects(
      secondHarness.start(),
      /Project is already in use by maclaw/u,
    );

    await firstHarness.teardown();
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("harness start replaces a stale project lock", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-harness-lock-stale-"));

  try {
    await initProjectConfig(projectDir, {
      name: "stale-lock-project",
      model: "dummy/test-model",
    });

    const lockFile = defaultProjectLockFile(projectDir);
    await writeFile(
      lockFile,
      `${JSON.stringify({
        pid: 999_999_999,
        host: os.hostname(),
        ownerId: "stale-owner",
        acquiredAt: "2026-04-11T00:00:00.000Z",
      }, null, 2)}\n`,
      "utf8",
    );

    const harness = Harness.load(projectDir);
    await harness.start();

    const rawLock = await readFile(lockFile, "utf8");
    const parsedLock = JSON.parse(rawLock) as {
      pid: number;
      host: string;
      ownerId: string;
    };

    assert.equal(parsedLock.pid, process.pid);
    assert.equal(parsedLock.host, os.hostname());
    assert.notEqual(parsedLock.ownerId, "stale-owner");

    await harness.teardown();
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("harness start does not replace a lock from another host", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-harness-lock-remote-"));

  try {
    await initProjectConfig(projectDir, {
      name: "remote-lock-project",
      model: "dummy/test-model",
    });

    const lockFile = defaultProjectLockFile(projectDir);
    await writeFile(
      lockFile,
      `${JSON.stringify({
        pid: 1234,
        host: "other-host",
        ownerId: "remote-owner",
        acquiredAt: "2026-04-11T00:00:00.000Z",
      }, null, 2)}\n`,
      "utf8",
    );

    const harness = Harness.load(projectDir);
    await assert.rejects(
      harness.start(),
      /Project is already in use by maclaw \(pid 1234 on other-host\)/u,
    );
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("harness emits a notification when an origin-backed agent fails", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-harness-agent-notify-"));

  try {
    const harness = Harness.load(projectDir, {
      onTaskMessage: noopTaskMessage,
      router: createRecordingRouter((notification) => {
        notifications.push(notification);
      }),
    });
    const notifications: Array<{ kind: string; text: string; originUserId?: string }> = [];
    await harness.start();

    harness.promptChat = async () => {
      throw new Error("boom");
    };

    const created = await harness.createAgent({
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

test("harness saves delivered notifications to the project inbox", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-harness-inbox-"));

  try {
    const harness = Harness.load(projectDir, {
      onTaskMessage: noopTaskMessage,
      router: {
        async send(notification) {
          return { delivered: true, target: notification.origin };
        },
      },
    });
    await harness.initProject({
      name: "inbox-project",
      model: "dummy/test-model",
    });
    await harness.start();

    harness.promptChat = async () => {
      throw new Error("boom");
    };

    const created = await harness.createAgent({
      name: "inbox-agent",
      prompt: "Do the thing",
      origin: {
        channel: "slack",
        conversationId: "C123",
        userId: "slack-T123-U123",
      },
    });
    assert.ok(created.agent);

    await waitForAgentToSettle(harness, created.agent.id);

    const inbox = await new JsonFileInboxStore(defaultInboxFile(projectDir)).loadEntries();
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0]?.kind, "agentFailed");
    assert.equal(inbox[0]?.origin.channel, "slack");
    assert.equal(inbox[0]?.origin.userId, "slack-T123-U123");
    assert.equal(inbox[0]?.sourceType, "agent");
    assert.equal(inbox[0]?.sourceId, created.agent.id);
    assert.equal(inbox[0]?.sourceName, "inbox-agent");
    assert.equal(inbox[0]?.sourceChatId, created.agent.chatId);
    assert.match(inbox[0]?.text ?? "", /inbox-agent failed: boom/u);
    assert.ok(inbox[0]?.id);
    assert.ok(inbox[0]?.createdAt);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("harness stores agents and inbox entries in sqlite when configured", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-harness-sqlite-"));

  try {
    const harness = Harness.load(projectDir, {
      onTaskMessage: noopTaskMessage,
      router: {
        async send(notification) {
          return { delivered: true, target: notification.origin };
        },
      },
    });
    await harness.initProject({
      name: "sqlite-project",
      model: "dummy/test-model",
      storage: "sqlite",
    });

    await harness.start();

    harness.promptChat = async () => {
      throw new Error("boom");
    };

    const created = await harness.createAgent({
      name: "sqlite-agent",
      prompt: "Do the thing",
      origin: {
        channel: "slack",
        conversationId: "C123",
        userId: "slack-T123-U123",
      },
    });
    assert.ok(created.agent);

    const settled = await waitForAgentToSettle(harness, created.agent.id);
    assert.equal(settled.status, "failed");

    const agents = harness.listAgents();
    assert.equal(agents.length, 1);
    assert.equal(agents[0]?.name, "sqlite-agent");
    assert.equal(existsSync(defaultAgentFile(projectDir, created.agent.id)), true);

    const inbox = await harness.listInbox();
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0]?.kind, "agentFailed");
    assert.match(inbox[0]?.text ?? "", /sqlite-agent failed: boom/u);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("harness start restores persisted running and paused agents", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-harness-restore-agents-"));

  try {
    const startedAt = new Date().toISOString();
    await initProjectConfig(projectDir, {
      name: "restore-agents-project",
      model: "dummy/test-model",
      storage: "json",
    });

    const agentStore = new JsonFileAgentStore(defaultAgentsFile(projectDir));
    agentStore.saveAgent({
      id: "agent_running",
      name: "running-agent",
      prompt: "Continue work",
      chatId: "agent_running",
      status: "running",
      maxSteps: 2,
      timeoutMs: 60 * 60 * 1000,
      stepCount: 1,
      createdAt: "2026-04-11T07:00:00.000Z",
      startedAt,
    });
    agentStore.saveAgent({
      id: "agent_paused",
      name: "paused-agent",
      prompt: "Wait here",
      chatId: "agent_paused",
      status: "paused",
      maxSteps: 5,
      timeoutMs: 60 * 60 * 1000,
      stepCount: 1,
      createdAt: "2026-04-11T07:00:00.000Z",
      startedAt,
    });

    const harness = Harness.load(projectDir);
    await harness.start();

    const restoredRunning = await waitForAgentToSettle(harness, "agent_running");
    const restoredPaused = harness.getAgent("agent_paused");

    assert.equal(restoredRunning.status, "stopped");
    assert.equal(restoredRunning.stepCount, 2);
    assert.equal(restoredRunning.startedAt, startedAt);
    assert.equal(restoredPaused?.status, "paused");
    assert.equal(restoredPaused?.stepCount, 1);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("harness stores tasks in sqlite when configured", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-harness-sqlite-task-"));

  try {
    const harness = Harness.load(projectDir);
    await harness.initProject({
      name: "sqlite-task-project",
      model: "dummy/test-model",
      storage: "sqlite",
    });

    const task = await harness.createTask({
      chatId: "default",
      title: "SQLite Task",
      prompt: "Do the thing later",
      runAt: "2026-04-05T09:00:00-07:00",
    });

    const tasks = await harness.listCurrentChatTasks();
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0]?.id, task.id);
    assert.equal(tasks[0]?.title, "SQLite Task");
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("harness stores agent inbox entries in sqlite when configured", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-harness-sqlite-agent-inbox-"));

  try {
    const harness = Harness.load(projectDir);
    await harness.initProject({
      name: "sqlite-agent-inbox-project",
      model: "dummy/test-model",
      storage: "sqlite",
    });

    const created = await harness.createAgent({
      name: "sqlite-agent",
      prompt: "Wait here",
      maxSteps: 50,
    });
    assert.ok(created.agent);
    assert.equal(harness.pauseAgent(created.agent.id)?.status, "paused");

    const entry = await harness.sendAgentInboxMessage({
      agentRef: created.agent.id,
      text: "Please pick this up after restart",
      sourceType: "user",
      sourceId: "alex",
      sourceName: "Alex",
      sourceChatId: "default",
    });
    assert.ok(entry);

    const entries = await harness.listAgentInbox(created.agent.id);
    assert.equal(entries?.length, 1);
    assert.equal(entries?.[0]?.text, "Please pick this up after restart");
    assert.equal(entries?.[0]?.sourceName, "Alex");

    const memoryWritten = await harness.writeAgentMemory(
      created.agent.id,
      "Keep the SQLite-backed agent notes on disk.",
    );
    assert.equal(memoryWritten, true);
    assert.equal(existsSync(defaultAgentMemoryFile(projectDir, created.agent.id)), true);

    await harness.promptChat(created.agent.id, "SQLite agent chat update");
    assert.equal(
      existsSync(path.join(projectDir, ".maclaw", "chats", `${created.agent.id}.jsonl`)),
      true,
    );
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("updateProjectConfig migrates project data when storage changes", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-harness-storage-migrate-"));

  try {
    const harness = Harness.load(projectDir);
    await harness.initProject({
      name: "storage-migrate-project",
      model: "dummy/test-model",
      storage: "json",
    });

    await harness.prompt("remember this");
    const task = await harness.createTask({
      title: "Follow up",
      prompt: "Check back later",
      runAt: "2026-04-05T09:00:00-07:00",
    });

    const created = await harness.createAgent({
      name: "stored-agent",
      prompt: "Wait here",
      maxSteps: 50,
    });
    assert.ok(created.agent);
    const cancelled = harness.cancelAgent(created.agent.id);
    assert.equal(cancelled?.status, "cancelled");

    const notification = await harness.notify({
      destination: "inbox",
      text: "Stored inbox message",
      saveToInbox: true,
    });
    assert.equal(notification.saved, true);

    const agentInboxEntry = await harness.sendAgentInboxMessage({
      agentRef: created.agent.id,
      text: "Stored agent inbox message",
      sourceType: "user",
      sourceId: "alex",
      sourceName: "Alex",
      sourceChatId: "default",
    });
    assert.ok(agentInboxEntry);

    const memoryWritten = await harness.writeAgentMemory(
      created.agent.id,
      "Remember to summarize the findings before finishing.",
    );
    assert.equal(memoryWritten, true);
    await harness.promptChat(created.agent.id, "Agent scratchpad update");

    const nextConfig = await harness.updateProjectConfig({ storage: "sqlite" });

    assert.equal(nextConfig.storage, "sqlite");
    assert.equal(harness.config.storage, "sqlite");

    const transcript = await harness.getCurrentChatTranscript();
    assert.match(transcript, /remember this/u);

    const tasks = await harness.listCurrentChatTasks();
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0]?.id, task.id);

    const agents = harness.listAgents();
    assert.equal(agents.length, 1);
    assert.equal(agents[0]?.name, "stored-agent");
    assert.equal(agents[0]?.status, "cancelled");
    assert.equal(existsSync(defaultAgentFile(projectDir, created.agent.id)), true);
    assert.equal(existsSync(defaultAgentMemoryFile(projectDir, created.agent.id)), true);
    assert.equal(
      existsSync(path.join(projectDir, ".maclaw", "chats", `${created.agent.id}.jsonl`)),
      true,
    );

    const inbox = await harness.listInbox();
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0]?.text, "Stored inbox message");

    const agentInbox = await harness.listAgentInbox(created.agent.id);
    assert.equal(agentInbox?.length, 1);
    assert.equal(agentInbox?.[0]?.text, "Stored agent inbox message");
    assert.equal(agentInbox?.[0]?.sourceName, "Alex");
    assert.equal(
      await harness.readAgentMemory(created.agent.id),
      "Remember to summarize the findings before finishing.",
    );
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("harness emits a notification when an origin-backed task completes", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-harness-task-notify-"));

  try {
    const notifications: Array<{ kind: string; text: string; originUserId?: string }> = [];
    const harness = Harness.load(projectDir, {
      onTaskMessage: noopTaskMessage,
      router: createRecordingRouter((notification) => {
        notifications.push(notification);
      }),
    });
    await harness.start();

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
    const notifications: Array<{ kind: string; text: string; originUserId?: string }> = [];
    const harness = Harness.load(projectDir, {
      onTaskMessage: noopTaskMessage,
      router: createRecordingRouter((notification) => {
        notifications.push(notification);
      }),
    });
    await harness.start();

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
    const notifications: Array<{ kind: string }> = [];
    const harness = Harness.load(projectDir, {
      onTaskMessage: noopTaskMessage,
      router: {
        async send(notification) {
          notifications.push({ kind: notification.kind });
          return { delivered: true, target: notification.origin };
        },
      },
    });
    await harness.initProject({
      name: "quiet-project",
      model: "dummy/test-model",
      notifications: "none",
    });
    await harness.start();

    harness.promptChat = async () => {
      throw new Error("boom");
    };

    const created = await harness.createAgent({
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

test("harness suppresses agent notifications when the agent notify override is none", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-harness-agent-notify-none-"));

  try {
    const notifications: Array<{ kind: string }> = [];
    const harness = Harness.load(projectDir, {
      onTaskMessage: noopTaskMessage,
      router: {
        async send(notification) {
          notifications.push({ kind: notification.kind });
          return { delivered: true, target: notification.origin };
        },
      },
    });
    await harness.start();

    harness.promptChat = async () => {
      throw new Error("boom");
    };

    const created = await harness.createAgent({
      name: "quiet-agent",
      prompt: "Do the thing",
      notify: "none",
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

test("harness suppresses task notifications when the task notify override is none", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-harness-task-notify-none-"));

  try {
    const notifications: Array<{ kind: string }> = [];
    const harness = Harness.load(projectDir, {
      onTaskMessage: noopTaskMessage,
      router: {
        async send(notification) {
          notifications.push({ kind: notification.kind });
          return { delivered: true, target: notification.origin };
        },
      },
    });
    await harness.start();

    await harness.createTask({
      chatId: "slack-T123-U123",
      notify: "none",
      origin: {
        channel: "slack",
        conversationId: "C123",
        userId: "slack-T123-U123",
      },
      title: "Quiet Task",
      prompt: "This should stay quiet",
      runAt: new Date(Date.now() - 60_000).toISOString(),
    });

    await harness.runDueTasks(async () => {});
    assert.equal(notifications.length, 0);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("harness applies notification allow and deny selectors", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-harness-selective-notify-"));

  try {
    const notifications: Array<{ kind: string; text: string }> = [];
    const harness = Harness.load(projectDir, {
      onTaskMessage: noopTaskMessage,
      router: {
        async send(notification) {
          notifications.push({
            kind: notification.kind,
            text: notification.text,
          });
          return { delivered: true, target: notification.origin };
        },
      },
    });
    await harness.initProject({
      name: "selective-project",
      model: "dummy/test-model",
      notifications: {
        allow: ["agent:*", "task:*"],
        deny: ["taskCompleted"],
      },
    });
    await harness.start();

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

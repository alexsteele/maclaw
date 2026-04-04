import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import { MaclawAgent } from "../src/agent.js";
import type { AppConfig } from "../src/config.js";
import { JsonFileTaskStore, TaskScheduler } from "../src/scheduler.js";
import { JsonFileChatStore, appendMessage } from "../src/chats.js";

const createHarness = async (): Promise<{
  agent: MaclawAgent;
  cleanup: () => Promise<void>;
  chatStore: JsonFileChatStore;
}> => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-agent-"));
  const config: AppConfig = {
    createdAt: undefined,
    dataDir: path.join(projectDir, ".maclaw"),
    isProjectInitialized: true,
    model: "gpt-4.1-mini",
    provider: "local",
    projectConfigFile: path.join(projectDir, ".maclaw", "maclaw.json"),
    projectFolder: projectDir,
    projectName: path.basename(projectDir),
    chatsDir: path.join(projectDir, ".maclaw", "chats"),
    schedulerFile: path.join(projectDir, ".maclaw", "tasks.json"),
    taskRunsFile: path.join(projectDir, ".maclaw", "task-runs.jsonl"),
    skillsDir: path.join(projectDir, ".maclaw", "skills"),
    chatId: "default",
    retentionDays: 30,
    compressionMode: "none",
    schedulerPollMs: 1_000,
  };

  const chatStore = new JsonFileChatStore(config.chatsDir);
  const scheduler = new TaskScheduler(new JsonFileTaskStore(config.schedulerFile));
  const agent = new MaclawAgent(config, scheduler, chatStore);

  return {
    agent,
    cleanup: async () => rm(projectDir, { recursive: true, force: true }),
    chatStore,
  };
};

test("agent can fork and switch chats", async () => {
  const { agent, cleanup, chatStore } = await createHarness();

  try {
    const chat = await agent.loadActiveChat();
    appendMessage(chat, "user", "hello from default");
    await chatStore.saveChat(chat);

    const forked = await agent.forkChat("branch-a");
    assert.equal(forked.id, "branch-a");
    assert.equal(agent.getCurrentChatId(), "branch-a");
    assert.equal(forked.messages.length, 1);
    assert.equal(forked.messages[0]?.content, "hello from default");

    const switched = await agent.switchChat("fresh");
    assert.equal(switched.id, "fresh");
    assert.equal(agent.getCurrentChatId(), "fresh");
    assert.equal(switched.messages.length, 0);
  } finally {
    await cleanup();
  }
});

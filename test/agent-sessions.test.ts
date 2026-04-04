import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import { MaclawAgent } from "../src/agent.js";
import type { ProjectConfig } from "../src/config.js";
import { defaultTasksFile } from "../src/config.js";
import { JsonFileTaskStore, TaskScheduler } from "../src/scheduler.js";
import { JsonFileChatStore, appendMessage } from "../src/chats.js";

const createHarness = async (): Promise<{
  agent: MaclawAgent;
  cleanup: () => Promise<void>;
  chatStore: JsonFileChatStore;
}> => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-agent-"));
  const tasksFile = defaultTasksFile(projectDir);
  const config: ProjectConfig = {
    name: path.basename(projectDir),
    createdAt: undefined,
    provider: "local",
    model: "gpt-4.1-mini",
    retentionDays: 30,
    skillsDir: path.join(projectDir, ".maclaw", "skills"),
    compressionMode: "none",
    schedulerPollMs: 1_000,
    projectFolder: projectDir,
    projectConfigFile: path.join(projectDir, ".maclaw", "maclaw.json"),
    chatId: "default",
    chatsDir: path.join(projectDir, ".maclaw", "chats"),
  };

  const chatStore = new JsonFileChatStore(config.chatsDir);
  const scheduler = new TaskScheduler(new JsonFileTaskStore(tasksFile));
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

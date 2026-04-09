import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import type { ProjectConfig } from "../src/config.js";
import { defaultTasksFile } from "../src/config.js";
import { TaskScheduler } from "../src/scheduler.js";
import { ChatRuntime, appendMessage } from "../src/chats.js";
import { JsonFileChatStore, JsonFileTaskStore } from "../src/storage/json.js";
import { createTools } from "../src/tools/index.js";

const createHarness = async (): Promise<{
  agent: ChatRuntime;
  cleanup: () => Promise<void>;
  chatStore: JsonFileChatStore;
}> => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-agent-"));
  const tasksFile = defaultTasksFile(projectDir);
  const config: ProjectConfig = {
    name: path.basename(projectDir),
    createdAt: undefined,
    model: "dummy/gpt-4.1-mini",
    storage: "json",
    notifications: "all",
    defaultTaskTime: "9:00 AM",
    contextMessages: 20,
    maxToolIterations: 8,
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
  const agent = new ChatRuntime(config, chatStore, createTools(config));

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

test("ChatRuntime only sends the most recent contextMessages to the provider", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-chat-context-"));
  const originalFetch = globalThis.fetch;
  const requestBodies: Array<{ input?: Array<Record<string, unknown>> }> = [];

  try {
    globalThis.fetch = (async (_input, init) => {
      requestBodies.push(JSON.parse(String(init?.body)) as { input?: Array<Record<string, unknown>> });
      return {
        ok: true,
        json: async () => ({ output_text: "ok" }),
      } as Response;
    }) as typeof fetch;

    const config: ProjectConfig = {
      name: path.basename(projectDir),
      createdAt: undefined,
      model: "openai/gpt-4.1-mini",
      storage: "json",
      notifications: "all",
      defaultTaskTime: "9:00 AM",
      contextMessages: 2,
      maxToolIterations: 8,
      retentionDays: 30,
      skillsDir: path.join(projectDir, ".maclaw", "skills"),
      compressionMode: "none",
      schedulerPollMs: 1_000,
      projectFolder: projectDir,
      projectConfigFile: path.join(projectDir, ".maclaw", "maclaw.json"),
      chatId: "default",
      chatsDir: path.join(projectDir, ".maclaw", "chats"),
      openAiApiKey: "test-key",
    };

    const chatStore = new JsonFileChatStore(config.chatsDir);
    const runtime = new ChatRuntime(config, chatStore, createTools(config));
    const chat = await runtime.loadActiveChat();
    appendMessage(chat, "user", "one");
    appendMessage(chat, "assistant", "two");
    appendMessage(chat, "user", "three");
    appendMessage(chat, "assistant", "four");
    await chatStore.saveChat(chat);

    await runtime.prompt("five");

    assert.equal(requestBodies.length, 1);
    const input = requestBodies[0]?.input ?? [];
    assert.equal(input.length, 3);
    assert.deepEqual(
      input.slice(1).map((item) => {
        const content = item.content as Array<{ text?: string }>;
        return content[0]?.text;
      }),
      ["four", "five"],
    );
  } finally {
    globalThis.fetch = originalFetch;
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("ChatRuntime includes the compressed chat summary in the system prompt", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-chat-summary-"));
  const originalFetch = globalThis.fetch;
  const requestBodies: Array<{ input?: Array<Record<string, unknown>> }> = [];

  try {
    globalThis.fetch = (async (_input, init) => {
      requestBodies.push(JSON.parse(String(init?.body)) as { input?: Array<Record<string, unknown>> });
      return {
        ok: true,
        json: async () => ({ output_text: "ok" }),
      } as Response;
    }) as typeof fetch;

    const config: ProjectConfig = {
      name: path.basename(projectDir),
      createdAt: undefined,
      model: "openai/gpt-4.1-mini",
      storage: "json",
      notifications: "all",
      defaultTaskTime: "9:00 AM",
      contextMessages: 2,
      maxToolIterations: 8,
      retentionDays: 30,
      skillsDir: path.join(projectDir, ".maclaw", "skills"),
      compressionMode: "planned",
      schedulerPollMs: 1_000,
      projectFolder: projectDir,
      projectConfigFile: path.join(projectDir, ".maclaw", "maclaw.json"),
      chatId: "default",
      chatsDir: path.join(projectDir, ".maclaw", "chats"),
      openAiApiKey: "test-key",
    };

    const chatStore = new JsonFileChatStore(config.chatsDir);
    const runtime = new ChatRuntime(config, chatStore, createTools(config));
    const chat = await runtime.loadActiveChat();
    chat.summary = "Earlier we decided to use sqlite for project state.";
    await chatStore.saveChat(chat);

    await runtime.prompt("what did we decide?");

    const input = requestBodies[0]?.input ?? [];
    const systemMessage = input[0] as { content?: Array<{ text?: string }> };
    const systemPrompt = systemMessage.content?.[0]?.text ?? "";

    assert.match(systemPrompt, /Compressed chat summary:/u);
    assert.match(systemPrompt, /Earlier we decided to use sqlite for project state\./u);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(projectDir, { recursive: true, force: true });
  }
});

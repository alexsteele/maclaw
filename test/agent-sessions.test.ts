import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import { MaclawAgent } from "../src/agent.js";
import type { AppConfig } from "../src/config.js";
import { JsonFileTaskStore, TaskScheduler } from "../src/scheduler.js";
import { JsonFileSessionStore, appendMessage } from "../src/sessions.js";

const createHarness = async (): Promise<{
  agent: MaclawAgent;
  cleanup: () => Promise<void>;
  sessionStore: JsonFileSessionStore;
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
    sessionsDir: path.join(projectDir, ".maclaw", "chats"),
    schedulerFile: path.join(projectDir, ".maclaw", "tasks.json"),
    taskRunsFile: path.join(projectDir, ".maclaw", "task-runs.jsonl"),
    skillsDir: path.join(projectDir, ".maclaw", "skills"),
    sessionId: "default",
    retentionDays: 30,
    compressionMode: "none",
    schedulerPollMs: 1_000,
  };

  const sessionStore = new JsonFileSessionStore(config.sessionsDir);
  const scheduler = new TaskScheduler(new JsonFileTaskStore(config.schedulerFile));
  const agent = new MaclawAgent(config, scheduler, sessionStore);

  return {
    agent,
    cleanup: async () => rm(projectDir, { recursive: true, force: true }),
    sessionStore,
  };
};

test("agent can fork and switch sessions", async () => {
  const { agent, cleanup, sessionStore } = await createHarness();

  try {
    const session = await agent.loadActiveSession();
    appendMessage(session, "user", "hello from default");
    await sessionStore.saveSession(session);

    const forked = await agent.forkSession("branch-a");
    assert.equal(forked.id, "branch-a");
    assert.equal(agent.getCurrentSessionId(), "branch-a");
    assert.equal(forked.messages.length, 1);
    assert.equal(forked.messages[0]?.content, "hello from default");

    const switched = await agent.switchSession("fresh");
    assert.equal(switched.id, "fresh");
    assert.equal(agent.getCurrentSessionId(), "fresh");
    assert.equal(switched.messages.length, 0);
  } finally {
    await cleanup();
  }
});

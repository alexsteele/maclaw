import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import test from "node:test";
import { Harness } from "../src/harness.js";

test("initProject upgrades a headless harness and preserves chats and tasks", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-harness-"));

  try {
    const harness = Harness.load(projectDir);

    await harness.handleUserInput("remember this");
    await harness.createTask({
      title: "Follow up",
      prompt: "Check back later",
      runAt: "2026-04-05T09:00:00-07:00",
    });

    const upgraded = await harness.initProject({
      name: "test-project",
      provider: "local",
      model: "test-model",
    });

    assert.equal(upgraded, harness);
    assert.equal(harness.config.isProjectInitialized, true);
    assert.equal(harness.config.name, "test-project");
    assert.equal(harness.config.provider, "local");
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

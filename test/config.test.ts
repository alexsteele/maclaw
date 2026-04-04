import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { initProjectConfig, loadConfig } from "../src/config.js";

test("loadConfig derives project-local paths from the current folder and maclaw.json", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-config-"));

  try {
    await mkdir(path.join(rootDir, ".maclaw"), { recursive: true });
    await writeFile(
      path.join(rootDir, ".maclaw", "maclaw.json"),
      `${JSON.stringify(
        {
          createdAt: "2026-04-04T10:00:00.000Z",
          name: "example-project",
          retentionDays: 14,
          provider: "local",
          model: "test-model",
          skillsDir: "project-skills",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const config = loadConfig(rootDir);

    assert.equal(config.createdAt, "2026-04-04T10:00:00.000Z");
    assert.equal(config.isProjectInitialized, true);
    assert.equal(config.projectConfigFile, path.join(rootDir, ".maclaw", "maclaw.json"));
    assert.equal(config.projectFolder, rootDir);
    assert.equal(config.projectName, "example-project");
    assert.equal(config.dataDir, path.join(rootDir, ".maclaw"));
    assert.equal(config.skillsDir, path.join(rootDir, "project-skills"));
    assert.equal(config.sessionsDir, path.join(rootDir, ".maclaw", "chats"));
    assert.equal(config.schedulerFile, path.join(rootDir, ".maclaw", "tasks.json"));
    assert.equal(
      config.taskRunsFile,
      path.join(rootDir, ".maclaw", "task-runs.jsonl"),
    );
    assert.equal(config.retentionDays, 14);
    assert.equal(config.sessionId, "default");
    assert.equal(config.provider, "local");
    assert.equal(config.model, "test-model");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("loadConfig runs in uninitialized mode when .maclaw/maclaw.json is missing", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-config-unset-"));

  try {
    const config = loadConfig(rootDir);

    assert.equal(config.isProjectInitialized, false);
    assert.equal(config.createdAt, undefined);
    assert.equal(config.projectConfigFile, path.join(rootDir, ".maclaw", "maclaw.json"));
    assert.equal(config.dataDir, path.join(rootDir, ".maclaw"));
    assert.equal(config.sessionsDir, path.join(rootDir, ".maclaw", "chats"));
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("initProjectConfig creates a new project config with createdAt", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-config-init-"));

  try {
    const projectConfig = await initProjectConfig(rootDir);
    const configPath = path.join(rootDir, ".maclaw", "maclaw.json");
    const raw = await readFile(configPath, "utf8");
    const saved = JSON.parse(raw) as { createdAt?: string; name?: string };

    assert.ok(projectConfig.createdAt);
    assert.equal(saved.createdAt, projectConfig.createdAt);
    assert.equal(saved.name, path.basename(rootDir));
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("initProjectConfig backfills missing createdAt without dropping project settings", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-config-backfill-"));

  try {
    await mkdir(path.join(rootDir, ".maclaw"), { recursive: true });
    await writeFile(
      path.join(rootDir, ".maclaw", "maclaw.json"),
      `${JSON.stringify(
        {
          name: "existing-project",
          retentionDays: 10,
          provider: "local",
          model: "test-model",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const projectConfig = await initProjectConfig(rootDir);

    assert.ok(projectConfig.createdAt);
    assert.equal(projectConfig.name, "existing-project");
    assert.equal(projectConfig.retentionDays, 10);
    assert.equal(projectConfig.provider, "local");
    assert.equal(projectConfig.model, "test-model");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("initProjectConfig merges overrides into the saved project config", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-config-override-"));

  try {
    const projectConfig = await initProjectConfig(rootDir, {
      name: "override-project",
      provider: "local",
      model: "override-model",
      retentionDays: 7,
    });

    assert.ok(projectConfig.createdAt);
    assert.equal(projectConfig.name, "override-project");
    assert.equal(projectConfig.provider, "local");
    assert.equal(projectConfig.model, "override-model");
    assert.equal(projectConfig.retentionDays, 7);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

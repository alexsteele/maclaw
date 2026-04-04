import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { loadConfig } from "../src/config.js";

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
    assert.equal(config.projectConfigFile, path.join(rootDir, ".maclaw", "maclaw.json"));
    assert.equal(config.projectFolder, rootDir);
    assert.equal(config.projectName, "example-project");
    assert.equal(config.dataDir, path.join(rootDir, ".maclaw", "data"));
    assert.equal(config.skillsDir, path.join(rootDir, "project-skills"));
    assert.equal(config.sessionsDir, path.join(rootDir, ".maclaw", "data", "sessions"));
    assert.equal(config.schedulerFile, path.join(rootDir, ".maclaw", "data", "tasks.json"));
    assert.equal(
      config.taskRunsFile,
      path.join(rootDir, ".maclaw", "data", "task-runs.jsonl"),
    );
    assert.equal(config.retentionDays, 14);
    assert.equal(config.sessionId, "default");
    assert.equal(config.provider, "local");
    assert.equal(config.model, "test-model");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import {
  defaultTaskRunsFile,
  defaultTasksFile,
  initProjectConfig,
  loadConfig,
} from "../src/config.js";

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
          provider: "dummy",
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
    assert.equal(config.name, "example-project");
    assert.equal(config.skillsDir, path.join(rootDir, "project-skills"));
    assert.equal(config.chatsDir, path.join(rootDir, ".maclaw", "chats"));
    assert.equal(defaultTasksFile(rootDir), path.join(rootDir, ".maclaw", "tasks.json"));
    assert.equal(defaultTaskRunsFile(rootDir), path.join(rootDir, ".maclaw", "task-runs.jsonl"));
    assert.equal(config.retentionDays, 14);
    assert.equal(config.chatId, "default");
    assert.equal(config.provider, "dummy");
    assert.equal(config.model, "test-model");
    assert.equal(config.storage, "json");
    assert.equal(config.notifications, "all");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("loadConfig runs in uninitialized mode when .maclaw/maclaw.json is missing", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-config-unset-"));

  try {
    const config = loadConfig(rootDir);

    assert.equal(config.createdAt, undefined);
    assert.equal(config.projectConfigFile, path.join(rootDir, ".maclaw", "maclaw.json"));
    assert.equal(config.chatsDir, path.join(rootDir, ".maclaw", "chats"));
    assert.equal(config.storage, "none");
    assert.equal(config.notifications, "all");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("loadConfig reads OpenAI API key from ~/.maclaw secrets when env is unset", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-config-secrets-"));

  try {
    const secretsPath = path.join(rootDir, "secrets.json");
    await writeFile(
      secretsPath,
      `${JSON.stringify(
        {
          openai: {
            apiKey: "file-openai-api-key",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const originalServerSecrets = process.env.MACLAW_SERVER_SECRETS;
    const originalOpenAiApiKey = process.env.OPENAI_API_KEY;

    try {
      process.env.MACLAW_SERVER_SECRETS = secretsPath;
      delete process.env.OPENAI_API_KEY;

      const config = loadConfig(rootDir);
      assert.equal(config.openAiApiKey, "file-openai-api-key");
    } finally {
      if (originalServerSecrets === undefined) {
        delete process.env.MACLAW_SERVER_SECRETS;
      } else {
        process.env.MACLAW_SERVER_SECRETS = originalServerSecrets;
      }

      if (originalOpenAiApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = originalOpenAiApiKey;
      }
    }
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
    assert.equal(projectConfig.storage, "json");
    assert.equal(projectConfig.notifications, "all");
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
          provider: "dummy",
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
    assert.equal(projectConfig.provider, "dummy");
    assert.equal(projectConfig.model, "test-model");
    assert.equal(projectConfig.storage, "json");
    assert.equal(projectConfig.notifications, "all");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("initProjectConfig merges overrides into the saved project config", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-config-override-"));

  try {
    const projectConfig = await initProjectConfig(rootDir, {
      name: "override-project",
      provider: "dummy",
      model: "override-model",
      retentionDays: 7,
    });

    assert.ok(projectConfig.createdAt);
    assert.equal(projectConfig.name, "override-project");
    assert.equal(projectConfig.provider, "dummy");
    assert.equal(projectConfig.model, "override-model");
    assert.equal(projectConfig.retentionDays, 7);
    assert.equal(projectConfig.storage, "json");
    assert.equal(projectConfig.notifications, "all");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("loadConfig reads storage from project config", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-config-storage-"));

  try {
    await mkdir(path.join(rootDir, ".maclaw"), { recursive: true });
    await writeFile(
      path.join(rootDir, ".maclaw", "maclaw.json"),
      `${JSON.stringify(
        {
          name: "storage-project",
          provider: "dummy",
          model: "test-model",
          storage: "json",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const config = loadConfig(rootDir);
    assert.equal(config.storage, "json");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("loadConfig reads notifications from project config", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-config-notifications-"));

  try {
    await mkdir(path.join(rootDir, ".maclaw"), { recursive: true });
    await writeFile(
      path.join(rootDir, ".maclaw", "maclaw.json"),
      `${JSON.stringify(
        {
          name: "notify-project",
          provider: "dummy",
          model: "test-model",
          notifications: {
            allow: ["agent:*", "task:*"],
            deny: ["taskCompleted"],
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const config = loadConfig(rootDir);
    assert.deepEqual(config.notifications, {
      allow: ["agent:*", "task:*"],
      deny: ["taskCompleted"],
    });
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { loadServerConfig, loadServerSecrets } from "../src/server-config.js";

test("loadServerConfig reads projects and WhatsApp settings from ~/.maclaw-style config", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-server-config-"));

  try {
    const configPath = path.join(rootDir, "server.json");
    const projectA = path.join(rootDir, "project-a");
    const projectB = path.join(rootDir, "project-b");

    await mkdir(projectA, { recursive: true });
    await mkdir(projectB, { recursive: true });
    await writeFile(
      configPath,
      `${JSON.stringify(
        {
          projects: [
            { name: "home", folder: projectA },
            { name: "work", folder: projectB },
          ],
          defaultProject: "home",
          channels: {
            slack: {
              enabled: true,
              botUserId: "U123456",
            },
            whatsapp: {
              enabled: true,
              port: 4010,
              webhookPath: "/hooks/whatsapp",
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const config = loadServerConfig(configPath);

    assert.equal(config.configFile, configPath);
    assert.deepEqual(config.projects, [
      { name: "home", folder: projectA },
      { name: "work", folder: projectB },
    ]);
    assert.equal(config.defaultProject, "home");
    assert.equal(config.channels.slack.enabled, true);
    assert.equal(config.channels.slack.botUserId, "U123456");
    assert.equal(config.channels.whatsapp.enabled, true);
    assert.equal(config.channels.whatsapp.port, 4010);
    assert.equal(config.channels.whatsapp.webhookPath, "/hooks/whatsapp");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("loadServerConfig lets env override WhatsApp phone number id", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-server-config-env-"));

  try {
    const configPath = path.join(rootDir, "server.json");
    const projectDir = path.join(rootDir, "project-a");

    await mkdir(projectDir, { recursive: true });
    await writeFile(
      configPath,
      `${JSON.stringify(
        {
          projects: [{ name: "home", folder: projectDir }],
          channels: {
            whatsapp: {
              enabled: true,
              phoneNumberId: "file-phone-number-id",
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const originalPhoneNumberId = process.env.MACLAW_WHATSAPP_PHONE_NUMBER_ID;

    try {
      process.env.MACLAW_WHATSAPP_PHONE_NUMBER_ID = "env-phone-number-id";

      const config = loadServerConfig(configPath);
      assert.equal(config.channels.whatsapp.phoneNumberId, "env-phone-number-id");
    } finally {
      if (originalPhoneNumberId === undefined) {
        delete process.env.MACLAW_WHATSAPP_PHONE_NUMBER_ID;
      } else {
        process.env.MACLAW_WHATSAPP_PHONE_NUMBER_ID = originalPhoneNumberId;
      }
    }
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("loadServerSecrets reads WhatsApp secrets and lets env override file values", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-server-secrets-"));

  try {
    const secretsPath = path.join(rootDir, "secrets.json");
    await writeFile(
      secretsPath,
      `${JSON.stringify(
        {
          slack: {
            appToken: "xapp-file-slack-app-token",
            botToken: "file-slack-bot-token",
          },
          whatsapp: {
            accessToken: "file-access-token",
            verifyToken: "file-verify-token",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const originalAccessToken = process.env.MACLAW_WHATSAPP_ACCESS_TOKEN;
    const originalVerifyToken = process.env.MACLAW_WHATSAPP_VERIFY_TOKEN;
    const originalSlackAppToken = process.env.MACLAW_SLACK_APP_TOKEN;
    const originalSlackBotToken = process.env.MACLAW_SLACK_BOT_TOKEN;

    try {
      process.env.MACLAW_WHATSAPP_ACCESS_TOKEN = "env-access-token";
      delete process.env.MACLAW_WHATSAPP_VERIFY_TOKEN;
      process.env.MACLAW_SLACK_APP_TOKEN = "env-slack-app-token";
      delete process.env.MACLAW_SLACK_BOT_TOKEN;

      const secrets = loadServerSecrets(secretsPath);

      assert.equal(secrets.configFile, secretsPath);
      assert.equal(secrets.slack.appToken, "env-slack-app-token");
      assert.equal(secrets.slack.botToken, "file-slack-bot-token");
      assert.equal(secrets.whatsapp.accessToken, "env-access-token");
      assert.equal(secrets.whatsapp.verifyToken, "file-verify-token");
    } finally {
      if (originalAccessToken === undefined) {
        delete process.env.MACLAW_WHATSAPP_ACCESS_TOKEN;
      } else {
        process.env.MACLAW_WHATSAPP_ACCESS_TOKEN = originalAccessToken;
      }

      if (originalVerifyToken === undefined) {
        delete process.env.MACLAW_WHATSAPP_VERIFY_TOKEN;
      } else {
        process.env.MACLAW_WHATSAPP_VERIFY_TOKEN = originalVerifyToken;
      }

      if (originalSlackAppToken === undefined) {
        delete process.env.MACLAW_SLACK_APP_TOKEN;
      } else {
        process.env.MACLAW_SLACK_APP_TOKEN = originalSlackAppToken;
      }

      if (originalSlackBotToken === undefined) {
        delete process.env.MACLAW_SLACK_BOT_TOKEN;
      } else {
        process.env.MACLAW_SLACK_BOT_TOKEN = originalSlackBotToken;
      }
    }
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

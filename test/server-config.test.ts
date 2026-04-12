import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import {
  defaultServerLogFile,
  loadServerConfig,
  loadServerSecrets,
} from "../src/server-config.js";

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
          logging: {
            file: "./logs/test.log",
            maxBytes: 2048,
            maxFiles: 7,
          },
          port: 4100,
          projects: [
            { name: "home", folder: projectA },
            { name: "work", folder: projectB },
          ],
          remotes: [
            {
              name: "gpu-box",
              provider: "ssh",
              metadata: {
                host: "gpu.example.com",
                user: "alex",
                port: 2222,
              },
              remoteServerPort: 4400,
              localForwardPort: 4100,
            },
          ],
          defaultProject: "home",
          channels: {
            discord: {
              enabled: true,
            },
            email: {
              enabled: true,
              from: "maclaw@example.com",
              to: "alex@example.com",
              host: "smtp.example.com",
              port: 2525,
              startTls: false,
            },
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
    assert.equal(config.logging.file, path.join(rootDir, "logs", "test.log"));
    assert.equal(config.logging.maxBytes, 2048);
    assert.equal(config.logging.maxFiles, 7);
    assert.deepEqual(config.projects, [
      { name: "home", folder: projectA },
      { name: "work", folder: projectB },
    ]);
    assert.equal(config.port, 4100);
    assert.equal(config.defaultProject, "home");
    assert.deepEqual(config.remotes, [
      {
        name: "gpu-box",
        provider: "ssh",
        metadata: {
          host: "gpu.example.com",
          user: "alex",
          port: 2222,
        },
        remoteServerPort: 4400,
        localForwardPort: 4100,
      },
    ]);
    assert.equal(config.channels.discord.enabled, true);
    assert.equal(config.channels.email.enabled, true);
    assert.equal(config.channels.email.from, "maclaw@example.com");
    assert.equal(config.channels.email.to, "alex@example.com");
    assert.equal(config.channels.email.host, "smtp.example.com");
    assert.equal(config.channels.email.port, 2525);
    assert.equal(config.channels.email.startTls, false);
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

test("loadServerConfig keeps channels optional when none are configured", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-server-config-sparse-"));

  try {
    const configPath = path.join(rootDir, "server.json");
    const projectDir = path.join(rootDir, "project-a");

    await mkdir(projectDir, { recursive: true });
    await writeFile(
      configPath,
      `${JSON.stringify(
        {
          projects: [{ name: "home", folder: projectDir }],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const config = loadServerConfig(configPath);
    assert.equal(config.logging.file, defaultServerLogFile());
    assert.equal(config.logging.maxBytes, 5 * 1024 * 1024);
    assert.equal(config.logging.maxFiles, 5);
    assert.equal(config.port, 4000);
    assert.equal(config.channels, undefined);
    assert.equal(config.remotes, undefined);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("loadServerConfig applies defaults for teleport remotes", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-server-config-remotes-"));

  try {
    const configPath = path.join(rootDir, "server.json");
    const projectDir = path.join(rootDir, "project-a");

    await mkdir(projectDir, { recursive: true });
    await writeFile(
      configPath,
      `${JSON.stringify(
        {
          projects: [{ name: "home", folder: projectDir }],
          remotes: [
            {
              name: "gpu-box",
              provider: "ssh",
              metadata: {
                host: "gpu.example.com",
              },
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const config = loadServerConfig(configPath);
    assert.deepEqual(config.remotes, [
      {
        name: "gpu-box",
        provider: "ssh",
        metadata: {
          host: "gpu.example.com",
          port: 22,
        },
        remoteServerPort: 4000,
        localForwardPort: 4001,
      },
    ]);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("loadServerConfig applies defaults for AWS teleport remotes", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-server-config-aws-remotes-"));

  try {
    const configPath = path.join(rootDir, "server.json");
    const projectDir = path.join(rootDir, "project-a");

    await mkdir(projectDir, { recursive: true });
    await writeFile(
      configPath,
      `${JSON.stringify(
        {
          projects: [{ name: "home", folder: projectDir }],
          remotes: [
            {
              name: "aws-dev",
              provider: "aws-ec2",
              metadata: {
                region: "us-west-2",
                instanceId: "i-1234567890abcdef0",
              },
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const config = loadServerConfig(configPath);
    assert.deepEqual(config.remotes, [
      {
        name: "aws-dev",
        provider: "aws-ec2",
        metadata: {
          region: "us-west-2",
          instanceId: "i-1234567890abcdef0",
        },
        remoteServerPort: 4000,
        localForwardPort: 4001,
      },
    ]);
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
          openai: {
            apiKey: "file-openai-api-key",
          },
          discord: {
            botToken: "file-discord-bot-token",
          },
          email: {
            smtpUser: "file-smtp-user",
            smtpPassword: "file-smtp-password",
          },
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
    const originalDiscordBotToken = process.env.MACLAW_DISCORD_BOT_TOKEN;
    const originalEmailSmtpUser = process.env.MACLAW_EMAIL_SMTP_USER;
    const originalEmailSmtpPassword = process.env.MACLAW_EMAIL_SMTP_PASSWORD;
    const originalSlackAppToken = process.env.MACLAW_SLACK_APP_TOKEN;
    const originalSlackBotToken = process.env.MACLAW_SLACK_BOT_TOKEN;
    const originalOpenAiApiKey = process.env.OPENAI_API_KEY;

    try {
      process.env.MACLAW_WHATSAPP_ACCESS_TOKEN = "env-access-token";
      delete process.env.MACLAW_WHATSAPP_VERIFY_TOKEN;
      process.env.MACLAW_DISCORD_BOT_TOKEN = "env-discord-bot-token";
      process.env.MACLAW_EMAIL_SMTP_USER = "env-smtp-user";
      delete process.env.MACLAW_EMAIL_SMTP_PASSWORD;
      process.env.MACLAW_SLACK_APP_TOKEN = "env-slack-app-token";
      delete process.env.MACLAW_SLACK_BOT_TOKEN;
      process.env.OPENAI_API_KEY = "env-openai-api-key";

      const secrets = loadServerSecrets(secretsPath);

      assert.equal(secrets.configFile, secretsPath);
      assert.equal(secrets.openai.apiKey, "env-openai-api-key");
      assert.equal(secrets.discord.botToken, "env-discord-bot-token");
      assert.equal(secrets.email.smtpUser, "env-smtp-user");
      assert.equal(secrets.email.smtpPassword, "file-smtp-password");
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

      if (originalDiscordBotToken === undefined) {
        delete process.env.MACLAW_DISCORD_BOT_TOKEN;
      } else {
        process.env.MACLAW_DISCORD_BOT_TOKEN = originalDiscordBotToken;
      }

      if (originalEmailSmtpUser === undefined) {
        delete process.env.MACLAW_EMAIL_SMTP_USER;
      } else {
        process.env.MACLAW_EMAIL_SMTP_USER = originalEmailSmtpUser;
      }

      if (originalEmailSmtpPassword === undefined) {
        delete process.env.MACLAW_EMAIL_SMTP_PASSWORD;
      } else {
        process.env.MACLAW_EMAIL_SMTP_PASSWORD = originalEmailSmtpPassword;
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

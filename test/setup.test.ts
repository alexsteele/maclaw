import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import * as fs from "node:fs/promises";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import test from "node:test";
import { runSetup } from "../src/cli/setup.js";
import { maclawHomeDir } from "../src/server-config.js";

class CaptureStream extends Writable {
  private readonly chunks: string[] = [];

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
    callback();
  }

  toString(): string {
    return this.chunks.join("");
  }
}

test("runSetup writes project, server config, and secrets from a simple guided flow", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-setup-"));

  try {
    const cwd = path.join(rootDir, "cwd");
    const homeDir = path.join(rootDir, "home");
    const input = Readable.from([]);
    const output = new CaptureStream();
    const answers = [
      "yes",
      "1",
      "gpt-5.4-mini",
      "sk-test-openai",
      "1",
      "1",
      "1,2",
      "xapp-slack",
      "xoxb-slack",
      "discord-token",
    ];

    await runSetup({ cwd, homeDir, input, output, answers });

    const globalHome = maclawHomeDir(homeDir);
    const projectConfigPath = path.join(globalHome, "projects", "default", ".maclaw", "maclaw.json");
    const serverConfigPath = path.join(globalHome, "server.json");
    const secretsPath = path.join(globalHome, "secrets.json");

    const projectConfig = JSON.parse(await readFile(projectConfigPath, "utf8")) as {
      model: string;
    };
    const serverConfig = JSON.parse(await readFile(serverConfigPath, "utf8")) as {
      defaultProject?: string;
      projects: Array<{ name: string; folder: string }>;
      channels?: {
        discord?: { enabled: boolean };
        slack?: { enabled: boolean };
        whatsapp?: {
          enabled: boolean;
          graphApiVersion: string;
          phoneNumberId?: string;
          port: number;
          webhookPath: string;
        } | undefined;
      };
    };
    const secrets = JSON.parse(await readFile(secretsPath, "utf8")) as {
      openai: { apiKey?: string };
      slack: { appToken?: string; botToken?: string };
      discord: { botToken?: string };
      whatsapp: { accessToken?: string; verifyToken?: string };
    };

    assert.equal(projectConfig.model, "openai/gpt-5.4-mini");
    assert.equal(serverConfig.projects.length, 1);
    assert.equal(serverConfig.defaultProject, "default");
    assert.equal(serverConfig.channels?.slack?.enabled, true);
    assert.equal(serverConfig.channels?.discord?.enabled, true);
    assert.equal(serverConfig.channels?.whatsapp, undefined);
    assert.equal(secrets.openai.apiKey, "sk-test-openai");
    assert.equal(secrets.slack.appToken, "xapp-slack");
    assert.equal(secrets.slack.botToken, "xoxb-slack");
    assert.equal(secrets.discord.botToken, "discord-token");
    assert.equal(secrets.whatsapp, undefined);
    assert.match(output.toString(), /Done\./);
    assert.match(output.toString(), /maclaw server/);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("runSetup merges existing server config and secrets instead of overwriting them", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-setup-merge-"));

  try {
    const cwd = path.join(rootDir, "cwd");
    const homeDir = path.join(rootDir, "home");
    const input = Readable.from([]);
    const output = new CaptureStream();
    const globalHome = maclawHomeDir(homeDir);
    const serverConfigPath = path.join(globalHome, "server.json");
    const secretsPath = path.join(globalHome, "secrets.json");

    await fs.mkdir(globalHome, { recursive: true });
    await fs.writeFile(
      serverConfigPath,
      `${JSON.stringify(
        {
          defaultProject: "existing",
          projects: [{ name: "existing", folder: "/tmp/existing-project" }],
          channels: {
            discord: { enabled: true },
            slack: { enabled: false, botUserId: "U123" },
            whatsapp: {
              enabled: true,
              graphApiVersion: "v22.0",
              phoneNumberId: "existing-phone-id",
              port: 4010,
              webhookPath: "/existing-hook",
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await fs.writeFile(
      secretsPath,
      `${JSON.stringify(
        {
          openai: { apiKey: "existing-openai-key" },
          discord: { botToken: "existing-discord-token" },
          slack: {
            appToken: "existing-slack-app-token",
            botToken: "existing-slack-bot-token",
          },
          whatsapp: {
            accessToken: "existing-whatsapp-access-token",
            verifyToken: "existing-whatsapp-verify-token",
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    await runSetup({
      cwd,
      homeDir,
      input,
      output,
      answers: [
        "yes",
        "3",
        "no",
        "1",
        "2",
        "new-discord-token",
      ],
    });

    const serverConfig = JSON.parse(await readFile(serverConfigPath, "utf8")) as {
      defaultProject?: string;
      projects: Array<{ name: string; folder: string }>;
      channels: {
        discord: { enabled: boolean };
        slack: { enabled: boolean; botUserId?: string };
        whatsapp: {
          enabled: boolean;
          graphApiVersion: string;
          phoneNumberId?: string;
          port: number;
          webhookPath: string;
        };
      };
    };
    const secrets = JSON.parse(await readFile(secretsPath, "utf8")) as {
      openai: { apiKey?: string };
      discord: { botToken?: string };
      slack: { appToken?: string; botToken?: string };
      whatsapp: { accessToken?: string; verifyToken?: string };
    };

    assert.equal(serverConfig.defaultProject, "existing");
    assert.deepEqual(serverConfig.projects, [
      { name: "existing", folder: "/tmp/existing-project" },
    ]);
    assert.equal(serverConfig.channels.discord.enabled, true);
    assert.equal(serverConfig.channels.slack.enabled, false);
    assert.equal(serverConfig.channels.slack.botUserId, "U123");
    assert.equal(serverConfig.channels.whatsapp.enabled, true);
    assert.equal(serverConfig.channels.whatsapp.graphApiVersion, "v22.0");
    assert.equal(serverConfig.channels.whatsapp.phoneNumberId, "existing-phone-id");
    assert.equal(serverConfig.channels.whatsapp.port, 4010);
    assert.equal(serverConfig.channels.whatsapp.webhookPath, "/existing-hook");
    assert.equal(secrets.openai.apiKey, "existing-openai-key");
    assert.equal(secrets.discord.botToken, "new-discord-token");
    assert.equal(secrets.slack.appToken, "existing-slack-app-token");
    assert.equal(secrets.slack.botToken, "existing-slack-bot-token");
    assert.equal(secrets.whatsapp.accessToken, "existing-whatsapp-access-token");
    assert.equal(secrets.whatsapp.verifyToken, "existing-whatsapp-verify-token");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("runSetup writes no channel config when server setup is skipped", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-setup-sparse-channels-"));

  try {
    const cwd = path.join(rootDir, "cwd");
    const homeDir = path.join(rootDir, "home");
    const input = Readable.from([]);
    const output = new CaptureStream();
    const globalHome = maclawHomeDir(homeDir);
    const serverConfigPath = path.join(globalHome, "server.json");

    await runSetup({
      cwd,
      homeDir,
      input,
      output,
      answers: [
        "yes",
        "3",
        "2",
        "2",
      ],
    });

    const serverConfig = JSON.parse(await readFile(serverConfigPath, "utf8")) as {
      channels?: unknown;
      projects?: unknown[];
    };

    assert.equal(serverConfig.channels, undefined);
    assert.equal(serverConfig.projects, undefined);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

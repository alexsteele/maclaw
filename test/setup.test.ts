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
      "1",
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
      model?: string;
    };
    const serverConfig = JSON.parse(await readFile(serverConfigPath, "utf8")) as {
      defaultProject?: string;
      projects: Array<{ name: string; folder: string }>;
      channels?: {
        discord?: { enabled: boolean };
        email?: {
          enabled: boolean;
          from: string;
          host: string;
          port: number;
          startTls: boolean;
          to?: string;
        };
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
      email: { smtpUser?: string; smtpPassword?: string };
      slack: { appToken?: string; botToken?: string };
      discord: { botToken?: string };
      whatsapp: { accessToken?: string; verifyToken?: string };
    };

    assert.equal(projectConfig.model, "openai/gpt-5.4-mini");
    assert.equal(serverConfig.projects.length, 1);
    assert.equal(serverConfig.defaultProject, "default");
    assert.equal(serverConfig.channels?.slack?.enabled, true);
    assert.equal(serverConfig.channels?.discord?.enabled, true);
    assert.equal(serverConfig.channels?.email, undefined);
    assert.equal(serverConfig.channels?.whatsapp, undefined);
    assert.equal(secrets.openai.apiKey, "sk-test-openai");
    assert.equal(secrets.email, undefined);
    assert.equal(secrets.slack.appToken, "xapp-slack");
    assert.equal(secrets.slack.botToken, "xoxb-slack");
    assert.equal(secrets.discord.botToken, "discord-token");
    assert.equal(secrets.whatsapp, undefined);
    assert.match(output.toString(), /Done! 🦞/u);
    assert.match(output.toString(), /maclaw server/);
    assert.equal((output.toString().match(/  1\. all/g) ?? []).length, 1);
    assert.match(output.toString(), /  4\. server/u);
    assert.match(output.toString(), /  5\. channels/u);
    assert.match(output.toString(), /  5\. channels\nDefault: all\n> 1/u);
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
        "5",
        "yes",
        "2",
        "new-discord-token",
      ],
    });

    const serverConfig = JSON.parse(await readFile(serverConfigPath, "utf8")) as {
      defaultProject?: string;
      projects: Array<{ name: string; folder: string }>;
      channels: {
        discord: { enabled: boolean };
        email?: {
          enabled: boolean;
          from: string;
          host: string;
          port: number;
          startTls: boolean;
          to?: string;
        };
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
      email?: { smtpUser?: string; smtpPassword?: string };
      slack: { appToken?: string; botToken?: string };
      whatsapp: { accessToken?: string; verifyToken?: string };
    };

    assert.equal(serverConfig.defaultProject, "existing");
    assert.deepEqual(serverConfig.projects, [
      { name: "existing", folder: "/tmp/existing-project" },
    ]);
    assert.equal(serverConfig.channels.discord.enabled, true);
    assert.equal(serverConfig.channels.email, undefined);
    assert.equal(serverConfig.channels.slack.enabled, false);
    assert.equal(serverConfig.channels.slack.botUserId, "U123");
    assert.equal(serverConfig.channels.whatsapp.enabled, true);
    assert.equal(serverConfig.channels.whatsapp.graphApiVersion, "v22.0");
    assert.equal(serverConfig.channels.whatsapp.phoneNumberId, "existing-phone-id");
    assert.equal(serverConfig.channels.whatsapp.port, 4010);
    assert.equal(serverConfig.channels.whatsapp.webhookPath, "/existing-hook");
    assert.equal(secrets.openai.apiKey, "existing-openai-key");
    assert.equal(secrets.discord.botToken, "new-discord-token");
    assert.equal(secrets.email, undefined);
    assert.equal(secrets.slack.appToken, "existing-slack-app-token");
    assert.equal(secrets.slack.botToken, "existing-slack-bot-token");
    assert.equal(secrets.whatsapp.accessToken, "existing-whatsapp-access-token");
    assert.equal(secrets.whatsapp.verifyToken, "existing-whatsapp-verify-token");
    assert.match(output.toString(), /Found existing server config:/u);
    assert.match(output.toString(), /Configured channels: discord, whatsapp/u);
    assert.doesNotMatch(output.toString(), /Found existing server secrets:/u);
    assert.match(output.toString(), /Current discord config:\n\{\n  "enabled": true\n\}/u);
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
        "5",
        "yes",
        "",
      ],
    });

    const serverConfig = JSON.parse(await readFile(serverConfigPath, "utf8")) as {
      channels?: unknown;
      projects?: unknown[];
    };

    assert.equal(serverConfig.channels, undefined);
    assert.equal(serverConfig.projects, undefined);
    assert.doesNotMatch(output.toString(), /Set up channels\?/u);
    assert.match(output.toString(), /Enable channels\?/u);
    assert.match(output.toString(), /  5\. skip/u);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("runSetup can jump straight to project setup", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-setup-project-only-"));

  try {
    const cwd = path.join(rootDir, "cwd");
    const homeDir = path.join(rootDir, "home");
    const input = Readable.from([]);
    const output = new CaptureStream();

    await runSetup({
      cwd,
      homeDir,
      input,
      output,
      answers: [
        "3",
        "yes",
        "1",
      ],
    });

    const globalHome = maclawHomeDir(homeDir);
    const projectConfigPath = path.join(globalHome, "projects", "default", ".maclaw", "maclaw.json");
    const serverConfigPath = path.join(globalHome, "server.json");
    const projectConfig = JSON.parse(await readFile(projectConfigPath, "utf8")) as {
      model: string;
    };
    const serverConfig = JSON.parse(await readFile(serverConfigPath, "utf8")) as {
      defaultProject?: string;
      projects?: Array<{ name: string; folder: string }>;
    };

    assert.ok(projectConfig.model);
    assert.equal(serverConfig.defaultProject, "default");
    assert.equal(serverConfig.projects?.length, 1);
    assert.doesNotMatch(output.toString(), /Model source\?/u);
    assert.doesNotMatch(output.toString(), /Set up channels\?/u);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("runSetup notes existing default project config and keeps the current default server project", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-setup-existing-default-"));

  try {
    const cwd = path.join(rootDir, "cwd");
    const homeDir = path.join(rootDir, "home");
    const input = Readable.from([]);
    const output = new CaptureStream();
    const globalHome = maclawHomeDir(homeDir);
    const defaultProjectFolder = path.join(globalHome, "projects", "default");
    const defaultProjectConfigDir = path.join(defaultProjectFolder, ".maclaw");
    const defaultProjectConfigPath = path.join(defaultProjectConfigDir, "maclaw.json");
    const serverConfigPath = path.join(globalHome, "server.json");

    await fs.mkdir(defaultProjectConfigDir, { recursive: true });
    await fs.writeFile(
      defaultProjectConfigPath,
      `${JSON.stringify({ name: "default", model: "dummy/default" }, null, 2)}\n`,
      "utf8",
    );
    await fs.mkdir(globalHome, { recursive: true });
    await fs.writeFile(
      serverConfigPath,
      `${JSON.stringify(
        {
          defaultProject: "default",
          projects: [{ name: "default", folder: defaultProjectFolder }],
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
        "1",
        "yes",
        "3",
        "1",
        "4",
        "1",
        "2",
      ],
    });

    assert.match(output.toString(), /Found existing default project:/u);
    assert.match(output.toString(), /Found existing default server project: default/u);
    assert.doesNotMatch(output.toString(), /Default server project\?/u);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("runSetup keeps the existing model and project when walking through defaults", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-setup-sticky-defaults-"));

  try {
    const cwd = path.join(rootDir, "cwd");
    const homeDir = path.join(rootDir, "home");
    const input = Readable.from([]);
    const output = new CaptureStream();
    const globalHome = maclawHomeDir(homeDir);
    const defaultProjectFolder = path.join(globalHome, "projects", "default");
    const defaultProjectConfigDir = path.join(defaultProjectFolder, ".maclaw");
    const defaultProjectConfigPath = path.join(defaultProjectConfigDir, "maclaw.json");
    const serverConfigPath = path.join(globalHome, "server.json");
    const secretsPath = path.join(globalHome, "secrets.json");

    await fs.mkdir(defaultProjectConfigDir, { recursive: true });
    await fs.writeFile(
      defaultProjectConfigPath,
      `${JSON.stringify({ name: "default", model: "openai/gpt-5.4" }, null, 2)}\n`,
      "utf8",
    );
    await fs.mkdir(globalHome, { recursive: true });
    await fs.writeFile(
      serverConfigPath,
      `${JSON.stringify(
        {
          defaultProject: "default",
          projects: [{ name: "default", folder: defaultProjectFolder }],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    await fs.writeFile(
      secretsPath,
      `${JSON.stringify({ openai: { apiKey: "existing-openai-key" } }, null, 2)}\n`,
      "utf8",
    );

    await runSetup({
      cwd,
      homeDir,
      input,
      output,
      answers: [
        "1",
        "yes",
        "",
        "",
        "",
        "",
        "",
        "",
      ],
    });

    const projectConfig = JSON.parse(await readFile(defaultProjectConfigPath, "utf8")) as {
      model?: string;
    };
    const serverConfig = JSON.parse(await readFile(serverConfigPath, "utf8")) as {
      defaultProject?: string;
      projects?: Array<{ name: string; folder: string }>;
    };
    const secrets = JSON.parse(await readFile(secretsPath, "utf8")) as {
      openai?: { apiKey?: string };
    };

    assert.equal(projectConfig.model, "openai/gpt-5.4");
    assert.equal(serverConfig.defaultProject, "default");
    assert.deepEqual(serverConfig.projects, [
      { name: "default", folder: defaultProjectFolder },
    ]);
    assert.equal(secrets.openai?.apiKey, "existing-openai-key");
    assert.match(output.toString(), /Found existing default project:/u);
    assert.match(output.toString(), /Found existing default server project: default/u);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("runSetup exits cleanly on EOF", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-setup-eof-"));

  try {
    const cwd = path.join(rootDir, "cwd");
    const homeDir = path.join(rootDir, "home");
    const input = Readable.from([]);
    const output = new CaptureStream();

    await runSetup({ cwd, homeDir, input, output });

    assert.doesNotMatch(output.toString(), /\[maclaw setup\] failed/u);
    assert.match(output.toString(), /Where do you want to start\?/u);
    assert.match(output.toString(), /Bye!/u);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { PassThrough, Writable } from "node:stream";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import test from "node:test";
import { runSetup } from "../src/setup.js";

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
    const input = new PassThrough();
    const output = new CaptureStream();
    const answers = [
      "yes",
      "1",
      "sk-test-openai",
      "gpt-5.4-mini",
      "yes",
      "",
      "1",
      "1,2",
      "xapp-slack",
      "xoxb-slack",
      "discord-token",
    ];

    await runSetup({ cwd, homeDir, input, output, answers });

    const projectConfigPath = path.join(homeDir, "maclaw-projects", "default", ".maclaw", "maclaw.json");
    const serverConfigPath = path.join(homeDir, ".maclaw", "server.json");
    const secretsPath = path.join(homeDir, ".maclaw", "secrets.json");

    const projectConfig = JSON.parse(await readFile(projectConfigPath, "utf8")) as {
      provider: string;
      model: string;
    };
    const serverConfig = JSON.parse(await readFile(serverConfigPath, "utf8")) as {
      defaultProject?: string;
      projects: Array<{ name: string; folder: string }>;
      channels: {
        discord: { enabled: boolean };
        slack: { enabled: boolean };
        whatsapp: { enabled: boolean };
      };
    };
    const secrets = JSON.parse(await readFile(secretsPath, "utf8")) as {
      openai: { apiKey?: string };
      slack: { appToken?: string; botToken?: string };
      discord: { botToken?: string };
    };

    assert.equal(projectConfig.provider, "openai");
    assert.equal(projectConfig.model, "gpt-5.4-mini");
    assert.equal(serverConfig.projects.length, 1);
    assert.equal(serverConfig.defaultProject, "default");
    assert.equal(serverConfig.channels.slack.enabled, true);
    assert.equal(serverConfig.channels.discord.enabled, true);
    assert.equal(serverConfig.channels.whatsapp.enabled, false);
    assert.equal(secrets.openai.apiKey, "sk-test-openai");
    assert.equal(secrets.slack.appToken, "xapp-slack");
    assert.equal(secrets.slack.botToken, "xoxb-slack");
    assert.equal(secrets.discord.botToken, "discord-token");
    assert.match(output.toString(), /Done\./);
    assert.match(output.toString(), /maclaw server/);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

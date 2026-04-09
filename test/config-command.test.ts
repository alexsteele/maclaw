import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import test from "node:test";
import { initProjectConfig } from "../src/config.js";
import { runConfigCommand } from "../src/cli/config.js";
import { useDummyProviderEnv } from "./provider-env.js";

useDummyProviderEnv();

test("runConfigCommand updates the project model", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-config-command-"));
  const previousCwd = process.cwd();
  const stdoutWrites: string[] = [];
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);

  try {
    await initProjectConfig(projectDir, { model: "openai/gpt-4.1-mini" });
    process.chdir(projectDir);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdoutWrites.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
      return true;
    }) as typeof process.stdout.write;

    await runConfigCommand(["set", "model", "gpt-5.4-mini"]);

    const projectConfigPath = path.join(projectDir, ".maclaw", "maclaw.json");
    const projectConfig = JSON.parse(await readFile(projectConfigPath, "utf8")) as {
      model: string;
    };

    assert.equal(projectConfig.model, "openai/gpt-5.4-mini");
    assert.match(stdoutWrites.join(""), /model = openai\/gpt-5.4-mini/);
  } finally {
    process.chdir(previousCwd);
    process.stdout.write = originalStdoutWrite;
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("runConfigCommand updates notifications from JSON", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-config-command-notify-"));
  const previousCwd = process.cwd();
  const stdoutWrites: string[] = [];
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);

  try {
    await initProjectConfig(projectDir, { model: "gpt-4.1-mini" });
    process.chdir(projectDir);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdoutWrites.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
      return true;
    }) as typeof process.stdout.write;

    await runConfigCommand(["set", "notifications", '{"allow":["errors"],"deny":["agentFailed"]}']);

    const projectConfigPath = path.join(projectDir, ".maclaw", "maclaw.json");
    const projectConfig = JSON.parse(await readFile(projectConfigPath, "utf8")) as {
      notifications: unknown;
    };

    assert.deepEqual(projectConfig.notifications, {
      allow: ["errors"],
      deny: ["agentFailed"],
    });
    assert.match(stdoutWrites.join(""), /notifications = /);
  } finally {
    process.chdir(previousCwd);
    process.stdout.write = originalStdoutWrite;
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("runConfigCommand updates scalar runtime settings", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-config-command-runtime-"));
  const previousCwd = process.cwd();
  const stdoutWrites: string[] = [];
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);

  try {
    await initProjectConfig(projectDir, { model: "gpt-4.1-mini" });
    process.chdir(projectDir);
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdoutWrites.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
      return true;
    }) as typeof process.stdout.write;

    await runConfigCommand(["set", "contextMessages", "12"]);
    await runConfigCommand(["set", "maxToolIterations", "5"]);
    await runConfigCommand(["set", "defaultTaskTime", "8:30 AM"]);
    await runConfigCommand(["set", "storage", "sqlite"]);
    await runConfigCommand(["set", "tools", '["read","act"]']);

    const projectConfigPath = path.join(projectDir, ".maclaw", "maclaw.json");
    const projectConfig = JSON.parse(await readFile(projectConfigPath, "utf8")) as {
      contextMessages: number;
      defaultTaskTime: string;
      maxToolIterations: number;
      storage: string;
      tools: string[];
    };

    assert.equal(projectConfig.contextMessages, 12);
    assert.equal(projectConfig.maxToolIterations, 5);
    assert.equal(projectConfig.defaultTaskTime, "8:30 AM");
    assert.equal(projectConfig.storage, "sqlite");
    assert.deepEqual(projectConfig.tools, ["read", "act"]);
    assert.match(stdoutWrites.join(""), /contextMessages = 12/);
    assert.match(stdoutWrites.join(""), /maxToolIterations = 5/);
    assert.match(stdoutWrites.join(""), /defaultTaskTime = 8:30 AM/);
    assert.match(stdoutWrites.join(""), /storage = sqlite/);
    assert.match(stdoutWrites.join(""), /tools = read,act|tools = read, act/);
  } finally {
    process.chdir(previousCwd);
    process.stdout.write = originalStdoutWrite;
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("runConfigCommand writes command errors to stderr", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-config-command-stderr-"));
  const previousCwd = process.cwd();
  const stderrWrites: string[] = [];
  const previousExitCode = process.exitCode;
  const originalStderrWrite = process.stderr.write.bind(process.stderr);

  try {
    await initProjectConfig(projectDir, { model: "gpt-4.1-mini" });
    process.chdir(projectDir);
    process.exitCode = undefined;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderrWrites.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
      return true;
    }) as typeof process.stderr.write;

    await runConfigCommand(["set", "bogus", "123"]);

    assert.match(stderrWrites.join(""), /Unknown or non-editable config key: bogus/);
    assert.equal(process.exitCode, 1);
  } finally {
    process.chdir(previousCwd);
    process.exitCode = previousExitCode;
    process.stderr.write = originalStderrWrite;
    await rm(projectDir, { recursive: true, force: true });
  }
});

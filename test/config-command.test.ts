import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import test from "node:test";
import { initProjectConfig } from "../src/config.js";
import { runConfigCommand } from "../src/cli/config.js";

test("runConfigCommand updates the project model", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-config-command-"));
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

    await runConfigCommand(["set", "model", "gpt-5.4-mini"]);

    const projectConfigPath = path.join(projectDir, ".maclaw", "maclaw.json");
    const projectConfig = JSON.parse(await readFile(projectConfigPath, "utf8")) as {
      model: string;
    };

    assert.equal(projectConfig.model, "gpt-5.4-mini");
    assert.match(stdoutWrites.join(""), /model = gpt-5.4-mini/);
  } finally {
    process.chdir(previousCwd);
    process.stdout.write = originalStdoutWrite;
    await rm(projectDir, { recursive: true, force: true });
  }
});

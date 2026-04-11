import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { Logger } from "../src/logger.js";

test("logger rotates an oversized existing log file on startup", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-logger-"));

  try {
    const logger = new Logger();
    const logPath = path.join(rootDir, "server.log");
    await writeFile(logPath, `${"x".repeat(512)}\n`, "utf8");
    logger.setStderr(false);
    logger.setFile(logPath, {
      maxBytes: 120,
      maxFiles: 3,
    });

    logger.info("server", "started", { project: "home", port: 4000 });
    await logger.close();

    const current = await readFile(logPath, "utf8");
    const rotated = await readFile(`${logPath}.1`, "utf8");

    assert.match(current, /\[INFO\] server started/u);
    assert.match(rotated, /x{20}/u);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

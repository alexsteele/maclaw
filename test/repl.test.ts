import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import test from "node:test";
import { initProjectConfig } from "../src/config.js";
import { loadReplHarness } from "../src/cli/repl.js";

test("loadReplHarness falls back to the managed default project when cwd is headless", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-repl-"));
  const originalMaclawHome = process.env.MACLAW_HOME;

  try {
    const cwd = path.join(rootDir, "cwd");
    const maclawHome = path.join(rootDir, "global-home");
    const defaultProjectDir = path.join(maclawHome, "projects", "default");

    process.env.MACLAW_HOME = maclawHome;
    await initProjectConfig(defaultProjectDir, {
      model: "dummy/test-model",
      name: "default",
    });

    const harness = loadReplHarness(cwd);

    assert.equal(harness.isProjectInitialized(), true);
    assert.equal(harness.config.projectFolder, defaultProjectDir);
    assert.equal(harness.config.name, "default");
  } finally {
    if (originalMaclawHome === undefined) {
      delete process.env.MACLAW_HOME;
    } else {
      process.env.MACLAW_HOME = originalMaclawHome;
    }

    await rm(rootDir, { recursive: true, force: true });
  }
});

test("loadReplHarness prefers the server config default project when cwd is headless", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-repl-server-default-"));
  const originalMaclawHome = process.env.MACLAW_HOME;

  try {
    const cwd = path.join(rootDir, "cwd");
    const maclawHome = path.join(rootDir, "global-home");
    const managedDefaultProjectDir = path.join(maclawHome, "projects", "default");
    const configuredDefaultProjectDir = path.join(rootDir, "configured-default");

    process.env.MACLAW_HOME = maclawHome;

    await initProjectConfig(managedDefaultProjectDir, {
      model: "dummy/test-model",
      name: "managed-default",
    });
    await initProjectConfig(configuredDefaultProjectDir, {
      model: "dummy/test-model",
      name: "configured-default",
    });

    await mkdir(maclawHome, { recursive: true });
    await writeFile(
      path.join(maclawHome, "server.json"),
      `${JSON.stringify(
        {
          defaultProject: "configured-default",
          projects: [
            { name: "configured-default", folder: configuredDefaultProjectDir },
          ],
          channels: {},
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const harness = loadReplHarness(cwd);

    assert.equal(harness.isProjectInitialized(), true);
    assert.equal(harness.config.projectFolder, configuredDefaultProjectDir);
    assert.equal(harness.config.name, "configured-default");
  } finally {
    if (originalMaclawHome === undefined) {
      delete process.env.MACLAW_HOME;
    } else {
      process.env.MACLAW_HOME = originalMaclawHome;
    }

    await rm(rootDir, { recursive: true, force: true });
  }
});

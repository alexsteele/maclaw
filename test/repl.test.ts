import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import test from "node:test";
import { initProjectConfig } from "../src/config.js";
import {
  defaultReplWrapWidth,
  formatReplPrompt,
  loadReplChannels,
  loadReplServerConfig,
  loadReplHarness,
  looksLikeMarkdown,
  parseAgentTailFollow,
  parseShellEscape,
  wrapReplLine,
} from "../src/cli/repl.js";
import { renderMarkdownForTerminal } from "../src/cli/render.js";

test("wrapReplLine wraps long lines and preserves indentation", () => {
  const wrapped = wrapReplLine("  alpha beta gamma delta", 12);

  assert.equal(wrapped, "  alpha beta\n  gamma\n  delta");
});

test("wrapReplLine aligns wrapped bullet and numbered list items", () => {
  assert.equal(
    wrapReplLine("- alpha beta gamma delta", 14),
    "- alpha beta\n  gamma delta",
  );
  assert.equal(
    wrapReplLine("  12. alpha beta gamma delta", 18),
    "  12. alpha beta\n      gamma delta",
  );
});

test("defaultReplWrapWidth uses terminal columns when available", () => {
  assert.equal(defaultReplWrapWidth(120), 118);
  assert.equal(defaultReplWrapWidth(22), 20);
  assert.equal(defaultReplWrapWidth(undefined), 100);
  assert.equal(defaultReplWrapWidth(0), 100);
});

test("formatReplPrompt shows teleport target when attached", () => {
  assert.equal(formatReplPrompt(), "> ");
  assert.equal(formatReplPrompt(undefined, "aws-dev"), "aws-dev> ");
  assert.equal(
    formatReplPrompt({
      target: "local-box",
      project: "home",
      chatId: "default",
    }),
    "local-box> ",
  );
  assert.equal(
    formatReplPrompt({
      target: "http://gpu.example.com:4001",
      project: "home",
      chatId: "default",
    }),
    "gpu.example.com> ",
  );
});

test("renderMarkdownForTerminal preserves markdown structure for lists", () => {
  const rendered = renderMarkdownForTerminal(
    "# Title\n\n- alpha\n- beta\n",
    80,
  );

  assert.match(rendered, /Title/u);
  assert.match(rendered, /alpha/u);
  assert.match(rendered, /beta/u);
  assert.match(rendered, /\n/u);
});

test("renderMarkdownForTerminal wraps long list items to terminal width", () => {
  const rendered = renderMarkdownForTerminal(
    "* Size: One of the largest marathons globally with 40,000-45,000 finishers annually.\n",
    50,
  );

  assert.match(rendered, /Size:/u);
  assert.match(rendered, /finishers annually\./u);
  assert.match(rendered, /\n\s+with 40,000-45,000 finishers annually\./u);
});

test("renderMarkdownForTerminal normalizes accidentally indented list items", () => {
  const rendered = renderMarkdownForTerminal(
    "    * **Elite runners:**\n",
    80,
  );

  assert.doesNotMatch(rendered, /\*\*Elite runners:\*\*/u);
  assert.match(rendered, /Elite runners:/u);
});

test("renderMarkdownForTerminal preserves real indented code blocks", () => {
  const rendered = renderMarkdownForTerminal(
    "    const answer = 42;\n",
    80,
  );

  assert.match(rendered, /const answer = 42;/u);
});

test("looksLikeMarkdown detects markdown-oriented command output", () => {
  assert.equal(looksLikeMarkdown("## Files\n- item"), true);
  assert.equal(looksLikeMarkdown("Use `code` here"), true);
  assert.equal(looksLikeMarkdown("id: default\nstatus: ready"), false);
  assert.equal(looksLikeMarkdown("name: home\nfolder: /tmp/home"), false);
});

test("parseAgentTailFollow parses follow mode arguments", () => {
  assert.deepEqual(parseAgentTailFollow("/agent tail -f poet"), {
    agentRef: "poet",
    count: 10,
  });
  assert.deepEqual(parseAgentTailFollow("/agent tail -f poet 25"), {
    agentRef: "poet",
    count: 25,
  });
  assert.equal(parseAgentTailFollow("/agent tail poet"), undefined);
});

test("parseShellEscape parses shell escape commands", () => {
  assert.equal(parseShellEscape("!pwd"), "pwd");
  assert.equal(parseShellEscape("! ls -la"), "ls -la");
  assert.equal(parseShellEscape("!"), undefined);
  assert.equal(parseShellEscape("/help"), undefined);
});

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

test("loadReplServerConfig loads the global server config for the repl", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-repl-email-origin-"));
  const originalMaclawHome = process.env.MACLAW_HOME;

  try {
    const maclawHome = path.join(rootDir, "global-home");
    await mkdir(maclawHome, { recursive: true });
    await writeFile(
      path.join(maclawHome, "server.json"),
      `${JSON.stringify(
        {
          projects: [],
          channels: {
            email: {
              enabled: true,
              from: "from@example.com",
              to: "alex@example.com",
              host: "smtp.example.com",
              port: 587,
              startTls: true,
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    process.env.MACLAW_HOME = maclawHome;

    const serverConfig = loadReplServerConfig();
    const channels = loadReplChannels(serverConfig);

    assert.equal(serverConfig?.channels?.email?.enabled, true);
    assert.equal(serverConfig?.channels?.email?.to, "alex@example.com");
    assert.equal(channels.has("email"), true);
  } finally {
    if (originalMaclawHome === undefined) {
      delete process.env.MACLAW_HOME;
    } else {
      process.env.MACLAW_HOME = originalMaclawHome;
    }

    await rm(rootDir, { recursive: true, force: true });
  }
});

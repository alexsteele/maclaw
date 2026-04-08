import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import { initProjectConfig } from "../src/config.js";
import { MaclawServer } from "../src/server.js";
import { useDummyProviderEnv } from "./provider-env.js";

useDummyProviderEnv();

test("server handles project commands and routes chat messages by active project", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-server-"));
  const homeDir = path.join(rootDir, "home");
  const workDir = path.join(rootDir, "work");

  try {
    await initProjectConfig(homeDir, {
      name: "home",
      model: "dummy/test-model",
    });
    await initProjectConfig(workDir, {
      name: "work",
      model: "dummy/test-model",
    });

    const server = MaclawServer.create(
      {
        configFile: path.join(rootDir, "server.json"),
        projects: [
          { name: "home", folder: homeDir },
          { name: "work", folder: workDir },
        ],
        defaultProject: "home",
        channels: {
          discord: {
            enabled: false,
          },
          slack: {
            enabled: false,
          },
          whatsapp: {
            enabled: false,
            graphApiVersion: "v23.0",
            port: 3000,
            webhookPath: "/whatsapp/webhook",
          },
        },
      },
      {
        configFile: path.join(rootDir, "secrets.json"),
        discord: {},
        slack: {},
        whatsapp: {},
      },
      {
        port: 0,
        servePortal: false,
      },
    );
    await server.start();

    const helpReply = await server.handleMessage({
      channel: "whatsapp",
      userId: "whatsapp-15551234567",
      text: "/help",
    });
    assert.match(helpReply ?? "", /\/project switch <name>/u);

    const listReply = await server.handleMessage({
      channel: "whatsapp",
      userId: "whatsapp-15551234567",
      text: "/project list",
    });
    assert.equal(listReply, "home\nwork");

    const projectReply = await server.handleMessage({
      channel: "whatsapp",
      userId: "whatsapp-15551234567",
      text: "/project",
    });
    assert.equal(projectReply, "Current project: home");

    const switchReply = await server.handleMessage({
      channel: "whatsapp",
      userId: "whatsapp-15551234567",
      text: "/switch work",
    });
    assert.equal(switchReply, "Switched to project: work");

    const afterSwitchReply = await server.handleMessage({
      channel: "whatsapp",
      userId: "whatsapp-15551234567",
      text: "/project",
    });
    assert.equal(afterSwitchReply, "Current project: work");

    await server.handleMessage({
      channel: "whatsapp",
      userId: "whatsapp-15551234567",
      text: "remember this in work",
    });

    const workTranscript = await server
      .getHarness("work")
      .loadChat("whatsapp-15551234567")
      .then((chat) => chat.messages.map((message) => message.content).join("\n"));
    assert.match(workTranscript, /remember this in work/u);

    const homeTranscript = await server
      .getHarness("home")
      .loadChat("whatsapp-15551234567")
      .then((chat) => chat.messages.map((message) => message.content).join("\n"));
    assert.doesNotMatch(homeTranscript, /remember this in work/u);

    await server.stop();
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("server prompts the user to choose a project when none is selected", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-server-prompt-"));
  const homeDir = path.join(rootDir, "home");
  const workDir = path.join(rootDir, "work");

  try {
    await initProjectConfig(homeDir, {
      name: "home",
      model: "dummy/test-model",
    });
    await initProjectConfig(workDir, {
      name: "work",
      model: "dummy/test-model",
    });

    const server = MaclawServer.create(
      {
        configFile: path.join(rootDir, "server.json"),
        projects: [
          { name: "home", folder: homeDir },
          { name: "work", folder: workDir },
        ],
        channels: {
          discord: {
            enabled: false,
          },
          slack: {
            enabled: false,
          },
          whatsapp: {
            enabled: false,
            graphApiVersion: "v23.0",
            port: 3000,
            webhookPath: "/whatsapp/webhook",
          },
        },
      },
      {
        configFile: path.join(rootDir, "secrets.json"),
        discord: {},
        slack: {},
        whatsapp: {},
      },
      {
        port: 0,
        servePortal: false,
      },
    );
    await server.start();

    const reply = await server.handleMessage({
      channel: "whatsapp",
      userId: "whatsapp-15550000000",
      text: "hello",
    });

    assert.match(reply ?? "", /No project selected/u);
    assert.match(reply ?? "", /home/u);
    assert.match(reply ?? "", /work/u);

    await server.stop();
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("server passes channel origin through to created agents", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-server-agent-origin-"));
  const homeDir = path.join(rootDir, "home");

  try {
    await initProjectConfig(homeDir, {
      name: "home",
      model: "dummy/test-model",
    });

    const server = MaclawServer.create(
      {
        configFile: path.join(rootDir, "server.json"),
        projects: [{ name: "home", folder: homeDir }],
        defaultProject: "home",
        channels: {
          discord: { enabled: false },
          slack: { enabled: false },
          whatsapp: {
            enabled: false,
            graphApiVersion: "v23.0",
            port: 3000,
            webhookPath: "/whatsapp/webhook",
          },
        },
      },
      {
        configFile: path.join(rootDir, "secrets.json"),
        discord: {},
        slack: {},
        whatsapp: {},
      },
      {
        port: 0,
        servePortal: false,
      },
    );
    await server.start();

    const reply = await server.handleMessage({
      channel: "slack",
      threadId: "thread-123",
      userId: "slack-T1-U1",
      text: "/agent create notifier | Let me know when this is done",
    });

    assert.match(reply ?? "", /started agent: /u);

    const agent = server.getHarness("home").listAgents()[0];
    assert.equal(agent?.origin?.channel, "slack");
    assert.equal(agent?.origin?.userId, "slack-T1-U1");
    assert.equal(agent?.origin?.threadId, "thread-123");

    await server.stop();
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("server renders the portal shell", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-server-portal-"));
  const homeDir = path.join(rootDir, "home");

  try {
    await initProjectConfig(homeDir, {
      name: "home",
      model: "dummy/test-model",
    });

    const server = MaclawServer.create(
      {
        configFile: path.join(rootDir, "server.json"),
        projects: [{ name: "home", folder: homeDir }],
        defaultProject: "home",
        channels: {
          discord: { enabled: false },
          slack: { enabled: false },
          whatsapp: {
            enabled: false,
            graphApiVersion: "v23.0",
            port: 3000,
            webhookPath: "/whatsapp/webhook",
          },
        },
      },
      {
        configFile: path.join(rootDir, "secrets.json"),
        discord: {},
        slack: {},
        whatsapp: {},
      },
      {
        servePortal: false,
      },
    );

    const html = server.renderPortal();

    assert.match(html, /maclaw/u);
    assert.match(html, /web channel/u);
    assert.match(html, />home</u);
    assert.match(html, /\/events/u);
    assert.match(html, /Recent chats/u);
    assert.match(html, /\/chat switch/u);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

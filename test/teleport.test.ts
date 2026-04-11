import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import { initProjectConfig } from "../src/config.js";
import { MaclawServer } from "../src/server.js";
import type { RemoteCommandRequest, RemoteCommandResponse } from "../src/teleport.js";
import { RemoteRuntimeClient } from "../src/teleport.js";
import { useDummyProviderEnv } from "./provider-env.js";

useDummyProviderEnv();

const actualFetch = globalThis.fetch;

const createServer = (
  rootDir: string,
  homeDir: string,
): MaclawServer =>
  MaclawServer.create(
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

test("server handles remote commands directly when the portal UI is disabled", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-teleport-api-"));
  const homeDir = path.join(rootDir, "home");

  try {
    await initProjectConfig(homeDir, {
      name: "home",
      model: "dummy/test-model",
    });

    const server = createServer(rootDir, homeDir);
    await server.start();

    const payload = await server.handleRemoteCommand({
      project: "home",
      chatId: "remote-chat",
      text: "/help",
    });

    assert.equal(payload.project, "home");
    assert.equal(payload.chatId, "remote-chat");
    assert.equal(payload.handledAsCommand, true);
    assert.match(payload.reply, /\/agent/u);

    await server.stop();
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("RemoteRuntimeClient sends structured commands to /api/command", async () => {
  const requests: Array<{
    input: string | URL | Request;
    init?: RequestInit;
  }> = [];

  globalThis.fetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    requests.push({ input, init });
    return new Response(
      JSON.stringify({
        project: "home",
        chatId: "remote-chat",
        reply: "ok",
        handledAsCommand: true,
      } satisfies RemoteCommandResponse),
      {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
      },
    );
  };

  try {
    const client = new RemoteRuntimeClient("http://127.0.0.1:9000/");
    const request: RemoteCommandRequest = {
      project: "home",
      chatId: "remote-chat",
      text: "/project",
    };

    const response = await client.sendCommand(request);

    assert.deepEqual(response, {
      project: "home",
      chatId: "remote-chat",
      reply: "ok",
      handledAsCommand: true,
    });
    assert.equal(requests.length, 1);
    assert.equal(String(requests[0]?.input), "http://127.0.0.1:9000/api/command");
    assert.equal(requests[0]?.init?.method, "POST");
    assert.deepEqual(
      requests[0]?.init?.headers as Record<string, string>,
      { "content-type": "application/json; charset=utf-8" },
    );
    assert.deepEqual(
      JSON.parse(String(requests[0]?.init?.body)),
      request,
    );
  } finally {
    globalThis.fetch = actualFetch;
  }
});

test("server remote commands can send chat messages into the target chat", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-teleport-client-"));
  const homeDir = path.join(rootDir, "home");

  try {
    await initProjectConfig(homeDir, {
      name: "home",
      model: "dummy/test-model",
    });

    const server = createServer(rootDir, homeDir);
    await server.start();

    const chatReply = await server.handleRemoteCommand({
      project: "home",
      chatId: "remote-chat",
      text: "remember this remotely",
    });

    assert.equal(chatReply.project, "home");
    assert.equal(chatReply.chatId, "remote-chat");
    assert.equal(chatReply.handledAsCommand, false);
    assert.match(chatReply.reply, /No model provider configured\./u);

    const transcript = await server
      .getHarness("home")
      .loadChat("remote-chat")
      .then((chat) => chat.messages.map((message) => message.content).join("\n"));
    assert.match(transcript, /remember this remotely/u);

    await server.stop();
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

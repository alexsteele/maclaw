import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import test from "node:test";
import { initProjectConfig } from "../src/config.js";
import { MaclawServer } from "../src/server.js";
import type { RemoteCommandRequest, RemoteCommandResponse } from "../src/teleport.js";
import {
  RemoteRuntimeClient,
  TeleportController,
  TeleportSession,
  sendTeleportCommand,
} from "../src/teleport.js";
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

test("sendTeleportCommand uses a configured SSH remote", async () => {
  const spawnCalls: Array<{
    command: string;
    args: string[];
  }> = [];
  const tunnel = new EventEmitter() as EventEmitter & {
    kill: (signal?: NodeJS.Signals | number) => boolean;
    stderr: EventEmitter;
  };
  tunnel.stderr = new EventEmitter();
  tunnel.kill = () => {
    queueMicrotask(() => {
      tunnel.emit("exit", 0, null);
    });
    return true;
  };

  const response = await sendTeleportCommand(
    "gpu-box",
    {
      project: "home",
      chatId: "remote-chat",
      text: "/project",
    },
    {
      remotes: [
        {
          name: "gpu-box",
          provider: "ssh",
          metadata: {
            host: "gpu.example.com",
            user: "alex",
            port: 2222,
          },
          remoteServerPort: 4400,
          localForwardPort: 4100,
        },
      ],
    },
    {
      tunnel: {
        startupDelayMs: 0,
        spawnFn(command, args) {
          spawnCalls.push({ command, args });
          return tunnel as never;
        },
      },
      runtime: {
        fetchFn: async (input) =>
          new Response(
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
          ),
        sleep: async () => {},
      },
    },
  );

  assert.deepEqual(response, {
    project: "home",
    chatId: "remote-chat",
    reply: "ok",
    handledAsCommand: true,
  });
  assert.deepEqual(spawnCalls, [
    {
      command: "ssh",
      args: [
        "-o",
        "ExitOnForwardFailure=yes",
        "-N",
        "-L",
        "4100:127.0.0.1:4400",
        "-p",
        "2222",
        "alex@gpu.example.com",
      ],
    },
  ]);
});

test("sendTeleportCommand uses a configured AWS remote", async () => {
  const spawnCalls: Array<{
    command: string;
    args: string[];
  }> = [];
  const tunnel = new EventEmitter() as EventEmitter & {
    kill: (signal?: NodeJS.Signals | number) => boolean;
    stderr: EventEmitter;
  };
  tunnel.stderr = new EventEmitter();
  tunnel.kill = () => {
    queueMicrotask(() => {
      tunnel.emit("exit", 0, null);
    });
    return true;
  };

  const response = await sendTeleportCommand(
    "aws-dev",
    {
      project: "home",
      chatId: "remote-chat",
      text: "/project",
    },
    {
      remotes: [
        {
          name: "aws-dev",
          provider: "aws-ec2",
          metadata: {
            region: "us-west-2",
            instanceId: "i-1234567890abcdef0",
          },
          remoteServerPort: 4400,
          localForwardPort: 4100,
        },
      ],
    },
    {
      tunnel: {
        startupDelayMs: 0,
        spawnFn(command, args) {
          spawnCalls.push({ command, args });
          return tunnel as never;
        },
      },
      runtime: {
        fetchFn: async () =>
          new Response(
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
          ),
        sleep: async () => {},
      },
    },
  );

  assert.deepEqual(response, {
    project: "home",
    chatId: "remote-chat",
    reply: "ok",
    handledAsCommand: true,
  });
  assert.deepEqual(spawnCalls, [
    {
      command: "aws",
      args: [
        "ssm",
        "start-session",
        "--region",
        "us-west-2",
        "--target",
        "i-1234567890abcdef0",
        "--document-name",
        "AWS-StartPortForwardingSession",
        "--parameters",
        "{\"portNumber\":[\"4400\"],\"localPortNumber\":[\"4100\"]}",
      ],
    },
  ]);
});

test("TeleportSession reuses one SSH tunnel across multiple commands", async () => {
  const spawnCalls: Array<{
    command: string;
    args: string[];
  }> = [];
  const fetchBodies: string[] = [];
  const tunnel = new EventEmitter() as EventEmitter & {
    kill: (signal?: NodeJS.Signals | number) => boolean;
    stderr: EventEmitter;
  };
  tunnel.stderr = new EventEmitter();
  tunnel.kill = () => {
    queueMicrotask(() => {
      tunnel.emit("exit", 0, null);
    });
    return true;
  };

  const session = new TeleportSession(
    "gpu-box",
    {
      remotes: [
        {
          name: "gpu-box",
          provider: "ssh",
          metadata: {
            host: "gpu.example.com",
            port: 22,
          },
        },
      ],
    },
    {
      tunnel: {
        startupDelayMs: 0,
        spawnFn(command, args) {
          spawnCalls.push({ command, args });
          return tunnel as never;
        },
      },
      runtime: {
        fetchFn: async (_input, init) => {
          fetchBodies.push(String(init?.body));
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
        },
        sleep: async () => {},
      },
    },
  );

  try {
    await session.sendCommand({ text: "/project" });
    await session.sendCommand({ text: "/help" });
  } finally {
    await session.stop();
  }

  assert.equal(spawnCalls.length, 1);
  assert.equal(fetchBodies.length, 2);
  assert.match(fetchBodies[0] ?? "", /"text":"\/project"/u);
  assert.match(fetchBodies[0] ?? "", /"teleportHost":"gpu\.example\.com"/u);
  assert.match(fetchBodies[1] ?? "", /"text":"\/help"/u);
});

test("TeleportController tracks an attached target and sends messages with stored defaults", async () => {
  const tunnel = new EventEmitter() as EventEmitter & {
    kill: (signal?: NodeJS.Signals | number) => boolean;
    stderr: EventEmitter;
  };
  const fetchBodies: string[] = [];
  tunnel.stderr = new EventEmitter();
  tunnel.kill = () => {
    queueMicrotask(() => {
      tunnel.emit("exit", 0, null);
    });
    return true;
  };

  const controller = new TeleportController(
    {
      remotes: [
        {
          name: "gpu-box",
          provider: "ssh",
          metadata: {
            host: "gpu.example.com",
            port: 22,
          },
        },
      ],
    },
    {
      tunnel: {
        startupDelayMs: 0,
        spawnFn() {
          return tunnel as never;
        },
      },
      runtime: {
        fetchFn: async (_input, init) => {
          fetchBodies.push(String(init?.body));
          return new Response(
            JSON.stringify({
              project: "home",
              chatId: "remote-chat",
              reply: "ok",
              handledAsCommand: false,
            } satisfies RemoteCommandResponse),
            {
              status: 200,
              headers: {
                "content-type": "application/json; charset=utf-8",
              },
            },
          );
        },
        sleep: async () => {},
      },
    },
  );

  try {
    const target = await controller.connect("gpu-box", {
      project: "home",
      chatId: "remote-chat",
    });
    const reply = await controller.sendMessage("hello remote");

    assert.deepEqual(target, controller.getTarget());
    assert.equal(target.target, "gpu-box");
    assert.equal(reply?.reply, "ok");
    assert.match(fetchBodies[0] ?? "", /"project":"home"/u);
    assert.match(fetchBodies[0] ?? "", /"chatId":"remote-chat"/u);
    assert.match(fetchBodies[0] ?? "", /"text":"hello remote"/u);
    assert.match(fetchBodies[0] ?? "", /"teleportRemote":"gpu-box"/u);
  } finally {
    await controller.disconnect();
  }

  assert.equal(controller.getTarget(), undefined);
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

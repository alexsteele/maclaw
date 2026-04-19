import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import {
  compressHelpText,
  dispatchCommand,
  helpText,
  inboxHelpText,
  modelHelpText,
  projectHelpText,
  remoteHelpText,
  saveHelpText,
  sendHelpText,
  taskScheduleHelpText,
  teleportHelpText,
  usageHelpText,
} from "../src/commands.js";
import {
  defaultAgentMemoryFile,
  defaultAgentsFile,
  initProjectConfig,
} from "../src/config.js";
import { Harness } from "../src/harness.js";
import { JsonFileAgentStore } from "../src/storage/json.js";
import { useDummyProviderEnv } from "./provider-env.js";

useDummyProviderEnv();

test("dispatchCommand handles history for an explicit chat id", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-"));

  try {
    const harness = Harness.load(projectDir);
    await harness.promptChat("whatsapp-15551234567", "remember this");

    const reply = await dispatchCommand(harness, "/history", {
      chatId: "whatsapp-15551234567",
    });

    assert.match(reply ?? "", /remember this/u);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand treats ? as an alias for help", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-help-alias-"));

  try {
    const harness = Harness.load(projectDir);

    const reply = await dispatchCommand(harness, "?");

    assert.equal(reply, helpText);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand shows teleport help", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-teleport-help-"));

  try {
    const harness = Harness.load(projectDir);

    assert.equal(await dispatchCommand(harness, "/help teleport"), teleportHelpText);
    assert.equal(await dispatchCommand(harness, "/teleport help"), teleportHelpText);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand shows remote help", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-remote-help-"));

  try {
    const harness = Harness.load(projectDir);

    assert.equal(await dispatchCommand(harness, "/help remote"), remoteHelpText);
    assert.equal(await dispatchCommand(harness, "/remote help"), remoteHelpText);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand shows teleport help by default", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-teleport-status-"));

  try {
    const harness = Harness.load(projectDir);

    const reply = await dispatchCommand(harness, "/teleport");

    assert.equal(reply, teleportHelpText);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand lists configured teleport remotes", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-teleport-list-"));

  try {
    const harness = Harness.load(projectDir);
    const controller = {
      async connect() {
        throw new Error("not used");
      },
      async disconnect() {
        return false;
      },
      getTarget() {
        return undefined;
      },
      listRemotes() {
        return [
          {
            name: "local-box",
            provider: "ssh" as const,
            metadata: { host: "127.0.0.1", port: 22 },
          },
          {
            name: "dev-box",
            provider: "ssh" as const,
            metadata: { host: "dev.example.com", port: 2222 },
          },
        ];
      },
    };

    const reply = await dispatchCommand(harness, "/teleport list", {
      teleport: controller,
    });

    assert.equal(reply, "- local-box: 127.0.0.1:22\n- dev-box: dev.example.com:2222");
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand can create, show, list, and delete remotes", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-remote-create-"));
  const maclawHome = await mkdtemp(path.join(os.tmpdir(), "maclaw-home-remote-"));
  const originalMaclawHome = process.env.MACLAW_HOME;

  try {
    process.env.MACLAW_HOME = maclawHome;
    const harness = Harness.load(projectDir);

    const createHelpReply = await dispatchCommand(harness, "/remote create");
    const createSshReply = await dispatchCommand(
      harness,
      '/remote create {"name":"gpu-box","provider":"ssh","metadata":{"host":"gpu.example.com","user":"alex","port":2222},"remoteServerPort":4000,"localForwardPort":4100}',
    );
    const createAwsReply = await dispatchCommand(
      harness,
      '/remote create {"name":"aws-dev","provider":"aws-ec2","metadata":{"region":"us-west-2","instanceId":"i-0d4a7b8d1b15e49c4"},"remoteServerPort":4000,"localForwardPort":4101,"runtime":{"kind":"docker"}}',
    );
    const createHttpReply = await dispatchCommand(
      harness,
      '/remote create {"name":"local-api","provider":"http","metadata":{"url":"http://127.0.0.1:4100"}}',
    );
    const listReply = await dispatchCommand(harness, "/remote list");
    const aliasListReply = await dispatchCommand(harness, "/remotes");
    const showReply = await dispatchCommand(harness, "/remote show aws-dev");
    const bootstrapReply = await dispatchCommand(harness, "/remote bootstrap local-api");
    const startReply = await dispatchCommand(harness, "/remote start local-api");
    const stopReply = await dispatchCommand(harness, "/remote stop local-api");
    const deleteReply = await dispatchCommand(harness, "/remote rm gpu-box");
    const missingReply = await dispatchCommand(harness, "/remote show gpu-box");

    assert.equal(
      createHelpReply,
      "Interactive /remote create is not supported yet. Use /remote create <json>.",
    );
    assert.equal(createSshReply, "saved remote: gpu-box");
    assert.equal(createAwsReply, "saved remote: aws-dev");
    assert.equal(createHttpReply, "saved remote: local-api");
    assert.equal(
      listReply,
      "- gpu-box: gpu.example.com:2222\n- aws-dev: aws-ec2 i-0d4a7b8d1b15e49c4 (us-west-2) [docker]\n- local-api: http://127.0.0.1:4100",
    );
    assert.equal(aliasListReply, listReply);
    assert.match(showReply, /"name": "aws-dev"/u);
    assert.match(showReply, /"provider": "aws-ec2"/u);
    assert.match(showReply, /"instanceId": "i-0d4a7b8d1b15e49c4"/u);
    assert.match(showReply, /"kind": "docker"/u);
    assert.equal(
      bootstrapReply,
      "bootstrap failed: local-api (exit 64)\nbootstrap is not implemented for http remotes.",
    );
    assert.equal(startReply, "start complete: local-api\nstart is a no-op for http remotes.");
    assert.equal(stopReply, "stop complete: local-api\nstop is a no-op for http remotes.");
    assert.equal(deleteReply, "deleted remote: gpu-box");
    assert.equal(missingReply, "remote not found: gpu-box");

    const savedConfig = JSON.parse(
      await readFile(path.join(maclawHome, "server.json"), "utf8"),
    ) as { remotes?: Array<{ name: string }> };
    assert.deepEqual(savedConfig.remotes?.map((remote) => remote.name), ["aws-dev", "local-api"]);
  } finally {
    if (originalMaclawHome === undefined) {
      delete process.env.MACLAW_HOME;
    } else {
      process.env.MACLAW_HOME = originalMaclawHome;
    }
    await rm(projectDir, { recursive: true, force: true });
    await rm(maclawHome, { recursive: true, force: true });
  }
});

test("dispatchCommand can connect and disconnect teleport through a controller", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-teleport-connect-"));
  const calls: string[] = [];
  let attachedTarget:
    | { target: string; project?: string; chatId: string }
    | undefined;

  try {
    const harness = Harness.load(projectDir);

    const controller = {
      async connect(target: string, options: { project?: string; chatId: string }) {
        calls.push(`connect:${target}:${options.project}:${options.chatId}`);
        attachedTarget = {
          target,
          project: options.project,
          chatId: options.chatId,
        };
        return attachedTarget;
      },
      async disconnect() {
        calls.push("disconnect");
        attachedTarget = undefined;
        return true;
      },
      getTarget() {
        return attachedTarget;
      },
    };

    const connectReply = await dispatchCommand(
      harness,
      "/teleport remote-box --project work --chat branch-a",
      { teleport: controller },
    );
    const statusReply = await dispatchCommand(harness, "/teleport status", {
      teleport: controller,
    });
    const disconnectReply = await dispatchCommand(harness, "/teleport disconnect", {
      teleport: controller,
    });

    assert.equal(
      connectReply,
      "attached to remote: remote-box\nteleport: connected\ntarget: remote-box\nproject: work\nchat: branch-a",
    );
    assert.equal(
      statusReply,
      "teleport: connected\ntarget: remote-box\nproject: work\nchat: branch-a",
    );
    assert.equal(disconnectReply, "teleport: disconnected");
    assert.deepEqual(calls, [
      "connect:remote-box:work:branch-a",
      "disconnect",
    ]);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand lets teleport use the remote default project when none is provided", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-teleport-default-project-"));
  const calls: string[] = [];

  try {
    const harness = Harness.load(projectDir);

    const controller = {
      async connect(target: string, options: { project?: string; chatId: string }) {
        calls.push(`connect:${target}:${options.project}:${options.chatId}`);
        return {
          target,
          project: options.project,
          chatId: options.chatId,
        };
      },
      async disconnect() {
        return true;
      },
      getTarget() {
        return undefined;
      },
      listRemotes() {
        return [];
      },
    };

    const reply = await dispatchCommand(
      harness,
      "/teleport aws-dev",
      { teleport: controller },
    );

    assert.equal(
      reply,
      "attached to remote: aws-dev\nteleport: connected\ntarget: aws-dev\nproject: (default)\nchat: default",
    );
    assert.deepEqual(calls, ["connect:aws-dev:undefined:default"]);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand prints teleport connection errors cleanly", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-teleport-error-"));

  try {
    const harness = Harness.load(projectDir);
    const controller = {
      async connect() {
        throw new Error("Unknown remote: missing-box");
      },
      async disconnect() {
        return false;
      },
      getTarget() {
        return undefined;
      },
      listRemotes() {
        return [];
      },
    };

    const reply = await dispatchCommand(harness, "/teleport missing-box", {
      teleport: controller,
    });

    assert.equal(reply, "Unknown remote: missing-box");
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand reports unsupported chat switching for scoped channels", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-switch-"));

  try {
    const harness = Harness.load(projectDir);

    const reply = await dispatchCommand(harness, "/chat switch branch-a", {
      chatId: "whatsapp-15551234567",
    });

    assert.equal(reply, "/chat switch is not supported in this channel yet.");
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand forks the current chat with an explicit name", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-fork-"));

  try {
    const harness = Harness.load(projectDir);

    const reply = await dispatchCommand(harness, "/chat fork branch-a");

    assert.equal(reply, "forked current chat to: branch-a");
    assert.equal(harness.getCurrentChatId(), "branch-a");
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand creates and switches to a new chat with /new", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-new-"));

  try {
    const harness = Harness.load(projectDir);

    const reply = await dispatchCommand(harness, "/new jazz");

    assert.equal(reply, "switched to chat: jazz");
    assert.equal(harness.getCurrentChatId(), "jazz");
    assert.equal((await harness.listChats()).some((chat) => chat.id === "jazz"), true);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand switches chats with /switch", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-switch-alias-"));

  try {
    const harness = Harness.load(projectDir);

    const reply = await dispatchCommand(harness, "/switch jazz");

    assert.equal(reply, "switched to chat: jazz");
    assert.equal(harness.getCurrentChatId(), "jazz");
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand forks the current chat with /fork", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-fork-alias-"));

  try {
    const harness = Harness.load(projectDir);

    const reply = await dispatchCommand(harness, "/fork jazz");

    assert.equal(reply, "forked current chat to: jazz");
    assert.equal(harness.getCurrentChatId(), "jazz");
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand clears the current chat with /reset", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-reset-"));

  try {
    const harness = Harness.load(projectDir);
    await harness.prompt("hello before reset");

    const reply = await dispatchCommand(harness, "/reset");
    const chat = await harness.loadCurrentChat();

    assert.equal(reply, "reset chat: default");
    assert.equal(chat.id, "default");
    assert.equal(chat.messages.length, 0);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand compresses the current chat with /compress", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-compress-"));

  try {
    await initProjectConfig(projectDir, {
      name: "compress-project",
      model: "dummy/test-model",
      contextMessages: 2,
    });
    const harness = Harness.load(projectDir);
    await harness.prompt("first message");
    await harness.prompt("second message");
    await harness.prompt("third message");

    const reply = await dispatchCommand(harness, "/compress");
    const chat = await harness.loadCurrentChat();

    assert.match(reply ?? "", /^compressed chat: default$/mu);
    assert.match(reply ?? "", /^removedMessages: 4$/mu);
    assert.match(reply ?? "", /^keptMessages: 2$/mu);
    assert.equal(chat.messages.length, 2);
    assert.match(chat.summary ?? "", /Summarize this chat history\./u);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand renders chat list output", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-chat-list-"));

  try {
    const harness = Harness.load(projectDir);
    await harness.prompt("hello from default");
    await harness.promptChat("branch-a", "hello from branch");

    const reply = await dispatchCommand(harness, "/chat list");

    assert.match(reply ?? "", /\bchat\b/u);
    assert.match(reply ?? "", /\bmessages\b/u);
    assert.match(reply ?? "", /default/u);
    assert.match(reply ?? "", /branch-a/u);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand supports /chats as an alias for /chat list", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-chats-alias-"));

  try {
    const harness = Harness.load(projectDir);
    await harness.prompt("hello from default");
    await harness.promptChat("branch-a", "hello from branch");

    const reply = await dispatchCommand(harness, "/chats");

    assert.match(reply ?? "", /\bchat\b/u);
    assert.match(reply ?? "", /\bmessages\b/u);
    assert.match(reply ?? "", /default/u);
    assert.match(reply ?? "", /branch-a/u);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand prunes expired chats", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-chat-prune-"));

  try {
    await initProjectConfig(projectDir, {
      retentionDays: 1,
    });
    const harness = Harness.load(projectDir);
    await harness.promptChat("stale", "old chat");
    await harness.promptChat("fresh", "fresh chat");

    const stalePath = path.join(projectDir, ".maclaw", "chats", "stale.json");
    const stale = JSON.parse(await readFile(stalePath, "utf8")) as { updatedAt: string };
    stale.updatedAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    await writeFile(stalePath, `${JSON.stringify(stale, null, 2)}\n`, "utf8");

    const reply = await dispatchCommand(harness, "/chat prune");

    assert.equal(reply, "pruned expired chats: 1");
    assert.equal((await harness.listChats()).some((chat) => chat.id === "stale"), false);
    assert.equal((await harness.listChats()).some((chat) => chat.id === "fresh"), true);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand supports /chats prune as an alias for /chat prune", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-chats-prune-alias-"));

  try {
    await initProjectConfig(projectDir, {
      retentionDays: 1,
    });
    const harness = Harness.load(projectDir);
    await harness.promptChat("stale", "old chat");

    const stalePath = path.join(projectDir, ".maclaw", "chats", "stale.json");
    const stale = JSON.parse(await readFile(stalePath, "utf8")) as { updatedAt: string };
    stale.updatedAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    await writeFile(stalePath, `${JSON.stringify(stale, null, 2)}\n`, "utf8");

    const directReply = await dispatchCommand(harness, "/chat prune");
    await harness.promptChat("stale-again", "old chat");
    const staleAgainPath = path.join(projectDir, ".maclaw", "chats", "stale-again.json");
    const staleAgain = JSON.parse(await readFile(staleAgainPath, "utf8")) as { updatedAt: string };
    staleAgain.updatedAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    await writeFile(staleAgainPath, `${JSON.stringify(staleAgain, null, 2)}\n`, "utf8");

    const aliasReply = await dispatchCommand(harness, "/chats prune");

    assert.equal(directReply, "pruned expired chats: 1");
    assert.equal(aliasReply, "pruned expired chats: 1");
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand supports /projects as an alias for /project list", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-projects-alias-"));

  try {
    const harness = Harness.load(projectDir);

    const directReply = await dispatchCommand(harness, "/project list");
    const aliasReply = await dispatchCommand(harness, "/projects");

    assert.equal(aliasReply, directReply);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand persists a switched chat so it appears in chat list output", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-chat-switch-list-"));

  try {
    const harness = Harness.load(projectDir);

    const switchReply = await dispatchCommand(harness, "/chat switch jazz");
    const listReply = await dispatchCommand(harness, "/chat list");

    assert.equal(switchReply, "switched to chat: jazz");
    assert.match(listReply ?? "", /jazz/u);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand shows current and named chat info", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-chat-show-"));

  try {
    const harness = Harness.load(projectDir);
    await harness.prompt("hello from default");
    await harness.promptChat("branch-a", "hello from branch");

    const currentReply = await dispatchCommand(harness, "/chat show");
    const namedReply = await dispatchCommand(harness, "/chat show branch-a");
    const modelPattern = new RegExp(`^model: ${harness.config.model.replace("/", "\\/")}$`, "mu");

    assert.match(currentReply ?? "", /^id: default$/mu);
    assert.match(currentReply ?? "", modelPattern);
    assert.match(currentReply ?? "", /^messageCount: 2$/mu);
    assert.match(currentReply ?? "", /^contextMessageCount: 2$/mu);
    assert.match(currentReply ?? "", /^contextBytes: \d+$/mu);
    assert.match(namedReply ?? "", /^id: branch-a$/mu);
    assert.match(namedReply ?? "", modelPattern);
    assert.match(namedReply ?? "", /^messageCount: 2$/mu);
    assert.match(namedReply ?? "", /^contextMessageCount: 2$/mu);
    assert.match(namedReply ?? "", /^contextBytes: \d+$/mu);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand saves the current chat transcript to the default file", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-save-default-"));

  try {
    const harness = Harness.load(projectDir);
    await harness.prompt("hello from default");

    const reply = await dispatchCommand(harness, "/save");
    const savedPath = path.join(projectDir, ".maclaw", "exports", "default.md");
    const savedContent = await readFile(savedPath, "utf8");

    assert.equal(reply, `saved chat transcript to: ${savedPath}`);
    assert.match(savedContent, /\[user\] hello from default/u);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand saves the current chat transcript to a custom file", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-save-custom-"));

  try {
    const harness = Harness.load(projectDir);
    await harness.prompt("hello from default");

    const reply = await dispatchCommand(harness, "/save notes/transcript.txt");
    const savedPath = path.join(projectDir, "notes", "transcript.txt");
    const savedContent = await readFile(savedPath, "utf8");

    assert.equal(reply, `saved chat transcript to: ${savedPath}`);
    assert.match(savedContent, /\[user\] hello from default/u);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand shows saved inbox notifications", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-inbox-"));

  try {
    const harness = Harness.load(projectDir, {
      onTaskMessage: async () => {},
      router: {
        async send() {
          return {
            delivered: true,
            target: {
              channel: "slack",
              conversationId: "C123",
              userId: "slack-T123-U123",
            },
          };
        },
      },
    });
    await harness.initProject({
      name: "inbox-project",
      model: "dummy/test-model",
    });

    await harness.start();

    harness.promptChat = async () => {
      throw new Error("boom");
    };

    const created = await harness.createAgent({
      name: "inbox-agent",
      prompt: "Do the thing",
      origin: {
        channel: "slack",
        conversationId: "C123",
        userId: "slack-T123-U123",
      },
    });
    assert.ok(created.agent);

    for (let attempt = 0; attempt < 50; attempt += 1) {
      const agent = harness.getAgent(created.agent.id);
      if (agent && agent.status === "failed") {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const reply = await dispatchCommand(harness, "/inbox");

    assert.match(reply ?? "", /agentFailed/u);
    assert.match(reply ?? "", /to: slack\/slack-T123-U123/u);
    assert.match(reply ?? "", /inbox-agent failed: boom/u);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand saves a manual notification to the inbox", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-send-inbox-"));

  try {
    const harness = Harness.load(projectDir);

    const reply = await dispatchCommand(harness, "/send hello from send");
    const inbox = await harness.listInbox();

    assert.equal(reply, "saved notification to inbox");
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0]?.kind, "manual");
    assert.equal(inbox[0]?.sourceType, "user");
    assert.equal(inbox[0]?.text, "hello from send");
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand can send a manual notification to the current origin", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-send-origin-"));
  const delivered: string[] = [];

  try {
    const harness = Harness.load(projectDir, {
      onTaskMessage: async () => {},
      router: {
        async send(notification) {
          const target = notification.target === "origin" ? notification.origin : undefined;
          if (!target) {
            return { delivered: false };
          }

          delivered.push(`${target.channel}/${target.userId}:${notification.text}`);
          return { delivered: true, target };
        },
      },
    });
    await harness.start();

    const reply = await dispatchCommand(harness, "/send origin | ping", {
      origin: {
        channel: "web",
        userId: "default",
        conversationId: "portal:test",
      },
    });
    const inbox = await harness.listInbox();

    assert.equal(reply, "sent notification to web/default");
    assert.deepEqual(delivered, ["web/default:ping"]);
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0]?.sourceType, "user");
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand can send a manual notification to email when configured", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-send-email-"));
  const delivered: string[] = [];

  try {
    const harness = Harness.load(projectDir, {
      onTaskMessage: async () => {},
      router: {
        async send(notification) {
          if (
            notification.target === "origin" ||
            notification.target === "inbox" ||
            notification.target !== "email"
          ) {
            return { delivered: false };
          }

          const target = {
            channel: "email",
            userId: "alex@example.com",
          };
          delivered.push(`${target.channel}/${target.userId}:${notification.text}`);
          return { delivered: true, target };
        },
      },
    });
    await harness.start();

    const reply = await dispatchCommand(harness, "/send email | ping");
    const inbox = await harness.listInbox();

    assert.equal(reply, "sent notification to email/alex@example.com");
    assert.deepEqual(delivered, ["email/alex@example.com:ping"]);
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0]?.sourceType, "user");
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand can send a manual notification to repl when configured", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-send-repl-"));
  const delivered: string[] = [];

  try {
    const harness = Harness.load(projectDir, {
      onTaskMessage: async () => {},
      router: {
        async send(notification) {
          if (
            notification.target === "origin" ||
            notification.target === "inbox" ||
            notification.target !== "repl"
          ) {
            return { delivered: false };
          }

          const target = {
            channel: "repl",
            userId: "local",
          };
          delivered.push(`${target.channel}/${target.userId}:${notification.text}`);
          return { delivered: true, target };
        },
      },
    });
    await harness.start();

    const reply = await dispatchCommand(harness, "/send repl | ping");
    const inbox = await harness.listInbox();

    assert.equal(reply, "sent notification to repl/local");
    assert.deepEqual(delivered, ["repl/local:ping"]);
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0]?.sourceType, "user");
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand shows inbox help", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-inbox-help-"));

  try {
    const harness = Harness.load(projectDir);

    const reply = await dispatchCommand(harness, "/inbox help");

    assert.equal(reply, inboxHelpText);
    assert.equal(await dispatchCommand(harness, "/send help"), sendHelpText);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand can delete and clear inbox entries", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-inbox-manage-"));

  try {
    const harness = Harness.load(projectDir);

    await dispatchCommand(harness, "/send first");
    await dispatchCommand(harness, "/send second");
    const inbox = await harness.listInbox();
    assert.equal(inbox.length, 2);

    const deleteReply = await dispatchCommand(harness, `/inbox rm ${inbox[0]!.id}`);
    const afterDelete = await harness.listInbox();
    const clearReply = await dispatchCommand(harness, "/inbox clear");
    const afterClear = await harness.listInbox();

    assert.equal(deleteReply, `deleted inbox entry: ${inbox[0]!.id}`);
    assert.equal(afterDelete.length, 1);
    assert.equal(clearReply, "cleared inbox: 1");
    assert.equal(afterClear.length, 0);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand shows chat and project usage from persisted assistant messages", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-usage-"));
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OPENAI_API_KEY;

  try {
    process.env.OPENAI_API_KEY = "test-key";
    globalThis.fetch = (async () =>
      ({
        ok: true,
        json: async () => ({
          output_text: "usage reply",
          usage: {
            input_tokens: 11,
            output_tokens: 7,
            total_tokens: 18,
            input_tokens_details: {
              cached_tokens: 3,
            },
            output_tokens_details: {
              reasoning_tokens: 2,
            },
          },
        }),
      }) as Response) as typeof fetch;

    await initProjectConfig(projectDir, {
      name: "usage-project",
      model: "openai/test-model",
      openAiApiKey: "test-key",
    });

    const harness = Harness.load(projectDir);
    await harness.prompt("hello from default");
    await harness.promptChat("branch-a", "hello from branch");

    const chatReply = await dispatchCommand(harness, "/chat usage branch-a");
    const projectReply = await dispatchCommand(harness, "/project usage");

    assert.match(chatReply ?? "", /^messagesWithUsage: 1$/mu);
    assert.match(chatReply ?? "", /^inputTokens: 11$/mu);
    assert.match(chatReply ?? "", /^outputTokens: 7$/mu);
    assert.match(chatReply ?? "", /^totalTokens: 18$/mu);
    assert.match(chatReply ?? "", /^cachedInputTokens: 3$/mu);
    assert.match(chatReply ?? "", /^reasoningTokens: 2$/mu);

    assert.match(projectReply ?? "", /^messagesWithUsage: 2$/mu);
    assert.match(projectReply ?? "", /^inputTokens: 22$/mu);
    assert.match(projectReply ?? "", /^outputTokens: 14$/mu);
    assert.match(projectReply ?? "", /^totalTokens: 36$/mu);
    assert.match(projectReply ?? "", /^cachedInputTokens: 6$/mu);
    assert.match(projectReply ?? "", /^reasoningTokens: 4$/mu);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalApiKey;
    }
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand aliases usage to current chat and project usage", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-usage-alias-"));
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OPENAI_API_KEY;

  try {
    process.env.OPENAI_API_KEY = "test-key";
    globalThis.fetch = (async () =>
      ({
        ok: true,
        json: async () => ({
          output_text: "usage reply",
          usage: {
            input_tokens: 5,
            output_tokens: 2,
            total_tokens: 7,
          },
        }),
      }) as Response) as typeof fetch;

    await initProjectConfig(projectDir, {
      name: "usage-alias-project",
      model: "openai/test-model",
      openAiApiKey: "test-key",
    });

    const harness = Harness.load(projectDir);
    await harness.prompt("hello from default");

    const usageReply = await dispatchCommand(harness, "/usage");
    const projectReply = await dispatchCommand(harness, "/usage project");
    const helpReply = await dispatchCommand(harness, "/usage help");

    assert.match(usageReply ?? "", /^messagesWithUsage: 1$/mu);
    assert.match(projectReply ?? "", /^messagesWithUsage: 1$/mu);
    assert.equal(helpReply, usageHelpText);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalApiKey;
    }
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand shows a project usage report and aliases /cost", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-usage-report-"));
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OPENAI_API_KEY;

  try {
    process.env.OPENAI_API_KEY = "test-key";
    globalThis.fetch = (async () =>
      ({
        ok: true,
        json: async () => ({
          output_text: "usage reply",
          usage: {
            input_tokens: 5,
            output_tokens: 2,
            total_tokens: 7,
          },
        }),
      }) as Response) as typeof fetch;

    await initProjectConfig(projectDir, {
      name: "usage-report-project",
      model: "openai/test-model",
      openAiApiKey: "test-key",
    });

    const harness = Harness.load(projectDir);
    await harness.prompt("hello from default");
    await harness.promptChat("branch-a", "hello from branch");
    const created = await harness.createAgent({
      name: "planner",
      prompt: "Do nothing",
      maxSteps: 0,
    });
    assert.ok(created.agent);
    await harness.promptChat(created.agent.chatId, "hello from agent");

    const reportReply = await dispatchCommand(harness, "/usage report");
    const costReply = await dispatchCommand(harness, "/cost");

    assert.match(reportReply ?? "", /^project usage report$/mu);
    assert.match(reportReply ?? "", /^messagesWithUsage: 3$/mu);
    assert.match(reportReply ?? "", /^totalTokens: 21$/mu);
    assert.match(reportReply ?? "", /^Chats$/mu);
    assert.match(reportReply ?? "", /default/u);
    assert.match(reportReply ?? "", /branch-a/u);
    assert.match(reportReply ?? "", /^Agents$/mu);
    assert.match(reportReply ?? "", /planner/u);
    assert.match(reportReply ?? "", /^Weeks$/mu);
    assert.equal(costReply, reportReply);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalApiKey;
    }
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand deletes a non-active chat", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-chat-rm-"));

  try {
    const harness = Harness.load(projectDir);
    await harness.prompt("hello from default");
    await harness.promptChat("branch-a", "hello from branch");
    await harness.createTask({
      chatId: "branch-a",
      title: "Branch Task",
      prompt: "Follow up on branch",
      runAt: "2026-04-05T09:00:00-07:00",
    });

    const reply = await dispatchCommand(harness, "/chat rm branch-a");

    assert.equal(reply, "deleted chat: branch-a");
    assert.equal((await harness.listChats()).some((chat) => chat.id === "branch-a"), false);
    assert.equal((await harness.listTasks("branch-a")).length, 0);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand refuses to delete the current chat", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-chat-rm-current-"));

  try {
    const harness = Harness.load(projectDir);

    const reply = await dispatchCommand(harness, "/chat rm default");

    assert.equal(reply, "Cannot delete the current chat. Switch to another chat first.");
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand renders task list output for a scoped chat", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-task-list-"));

  try {
    const harness = Harness.load(projectDir);
    await harness.createTask({
      chatId: "whatsapp-15551234567",
      title: "Stock Updates",
      prompt: "Send me a market update",
      schedule: {
        type: "weekly",
        days: ["mon"],
        hour: 10,
        minute: 0,
      },
    });

    const reply = await dispatchCommand(harness, "/task list", {
      chatId: "whatsapp-15551234567",
    });

    assert.match(reply ?? "", /\btitle\b/u);
    assert.match(reply ?? "", /\bschedule\b/u);
    assert.match(reply ?? "", /Stock Updates/u);
    assert.match(reply ?? "", /mon/u);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand supports /tasks as an alias for /task list", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-tasks-alias-"));

  try {
    const harness = Harness.load(projectDir);
    await harness.createTask({
      chatId: "default",
      title: "Daily Brief",
      prompt: "Send the brief",
      schedule: {
        type: "daily",
        hour: 9,
        minute: 0,
      },
    });

    const directReply = await dispatchCommand(harness, "/task list");
    const aliasReply = await dispatchCommand(harness, "/tasks");

    assert.equal(aliasReply, directReply);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand prunes inactive tasks for the current chat", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-task-prune-"));

  try {
    const harness = Harness.load(projectDir);
    const pendingTask = await harness.createTask({
      chatId: "default",
      title: "Pending",
      prompt: "Keep me",
      runAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    const completedTask = await harness.createTask({
      chatId: "default",
      title: "Completed",
      prompt: "Remove me",
      runAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const tasks = await harness.listTasks("default");
    const completed = tasks.find((task) => task.id === completedTask.id);
    assert.ok(completed);
    await harness.replaceTasks(tasks.map((task) =>
      task.id === completedTask.id ? { ...task, status: "completed" as const } : task,
    ));

    const reply = await dispatchCommand(harness, "/task prune");
    const remaining = await harness.listTasks("default");

    assert.equal(reply, "pruned inactive tasks: 1");
    assert.equal(remaining.some((task) => task.id === pendingTask.id), true);
    assert.equal(remaining.some((task) => task.id === completedTask.id), false);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand supports /tasks prune as an alias for /task prune", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-tasks-prune-alias-"));

  try {
    const harness = Harness.load(projectDir);
    const task = await harness.createTask({
      chatId: "default",
      title: "Completed",
      prompt: "Remove me",
      runAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    const tasks = await harness.listTasks("default");
    await harness.replaceTasks(tasks.map((entry) =>
      entry.id === task.id ? { ...entry, status: "failed" as const } : entry,
    ));

    const directReply = await dispatchCommand(harness, "/task prune");

    const task2 = await harness.createTask({
      chatId: "default",
      title: "Completed 2",
      prompt: "Remove me too",
      runAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    const tasks2 = await harness.listTasks("default");
    await harness.replaceTasks(tasks2.map((entry) =>
      entry.id === task2.id ? { ...entry, status: "completed" as const } : entry,
    ));

    const aliasReply = await dispatchCommand(harness, "/tasks prune");

    assert.equal(directReply, "pruned inactive tasks: 1");
    assert.equal(aliasReply, "pruned inactive tasks: 1");
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand cancels a scheduled task", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-task-cancel-"));

  try {
    const harness = Harness.load(projectDir);
    const task = await harness.createTask({
      title: "Follow up",
      prompt: "Send me a reminder",
      runAt: "2026-04-05T09:00:00-07:00",
    });

    const reply = await dispatchCommand(harness, `/task cancel ${task.id}`);

    assert.equal(reply, `cancelled task: ${task.id}`);
    assert.equal((await harness.listCurrentChatTasks()).length, 0);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand lists local skills", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-skills-"));

  try {
    await initProjectConfig(projectDir, {
      name: "skills-project",
      model: "dummy/test-model",
    });
    await mkdir(path.join(projectDir, ".maclaw", "skills"), { recursive: true });
    await writeFile(
      path.join(projectDir, ".maclaw", "skills", "daily_summary.md"),
      "# Daily Summary\n\nShort daily summary skill.\n",
      "utf8",
    );

    const harness = Harness.load(projectDir);
    const reply = await dispatchCommand(harness, "/skills");

    assert.match(reply ?? "", /daily_summary/u);
    assert.match(reply ?? "", /# Daily Summary/u);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand lists current tools and shows tools help", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-tools-"));

  try {
    const harness = Harness.load(projectDir);

    const reply = await dispatchCommand(harness, "/tools");
    const helpReply = await dispatchCommand(harness, "/tools help");
    const sharedHelpReply = await dispatchCommand(harness, "/help tools");

    assert.match(reply ?? "", /^\*\*Permissions:\*\* read$/mu);
    assert.match(reply ?? "", /^## Toolsets$/mu);
    assert.match(reply ?? "", /- maclaw: Built-in tools for chats, agents, tasks, and notifications\./u);
    assert.match(reply ?? "", /- files: Workspace-scoped file inspection and editing tools\./u);
    assert.match(reply ?? "", /^## Project$/mu);
    assert.match(reply ?? "", /^## Chats$/mu);
    assert.match(reply ?? "", /^## Agents$/mu);
    assert.match(reply ?? "", /^## Tasks$/mu);
    assert.match(reply ?? "", /^## Files$/mu);
    assert.match(reply ?? "", /^## Skills$/mu);
    assert.match(reply ?? "", /^## Utilities$/mu);
    assert.match(reply ?? "", /find_files/u);
    assert.match(reply ?? "", /search_files/u);
    assert.match(reply ?? "", /read_files/u);
    assert.match(reply ?? "", /list_dir/u);
    assert.match(reply ?? "", /tree/u);
    assert.match(reply ?? "", /list_chats/u);
    assert.match(reply ?? "", /show_chat/u);
    assert.match(reply ?? "", /list_agents/u);
    assert.match(reply ?? "", /show_agent/u);
    assert.match(reply ?? "", /list_tasks/u);
    assert.match(reply ?? "", /show_task/u);
    assert.match(reply ?? "", /list_skills/u);
    assert.match(reply ?? "", /read_skill/u);
    assert.match(reply ?? "", /get_time/u);
    assert.equal(helpReply, sharedHelpReply);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand shows the files toolset when dangerous tools are enabled", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-tools-files-"));

  try {
    const harness = Harness.load(projectDir);
    await harness.initProject({
      model: "dummy/test-model",
      tools: ["read", "dangerous"],
    });

    const reply = await dispatchCommand(harness, "/tools");

    assert.match(reply ?? "", /^\*\*Permissions:\*\* read, dangerous$/mu);
    assert.match(reply ?? "", /- files: Workspace-scoped file inspection and editing tools\./u);
    assert.match(reply ?? "", /- shell: Reviewed shell command tools for the current workspace\./u);
    assert.match(reply ?? "", /^## Files$/mu);
    assert.match(reply ?? "", /^## Shell$/mu);
    assert.match(reply ?? "", /find_files \[read\]/u);
    assert.match(reply ?? "", /search_files \[read\]/u);
    assert.match(reply ?? "", /read_files \[read\]/u);
    assert.match(reply ?? "", /list_dir \[read\]/u);
    assert.match(reply ?? "", /tree \[read\]/u);
    assert.match(reply ?? "", /read_file \[dangerous\]/u);
    assert.match(reply ?? "", /write_file \[dangerous\]/u);
    assert.match(reply ?? "", /run_shell \[dangerous\]/u);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand shows suggested models", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-models-"));

  try {
    const harness = Harness.load(projectDir);

    const reply = await dispatchCommand(harness, "/model list");
    const helpReply = await dispatchCommand(harness, "/model help");

    assert.match(reply ?? "", /openai\/gpt-5\.4-nano/u);
    assert.match(reply ?? "", /openai\/gpt-5\.4-mini/u);
    assert.match(reply ?? "", /dummy\/default/u);
    assert.match(reply ?? "", /OpenAI model docs:/u);
    assert.equal(helpReply, modelHelpText);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand shows, gets, and sets project config", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-config-"));

  try {
    await initProjectConfig(projectDir, {
      name: "config-project",
      model: "dummy/test-model",
    });
    const harness = Harness.load(projectDir);

    const showReply = await dispatchCommand(harness, "/config");
    const showAliasReply = await dispatchCommand(harness, "/config show");
    assert.match(showReply ?? "", /name: config-project/u);
    assert.match(showReply ?? "", /defaultAgentMaxSteps: 10/u);
    assert.match(showReply ?? "", /defaultAgentTimeout: 1h/u);
    assert.match(showReply ?? "", /contextMessages: 20/u);
    assert.equal(showAliasReply, showReply);

    const getReply = await dispatchCommand(harness, "/config get model");
    assert.equal(getReply, "dummy/test-model");

    const setReply = await dispatchCommand(harness, "/config set contextMessages 12");
    assert.equal(setReply, "contextMessages = 12");

    const updatedReply = await dispatchCommand(harness, "/config get contextMessages");
    assert.equal(updatedReply, "12");

    const setAgentStepsReply = await dispatchCommand(harness, "/config set defaultAgentMaxSteps 25");
    assert.equal(setAgentStepsReply, "defaultAgentMaxSteps = 25");

    const updatedAgentStepsReply = await dispatchCommand(
      harness,
      "/config get defaultAgentMaxSteps",
    );
    assert.equal(updatedAgentStepsReply, "25");

    const setAgentTimeoutReply = await dispatchCommand(
      harness,
      "/config set defaultAgentTimeout 90s",
    );
    assert.equal(setAgentTimeoutReply, "defaultAgentTimeout = 90s");

    const updatedAgentTimeoutReply = await dispatchCommand(
      harness,
      "/config get defaultAgentTimeout",
    );
    assert.equal(updatedAgentTimeoutReply, "90s");
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand refreshes the live tool list after /config set tools", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-config-tools-"));

  try {
    const harness = Harness.load(projectDir);

    const beforeReply = await dispatchCommand(harness, "/tools");
    const setReply = await dispatchCommand(harness, "/config set tools read act");
    const afterReply = await dispatchCommand(harness, "/tools");

    assert.match(beforeReply ?? "", /^\*\*Permissions:\*\* read$/mu);
    assert.doesNotMatch(beforeReply ?? "", /create_agent/u);
    assert.equal(setReply, 'tools = read,act');
    assert.match(afterReply ?? "", /^\*\*Permissions:\*\* read, act$/mu);
    assert.match(afterReply ?? "", /create_agent/u);
    assert.match(afterReply ?? "", /create_task/u);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand config help lists editable keys", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-config-help-"));

  try {
    const harness = Harness.load(projectDir);

    const reply = await dispatchCommand(harness, "/help config");

    assert.match(reply ?? "", /### Editable keys/u);
    assert.match(reply ?? "", /\bnotifications\b/u);
    assert.match(reply ?? "", /\bcontextMessages\b/u);
    assert.match(reply ?? "", /\bmaxToolIterations\b/u);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand renders agent list output", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-agent-list-"));

  try {
    const harness = Harness.load(projectDir);
    await harness.createAgent({
      name: "daily-summary",
      prompt: "Write a summary",
      toolsets: ["maclaw", "skills"],
    });

    const reply = await dispatchCommand(harness, "/agent list");

    assert.match(reply ?? "", /\bid\b/u);
    assert.match(reply ?? "", /\bname\b/u);
    assert.match(reply ?? "", /\btoolsets\b/u);
    assert.match(reply ?? "", /\bstatus\b/u);
    assert.match(reply ?? "", /\bstarted\b/u);
    assert.match(reply ?? "", /\bfinished\b/u);
    assert.match(reply ?? "", /daily-summary/u);
    assert.match(reply ?? "", /maclaw,skills/u);
    assert.doesNotMatch(reply ?? "", /\bchat\b/u);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand renders completed agents as done in the list output", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-agent-list-done-"));

  try {
    await initProjectConfig(projectDir, {
      storage: "json",
    });
    const harness = Harness.load(projectDir);
    const agentStore = new JsonFileAgentStore(defaultAgentsFile(projectDir));
    const createdAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const finishedAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();

    agentStore.saveAgent({
      id: "agent_done",
      name: "done-agent",
      prompt: "Finished work",
      chatId: "agent_done",
      sourceChatId: "default",
      status: "completed",
      timeoutMs: 60 * 60 * 1000,
      stepCount: 1,
      createdAt,
      finishedAt,
    });

    const reply = await dispatchCommand(harness, "/agent list");

    assert.match(reply ?? "", /\bdone\b/u);
    assert.doesNotMatch(reply ?? "", /\bcompleted\b/u);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand supports /agents as an alias for /agent list", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-agents-alias-"));

  try {
    const harness = Harness.load(projectDir);
    await harness.createAgent({
      name: "daily-summary",
      prompt: "Write a summary",
    });

    const directReply = await dispatchCommand(harness, "/agent list");
    const aliasReply = await dispatchCommand(harness, "/agents");

    assert.equal(aliasReply, directReply);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand prunes inactive agents older than 24h by default", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-agent-prune-"));

  try {
    await initProjectConfig(projectDir, {
      storage: "json",
    });
    const harness = Harness.load(projectDir);
    const agentStore = new JsonFileAgentStore(defaultAgentsFile(projectDir));
    const oldCreatedAt = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const oldFinishedAt = new Date(Date.now() - 47 * 60 * 60 * 1000).toISOString();
    const recentCreatedAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const recentFinishedAt = new Date(Date.now() - 20 * 60 * 1000).toISOString();

    agentStore.saveAgent({
      id: "agent_completed",
      name: "completed-agent",
      prompt: "Done already",
      chatId: "agent_completed",
      sourceChatId: "default",
      status: "completed",
      timeoutMs: 60 * 60 * 1000,
      stepCount: 1,
      createdAt: oldCreatedAt,
      finishedAt: oldFinishedAt,
    });
    agentStore.saveAgent({
      id: "agent_stopped",
      name: "stopped-agent",
      prompt: "Stopped already",
      chatId: "agent_stopped",
      sourceChatId: "default",
      status: "stopped",
      timeoutMs: 60 * 60 * 1000,
      stepCount: 2,
      createdAt: oldCreatedAt,
      finishedAt: oldFinishedAt,
    });
    agentStore.saveAgent({
      id: "agent_recent",
      name: "recent-agent",
      prompt: "Done recently",
      chatId: "agent_recent",
      sourceChatId: "default",
      status: "completed",
      timeoutMs: 60 * 60 * 1000,
      stepCount: 1,
      createdAt: recentCreatedAt,
      finishedAt: recentFinishedAt,
    });
    agentStore.saveAgent({
      id: "agent_running",
      name: "running-agent",
      prompt: "Still working",
      chatId: "agent_running",
      sourceChatId: "default",
      status: "running",
      timeoutMs: 60 * 60 * 1000,
      stepCount: 1,
      createdAt: recentCreatedAt,
      startedAt: recentCreatedAt,
    });

    await harness.promptChat("agent_completed", "completed chat history");
    await harness.promptChat("agent_stopped", "stopped chat history");
    await harness.promptChat("agent_recent", "recent chat history");
    await harness.sendAgentInboxMessage({
      agentRef: "completed-agent",
      text: "saved inbox note",
      sourceType: "user",
      sourceId: "alex",
    });
    await harness.sendAgentInboxMessage({
      agentRef: "stopped-agent",
      text: "stopped inbox note",
      sourceType: "user",
      sourceId: "alex",
    });
    await harness.writeAgentMemory("completed-agent", "saved memory note");
    await harness.writeAgentMemory("stopped-agent", "stopped memory note");
    await harness.writeAgentMemory("recent-agent", "recent memory note");

    const reply = await dispatchCommand(harness, "/agent prune");

    assert.equal(reply, "pruned inactive agents older than 24h: 2");
    assert.equal(harness.getAgent("completed-agent"), undefined);
    assert.equal(harness.getAgent("stopped-agent"), undefined);
    assert.equal(harness.getAgent("agent_recent")?.name, "recent-agent");
    assert.equal(harness.getAgent("agent_running")?.name, "running-agent");
    assert.equal(await harness.getChatTranscript("agent_completed"), "No history yet.");
    assert.equal(await harness.getChatTranscript("agent_stopped"), "No history yet.");
    assert.equal(existsSync(defaultAgentMemoryFile(projectDir, "agent_completed")), false);
    assert.equal(existsSync(defaultAgentMemoryFile(projectDir, "agent_stopped")), false);
    assert.equal(existsSync(defaultAgentMemoryFile(projectDir, "agent_recent")), true);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand prunes all inactive agents immediately with now", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-agent-prune-now-"));

  try {
    await initProjectConfig(projectDir, {
      storage: "json",
    });
    const harness = Harness.load(projectDir);
    const agentStore = new JsonFileAgentStore(defaultAgentsFile(projectDir));
    const now = new Date().toISOString();

    agentStore.saveAgent({
      id: "agent_failed",
      name: "failed-agent",
      prompt: "Failed recently",
      chatId: "agent_failed",
      sourceChatId: "default",
      status: "failed",
      timeoutMs: 60 * 60 * 1000,
      stepCount: 1,
      createdAt: now,
      finishedAt: now,
    });
    agentStore.saveAgent({
      id: "agent_paused",
      name: "paused-agent",
      prompt: "Paused still",
      chatId: "agent_paused",
      sourceChatId: "default",
      status: "paused",
      timeoutMs: 60 * 60 * 1000,
      stepCount: 1,
      createdAt: now,
      startedAt: now,
    });

    const reply = await dispatchCommand(harness, "/agent prune now");

    assert.equal(reply, "pruned inactive agents: 1");
    assert.equal(harness.getAgent("agent_failed"), undefined);
    assert.equal(harness.getAgent("agent_paused")?.name, "paused-agent");
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand prunes inactive agents older than a custom age", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-agent-prune-age-"));

  try {
    await initProjectConfig(projectDir, {
      storage: "json",
    });
    const harness = Harness.load(projectDir);
    const agentStore = new JsonFileAgentStore(defaultAgentsFile(projectDir));
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const ninetyMinutesAgo = new Date(Date.now() - 90 * 60 * 1000).toISOString();
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();

    agentStore.saveAgent({
      id: "agent_old",
      name: "old-agent",
      prompt: "Finished earlier",
      chatId: "agent_old",
      sourceChatId: "default",
      status: "completed",
      timeoutMs: 60 * 60 * 1000,
      stepCount: 1,
      createdAt: twoHoursAgo,
      finishedAt: ninetyMinutesAgo,
    });
    agentStore.saveAgent({
      id: "agent_recent",
      name: "recent-agent",
      prompt: "Finished recently",
      chatId: "agent_recent",
      sourceChatId: "default",
      status: "failed",
      timeoutMs: 60 * 60 * 1000,
      stepCount: 1,
      createdAt: thirtyMinutesAgo,
      finishedAt: thirtyMinutesAgo,
    });

    const reply = await dispatchCommand(harness, "/agent prune 1h");

    assert.equal(reply, "pruned inactive agents older than 1h: 1");
    assert.equal(harness.getAgent("agent_old"), undefined);
    assert.equal(harness.getAgent("agent_recent")?.name, "recent-agent");
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand rejects invalid agent prune ages", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-agent-prune-invalid-"));

  try {
    const harness = Harness.load(projectDir);

    const reply = await dispatchCommand(harness, "/agent prune later");

    assert.equal(reply, "Usage: /agent prune [now|<age like 1h, 30m, 2d>]");
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand removes a completed agent", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-agent-rm-"));

  try {
    await initProjectConfig(projectDir, {
      storage: "json",
    });
    const harness = Harness.load(projectDir);
    const agentStore = new JsonFileAgentStore(defaultAgentsFile(projectDir));
    const createdAt = new Date().toISOString();

    agentStore.saveAgent({
      id: "agent_done",
      name: "done-agent",
      prompt: "Done already",
      chatId: "agent_done",
      sourceChatId: "default",
      status: "completed",
      timeoutMs: 60 * 60 * 1000,
      stepCount: 1,
      createdAt,
      finishedAt: createdAt,
    });
    await harness.promptChat("agent_done", "done chat history");
    await harness.writeAgentMemory("done-agent", "done memory");

    const reply = await dispatchCommand(harness, "/agent rm done-agent");

    assert.equal(reply, "deleted agent: done-agent");
    assert.equal(harness.getAgent("agent_done"), undefined);
    assert.equal(await harness.getChatTranscript("agent_done"), "No history yet.");
    assert.equal(existsSync(defaultAgentMemoryFile(projectDir, "agent_done")), false);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand stops and removes a paused agent", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-agent-rm-paused-"));

  try {
    const harness = Harness.load(projectDir);
    const created = await harness.createAgent({
      name: "paused-agent",
      prompt: "Work on this",
      maxSteps: 50,
    });
    assert.ok(created.agent);

    await dispatchCommand(harness, "/agent pause paused-agent");
    const reply = await dispatchCommand(harness, "/agent rm paused-agent");

    assert.equal(reply, "deleted agent: paused-agent");
    assert.equal(harness.getAgent(created.agent.id), undefined);
    assert.equal(await harness.getChatTranscript(created.agent.chatId), "No history yet.");
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand creates an agent from the scoped chat without reusing its transcript", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-agent-create-"));

  try {
    const harness = Harness.load(projectDir);
    await harness.promptChat("whatsapp-15551234567", "remember this source chat");

    const reply = await dispatchCommand(
      harness,
      "/agent create stock-updates | Send me a market summary",
      { chatId: "whatsapp-15551234567" },
    );

    assert.match(reply ?? "", /started agent: /u);
    const agent = harness.listAgents()[0];
    assert.equal(agent?.name, "stock-updates");
    assert.notEqual(agent?.chatId, "whatsapp-15551234567");
    assert.equal(agent?.sourceChatId, "whatsapp-15551234567");

    const transcript = await harness.getChatTranscript(agent?.chatId);
    assert.equal(transcript === "No history yet." || transcript.length > 0, true);
    assert.doesNotMatch(transcript, /remember this source chat/u);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand creates an agent with JSON options", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-agent-options-"));

  try {
    const harness = Harness.load(projectDir);

    const reply = await dispatchCommand(
      harness,
      '/agent create planner | work through the task | {"maxSteps":3,"timeoutMs":5000,"stepIntervalMs":25}',
    );

    assert.match(reply ?? "", /^started agent: agent_/u);

    const agent = harness.listAgents().find((entry) => entry.name === "planner");
    assert.ok(agent);
    assert.equal(agent.maxSteps, 3);
    assert.equal(agent.timeoutMs, 5000);
    assert.equal(agent.stepIntervalMs, 25);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand creates an agent using the project's defaultAgentMaxSteps", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-agent-default-steps-"));

  try {
    await initProjectConfig(projectDir, {
      defaultAgentMaxSteps: 25,
    });
    const harness = Harness.load(projectDir);

    const reply = await dispatchCommand(
      harness,
      "/agent create planner | work through the task",
    );

    assert.match(reply ?? "", /^started agent: agent_/u);

    const agent = harness.listAgents().find((entry) => entry.name === "planner");
    assert.ok(agent);
    assert.equal(agent.maxSteps, 25);
    await harness.teardown();
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand creates an agent using the project's defaultAgentTimeout", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-agent-default-timeout-"));

  try {
    await initProjectConfig(projectDir, {
      defaultAgentTimeout: "90s",
    });
    const harness = Harness.load(projectDir);

    const reply = await dispatchCommand(
      harness,
      "/agent create planner | work through the task",
    );

    assert.match(reply ?? "", /^started agent: agent_/u);

    const agent = harness.listAgents().find((entry) => entry.name === "planner");
    assert.ok(agent);
    assert.equal(agent.timeoutMs, 90_000);
    await harness.teardown();
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand creates an agent with toolsets", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-agent-toolsets-"));

  try {
    const harness = Harness.load(projectDir);

    const reply = await dispatchCommand(
      harness,
      '/agent create planner | work through the task | {"toolsets":["maclaw","skills"],"maxSteps":3}',
    );

    assert.match(reply ?? "", /^started agent: agent_/u);

    const agent = harness.listAgents().find((entry) => entry.name === "planner");
    assert.deepEqual(agent?.toolsets, ["maclaw", "skills"]);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand shows agent toolsets", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-agent-show-toolsets-"));

  try {
    const harness = Harness.load(projectDir);
    const created = await harness.createAgent({
      name: "planner",
      prompt: "Work through the task",
      toolsets: ["maclaw", "skills"],
    });
    assert.ok(created.agent);

    const reply = await dispatchCommand(harness, "/agent show planner");

    assert.match(reply ?? "", /^toolsets: maclaw, skills$/mu);
    assert.match(reply ?? "", /^chatId: /mu);
    assert.match(reply ?? "", /^sourceChatId: default$/mu);
    assert.match(reply ?? "", /^createdBy: user$/mu);
    assert.match(reply ?? "", /^notify: \(default\)$/mu);
    assert.match(reply ?? "", /^maxSteps: 10$/mu);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand rejects unknown agent toolsets", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-agent-bad-toolset-"));

  try {
    const harness = Harness.load(projectDir);

    const reply = await dispatchCommand(
      harness,
      '/agent create planner | work through the task | {"toolsets":["missing"]}',
    );

    assert.equal(reply, "unknown toolset: missing");
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand creates an agent with notification overrides", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-agent-notify-options-"));

  try {
    const harness = Harness.load(projectDir);

    const reply = await dispatchCommand(
      harness,
      '/agent create planner | work through the task | {"notify":["errors"],"notifyTarget":{"channel":"slack"}}',
      {
        origin: {
          channel: "slack",
          conversationId: "C123",
          userId: "slack-T123-U123",
        },
      },
    );

    assert.match(reply ?? "", /^started agent: agent_/u);

    const agent = harness.listAgents().find((entry) => entry.name === "planner");
    assert.ok(agent);
    assert.deepEqual(agent.notify, ["errors"]);
    assert.deepEqual(agent.notifyTarget, { channel: "slack" });
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand loads agent and task prompts from @files", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-prompt-files-"));

  try {
    const harness = Harness.load(projectDir);
    await writeFile(path.join(projectDir, "agent-prompt.md"), "Prompt from file\n", "utf8");
    await writeFile(path.join(projectDir, "task-prompt.md"), "Task prompt from file\n", "utf8");

    const agentReply = await dispatchCommand(
      harness,
      "/agent create planner | @agent-prompt.md",
    );
    const taskReply = await dispatchCommand(
      harness,
      "/task schedule daily 9:00 AM | Daily Brief | @task-prompt.md",
    );

    assert.match(agentReply ?? "", /^started agent: agent_/u);
    assert.match(taskReply ?? "", /^scheduled task: /u);

    const agent = harness.listAgents().find((entry) => entry.name === "planner");
    assert.ok(agent);
    assert.match(agent.prompt, /Prompt from file\n/);

    const tasks = await harness.listCurrentChatTasks();
    assert.match(tasks[0]?.prompt, /Task prompt from file\n/);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand can send and manage agent inbox messages", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-agent-inbox-"));

  try {
    const harness = Harness.load(projectDir);
    const created = await harness.createAgent({
      name: "research-agent",
      prompt: "Start here",
      maxSteps: 50,
    });
    assert.ok(created.agent);

    const pauseReply = await dispatchCommand(harness, "/agent pause research-agent");
    const sendReply = await dispatchCommand(
      harness,
      "/agent send research-agent | Focus on the persisted inbox design",
      {
        origin: {
          channel: "repl",
          userId: "alex",
        },
      },
    );
    const inboxReply = await dispatchCommand(harness, "/agent inbox research-agent");
    const entries = await harness.listAgentInbox("research-agent");
    const entryId = entries?.[0]?.id;
    assert.ok(entryId);

    const deleteReply = await dispatchCommand(
      harness,
      `/agent inbox rm research-agent ${entryId}`,
    );
    const clearReply = await dispatchCommand(harness, "/agent inbox clear research-agent");

    assert.equal(pauseReply, "paused agent: research-agent");
    assert.equal(sendReply, "sent message to agent: research-agent");
    assert.match(inboxReply ?? "", /Focus on the persisted inbox design/u);
    assert.match(inboxReply ?? "", /from: user alex/u);
    assert.equal(deleteReply, `deleted agent inbox entry: ${entryId}`);
    assert.equal(clearReply, "cleared agent inbox: 0");
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand schedules a task with notification overrides", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-task-notify-options-"));

  try {
    const harness = Harness.load(projectDir);

    const reply = await dispatchCommand(
      harness,
      '/task schedule daily 9:00 AM | Daily Brief | Send the brief | {"notify":"none","notifyTarget":{"channel":"slack"}}',
      {
        origin: {
          channel: "slack",
          conversationId: "C123",
          userId: "slack-T123-U123",
        },
      },
    );

    assert.match(reply ?? "", /^scheduled task: /u);

    const tasks = await harness.listCurrentChatTasks();
    assert.equal(tasks[0]?.notify, "none");
    assert.deepEqual(tasks[0]?.notifyTarget, { channel: "slack" });
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand can steer, pause, resume, and stop an agent", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-agent-control-"));

  try {
    const harness = Harness.load(projectDir);
    const created = await harness.createAgent({
      name: "research-agent",
      prompt: "Research this",
    });
    assert.ok(created.agent);
    const agent = created.agent;

    const steerReply = await dispatchCommand(
      harness,
      "/agent steer research-agent | Focus on recent changes",
    );
    assert.equal(steerReply, "steered agent: research-agent");

    const pauseReply = await dispatchCommand(harness, "/agent pause research-agent");
    assert.equal(pauseReply, "paused agent: research-agent");

    const resumeReply = await dispatchCommand(harness, "/agent resume research-agent");
    assert.equal(resumeReply, "resumed agent: research-agent");

    const stopReply = await dispatchCommand(harness, "/agent stop research-agent");
    assert.equal(stopReply, "stopped agent: research-agent");
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand can pause an agent and switch into its chat", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-agent-chat-"));

  try {
    const harness = Harness.load(projectDir);
    const created = await harness.createAgent({
      name: "research-agent",
      prompt: "Research this",
    });
    assert.ok(created.agent);

    const reply = await dispatchCommand(harness, "/agent chat research-agent");

    assert.equal(
      reply,
      `paused agent: research-agent\nswitched to chat: ${created.agent.chatId}`,
    );
    assert.equal(harness.getCurrentChatId(), created.agent.chatId);
    assert.equal(harness.getAgent(created.agent.id)?.status, "paused");
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand tails recent agent chat messages", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-agent-tail-"));

  try {
    const harness = Harness.load(projectDir);
    const created = await harness.createAgent({
      name: "poet-agent",
      prompt: "Write a poem",
    });
    assert.ok(created.agent);

    await harness.promptChat(created.agent.chatId, "first line");
    await harness.promptChat(created.agent.chatId, "second line");
    await harness.promptChat(created.agent.chatId, "third line");

    const reply = await dispatchCommand(harness, "/agent tail poet-agent");

    assert.match(reply ?? "", /third line/u);
    assert.doesNotMatch(reply ?? "", /second line/u);
    assert.doesNotMatch(reply ?? "", /first line/u);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand reports unsupported follow mode for agent tail outside the repl", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-agent-tail-follow-"));

  try {
    const harness = Harness.load(projectDir);

    const reply = await dispatchCommand(harness, "/agent tail -f poet-agent");

    assert.equal(reply, "/agent tail -f is only supported in the REPL right now.");
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand can return from an agent chat and resume the agent", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-agent-return-"));

  try {
    const harness = Harness.load(projectDir);
    await harness.prompt("hello from default");
    const created = await harness.createAgent({
      name: "research-agent",
      prompt: "Research this",
    });
    assert.ok(created.agent);

    await dispatchCommand(harness, "/agent chat research-agent");

    const reply = await dispatchCommand(harness, "/agent return research-agent");

    assert.equal(reply, "resumed agent: research-agent\nswitched to chat: default");
    assert.equal(harness.getCurrentChatId(), "default");
    assert.equal(harness.getAgent(created.agent.id)?.status, "running");
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand rejects duplicate live agent names", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-agent-duplicate-"));

  try {
    const harness = Harness.load(projectDir);
    const created = await harness.createAgent({
      name: "planner",
      prompt: "First run",
    });
    assert.ok(created.agent);

    const reply = await dispatchCommand(harness, "/agent create planner | Second run");

    assert.equal(reply, "agent already running: planner");
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand requires confirmation before wiping project data", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-wipeout-"));

  try {
    await initProjectConfig(projectDir, {
      name: "wipeout-project",
      model: "dummy/test-model",
    });
    const harness = Harness.load(projectDir);

    const warningReply = await dispatchCommand(harness, "/project wipeout");
    assert.match(warningReply ?? "", /delete the project's \.maclaw folder/u);
    assert.match(warningReply ?? "", /\/project wipeout confirm/u);

    const confirmReply = await dispatchCommand(harness, "/project wipeout confirm");
    assert.match(confirmReply ?? "", /deleted project data: \.maclaw/u);
    assert.equal(harness.isProjectInitialized(), false);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand shows project help for unknown project subcommands", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-project-help-"));

  try {
    const harness = Harness.load(projectDir);

    const reply = await dispatchCommand(harness, "/project foo");

    assert.equal(reply, projectHelpText);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand treats /command help like /help command", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-family-help-"));

  try {
    const harness = Harness.load(projectDir);

    assert.equal(await dispatchCommand(harness, "/config help"), await dispatchCommand(harness, "/help config"));
    assert.equal(await dispatchCommand(harness, "/project help"), await dispatchCommand(harness, "/help project"));
    assert.equal(await dispatchCommand(harness, "/chat help"), await dispatchCommand(harness, "/help chat"));
    assert.equal(await dispatchCommand(harness, "/task help"), await dispatchCommand(harness, "/help task"));
    assert.equal(await dispatchCommand(harness, "/task schedule help"), await dispatchCommand(harness, "/help task schedule"));
    assert.equal(await dispatchCommand(harness, "/agent help"), await dispatchCommand(harness, "/help agent"));
    assert.equal(
      await dispatchCommand(harness, "/agent help tail"),
      [
        "Usage: /agent tail [-f] <name> [N]",
        "Show the latest messages from one agent's chat.",
        "Without `N`, this shows the latest agent reply.",
        "With `N`, this shows the latest `N` chat messages.",
        "Use `-f` in the REPL to keep following new messages as they arrive.",
      ].join("\n"),
    );
    assert.equal(await dispatchCommand(harness, "/model help"), await dispatchCommand(harness, "/help model"));
    assert.equal(await dispatchCommand(harness, "/compress help"), compressHelpText);
    assert.equal(await dispatchCommand(harness, "/save help"), saveHelpText);
    assert.equal(await dispatchCommand(harness, "/usage help"), usageHelpText);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand shows detailed task schedule help", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-task-schedule-help-"));

  try {
    const harness = Harness.load(projectDir);

    const reply = await dispatchCommand(harness, "/help task schedule");

    assert.equal(reply, taskScheduleHelpText);
    assert.match(reply ?? "", /defaultTaskTime/u);
    assert.match(reply ?? "", /once today/u);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand shows main help for unknown help subcommands", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-help-help-"));

  try {
    const harness = Harness.load(projectDir);

    const reply = await dispatchCommand(harness, "/help foo");

    assert.equal(reply, helpText);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand keeps unknown skills and history variants local", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-local-help-"));

  try {
    const harness = Harness.load(projectDir);

    assert.equal(await dispatchCommand(harness, "/skills foo"), "Usage: /skills");
    assert.equal(await dispatchCommand(harness, "/history foo"), "Usage: /history");
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand shows main help for unknown slash commands", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-unknown-slash-"));

  try {
    const harness = Harness.load(projectDir);

    const reply = await dispatchCommand(harness, "/wat");

    assert.equal(reply, helpText);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

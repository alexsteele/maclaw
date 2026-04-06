import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { dispatchCommand } from "../src/commands.js";
import { initProjectConfig } from "../src/config.js";
import { Harness } from "../src/harness.js";
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

test("dispatchCommand shows current and named chat info", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-chat-show-"));

  try {
    const harness = Harness.load(projectDir);
    await harness.prompt("hello from default");
    await harness.promptChat("branch-a", "hello from branch");

    const currentReply = await dispatchCommand(harness, "/chat show");
    const namedReply = await dispatchCommand(harness, "/chat show branch-a");

    assert.match(currentReply ?? "", /^id: default$/mu);
    assert.match(currentReply ?? "", /^messageCount: 2$/mu);
    assert.match(namedReply ?? "", /^id: branch-a$/mu);
    assert.match(namedReply ?? "", /^messageCount: 2$/mu);
  } finally {
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

test("dispatchCommand lists local skills", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-skills-"));

  try {
    await initProjectConfig(projectDir, {
      name: "skills-project",
      provider: "dummy",
      model: "test-model",
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

test("dispatchCommand shows, gets, and sets project config", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-config-"));

  try {
    await initProjectConfig(projectDir, {
      name: "config-project",
      provider: "dummy",
      model: "test-model",
    });
    const harness = Harness.load(projectDir);

    const showReply = await dispatchCommand(harness, "/config");
    assert.match(showReply ?? "", /name: config-project/u);
    assert.match(showReply ?? "", /contextMessages: 20/u);

    const getReply = await dispatchCommand(harness, "/config get model");
    assert.equal(getReply, "test-model");

    const setReply = await dispatchCommand(harness, "/config set contextMessages 12");
    assert.equal(setReply, "contextMessages = 12");

    const updatedReply = await dispatchCommand(harness, "/config get contextMessages");
    assert.equal(updatedReply, "12");
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand renders agent list output", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-agent-list-"));

  try {
    const harness = Harness.load(projectDir);
    harness.createAgent({
      name: "daily-summary",
      prompt: "Write a summary",
    });

    const reply = await dispatchCommand(harness, "/agent list");

    assert.match(reply ?? "", /\bid\b/u);
    assert.match(reply ?? "", /\bname\b/u);
    assert.match(reply ?? "", /\bstatus\b/u);
    assert.match(reply ?? "", /daily-summary/u);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand creates an agent for the scoped chat", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-agent-create-"));

  try {
    const harness = Harness.load(projectDir);

    const reply = await dispatchCommand(
      harness,
      "/agent create stock-updates | Send me a market summary",
      { chatId: "whatsapp-15551234567" },
    );

    assert.match(reply ?? "", /started agent: /u);
    const agent = harness.listAgents()[0];
    assert.equal(agent?.name, "stock-updates");
    assert.equal(agent?.chatId, "whatsapp-15551234567");
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

test("dispatchCommand can steer, pause, resume, and stop an agent", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-agent-control-"));

  try {
    const harness = Harness.load(projectDir);
    const created = harness.createAgent({
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
    const created = harness.createAgent({
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

test("dispatchCommand can return from an agent chat and resume the agent", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-agent-return-"));

  try {
    const harness = Harness.load(projectDir);
    await harness.prompt("hello from default");
    const created = harness.createAgent({
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
    const created = harness.createAgent({
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
      provider: "dummy",
      model: "test-model",
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

    assert.equal(reply, "Command: /project\n  /project           Show the active project\n  /project show      Show the active project\n  /project init      Create .maclaw/maclaw.json for this project\n  /project wipeout   Delete .maclaw/ for this project after confirmation");
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
    assert.equal(await dispatchCommand(harness, "/agent help"), await dispatchCommand(harness, "/help agent"));
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand shows main help for unknown help subcommands", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-help-help-"));

  try {
    const harness = Harness.load(projectDir);

    const reply = await dispatchCommand(harness, "/help foo");

    assert.equal(reply, "Commands:\n  /help              Show this help\n  /config            Project config commands\n  /project           Project information commands\n  /chat              Chat management commands\n  /history           Show the current chat transcript\n  /skills            List local skills\n  /agent             Agent management commands\n  /task              Task scheduling commands");
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

    assert.equal(reply, "Commands:\n  /help              Show this help\n  /config            Project config commands\n  /project           Project information commands\n  /chat              Chat management commands\n  /history           Show the current chat transcript\n  /skills            List local skills\n  /agent             Agent management commands\n  /task              Task scheduling commands");
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

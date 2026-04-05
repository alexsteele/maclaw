import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { dispatchCommand } from "../src/commands.js";
import { initProjectConfig } from "../src/config.js";
import { Harness } from "../src/harness.js";

test("dispatchCommand handles history for an explicit chat id", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-"));

  try {
    const harness = Harness.load(projectDir);
    await harness.handleUserInputForChat("whatsapp-15551234567", "remember this");

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
    await harness.handleUserInput("hello from default");
    await harness.handleUserInputForChat("branch-a", "hello from branch");

    const reply = await dispatchCommand(harness, "/chat list");

    assert.match(reply ?? "", /\bchat\b/u);
    assert.match(reply ?? "", /\bmessages\b/u);
    assert.match(reply ?? "", /default/u);
    assert.match(reply ?? "", /branch-a/u);
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
      provider: "local",
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

test("dispatchCommand can steer and stop an agent", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-agent-control-"));

  try {
    const harness = Harness.load(projectDir);
    const agent = harness.createAgent({
      name: "research-agent",
      prompt: "Research this",
    });

    const steerReply = await dispatchCommand(
      harness,
      `/agent steer ${agent.id} | Focus on recent changes`,
    );
    assert.equal(steerReply, `steered agent: ${agent.id}`);

    const stopReply = await dispatchCommand(harness, `/agent stop ${agent.id}`);
    assert.equal(stopReply, `stopped agent: ${agent.id}`);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

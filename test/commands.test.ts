import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import {
  dispatchCommand,
  helpText,
  inboxHelpText,
  projectHelpText,
  saveHelpText,
  taskScheduleHelpText,
  usageHelpText,
} from "../src/commands.js";
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

    assert.match(currentReply ?? "", /^id: default$/mu);
    assert.match(currentReply ?? "", /^messageCount: 2$/mu);
    assert.match(namedReply ?? "", /^id: branch-a$/mu);
    assert.match(namedReply ?? "", /^messageCount: 2$/mu);
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
    const harness = Harness.load(projectDir);
    await harness.initProject({
      name: "inbox-project",
      model: "dummy/test-model",
    });

    await harness.start(
      async () => {},
      async () => {},
    );

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

test("dispatchCommand shows inbox help", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-inbox-help-"));

  try {
    const harness = Harness.load(projectDir);

    const reply = await dispatchCommand(harness, "/inbox help");

    assert.equal(reply, inboxHelpText);
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

    assert.match(reply ?? "", /list_skills/u);
    assert.match(reply ?? "", /read_skill/u);
    assert.match(reply ?? "", /get_time/u);
    assert.equal(helpReply, sharedHelpReply);
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
    assert.match(showReply ?? "", /name: config-project/u);
    assert.match(showReply ?? "", /contextMessages: 20/u);

    const getReply = await dispatchCommand(harness, "/config get model");
    assert.equal(getReply, "dummy/test-model");

    const setReply = await dispatchCommand(harness, "/config set contextMessages 12");
    assert.equal(setReply, "contextMessages = 12");

    const updatedReply = await dispatchCommand(harness, "/config get contextMessages");
    assert.equal(updatedReply, "12");
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("dispatchCommand config help lists editable keys", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-commands-config-help-"));

  try {
    const harness = Harness.load(projectDir);

    const reply = await dispatchCommand(harness, "/help config");

    assert.match(reply ?? "", /Editable keys:/u);
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
    assert.equal(agent.prompt, "Prompt from file\n");

    const tasks = await harness.listCurrentChatTasks();
    assert.equal(tasks[0]?.prompt, "Task prompt from file\n");
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

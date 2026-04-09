import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import type { ProjectConfig } from "../src/config.js";
import { createTools } from "../src/tools/index.js";
import { Harness } from "../src/harness.js";

const createConfig = (projectDir: string): ProjectConfig => ({
  name: path.basename(projectDir),
  createdAt: undefined,
  model: "dummy/test-model",
  storage: "none",
  tools: ["read"],
  notifications: "all",
  defaultTaskTime: "9:00 AM",
  contextMessages: 20,
  maxToolIterations: 8,
  retentionDays: 30,
  skillsDir: path.join(projectDir, ".maclaw", "skills"),
  compressionMode: "none",
  schedulerPollMs: 1000,
  projectFolder: projectDir,
  projectConfigFile: path.join(projectDir, ".maclaw", "maclaw.json"),
  chatId: "default",
  chatsDir: path.join(projectDir, ".maclaw", "chats"),
});

test("starter tools parse their own input", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-tools-"));

  try {
    const config = createConfig(projectDir);
    await mkdir(config.skillsDir, { recursive: true });
    await writeFile(
      path.join(config.skillsDir, "daily_summary.md"),
      "# Daily Summary\n\nShort daily summary skill.\n",
      "utf8",
    );

    const tools = createTools(config);
    const listSkills = tools.find((tool) => tool.name === "list_skills");
    const readSkill = tools.find((tool) => tool.name === "read_skill");
    const getTime = tools.find((tool) => tool.name === "get_time");

    assert.ok(listSkills);
    assert.ok(readSkill);
    assert.ok(getTime);
    assert.equal(listSkills.permission, "read");
    assert.equal(readSkill.permission, "read");
    assert.equal(getTime.permission, "read");

    const skills = await listSkills.execute({});
    assert.match(skills, /daily_summary/u);

    const skill = await readSkill.execute({ name: "daily_summary" });
    assert.match(skill, /Daily Summary/u);

    const timestamp = await getTime.execute({});
    assert.ok(Number.isFinite(Date.parse(timestamp)));
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("built-in repo skills are available and project skills can override them", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-tools-builtins-"));

  try {
    const config = createConfig(projectDir);
    await mkdir(config.skillsDir, { recursive: true });
    await writeFile(
      path.join(config.skillsDir, "daily_summary.md"),
      "# Project Daily Summary\n\nProject override for the built-in skill.\n",
      "utf8",
    );

    const tools = createTools(config);
    const listSkills = tools.find((tool) => tool.name === "list_skills");
    const readSkill = tools.find((tool) => tool.name === "read_skill");

    assert.ok(listSkills);
    assert.ok(readSkill);

    const skills = await listSkills.execute({});
    assert.match(skills, /agent_operator/u);
    assert.match(skills, /inbox_triage/u);

    const dailySummary = await readSkill.execute({ name: "daily_summary" });
    assert.match(dailySummary, /Project Daily Summary/u);
    assert.doesNotMatch(dailySummary, /^# Daily Summary$/mu);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("harness-backed tools can inspect chats, agents, and tasks", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-tools-harness-"));

  try {
    const harness = Harness.load(projectDir);
    await harness.prompt("hello from default");
    await harness.promptChat("branch-a", "hello from branch");
    await harness.createAgent({
      name: "planner",
      prompt: "Plan the work",
    });
    const task = await harness.createTask({
      title: "Daily Brief",
      prompt: "Send the brief",
      runAt: "2026-04-05T09:00:00-07:00",
    });

    const tools = harness.listTools();
    const listChats = tools.find((tool) => tool.name === "list_chats");
    const showChat = tools.find((tool) => tool.name === "show_chat");
    const listAgents = tools.find((tool) => tool.name === "list_agents");
    const showAgent = tools.find((tool) => tool.name === "show_agent");
    const listTasks = tools.find((tool) => tool.name === "list_tasks");
    const showTask = tools.find((tool) => tool.name === "show_task");

    assert.ok(listChats);
    assert.ok(showChat);
    assert.ok(listAgents);
    assert.ok(showAgent);
    assert.ok(listTasks);
    assert.ok(showTask);
    assert.equal(listChats.permission, "read");
    assert.equal(showAgent.permission, "read");
    assert.equal(showTask.permission, "read");

    assert.match(await listChats.execute({}), /default/u);
    assert.match(await listChats.execute({}), /branch-a/u);
    assert.match(await showChat.execute({ chatId: "branch-a" }), /^id: branch-a$/mu);
    assert.match(await listAgents.execute({}), /planner: /u);
    assert.match(await showAgent.execute({ agent: "planner" }), /^name: planner$/mu);
    assert.match(await listTasks.execute({}), /Daily Brief/u);
    assert.match(await showTask.execute({ taskId: task.id }), new RegExp(`^id: ${task.id}$`, "mu"));
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("harness-backed act tools can create agents and tasks when enabled", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-tools-act-"));
  let harness: Harness | undefined;

  try {
    harness = Harness.load(projectDir);
    await harness.initProject({
      model: "dummy/test-model",
      tools: ["read", "act"],
    });

    const tools = harness.listTools();
    const createAgent = tools.find((tool) => tool.name === "create_agent");
    const createTask = tools.find((tool) => tool.name === "create_task");

    assert.ok(createAgent);
    assert.ok(createTask);
    assert.equal(createAgent.permission, "act");
    assert.equal(createTask.permission, "act");

    const agentReply = await createAgent.execute({
      name: "planner",
      prompt: "Plan the work",
      maxSteps: 3,
    });
    const taskReply = await createTask.execute({
      title: "Daily Brief",
      prompt: "Send the brief",
      when: "once tomorrow",
    });

    assert.match(agentReply, /^started agent: planner \(agent_/u);
    assert.match(taskReply, /^scheduled task: task_/u);

    const agent = harness.findAgent("planner");
    assert.ok(agent);
    assert.equal(agent.maxSteps, 3);
    assert.notEqual(agent.chatId, harness.getCurrentChatId());
    assert.equal(agent.chatId, agent.id);
    assert.equal(agent.sourceChatId, "default");
    assert.equal(agent.createdBy, "tool");

    const tasks = await harness.listCurrentChatTasks();
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0]?.title, "Daily Brief");
    assert.equal(tasks[0]?.sourceChatId, "default");
    assert.equal(tasks[0]?.createdBy, "tool");
  } finally {
    harness?.cancelAgent("planner");
    harness?.teardown();
    await new Promise((resolve) => setTimeout(resolve, 10));
    await rm(projectDir, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
    const findFiles = tools.find((tool) => tool.name === "find_files");

    assert.ok(listSkills);
    assert.ok(readSkill);
    assert.ok(getTime);
    assert.ok(findFiles);
    assert.equal(listSkills.permission, "read");
    assert.equal(readSkill.permission, "read");
    assert.equal(getTime.permission, "read");
    assert.equal(findFiles.permission, "read");

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
    await harness.sendAgentInboxMessage({
      agentRef: "planner",
      text: "Please review the latest plan",
      sourceType: "user",
      sourceId: "alex",
      sourceName: "Alex",
      sourceChatId: "default",
    });
    const task = await harness.createTask({
      title: "Daily Brief",
      prompt: "Send the brief",
      runAt: "2026-04-05T09:00:00-07:00",
    });

    const tools = harness.listTools();
    const listTools = tools.find((tool) => tool.name === "list_tools");
    const listChats = tools.find((tool) => tool.name === "list_chats");
    const listChannels = tools.find((tool) => tool.name === "list_channels");
    const showChat = tools.find((tool) => tool.name === "show_chat");
    const readChat = tools.find((tool) => tool.name === "read_chat");
    const listAgents = tools.find((tool) => tool.name === "list_agents");
    const showAgent = tools.find((tool) => tool.name === "show_agent");
    const readAgentInbox = tools.find((tool) => tool.name === "read_agent_inbox");
    const readAgentMemory = tools.find((tool) => tool.name === "read_agent_memory");
    const listTasks = tools.find((tool) => tool.name === "list_tasks");
    const showTask = tools.find((tool) => tool.name === "show_task");

    assert.ok(listTools);
    assert.ok(listChats);
    assert.ok(listChannels);
    assert.ok(showChat);
    assert.ok(readChat);
    assert.ok(listAgents);
    assert.ok(showAgent);
    assert.ok(readAgentInbox);
    assert.ok(readAgentMemory);
    assert.ok(listTasks);
    assert.ok(showTask);
    assert.equal(listTools.permission, "read");
    assert.equal(listChats.permission, "read");
    assert.equal(listChannels.permission, "read");
    assert.equal(readChat.permission, "read");
    assert.equal(showAgent.permission, "read");
    assert.equal(readAgentInbox.permission, "read");
    assert.equal(readAgentMemory.permission, "read");
    assert.equal(showTask.permission, "read");

    assert.match(await listTools.execute({}), /^Toolsets:$/mu);
    assert.match(await listTools.execute({}), /- maclaw: Built-in tools for chats, agents, tasks, and notifications\./u);
    assert.match(await listTools.execute({}), /list_chats \[read\]/u);
    assert.match(await listTools.execute({}), /list_channels \[read\]/u);
    assert.match(await listTools.execute({}), /read_chat \[read\]/u);
    assert.match(await listTools.execute({}), /show_agent \[read\]/u);
    assert.match(await listTools.execute({}), /read_agent_inbox \[read\]/u);
    assert.match(await listTools.execute({}), /read_agent_memory \[read\]/u);
    assert.match(await listChats.execute({}), /default/u);
    assert.match(await listChats.execute({}), /branch-a/u);
    assert.match(await listChannels.execute({}), /- inbox/u);
    assert.match(await listChannels.execute({}), /- origin/u);
    assert.match(await showChat.execute({ chatId: "branch-a" }), /^id: branch-a$/mu);
    assert.match(
      await readChat.execute({ chatId: "branch-a" }),
      /\[assistant\] No model provider configured\./u,
    );
    assert.match(await listAgents.execute({}), /planner: /u);
    assert.match(await showAgent.execute({ agent: "planner" }), /^name: planner$/mu);
    assert.match(await readAgentInbox.execute({ agent: "planner" }), /Please review the latest plan/u);
    assert.match(await readAgentInbox.execute({ agent: "planner" }), /from: user Alex/u);
    assert.equal(await harness.writeAgentMemory("planner", "Track follow-up questions."), true);
    assert.match(await readAgentMemory.execute({ agent: "planner" }), /Track follow-up questions\./u);
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
    const listTools = tools.find((tool) => tool.name === "list_tools");
    const createAgent = tools.find((tool) => tool.name === "create_agent");
    const sendAgentMessage = tools.find((tool) => tool.name === "send_agent_message");
    const writeAgentMemory = tools.find((tool) => tool.name === "write_agent_memory");
    const readAgentMemory = tools.find((tool) => tool.name === "read_agent_memory");
    const createTask = tools.find((tool) => tool.name === "create_task");
    const notify = tools.find((tool) => tool.name === "notify");

    assert.ok(listTools);
    assert.ok(createAgent);
    assert.ok(sendAgentMessage);
    assert.ok(writeAgentMemory);
    assert.ok(readAgentMemory);
    assert.ok(createTask);
    assert.ok(notify);
    assert.equal(createAgent.permission, "act");
    assert.equal(sendAgentMessage.permission, "act");
    assert.equal(writeAgentMemory.permission, "act");
    assert.equal(createTask.permission, "act");
    assert.equal(notify.permission, "act");
    assert.match(await listTools.execute({}), /^Toolsets:$/mu);
    assert.match(await listTools.execute({}), /- maclaw: Built-in tools for chats, agents, tasks, and notifications\./u);
    assert.match(await listTools.execute({}), /- skills: Local skill discovery and reading tools\./u);
    assert.match(await listTools.execute({}), /- time: Basic time and clock tools\./u);
    assert.match(await listTools.execute({}), /create_agent \[act\]/u);
    assert.match(await listTools.execute({}), /send_agent_message \[act\]/u);
    assert.match(await listTools.execute({}), /write_agent_memory \[act\]/u);
    assert.match(await listTools.execute({}), /create_task \[act\]/u);
    assert.match(await listTools.execute({}), /notify \[act\]/u);

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
    assert.deepEqual(agent.toolsets, undefined);
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
    assert.equal(tasks[0]?.createdByAgentId, undefined);

    const notifyReply = await notify.execute({
      text: "Daily brief is ready",
      channel: "inbox",
    });
    const inbox = await harness.listInbox();

    assert.equal(notifyReply, "saved notification to inbox");
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0]?.sourceType, "user");
    assert.equal(inbox[0]?.sourceChatId, "default");

    await harness.switchChat(agent.chatId);

    const childAgentReply = await createAgent.execute({
      name: "child-planner",
      prompt: "Plan a child task",
      toolsets: ["maclaw", "skills"],
    });
    const childTaskReply = await createTask.execute({
      title: "Child Brief",
      prompt: "Send the child brief",
      when: "once tomorrow",
    });

    assert.match(childAgentReply, /^started agent: child-planner \(agent_/u);
    assert.match(childTaskReply, /^scheduled task: task_/u);

    const childAgent = harness.findAgent("child-planner");
    assert.ok(childAgent);
    assert.deepEqual(childAgent.toolsets, ["maclaw", "skills"]);
    assert.equal(childAgent.sourceChatId, agent.chatId);
    assert.equal(childAgent.createdBy, "tool");
    assert.equal(childAgent.createdByAgentId, agent.id);

    const childTools = harness.resolveAgentTools(childAgent).map((tool) => tool.name);
    assert.equal(childTools.includes("list_tools"), true);
    assert.equal(childTools.includes("list_skills"), true);
    assert.equal(childTools.includes("get_time"), false);

    const childTasks = await harness.listCurrentChatTasks();
    assert.equal(childTasks.length, 1);
    assert.equal(childTasks[0]?.title, "Child Brief");
    assert.equal(childTasks[0]?.sourceChatId, agent.chatId);
    assert.equal(childTasks[0]?.createdBy, "tool");
    assert.equal(childTasks[0]?.createdByAgentId, agent.id);

    await harness.switchChat(childAgent.chatId);

    const writeMemoryReply = await writeAgentMemory.execute({
      text: "Child agent is ready to report back.",
    });
    const readMemoryReply = await readAgentMemory.execute({});

    const sendAgentMessageReply = await sendAgentMessage.execute({
      agent: "planner",
      text: "I finished the child plan",
    });
    const plannerInbox = await harness.listAgentInbox("planner");
    const childMessage = plannerInbox?.find((entry) => entry.text === "I finished the child plan");

    assert.equal(writeMemoryReply, `updated agent memory: ${childAgent.id}`);
    assert.equal(readMemoryReply, "Child agent is ready to report back.");
    assert.equal(sendAgentMessageReply, "sent message to agent: planner");
    assert.ok(childMessage);
    assert.equal(childMessage.sourceType, "agent");
    assert.equal(childMessage.sourceId, childAgent.id);
    assert.equal(childMessage.sourceName, childAgent.name);
    assert.equal(childMessage.sourceChatId, childAgent.chatId);
    assert.equal(childMessage.text, "I finished the child plan");

    const childNotifyReply = await notify.execute({
      text: "Child brief is ready",
      channel: "inbox",
    });
    const childInbox = await harness.listInbox();

    assert.equal(childNotifyReply, "saved notification to inbox");
    assert.equal(childInbox.length, 2);
    assert.equal(childInbox[1]?.sourceType, "agent");
    assert.equal(childInbox[1]?.sourceId, childAgent.id);
    assert.equal(childInbox[1]?.sourceName, childAgent.name);
    assert.equal(childInbox[1]?.sourceChatId, childAgent.chatId);
  } finally {
    harness?.cancelAgent("planner");
    harness?.cancelAgent("child-planner");
    await harness?.teardown();
    await new Promise((resolve) => setTimeout(resolve, 10));
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("rooted file tools read, write, and list within the project workspace", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-tools-files-"));

  try {
    const harness = Harness.load(projectDir);
    await harness.initProject({
      model: "dummy/test-model",
      tools: ["read", "dangerous"],
    });

    await mkdir(path.join(projectDir, "notes"), { recursive: true });
    await writeFile(path.join(projectDir, "notes", "todo.txt"), "alpha\n", "utf8");

    const tools = harness.listTools();
    const readFileTool = tools.find((tool) => tool.name === "read_file");
    const writeFileTool = tools.find((tool) => tool.name === "write_file");
    const listDirTool = tools.find((tool) => tool.name === "list_dir");
    const listTools = tools.find((tool) => tool.name === "list_tools");

    assert.ok(readFileTool);
    assert.ok(writeFileTool);
    assert.ok(listDirTool);
    assert.ok(listTools);
    assert.equal(readFileTool.permission, "dangerous");
    assert.equal(writeFileTool.permission, "dangerous");
    assert.equal(listDirTool.permission, "read");
    assert.equal(readFileTool.requiresReview, undefined);
    assert.equal(writeFileTool.requiresReview, undefined);
    assert.equal(listDirTool.requiresReview, undefined);
    assert.match(await listTools.execute({}), /- files: Workspace-scoped file inspection and editing tools\./u);
    assert.match(await listTools.execute({}), /read_file \[dangerous\]/u);

    assert.equal(await readFileTool.execute({ path: "notes/todo.txt" }), "alpha\n");
    assert.match(await listDirTool.execute({ path: "notes" }), /file todo\.txt/u);
    assert.doesNotMatch(await listDirTool.execute({}), /\.maclaw/u);
    assert.equal(
      await writeFileTool.execute({ path: "notes/out.txt", content: "beta\n" }),
      "wrote file: notes/out.txt",
    );
    assert.equal(await readFile(path.join(projectDir, "notes", "out.txt"), "utf8"), "beta\n");
    assert.equal(
      await writeFileTool.execute({ path: "notes/deep/out-2.txt", content: "gamma\n" }),
      "wrote file: notes/deep/out-2.txt",
    );
    assert.equal(
      await readFile(path.join(projectDir, "notes", "deep", "out-2.txt"), "utf8"),
      "gamma\n",
    );
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("rooted file tools reject paths outside the project workspace", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-tools-files-root-"));

  try {
    const harness = Harness.load(projectDir);
    await harness.initProject({
      model: "dummy/test-model",
      tools: ["read", "dangerous"],
    });

    const tools = harness.listTools();
    const readFileTool = tools.find((tool) => tool.name === "read_file");
    const writeFileTool = tools.find((tool) => tool.name === "write_file");
    const listDirTool = tools.find((tool) => tool.name === "list_dir");

    assert.ok(readFileTool);
    assert.ok(writeFileTool);
    assert.ok(listDirTool);

    await assert.rejects(
      readFileTool.execute({ path: "../secret.txt" }),
      /Path escapes the workspace root/u,
    );
    await assert.rejects(
      writeFileTool.execute({ path: "../../secret.txt", content: "nope" }),
      /Path escapes the workspace root/u,
    );
    await assert.rejects(
      listDirTool.execute({ path: "../" }),
      /Path escapes the workspace root/u,
    );
    await assert.rejects(
      readFileTool.execute({ path: ".maclaw/maclaw.json" }),
      /Path is reserved for maclaw metadata/u,
    );
    await assert.rejects(
      writeFileTool.execute({ path: ".maclaw/notes.txt", content: "nope" }),
      /Path is reserved for maclaw metadata/u,
    );
    await assert.rejects(
      listDirTool.execute({ path: ".maclaw" }),
      /Path is reserved for maclaw metadata/u,
    );
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("repo tools inspect the project workspace and exclude .maclaw", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-tools-repo-"));

  try {
    const harness = Harness.load(projectDir);
    await harness.initProject({
      model: "dummy/test-model",
      tools: ["read"],
    });

    await mkdir(path.join(projectDir, "src"), { recursive: true });
    await mkdir(path.join(projectDir, "notes"), { recursive: true });
    await writeFile(path.join(projectDir, "src", "main.ts"), "export const message = 'hello world';\n", "utf8");
    await writeFile(path.join(projectDir, "notes", "todo.md"), "# TODO\n\nremember hello world\n", "utf8");
    await writeFile(path.join(projectDir, ".maclaw", "secret.txt"), "do not show me\n", "utf8");

    const tools = harness.listTools();
    const listTools = tools.find((tool) => tool.name === "list_tools");
    const findFiles = tools.find((tool) => tool.name === "find_files");
    const searchFiles = tools.find((tool) => tool.name === "search_files");
    const readFiles = tools.find((tool) => tool.name === "read_files");
    const listDir = tools.find((tool) => tool.name === "list_dir");
    const tree = tools.find((tool) => tool.name === "tree");

    assert.ok(listTools);
    assert.ok(findFiles);
    assert.ok(searchFiles);
    assert.ok(readFiles);
    assert.ok(listDir);
    assert.ok(tree);
    assert.equal(findFiles.permission, "read");
    assert.equal(searchFiles.permission, "read");
    assert.equal(readFiles.permission, "read");
    assert.equal(listDir.permission, "read");
    assert.equal(tree.permission, "read");

    const toolsReply = await listTools.execute({});
    assert.match(toolsReply, /- files: Workspace-scoped file inspection and editing tools\./u);
    assert.match(toolsReply, /find_files \[read\]/u);
    assert.match(toolsReply, /search_files \[read\]/u);
    assert.match(toolsReply, /read_files \[read\]/u);
    assert.match(toolsReply, /list_dir \[read\]/u);
    assert.match(toolsReply, /tree \[read\]/u);
    assert.match(toolsReply, /output:/u);

    assert.match(await findFiles.execute({ query: "main" }), /src\/main\.ts/u);
    assert.doesNotMatch(await findFiles.execute({ query: "secret" }), /\.maclaw/u);
    assert.match(await searchFiles.execute({ query: "hello world" }), /src\/main\.ts:1:/u);
    assert.doesNotMatch(await searchFiles.execute({ query: "do not show me" }), /\.maclaw/u);
    assert.match(await readFiles.execute({ paths: ["src/main.ts", "notes/todo.md"] }), /==> src\/main\.ts <==/u);
    assert.match(await listDir.execute({}), /notes\//u);
    assert.match(await listDir.execute({}), /src\//u);
    const treeReply = await tree.execute({ maxDepth: 2 });
    assert.match(treeReply, /notes/u);
    assert.match(treeReply, /src/u);
    assert.doesNotMatch(treeReply, /\.maclaw/u);

    await assert.rejects(
      readFiles.execute({ paths: [".maclaw/secret.txt"] }),
      /Path is reserved for maclaw metadata/u,
    );
    await assert.rejects(
      tree.execute({ path: ".maclaw" }),
      /Path is reserved for maclaw metadata/u,
    );
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

test("shell tools run reviewed commands in the project workspace", async () => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), "maclaw-tools-shell-"));

  try {
    const harness = Harness.load(projectDir);
    await harness.initProject({
      model: "dummy/test-model",
      tools: ["read", "dangerous"],
    });

    const tools = harness.listTools();
    const runShell = tools.find((tool) => tool.name === "run_shell");
    const listTools = tools.find((tool) => tool.name === "list_tools");

    assert.ok(runShell);
    assert.ok(listTools);
    assert.equal(runShell.permission, "dangerous");
    assert.equal(runShell.requiresReview, true);
    assert.match(
      await listTools.execute({}),
      /- shell: Reviewed shell command tools for the current workspace\./u,
    );

    const reply = await runShell.execute({
      command: 'printf "hello from shell\\n"',
    });

    assert.match(reply, /^stdout:\nhello from shell$/u);
  } finally {
    await rm(projectDir, { recursive: true, force: true });
  }
});

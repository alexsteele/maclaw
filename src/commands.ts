import { Harness } from "./harness.js";
import { parseTaskSchedule } from "./task.js";
import type { AgentRecord, TaskSchedule } from "./types.js";

type DispatchOptions = {
  chatId?: string;
};

export const helpText = [
  "Commands:",
  "  /help              Show this help",
  "  /project           Project information commands",
  "  /chat              Chat management commands",
  "  /history           Show the current chat transcript",
  "  /skills            List local skills",
  "  /agent             Agent management commands",
  "  /task              Task scheduling commands",
].join("\n");

export const projectHelpText = [
  "Command: /project",
  "  /project           Show the active project",
  "  /project show      Show the active project",
  "  /project init      Create .maclaw/maclaw.json for this project",
].join("\n");

export const chatHelpText = [
  "Command: /chat",
  "  /chat              Show the current chat id",
  "  /chat list         List saved chats",
  "  /chat switch X     Switch to chat X",
  "  /chat fork [X]     Fork the current chat and switch to it",
].join("\n");

export const taskHelpText = [
  "Command: /task",
  "  /task list",
  "  /task schedule once 4/5/2026 9:00 AM | <title> | <prompt>",
  "  /task schedule hourly | <title> | <prompt>",
  "  /task schedule daily 9:00 AM | <title> | <prompt>",
  "  /task schedule weekly mon,wed,fri 5:30 PM | <title> | <prompt>",
  "  /task delete <task id>",
].join("\n");

export const agentHelpText = [
  "Command: /agent",
  "  /agent",
  "  /agent list",
  "  /agent create <name> | <prompt>",
  "  /agent show <agent id>",
  "  /agent stop <agent id>",
  "  /agent steer <agent id> | <prompt>",
].join("\n");

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "numeric",
  day: "numeric",
  year: "numeric",
});

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
});

const parseChatId = (value: string): string | null => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  return /^[A-Za-z0-9._-]+$/u.test(trimmed) ? trimmed : null;
};

const formatChatTimestamp = (value: string): string => {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return value;
  }

  const now = new Date();
  const isToday =
    timestamp.getFullYear() === now.getFullYear() &&
    timestamp.getMonth() === now.getMonth() &&
    timestamp.getDate() === now.getDate();

  return isToday ? timeFormatter.format(timestamp) : dateFormatter.format(timestamp);
};

const padCell = (value: string, width: number): string => value.padEnd(width, " ");

const formatTaskTimestamp = (value: string): string => {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return value;
  }

  const now = new Date();
  const isToday =
    timestamp.getFullYear() === now.getFullYear() &&
    timestamp.getMonth() === now.getMonth() &&
    timestamp.getDate() === now.getDate();

  return isToday
    ? timeFormatter.format(timestamp)
    : `${dateFormatter.format(timestamp)} ${timeFormatter.format(timestamp)}`;
};

const formatSchedule = (schedule: TaskSchedule): string => {
  const renderTime = (hour: number, minute: number): string => {
    const date = new Date();
    date.setHours(hour, minute, 0, 0);
    return timeFormatter.format(date);
  };

  switch (schedule.type) {
    case "once":
      return "once";
    case "hourly":
      return `hourly @ :${String(schedule.minute).padStart(2, "0")}`;
    case "daily":
      return `daily ${renderTime(schedule.hour, schedule.minute)}`;
    case "weekly":
      return `${schedule.days.join(",")} ${renderTime(schedule.hour, schedule.minute)}`;
  }
};

const renderTaskList = async (
  tasks: Awaited<ReturnType<Harness["listTasks"]>>,
): Promise<string> => {
  if (tasks.length === 0) {
    return "No scheduled tasks.";
  }

  const rows = tasks.map((task) => ({
    id: task.id,
    title: task.title,
    status: task.status,
    nextRunAt: formatTaskTimestamp(task.nextRunAt),
    schedule: formatSchedule(task.schedule),
  }));

  const idWidth = Math.max("id".length, ...rows.map((row) => row.id.length));
  const titleWidth = Math.max("title".length, ...rows.map((row) => row.title.length));
  const statusWidth = Math.max("status".length, ...rows.map((row) => row.status.length));
  const nextRunWidth = Math.max("next run".length, ...rows.map((row) => row.nextRunAt.length));
  const scheduleWidth = Math.max("schedule".length, ...rows.map((row) => row.schedule.length));

  const header = [
    padCell("id", idWidth),
    padCell("title", titleWidth),
    padCell("status", statusWidth),
    padCell("next run", nextRunWidth),
    padCell("schedule", scheduleWidth),
  ].join("  ");

  const separator = [
    "-".repeat(idWidth),
    "-".repeat(titleWidth),
    "-".repeat(statusWidth),
    "-".repeat(nextRunWidth),
    "-".repeat(scheduleWidth),
  ].join("  ");

  const lines = rows.map((row) =>
    [
      padCell(row.id, idWidth),
      padCell(row.title, titleWidth),
      padCell(row.status, statusWidth),
      padCell(row.nextRunAt, nextRunWidth),
      padCell(row.schedule, scheduleWidth),
    ].join("  "),
  );

  return [header, separator, ...lines].join("\n");
};

const renderAgentList = (agents: AgentRecord[]): string => {
  if (agents.length === 0) {
    return "No agents.";
  }

  const rows = agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    status: agent.status,
    steps:
      agent.maxSteps === undefined
        ? `${agent.stepCount}`
        : `${agent.stepCount}/${agent.maxSteps}`,
    chat: agent.chatId,
  }));

  const idWidth = Math.max("id".length, ...rows.map((row) => row.id.length));
  const nameWidth = Math.max("name".length, ...rows.map((row) => row.name.length));
  const statusWidth = Math.max("status".length, ...rows.map((row) => row.status.length));
  const stepsWidth = Math.max("steps".length, ...rows.map((row) => row.steps.length));
  const chatWidth = Math.max("chat".length, ...rows.map((row) => row.chat.length));

  const header = [
    padCell("id", idWidth),
    padCell("name", nameWidth),
    padCell("status", statusWidth),
    padCell("steps", stepsWidth),
    padCell("chat", chatWidth),
  ].join("  ");

  const separator = [
    "-".repeat(idWidth),
    "-".repeat(nameWidth),
    "-".repeat(statusWidth),
    "-".repeat(stepsWidth),
    "-".repeat(chatWidth),
  ].join("  ");

  const lines = rows.map((row) =>
    [
      padCell(row.id, idWidth),
      padCell(row.name, nameWidth),
      padCell(row.status, statusWidth),
      padCell(row.steps, stepsWidth),
      padCell(row.chat, chatWidth),
    ].join("  "),
  );

  return [header, separator, ...lines].join("\n");
};

const renderAgentInfo = (agent: AgentRecord): string =>
  [
    `id: ${agent.id}`,
    `name: ${agent.name}`,
    `status: ${agent.status}`,
    `chatId: ${agent.chatId}`,
    `steps: ${
      agent.maxSteps === undefined
        ? `${agent.stepCount}`
        : `${agent.stepCount}/${agent.maxSteps}`
    }`,
    `timeoutMs: ${agent.timeoutMs}`,
    `createdAt: ${agent.createdAt}`,
    `startedAt: ${agent.startedAt ?? "(not started)"}`,
    `finishedAt: ${agent.finishedAt ?? "(not finished)"}`,
    `lastError: ${agent.lastError ?? "(none)"}`,
  ].join("\n");

const renderProjectInfo = (harness: Harness, currentChatId: string): string => {
  const projectConfig = harness.config;
  const isProjectInitialized = harness.isProjectInitialized();
  return [
    `name: ${projectConfig.name}`,
    `initialized: ${isProjectInitialized ? "yes" : "no"}`,
    `createdAt: ${projectConfig.createdAt ?? "(not set)"}`,
    `folder: ${projectConfig.projectFolder}`,
    `config: ${isProjectInitialized ? projectConfig.projectConfigFile : "(not set)"}`,
    `provider: ${projectConfig.provider}`,
    `model: ${projectConfig.model}`,
    `retentionDays: ${projectConfig.retentionDays}`,
    `currentChat: ${currentChatId}`,
    `skillsDir: ${projectConfig.skillsDir}`,
  ].join("\n");
};

const renderChatList = (
  chats: Awaited<ReturnType<Harness["listChats"]>>,
  currentChatId: string,
): string => {
  if (chats.length === 0) {
    return "No saved chats.";
  }

  const rows = chats.map((chat) => ({
    marker: chat.id === currentChatId ? "*" : " ",
    id: chat.id,
    messages: String(chat.messageCount),
    created: formatChatTimestamp(chat.createdAt),
    lastActivity: formatChatTimestamp(chat.updatedAt),
  }));

  const markerWidth = 1;
  const idWidth = Math.max("chat".length, ...rows.map((row) => row.id.length));
  const messagesWidth = Math.max("messages".length, ...rows.map((row) => row.messages.length));
  const createdWidth = Math.max("created".length, ...rows.map((row) => row.created.length));
  const activityWidth = Math.max(
    "last activity".length,
    ...rows.map((row) => row.lastActivity.length),
  );

  const header = [
    padCell("", markerWidth),
    padCell("chat", idWidth),
    padCell("messages", messagesWidth),
    padCell("created", createdWidth),
    padCell("last activity", activityWidth),
  ].join("  ");

  const separator = [
    "-".repeat(markerWidth),
    "-".repeat(idWidth),
    "-".repeat(messagesWidth),
    "-".repeat(createdWidth),
    "-".repeat(activityWidth),
  ].join("  ");

  const lines = rows.map((row) =>
    [
      padCell(row.marker, markerWidth),
      padCell(row.id, idWidth),
      padCell(row.messages, messagesWidth),
      padCell(row.created, createdWidth),
      padCell(row.lastActivity, activityWidth),
    ].join("  "),
  );

  return [header, separator, ...lines].join("\n");
};

const getScopedChatId = (harness: Harness, options?: DispatchOptions): string =>
  options?.chatId ?? harness.getCurrentChatId();

// Parses user input and dispatches it to a project.
export const dispatchCommand = async (
  harness: Harness,
  input: string,
  options: DispatchOptions = {},
): Promise<string | null> => {
  if (input === "/help") {
    return helpText;
  }

  if (input === "/help project") {
    return projectHelpText;
  }

  if (input === "/help chat") {
    return chatHelpText;
  }

  if (input === "/help task") {
    return taskHelpText;
  }

  if (input === "/help agent") {
    return agentHelpText;
  }

  if (input === "/project" || input === "/project show") {
    return renderProjectInfo(harness, getScopedChatId(harness, options));
  }

  if (input === "/project init") {
    if (harness.isProjectInitialized()) {
      return `project already initialized: ${harness.config.projectConfigFile}`;
    }

    await harness.initProject();
    return (
      `initialized project: ${harness.config.projectConfigFile}\n` +
      `current chat: ${harness.getCurrentChatId()}\n` +
      "switched this REPL into persistent project mode"
    );
  }

  if (input === "/chat") {
    return getScopedChatId(harness, options);
  }

  if (input === "/chat list") {
    return renderChatList(await harness.listChats(), getScopedChatId(harness, options));
  }

  if (input.startsWith("/chat switch ")) {
    if (options.chatId) {
      return "/chat switch is not supported in this channel yet.";
    }

    const requestedId = parseChatId(input.slice("/chat switch ".length));
    if (!requestedId) {
      return "Chat ids may only contain letters, numbers, dots, underscores, and hyphens.";
    }

    const chat = await harness.switchChat(requestedId);
    return `switched to chat: ${chat.id}`;
  }

  if (input === "/chat fork" || input.startsWith("/chat fork ")) {
    if (options.chatId) {
      return "/chat fork is not supported in this channel yet.";
    }

    const result = await harness.forkChat(input.slice("/chat fork".length).trim());
    if (result.error) {
      return result.error;
    }
    if (!result.chat) {
      return "Could not fork chat.";
    }

    return `forked current chat to: ${result.chat.id}`;
  }

  if (input.startsWith("/chat")) {
    return chatHelpText;
  }

  if (input === "/task") {
    return taskHelpText;
  }

  if (input === "/task list") {
    return renderTaskList(await harness.listTasks(getScopedChatId(harness, options)));
  }

  if (input.startsWith("/task schedule ")) {
    const parsed = parseTaskSchedule(input.slice("/task schedule ".length).trim());
    if (!parsed) {
      return (
        "Usage: /task schedule once 4/5/2026 9:00 AM | <title> | <prompt>\n" +
        "       /task schedule hourly | <title> | <prompt>\n" +
        "       /task schedule daily 9:00 AM | <title> | <prompt>\n" +
        "       /task schedule weekly mon,wed,fri 5:30 PM | <title> | <prompt>"
      );
    }

    const task = await harness.createTask({
      chatId: getScopedChatId(harness, options),
      title: parsed.title,
      prompt: parsed.prompt,
      schedule: parsed.schedule,
    });

    return `scheduled task: ${task.id}`;
  }

  if (input.startsWith("/task delete ")) {
    const taskId = input.slice("/task delete ".length).trim();
    if (taskId.length === 0) {
      return "Usage: /task delete <task id>";
    }

    const deleted = await harness.deleteTask(taskId, getScopedChatId(harness, options));
    return deleted ? `deleted task: ${taskId}` : `task not found: ${taskId}`;
  }

  if (input.startsWith("/task")) {
    return taskHelpText;
  }

  if (input === "/agent") {
    return agentHelpText;
  }

  if (input === "/agent list") {
    return renderAgentList(harness.listAgents());
  }

  if (input.startsWith("/agent create ")) {
    const body = input.slice("/agent create ".length).trim();
    const separatorIndex = body.indexOf("|");
    if (separatorIndex < 0) {
      return "Usage: /agent create <name> | <prompt>";
    }

    const name = body.slice(0, separatorIndex).trim();
    const prompt = body.slice(separatorIndex + 1).trim();
    if (name.length === 0 || prompt.length === 0) {
      return "Usage: /agent create <name> | <prompt>";
    }

    const agent = harness.createAgent({
      name,
      prompt,
      chatId: getScopedChatId(harness, options),
    });
    return `started agent: ${agent.id}`;
  }

  if (input.startsWith("/agent show ")) {
    const agentId = input.slice("/agent show ".length).trim();
    if (agentId.length === 0) {
      return "Usage: /agent show <agent id>";
    }

    const agent = harness.getAgent(agentId);
    return agent ? renderAgentInfo(agent) : `agent not found: ${agentId}`;
  }

  if (input.startsWith("/agent stop ")) {
    const agentId = input.slice("/agent stop ".length).trim();
    if (agentId.length === 0) {
      return "Usage: /agent stop <agent id>";
    }

    const agent = harness.cancelAgent(agentId);
    return agent ? `stopped agent: ${agentId}` : `agent not found: ${agentId}`;
  }

  if (input.startsWith("/agent steer ")) {
    const body = input.slice("/agent steer ".length).trim();
    const separatorIndex = body.indexOf("|");
    if (separatorIndex < 0) {
      return "Usage: /agent steer <agent id> | <prompt>";
    }

    const agentId = body.slice(0, separatorIndex).trim();
    const prompt = body.slice(separatorIndex + 1).trim();
    if (agentId.length === 0 || prompt.length === 0) {
      return "Usage: /agent steer <agent id> | <prompt>";
    }

    const agent = harness.steerAgent(agentId, prompt);
    return agent ? `steered agent: ${agentId}` : `agent not found: ${agentId}`;
  }

  if (input.startsWith("/agent")) {
    return agentHelpText;
  }

  if (input === "/skills") {
    const skills = await harness.listSkills();
    return skills.length === 0
      ? "No skills found."
      : skills.map((skill) => `- ${skill.name}: ${skill.description}`).join("\n");
  }

  if (input === "/history") {
    return harness.getChatTranscript(options.chatId);
  }

  return null;
};

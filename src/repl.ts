import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { Harness, type ProjectInfo } from "./harness.js";
import { parseTaskSchedule } from "./task.js";
import type { TaskSchedule } from "./types.js";

const helpText = [
  "Commands:",
  "  /help              Show this help",
  "  /project           Project information commands",
  "  /chat              Chat management commands",
  "  /history           Show the current session transcript",
  "  /skills            List local skills",
  "  /task              Task scheduling commands",
  "  /quit              Exit the REPL",
].join("\n");

const projectHelpText = [
  "Command: /project",
  "  /project           Show the active project",
  "  /project show      Show the active project",
  "  /project init      Create .maclaw/maclaw.json for this project",
].join("\n");

const chatHelpText = [
  "Command: /chat",
  "  /chat              Show the current chat id",
  "  /chat list         List saved chats",
  "  /chat switch X     Switch to chat X",
  "  /chat fork [X]     Fork the current chat and switch to it",
].join("\n");

const taskHelpText = [
  "Command: /task",
  "  /task list",
  "  /task schedule once 4/5/2026 9:00 AM | <title> | <prompt>",
  "  /task schedule hourly | <title> | <prompt>",
  "  /task schedule daily 9:00 AM | <title> | <prompt>",
  "  /task schedule weekly mon,wed,fri 5:30 PM | <title> | <prompt>",
  "  /task delete <task id>",
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

const parseSessionId = (value: string): string | null => {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  return /^[A-Za-z0-9._-]+$/u.test(trimmed) ? trimmed : null;
};

const buildForkSessionId = async (
  harness: Harness,
  requestedId?: string,
): Promise<string | null> => {
  if (requestedId && requestedId.trim().length > 0) {
    return parseSessionId(requestedId);
  }

  const baseId = `${harness.getCurrentChatId()}-fork`;
  const existingIds = new Set((await harness.listChats()).map((session) => session.id));
  if (!existingIds.has(baseId)) {
    return baseId;
  }

  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${baseId}-${index}`;
    if (!existingIds.has(candidate)) {
      return candidate;
    }
  }

  return null;
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

const renderTaskList = async (tasks: Awaited<ReturnType<Harness["listCurrentChatTasks"]>>): Promise<string> => {
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

const renderProjectInfo = (projectInfo: ProjectInfo): string => {
  return [
    `name: ${projectInfo.name}`,
    `initialized: ${projectInfo.initialized ? "yes" : "no"}`,
    `createdAt: ${projectInfo.createdAt ?? "(not set)"}`,
    `folder: ${projectInfo.folder}`,
    `config: ${projectInfo.configFile ?? "(not set)"}`,
    `provider: ${projectInfo.provider}`,
    `model: ${projectInfo.model}`,
    `retentionDays: ${projectInfo.retentionDays}`,
    `currentChat: ${projectInfo.currentChat}`,
    `skillsDir: ${projectInfo.skillsDir}`,
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
  const messagesWidth = Math.max(
    "messages".length,
    ...rows.map((row) => row.messages.length),
  );
  const createdWidth = Math.max(
    "created".length,
    ...rows.map((row) => row.created.length),
  );
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

class Repl {
  private readonly rl = readline.createInterface({ input, output });
  private harness: Harness;

  constructor(harness: Harness) {
    this.harness = harness;
  }

  async run(): Promise<void> {
    this.harness.start(async (task, message) => {
      output.write(`\n[scheduled:${task.title}] ${message.content}\n\n> `);
    });
    this.showStartup();

    while (true) {
      const line = (await this.rl.question("> ")).trim();
      if (line.length === 0) {
        continue;
      }

      const shouldExit = await this.handleLine(line);
      if (shouldExit) {
        this.harness.teardown();
        this.rl.close();
        break;
      }
    }
  }

  private showStartup(): void {
    output.write("maclaw REPL\n");
    output.write(`chat: ${this.harness.getCurrentChatId()}\n`);
    if (!this.harness.config.isProjectInitialized) {
      output.write("warning: running without a project config; chats, tasks, and logs will not be saved\n");
    }
    output.write("type /help for commands\n\n");
  }

  private writeLine(text: string): void {
    output.write(`${text}\n\n`);
  }

  private async handleLine(line: string): Promise<boolean> {
    if (line === "/quit") {
      return true;
    }

    if (line === "/help") {
      this.writeLine(helpText);
      return false;
    }

    if (line === "/help project") {
      this.writeLine(projectHelpText);
      return false;
    }

    if (line === "/help chat") {
      this.writeLine(chatHelpText);
      return false;
    }

    if (line === "/help task") {
      this.writeLine(taskHelpText);
      return false;
    }

    if (line === "/chat") {
      this.writeLine(this.harness.getCurrentChatId());
      return false;
    }

    if (line.startsWith("/project")) {
      await this.handleProjectCommand(line);
      return false;
    }

    if (line.startsWith("/chat")) {
      await this.handleChatCommand(line);
      return false;
    }

    if (line.startsWith("/task")) {
      await this.handleTaskCommand(line);
      return false;
    }

    if (line === "/skills") {
      const skills = await this.harness.listSkills();
      this.writeLine(
        skills.length === 0
          ? "No skills found."
          : skills.map((skill) => `- ${skill.name}: ${skill.description}`).join("\n"),
      );
      return false;
    }

    if (line === "/history") {
      this.writeLine(await this.harness.getCurrentChatTranscript());
      return false;
    }

    const reply = await this.harness.handleUserInput(line);
    this.writeLine(reply.content);
    return false;
  }

  private async handleProjectCommand(line: string): Promise<void> {
    if (line === "/project" || line === "/project show") {
      this.writeLine(renderProjectInfo(this.harness.getProjectInfo()));
      return;
    }

    if (line === "/project init") {
      if (this.harness.config.isProjectInitialized) {
        this.writeLine(`project already initialized: ${this.harness.config.projectConfigFile}`);
        return;
      }

      const nextHarness = await this.harness.initProject();
      this.harness = nextHarness;
      this.writeLine(
        `initialized project: ${this.harness.config.projectConfigFile}\n` +
          `current chat: ${this.harness.getCurrentChatId()}\n` +
          "switched this REPL into persistent project mode",
      );
      return;
    }

    this.writeLine(projectHelpText);
  }

  private async handleChatCommand(line: string): Promise<void> {
    if (line === "/chat list") {
      this.writeLine(
        renderChatList(await this.harness.listChats(), this.harness.getCurrentChatId()),
      );
      return;
    }

    if (line.startsWith("/chat switch ")) {
      const requestedId = parseSessionId(line.slice("/chat switch ".length));
      if (!requestedId) {
        this.writeLine("Chat ids may only contain letters, numbers, dots, underscores, and hyphens.");
        return;
      }

      const session = await this.harness.switchChat(requestedId);
      this.writeLine(`switched to chat: ${session.id}`);
      return;
    }

    if (line === "/chat fork" || line.startsWith("/chat fork ")) {
      const requestedId = await buildForkSessionId(
        this.harness,
        line.slice("/chat fork".length).trim(),
      );
      if (!requestedId) {
        this.writeLine("Could not create a valid chat id for the fork.");
        return;
      }

      const existingSessions = await this.harness.listChats();
      if (existingSessions.some((session) => session.id === requestedId)) {
        this.writeLine(`chat already exists: ${requestedId}`);
        return;
      }

      const session = await this.harness.forkChat(requestedId);
      this.writeLine(`forked current chat to: ${session.id}`);
      return;
    }

    this.writeLine(chatHelpText);
  }

  private async handleTaskCommand(line: string): Promise<void> {
    if (line === "/task") {
      this.writeLine(taskHelpText);
      return;
    }

    if (line === "/task list") {
      this.writeLine(await renderTaskList(await this.harness.listCurrentChatTasks()));
      return;
    }

    if (line.startsWith("/task schedule ")) {
      const parsed = parseTaskSchedule(line.slice("/task schedule ".length).trim());
      if (!parsed) {
        this.writeLine(
          "Usage: /task schedule once 4/5/2026 9:00 AM | <title> | <prompt>\n" +
            "       /task schedule hourly | <title> | <prompt>\n" +
            "       /task schedule daily 9:00 AM | <title> | <prompt>\n" +
            "       /task schedule weekly mon,wed,fri 5:30 PM | <title> | <prompt>",
        );
        return;
      }

      const task = await this.harness.createTaskForCurrentChat({
        title: parsed.title,
        prompt: parsed.prompt,
        schedule: parsed.schedule,
      });

      this.writeLine(`scheduled task: ${task.id}`);
      return;
    }

    if (line.startsWith("/task delete ")) {
      const taskId = line.slice("/task delete ".length).trim();
      if (taskId.length === 0) {
        this.writeLine("Usage: /task delete <task id>");
        return;
      }

      const deleted = await this.harness.deleteTaskForCurrentChat(taskId);
      this.writeLine(deleted ? `deleted task: ${taskId}` : `task not found: ${taskId}`);
      return;
    }

    this.writeLine(taskHelpText);
  }
}

export const runRepl = async (
  harness: Harness,
): Promise<void> => {
  const repl = new Repl(harness);
  await repl.run();
};

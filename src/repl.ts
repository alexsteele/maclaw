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


export const runRepl = async (
  controls: {
    getHarness: () => Harness;
    setHarness: (harness: Harness) => void;
  },
): Promise<void> => {
  const rl = readline.createInterface({ input, output });
  let harness = controls.getHarness();

  output.write("maclaw REPL\n");
  output.write(`chat: ${harness.getCurrentChatId()}\n`);
  if (!harness.config.isProjectInitialized) {
    output.write("warning: running without a project config; chats, tasks, and logs will not be saved\n");
  }
  output.write("type /help for commands\n\n");

  while (true) {
    const line = (await rl.question("> ")).trim();
    if (line.length === 0) {
      continue;
    }

    if (line === "/quit") {
      rl.close();
      break;
    }

    if (line === "/help") {
      output.write(`${helpText}\n\n`);
      continue;
    }

    if (line === "/help project") {
      output.write(`${projectHelpText}\n\n`);
      continue;
    }

    if (line === "/help chat") {
      output.write(`${chatHelpText}\n\n`);
      continue;
    }

    if (line === "/help task") {
      output.write(`${taskHelpText}\n\n`);
      continue;
    }

    if (line === "/chat") {
      output.write(`${harness.getCurrentChatId()}\n\n`);
      continue;
    }

    if (line === "/project" || line === "/project show") {
      output.write(`${renderProjectInfo(harness.getProjectInfo())}\n\n`);
      continue;
    }

    if (line === "/project init") {
      if (harness.config.isProjectInitialized) {
        output.write(`project already initialized: ${harness.config.projectConfigFile}\n\n`);
        continue;
      }

      harness = await harness.initializeProject();
      controls.setHarness(harness);

      output.write(
        `initialized project: ${harness.config.projectConfigFile}\n` +
          `current chat: ${harness.getCurrentChatId()}\n` +
          "switched this REPL into persistent project mode\n\n",
      );
      continue;
    }

    if (line === "/chat list") {
      const sessions = await harness.listChats();
      const rendered =
        sessions.length === 0
          ? "No saved chats."
          : (() => {
              const rows = sessions.map((session) => ({
                marker: session.id === harness.getCurrentChatId() ? "*" : " ",
                id: session.id,
                messages: String(session.messageCount),
                created: formatChatTimestamp(session.createdAt),
                lastActivity: formatChatTimestamp(session.updatedAt),
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
            })();

      output.write(`${rendered}\n\n`);
      continue;
    }

    if (line.startsWith("/chat switch ")) {
      const requestedId = parseSessionId(line.slice("/chat switch ".length));
      if (!requestedId) {
        output.write("Chat ids may only contain letters, numbers, dots, underscores, and hyphens.\n\n");
        continue;
      }

      const session = await harness.switchChat(requestedId);
      output.write(`switched to chat: ${session.id}\n\n`);
      continue;
    }

    if (line === "/chat fork" || line.startsWith("/chat fork ")) {
      const requestedId = await buildForkSessionId(
        harness,
        line.slice("/chat fork".length).trim(),
      );
      if (!requestedId) {
        output.write("Could not create a valid chat id for the fork.\n\n");
        continue;
      }

      const existingSessions = await harness.listChats();
      if (existingSessions.some((session) => session.id === requestedId)) {
        output.write(`chat already exists: ${requestedId}\n\n`);
        continue;
      }

      const session = await harness.forkChat(requestedId);
      output.write(`forked current chat to: ${session.id}\n\n`);
      continue;
    }

    if (line === "/task") {
      output.write(`${taskHelpText}\n\n`);
      continue;
    }

    if (line === "/task list") {
      const rendered = await renderTaskList(await harness.listCurrentChatTasks());
      output.write(`${rendered}\n\n`);
      continue;
    }

    if (line.startsWith("/task schedule ")) {
      const parsed = parseTaskSchedule(line.slice("/task schedule ".length).trim());
      if (!parsed) {
        output.write(
          "Usage: /task schedule once 4/5/2026 9:00 AM | <title> | <prompt>\n" +
            "       /task schedule hourly | <title> | <prompt>\n" +
            "       /task schedule daily 9:00 AM | <title> | <prompt>\n" +
            "       /task schedule weekly mon,wed,fri 5:30 PM | <title> | <prompt>\n\n",
        );
        continue;
      }

      const task = await harness.createTaskForCurrentChat({
        title: parsed.title,
        prompt: parsed.prompt,
        schedule: parsed.schedule,
      });

      output.write(`scheduled task: ${task.id}\n\n`);
      continue;
    }

    if (line.startsWith("/task delete ")) {
      const taskId = line.slice("/task delete ".length).trim();
      if (taskId.length === 0) {
        output.write("Usage: /task delete <task id>\n\n");
        continue;
      }

      const deleted = await harness.deleteTaskForCurrentChat(taskId);
      output.write(deleted ? `deleted task: ${taskId}\n\n` : `task not found: ${taskId}\n\n`);
      continue;
    }

    if (line === "/skills") {
      const skills = await harness.listSkills();
      output.write(
        skills.length === 0
          ? "No skills found.\n\n"
          : `${skills.map((skill) => `- ${skill.name}: ${skill.description}`).join("\n")}\n\n`,
      );
      continue;
    }

    if (line === "/history") {
      output.write(`${await harness.getCurrentChatTranscript()}\n\n`);
      continue;
    }

    const reply = await harness.handleUserInput(line);
    output.write(`${reply.content}\n\n`);
  }
};

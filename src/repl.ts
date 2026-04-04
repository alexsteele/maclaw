import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { AppConfig } from "./config.js";
import type { SessionStore } from "./sessions.js";
import { loadSkills } from "./skills.js";
import { MaclawAgent } from "./agent.js";
import { TaskScheduler } from "./scheduler.js";
import type { TaskSchedule, Weekday } from "./types.js";

const helpText = [
  "Commands:",
  "  /help              Show this help",
  "  /chat              Chat management commands",
  "  /task              Task scheduling commands",
  "  /skills            List local skills",
  "  /history           Show the current session transcript",
  "  /quit              Exit the REPL",
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
  agent: MaclawAgent,
  requestedId?: string,
): Promise<string | null> => {
  if (requestedId && requestedId.trim().length > 0) {
    return parseSessionId(requestedId);
  }

  const baseId = `${agent.getCurrentSessionId()}-fork`;
  const existingIds = new Set((await agent.listSessions()).map((session) => session.id));
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
const weekdayNames: Weekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

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
  scheduler: TaskScheduler,
  sessionId: string,
): Promise<string> => {
  const tasks = await scheduler.listTasks(sessionId);
  if (tasks.length === 0) {
    return "No scheduled tasks.";
  }

  const rows = tasks.map((task) => ({
    id: task.id,
    status: task.status,
    nextRunAt: formatTaskTimestamp(task.nextRunAt),
    schedule: formatSchedule(task.schedule),
    title: task.title,
  }));

  const idWidth = Math.max("id".length, ...rows.map((row) => row.id.length));
  const statusWidth = Math.max("status".length, ...rows.map((row) => row.status.length));
  const nextRunWidth = Math.max("next run".length, ...rows.map((row) => row.nextRunAt.length));
  const scheduleWidth = Math.max("schedule".length, ...rows.map((row) => row.schedule.length));
  const titleWidth = Math.max("title".length, ...rows.map((row) => row.title.length));

  const header = [
    padCell("id", idWidth),
    padCell("status", statusWidth),
    padCell("next run", nextRunWidth),
    padCell("schedule", scheduleWidth),
    padCell("title", titleWidth),
  ].join("  ");

  const separator = [
    "-".repeat(idWidth),
    "-".repeat(statusWidth),
    "-".repeat(nextRunWidth),
    "-".repeat(scheduleWidth),
    "-".repeat(titleWidth),
  ].join("  ");

  const lines = rows.map((row) =>
    [
      padCell(row.id, idWidth),
      padCell(row.status, statusWidth),
      padCell(row.nextRunAt, nextRunWidth),
      padCell(row.schedule, scheduleWidth),
      padCell(row.title, titleWidth),
    ].join("  "),
  );

  return [header, separator, ...lines].join("\n");
};

const parseTimeOfDay = (value: string): { hour: number; minute: number } | null => {
  const trimmed = value.trim();
  const twelveHourMatch = /^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/u.exec(trimmed);
  if (twelveHourMatch) {
    const rawHour = Number.parseInt(twelveHourMatch[1] ?? "", 10);
    const minute = Number.parseInt(twelveHourMatch[2] ?? "", 10);
    const meridiem = (twelveHourMatch[3] ?? "").toUpperCase();

    if (rawHour < 1 || rawHour > 12 || minute < 0 || minute > 59) {
      return null;
    }

    let hour = rawHour % 12;
    if (meridiem === "PM") {
      hour += 12;
    }

    return { hour, minute };
  }

  const twentyFourHourMatch = /^(\d{1,2}):(\d{2})$/u.exec(trimmed);
  if (!twentyFourHourMatch) {
    return null;
  }

  const hour = Number.parseInt(twentyFourHourMatch[1] ?? "", 10);
  const minute = Number.parseInt(twentyFourHourMatch[2] ?? "", 10);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  return { hour, minute };
};

const parseUsDateTime = (value: string): string | null => {
  const trimmed = value.trim();
  const match =
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/u.exec(trimmed);
  if (!match) {
    return null;
  }

  const month = Number.parseInt(match[1] ?? "", 10);
  const day = Number.parseInt(match[2] ?? "", 10);
  const year = Number.parseInt(match[3] ?? "", 10);
  const rawHour = Number.parseInt(match[4] ?? "", 10);
  const minute = Number.parseInt(match[5] ?? "", 10);
  const meridiem = (match[6] ?? "").toUpperCase();

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    rawHour < 1 ||
    rawHour > 12 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  let hour = rawHour % 12;
  if (meridiem === "PM") {
    hour += 12;
  }

  const date = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date.toISOString();
};

const parseWeekdays = (value: string): Weekday[] | null => {
  const parts = value
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0);

  if (parts.length === 0) {
    return null;
  }

  const unique = new Set<Weekday>();
  for (const part of parts) {
    if (!weekdayNames.includes(part as Weekday)) {
      return null;
    }
    unique.add(part as Weekday);
  }

  return weekdayNames.filter((day) => unique.has(day));
};

const parseTaskScheduleCommand = (
  value: string,
): { prompt: string; schedule: TaskSchedule; title: string } | null => {
  const parts = value.split("|").map((part) => part.trim());
  if (parts.length !== 3) {
    return null;
  }

  const [schedulePart, title, prompt] = parts;
  if (!schedulePart || !title || !prompt) {
    return null;
  }

  const usDateTime = parseUsDateTime(schedulePart);
  if (usDateTime) {
    return {
      schedule: {
        type: "once",
        runAt: usDateTime,
      },
      title,
      prompt,
    };
  }

  const tokens = schedulePart.split(/\s+/u);
  const kind = tokens[0]?.toLowerCase();

  if (kind === "once" && tokens.length >= 2) {
    const runAt = parseUsDateTime(tokens.slice(1).join(" "));
    if (!runAt) {
      return null;
    }

    return {
      schedule: {
        type: "once",
        runAt,
      },
      title,
      prompt,
    };
  }

  if (kind === "hourly" && tokens.length === 1) {
    return {
      schedule: {
        type: "hourly",
        minute: new Date().getMinutes(),
      },
      title,
      prompt,
    };
  }

  if (kind === "daily" && tokens.length === 2) {
    const time = parseTimeOfDay(tokens[1] ?? "");
    if (!time) {
      return null;
    }

    return {
      schedule: {
        type: "daily",
        hour: time.hour,
        minute: time.minute,
      },
      title,
      prompt,
    };
  }

  if (kind === "weekly" && tokens.length === 3) {
    const days = parseWeekdays(tokens[1] ?? "");
    const time = parseTimeOfDay(tokens[2] ?? "");
    if (!days || !time) {
      return null;
    }

    return {
      schedule: {
        type: "weekly",
        days,
        hour: time.hour,
        minute: time.minute,
      },
      title,
      prompt,
    };
  }

  return null;
};

export const runRepl = async (
  config: AppConfig,
  agent: MaclawAgent,
  scheduler: TaskScheduler,
  sessionStore: SessionStore,
): Promise<void> => {
  const rl = readline.createInterface({ input, output });

  output.write("maclaw REPL\n");
  output.write(`session: ${agent.getCurrentSessionId()}\n`);
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

    if (line === "/help chat") {
      output.write(`${chatHelpText}\n\n`);
      continue;
    }

    if (line === "/help task") {
      output.write(`${taskHelpText}\n\n`);
      continue;
    }

    if (line === "/chat") {
      output.write(`${agent.getCurrentSessionId()}\n\n`);
      continue;
    }

    if (line === "/chat list") {
      const sessions = await agent.listSessions();
      const rendered =
        sessions.length === 0
          ? "No saved chats."
          : (() => {
              const rows = sessions.map((session) => ({
                marker: session.id === agent.getCurrentSessionId() ? "*" : " ",
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

      const session = await agent.switchSession(requestedId);
      output.write(`switched to chat: ${session.id}\n\n`);
      continue;
    }

    if (line === "/chat fork" || line.startsWith("/chat fork ")) {
      const requestedId = await buildForkSessionId(
        agent,
        line.slice("/chat fork".length).trim(),
      );
      if (!requestedId) {
        output.write("Could not create a valid chat id for the fork.\n\n");
        continue;
      }

      const existingSessions = await agent.listSessions();
      if (existingSessions.some((session) => session.id === requestedId)) {
        output.write(`chat already exists: ${requestedId}\n\n`);
        continue;
      }

      const session = await agent.forkSession(requestedId);
      output.write(`forked current chat to: ${session.id}\n\n`);
      continue;
    }

    if (line === "/task") {
      output.write(`${taskHelpText}\n\n`);
      continue;
    }

    if (line === "/task list") {
      const rendered = await renderTaskList(scheduler, agent.getCurrentSessionId());
      output.write(`${rendered}\n\n`);
      continue;
    }

    if (line.startsWith("/task schedule ")) {
      const parsed = parseTaskScheduleCommand(line.slice("/task schedule ".length).trim());
      if (!parsed) {
        output.write(
          "Usage: /task schedule once 4/5/2026 9:00 AM | <title> | <prompt>\n" +
            "       /task schedule hourly | <title> | <prompt>\n" +
            "       /task schedule daily 9:00 AM | <title> | <prompt>\n" +
            "       /task schedule weekly mon,wed,fri 5:30 PM | <title> | <prompt>\n\n",
        );
        continue;
      }

      const task = await scheduler.createTask({
        sessionId: agent.getCurrentSessionId(),
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

      const deleted = await scheduler.deleteTask(taskId, agent.getCurrentSessionId());
      output.write(deleted ? `deleted task: ${taskId}\n\n` : `task not found: ${taskId}\n\n`);
      continue;
    }

    if (line === "/skills") {
      const skills = await loadSkills(config.skillsDir);
      output.write(
        skills.length === 0
          ? "No skills found.\n\n"
          : `${skills.map((skill) => `- ${skill.name}: ${skill.description}`).join("\n")}\n\n`,
      );
      continue;
    }

    if (line === "/history") {
      const session = await sessionStore.loadSession(
        agent.getCurrentSessionId(),
        {
          retentionDays: config.retentionDays,
          compressionMode: config.compressionMode,
        },
      );

      const transcript =
        session.messages.length === 0
          ? "No history yet."
          : session.messages
              .map((message) => `[${message.role}] ${message.content}`)
              .join("\n");

      output.write(`${transcript}\n\n`);
      continue;
    }

    const reply = await agent.handleUserInput(line);
    output.write(`${reply.content}\n\n`);
  }
};

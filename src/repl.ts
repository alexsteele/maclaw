import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { AppConfig } from "./config.js";
import type { SessionStore } from "./sessions.js";
import { loadSkills } from "./skills.js";
import { MaclawAgent } from "./agent.js";
import { TaskScheduler } from "./scheduler.js";

const helpText = [
  "Commands:",
  "  /help              Show this help",
  "  /chat              Chat management commands",
  "  /skills            List local skills",
  "  /history           Show the current session transcript",
  "  /tasks             List scheduled tasks",
  "  /quit              Exit the REPL",
].join("\n");

const chatHelpText = [
  "Command: /chat",
  "  /chat              Show the current chat id",
  "  /chat list         List saved chats",
  "  /chat switch X     Switch to chat X",
  "  /chat fork [X]     Fork the current chat and switch to it",
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

    if (line === "/tasks") {
      const tasks = await scheduler.listTasks(agent.getCurrentSessionId());
      const rendered =
        tasks.length === 0
          ? "No scheduled tasks."
          : tasks
              .map((task) => `- [${task.status}] ${task.title} at ${task.runAt}`)
              .join("\n");
      output.write(`${rendered}\n\n`);
      continue;
    }

    const reply = await agent.handleUserInput(line);
    output.write(`${reply.content}\n\n`);
  }
};

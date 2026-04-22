/**
 * Shared slash-command parsing and dispatch for maclaw.
 *
 * This module defines the common command surface used by the REPL, CLI wrappers,
 * and portal/server chat entrypoints so command behavior stays consistent across
 * interfaces. See `docs/design.md` for the higher-level message flow.
 */
import { Harness, type AgentCreateOptions } from "./harness.js";
import { loadConfig, parseConfiguredModel } from "./config.js";
import {
  defaultServerConfigFile,
  type EditableServerConfig,
  type RemoteConfig,
  validateRemoteConfig,
} from "./server-config.js";
import { readJsonFile, writeJsonFile } from "./fs-utils.js";
import { createRemote, summarizeRemote } from "./remote/index.js";
import {
  editableProjectConfigKeys,
  parseProjectConfigValue,
  renderProjectConfig,
} from "./project-config.js";
import { renderModelSuggestions } from "./models.js";
import { parseTaskSchedule } from "./task.js";
import type {
  AgentInboxEntry,
  AgentRecord,
  InboxEntry,
  NotificationOverride,
  NotificationPolicy,
  NotificationTarget,
  Origin,
  TaskSchedule,
  UsageSummary,
} from "./types.js";

type TeleportCommandOptions = {
  chatId: string;
  project?: string;
};

type TeleportControl = {
  connect(
    target: string,
    options: TeleportCommandOptions,
  ): Promise<{
    chatId: string;
    project?: string;
    target: string;
  }>;
  disconnect(): Promise<boolean>;
  getTarget():
    | {
        chatId: string;
        project?: string;
        target: string;
      }
    | undefined;
  listRemotes(): RemoteConfig[];
};

type ProjectControl = {
  show?(): Promise<string> | string;
  list?(): Promise<string> | string;
  create(name: string): Promise<string>;
  switch(name: string): Promise<string>;
};

type DispatchOptions = {
  chatId?: string;
  origin?: Origin;
  project?: ProjectControl;
  // Optional teleport context supplied by interactive clients such as the REPL
  // or server-backed channels. When present, shared /teleport commands can
  // attach, list, inspect, and disconnect remote sessions.
  teleport?: TeleportControl;
};

type SubcommandHandler = (
  harness: Harness,
  args: string,
  options: DispatchOptions,
) => Promise<string>;

type RegisteredSubcommand = {
  aliases?: string[];
  help?: string;
  run: SubcommandHandler;
};

type SubcommandDispatchOptions = {
  defaultSubcommand?: string;
  implicitDefault?: boolean;
};

export const helpText = [
  "## Commands",
  "- /help Show this help",
  "- /chats List saved chats",
  "- /new Create and switch to a new chat",
  "- /switch Switch to a chat",
  "- /fork Fork the current chat",
  "- /reset Clear the current chat",
  "- /compress Compress the current chat",
  "- /save Save the current chat transcript to a file",
  "- /usage Show token usage for the current chat",
  "- /cost Show the project usage report",
  "- /model Show suggested models",
  "- /config Project config commands",
  "- /project Project information commands",
  "- /chat Chat management commands",
  "- /history Show the current chat transcript",
  "- /tools Show the current tools",
  "- /skills List local skills",
  "- /agent Agent management commands",
  "- /task Task scheduling commands",
  "- /send Send a test notification",
  "- /inbox Show saved notifications",
  "- /remote Manage configured remotes",
  "- /teleport Attach this session to a remote maclaw runtime",
].join("\n");

export const projectHelpText = [
  "## /project",
  "- /project Show the active project",
  "- /project list List managed projects when available",
  "- /project show Show the active project",
  "- /project init Create .maclaw/maclaw.json for this project",
  "- /project new <name> Create and switch to a new managed project",
  "- /project switch <name> Switch to a managed project by name",
  "- /project usage Show token usage for the project",
  "- /project wipeout Delete .maclaw/ for this project after confirmation",
].join("\n");

export const configHelpText = [
  "## /config",
  "- /config Show the current project config",
  "- /config show Show the current project config",
  "- /config get <key> Show one config value",
  "- /config set <key> <v> Update a config value",
  "",
  "### Editable keys",
  ...Array.from(editableProjectConfigKeys, (key) => `- \`${key}\``),
].join("\n");

export const chatHelpText = [
  "## /chat",
  "- /chat Show the current chat id",
  "- /chat show [X] Show the current or named chat",
  "- /chat usage [X] Show token usage for the current or named chat",
  "- /chat list List saved chats",
  "- /chat prune Delete expired chats using retentionDays",
  "- /chat new [X] Create and switch to a new chat",
  "- /chat switch X Switch to chat X",
  "- /chat fork [X] Fork the current chat and switch to it",
  "- /chat reset Clear the current chat",
  "- /chat compress Compress the current chat",
  "- /chat rm X Delete chat X",
].join("\n");

export const modelHelpText = [
  "## /model",
  "- /model Show suggested models",
  "- /model list Show suggested models",
].join("\n");

export const taskHelpText = [
  "## /task",
  "- /task list",
  "- /task prune",
  "- /task schedule <date> | <title> | <prompt> [| <json options>]",
  "- /task delete <task id>",
  "- /task cancel <task id>",
  "",
  "Run /help task schedule for scheduling syntax and examples.",
].join("\n");

export const taskScheduleHelpText = [
  "## /task schedule",
  "- /task schedule <date> | <title> | <prompt> [| <json options>]",
  "- /task schedule once <today|tomorrow|now|4/5/2026 [9:00 AM]> | <title> | <prompt> [| <json options>]",
  "- /task schedule hourly | <title> | <prompt> [| <json options>]",
  "- /task schedule daily 9:00 AM | <title> | <prompt> [| <json options>]",
  "- /task schedule weekly mon,wed,fri 5:30 PM | <title> | <prompt> [| <json options>]",
  "",
  "### One-time schedules",
  "- today",
  "- tomorrow",
  "- now",
  "- 4/5/2026",
  "- 4/5/2026 9:00 AM",
  "",
  "### Notes",
  "- Date-only one-time schedules use the project's defaultTaskTime.",
  "- JSON options currently support notify and notifyTarget overrides.",
  "",
  "### Examples",
  "- /task schedule once today | Daily Brief | Send the brief",
  "- /task schedule once tomorrow 5:30 PM | Check In | Ask me how the day went",
  '- /task schedule daily 9:00 AM | Daily Brief | Send the brief | {"notify":"none"}',
].join("\n");

export const agentHelpText = [
  "## /agent",
  "- /agent",
  "- /agent list",
  "- /agent create <name> | <prompt> [| <json options>]",
  '- json options: {"toolsets":["maclaw","skills"],"maxSteps":3}',
  "- /agent send <name> | <message>",
  "- /agent inbox <name>",
  "- /agent inbox clear <name>",
  "- /agent inbox rm <name> <id>",
  "- /agent prune [now|<age>]",
  "- /agent chat <name>",
  "- /agent return <name>",
  "- /agent show <name>",
  "- /agent tail <name> [N]",
  "- /agent tail -f <name> [N]",
  "- /agent rm <name>",
  "- /agent pause <name>",
  "- /agent resume <name>",
  "- /agent stop <name>",
  "- /agent steer <name> | <prompt>",
].join("\n");

const parseAgentPruneAge = (value: string): number | undefined => {
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "now") {
    return 0;
  }

  const match = /^(\d+)([mhd])$/u.exec(trimmed);
  if (!match) {
    return undefined;
  }

  const amount = Number.parseInt(match[1] ?? "", 10);
  const unit = match[2];
  if (!Number.isFinite(amount)) {
    return undefined;
  }

  if (unit === "m") {
    return amount * 60 * 1000;
  }

  if (unit === "h") {
    return amount * 60 * 60 * 1000;
  }

  return amount * 24 * 60 * 60 * 1000;
};

const parseAgentTailArgs = (
  value: string,
): {
  agentRef?: string;
  count: number;
  follow: boolean;
  error?: string;
} => {
  const tokens = value.trim().split(/\s+/u).filter((part) => part.length > 0);
  if (tokens.length === 0) {
    return {
      count: 10,
      follow: false,
      error: "Usage: /agent tail [-f] <name> [N]",
    };
  }

  let follow = false;
  if (tokens[0] === "-f") {
    follow = true;
    tokens.shift();
  }

  if (tokens.length === 0) {
    return {
      count: 10,
      follow,
      error: "Usage: /agent tail [-f] <name> [N]",
    };
  }

  let count = 10;
  const maybeCount = tokens[tokens.length - 1];
  if (maybeCount && /^\d+$/u.test(maybeCount)) {
    count = Number.parseInt(maybeCount, 10);
    tokens.pop();
  }

  if (!Number.isFinite(count) || count <= 0 || tokens.length === 0) {
    return {
      count: 10,
      follow,
      error: "Usage: /agent tail [-f] <name> [N]",
    };
  }

  return {
    agentRef: tokens.join(" "),
    count,
    follow,
  };
};

const stripAgentDoneMarker = (content: string): string =>
  content
    .split("\n")
    .filter((line) => line.trim() !== "<AGENT_DONE>")
    .join("\n")
    .trimEnd();

const tailAgentMessages = (
  messages: Array<{ role: string; content: string }>,
  count: number,
): string =>
  messages
    .filter((m) => m.role === "assistant")
    .slice(-count)
    .map((m) => stripAgentDoneMarker(m.content))
    .filter((content) => content.length > 0)
    .join("\n\n");

const formatSubcommandHelp = (
  usage: string,
  description: string,
  details?: string[],
): string => [usage, description, ...(details ?? [])].join("\n");

const findRegisteredSubcommand = (
  registry: Record<string, RegisteredSubcommand>,
  name: string,
): RegisteredSubcommand | undefined => {
  const direct = registry[name];
  if (direct) {
    return direct;
  }

  return Object.values(registry).find((entry) => entry.aliases?.includes(name));
};

const dispatchRegisteredSubcommand = async (
  harness: Harness,
  input: string,
  options: DispatchOptions,
  familyCommand: string,
  familyHelpText: string,
  registry: Record<string, RegisteredSubcommand>,
  dispatchOptions: SubcommandDispatchOptions = {},
): Promise<string> => {
  if (input === familyCommand || input === `${familyCommand} help`) {
    if (dispatchOptions.defaultSubcommand && input === familyCommand) {
      const defaultEntry = findRegisteredSubcommand(
        registry,
        dispatchOptions.defaultSubcommand,
      );
      if (defaultEntry) {
        return defaultEntry.run(harness, "", options);
      }
    }

    return familyHelpText;
  }

  const remainder = input.slice(familyCommand.length).trim();
  if (remainder.length === 0) {
    return familyHelpText;
  }

  if (remainder.startsWith("help ")) {
    const helpTarget = remainder.slice("help ".length).trim();
    if (helpTarget.length === 0) {
      return familyHelpText;
    }

    const helpEntry = findRegisteredSubcommand(registry, helpTarget);
    return helpEntry?.help ?? familyHelpText;
  }

  const firstSpace = remainder.indexOf(" ");
  const subcommandName =
    firstSpace < 0 ? remainder : remainder.slice(0, firstSpace);
  const args = firstSpace < 0 ? "" : remainder.slice(firstSpace + 1).trim();
  const entry = findRegisteredSubcommand(registry, subcommandName);
  if (entry) {
    return entry.run(harness, args, options);
  }

  if (dispatchOptions.defaultSubcommand && dispatchOptions.implicitDefault) {
    const defaultEntry = findRegisteredSubcommand(
      registry,
      dispatchOptions.defaultSubcommand,
    );
    if (defaultEntry) {
      return defaultEntry.run(harness, remainder, options);
    }
  }

  if (!entry) {
    return familyHelpText;
  }

  return familyHelpText;
};

export const toolsHelpText = [
  "Command: /tools",
  "  /tools             Show the current tools",
].join("\n");

export const saveHelpText = [
  "Command: /save",
  "  /save              Save the current chat transcript to .maclaw/exports/<chat>.md",
  "  /save <path>       Save the current chat transcript to a file",
].join("\n");

export const compressHelpText = [
  "Command: /compress",
  "  /compress          Compress the current chat",
].join("\n");

export const inboxHelpText = [
  "Command: /inbox",
  "  /inbox             Show saved notifications",
  "  /inbox rm <id>     Delete one notification",
  "  /inbox clear       Clear all notifications",
].join("\n");

export const sendHelpText = [
  "Command: /send",
  "  /send <message>              Save a test notification to the inbox",
  "  /send email | <message>      Send a test email when email is configured",
  "  /send inbox | <message>      Save a test notification to the inbox",
  "  /send origin | <message>     Send a test notification to the current origin",
  "  /send <channel> | <message>  Send to the current origin when it matches the channel",
].join("\n");

export const usageHelpText = [
  "Command: /usage",
  "  /usage             Show token usage for the current chat",
  "  /usage <chat>      Show token usage for a named chat",
  "  /usage project     Show token usage for the project",
  "  /usage report      Show a project usage report by chat, agent, and week",
].join("\n");

export const teleportHelpText = [
  "Command: /teleport",
  "  /teleport                                  Show teleport help",
  "  /teleport list                             List configured remotes",
  "  /teleport status                           Show current teleport status",
  "  /teleport connect <url|remote> [--project <name>] [--chat <id>]",
  "  /teleport <url|remote>                     Alias for /teleport connect",
  "  /teleport disconnect                       Disconnect the active teleport session",
  "",
  "While teleport is connected, normal REPL or channel messages are sent to the remote runtime.",
].join("\n");

export const remoteHelpText = [
  "Command: /remote",
  "  /remote                  Show remote help",
  "  /remote list             List configured remotes",
  "  /remote show <name>      Show one remote config",
  "  /remote bootstrap <name> Bootstrap one remote",
  "  /remote start <name>     Start one remote server",
  "  /remote stop <name>      Stop one remote server",
  "  /remote rm <name>        Delete one remote config",
  "  /remote create           Create a remote interactively when supported",
  "  /remote create <json>    Save one remote config from JSON",
].join("\n");

const helpTopics: Record<string, string> = {
  config: configHelpText,
  save: saveHelpText,
  model: modelHelpText,
  compress: compressHelpText,
  usage: usageHelpText,
  project: projectHelpText,
  chat: chatHelpText,
  task: taskHelpText,
  "task schedule": taskScheduleHelpText,
  agent: agentHelpText,
  tools: toolsHelpText,
  teleport: teleportHelpText,
  remote: remoteHelpText,
};

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

const parseProjectName = (value: string): string | null => parseChatId(value);

type ServerConfigData = EditableServerConfig;

const serverConfigFallback = (): ServerConfigData => ({
  projects: [],
});

const loadEditableServerConfig = async (): Promise<ServerConfigData> =>
  await readJsonFile<ServerConfigData>(
    defaultServerConfigFile(),
    serverConfigFallback(),
  );

const saveEditableServerConfig = async (
  serverConfig: ServerConfigData,
): Promise<void> => {
  await writeJsonFile(defaultServerConfigFile(), serverConfig);
};

const renderRemoteInfo = (remote: RemoteConfig): string =>
  JSON.stringify(remote, null, 2);

const renderRemoteList = (remotes: RemoteConfig[]): string =>
  remotes.length === 0
    ? "No remotes configured."
    : remotes
        .map((remote) => `- ${remote.name}: ${summarizeRemote(remote)}`)
        .join("\n");

const formatRemoteActionResult = (
  action: string,
  remoteName: string,
  result: { exitCode: number; message: string },
): string => {
  const statusLine =
    result.exitCode === 0
      ? `${action} complete: ${remoteName}`
      : `${action} failed: ${remoteName} (exit ${result.exitCode})`;
  const message = result.message.trim();
  return message ? `${statusLine}\n${message}` : statusLine;
};

const parseRemoteCreateJson = (value: string): RemoteConfig | string => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return "Invalid remote JSON.";
  }

  const validationError = validateRemoteConfig(parsed);
  if (validationError) {
    return validationError;
  }

  return parsed as RemoteConfig;
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

  return isToday
    ? timeFormatter.format(timestamp)
    : dateFormatter.format(timestamp);
};

const padCell = (value: string, width: number): string =>
  value.padEnd(width, " ");

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
  const titleWidth = Math.max(
    "title".length,
    ...rows.map((row) => row.title.length),
  );
  const statusWidth = Math.max(
    "status".length,
    ...rows.map((row) => row.status.length),
  );
  const nextRunWidth = Math.max(
    "next run".length,
    ...rows.map((row) => row.nextRunAt.length),
  );
  const scheduleWidth = Math.max(
    "schedule".length,
    ...rows.map((row) => row.schedule.length),
  );

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

  const renderAgentStatus = (status: AgentRecord["status"]): string =>
    status === "completed" ? "done" : status;

  const statusPriority: Record<AgentRecord["status"], number> = {
    running: 0,
    paused: 1,
    pending: 2,
    failed: 3,
    stopped: 4,
    completed: 5,
    cancelled: 6,
  };

  const rows = [...agents]
    .sort((left, right) => {
      const priorityDelta =
        statusPriority[left.status] - statusPriority[right.status];
      if (priorityDelta !== 0) {
        return priorityDelta;
      }

      return left.createdAt.localeCompare(right.createdAt);
    })
    .map((agent) => ({
      id: agent.id,
      name: agent.name,
      toolsets: agent.toolsets?.join(",") ?? "(default)",
      status: renderAgentStatus(agent.status),
      steps:
        agent.maxSteps === undefined
          ? `${agent.stepCount}`
          : `${agent.stepCount}/${agent.maxSteps}`,
      started: agent.startedAt
        ? formatTaskTimestamp(agent.startedAt)
        : "(not started)",
      finished: agent.finishedAt
        ? formatTaskTimestamp(agent.finishedAt)
        : "(running)",
    }));

  const idWidth = Math.max("id".length, ...rows.map((row) => row.id.length));
  const nameWidth = Math.max(
    "name".length,
    ...rows.map((row) => row.name.length),
  );
  const toolsetsWidth = Math.max(
    "toolsets".length,
    ...rows.map((row) => row.toolsets.length),
  );
  const statusWidth = Math.max(
    "status".length,
    ...rows.map((row) => row.status.length),
  );
  const stepsWidth = Math.max(
    "steps".length,
    ...rows.map((row) => row.steps.length),
  );
  const startedWidth = Math.max(
    "started".length,
    ...rows.map((row) => row.started.length),
  );
  const finishedWidth = Math.max(
    "finished".length,
    ...rows.map((row) => row.finished.length),
  );

  const header = [
    padCell("id", idWidth),
    padCell("name", nameWidth),
    padCell("toolsets", toolsetsWidth),
    padCell("status", statusWidth),
    padCell("steps", stepsWidth),
    padCell("started", startedWidth),
    padCell("finished", finishedWidth),
  ].join("  ");

  const separator = [
    "-".repeat(idWidth),
    "-".repeat(nameWidth),
    "-".repeat(toolsetsWidth),
    "-".repeat(statusWidth),
    "-".repeat(stepsWidth),
    "-".repeat(startedWidth),
    "-".repeat(finishedWidth),
  ].join("  ");

  const lines = rows.map((row) =>
    [
      padCell(row.id, idWidth),
      padCell(row.name, nameWidth),
      padCell(row.toolsets, toolsetsWidth),
      padCell(row.status, statusWidth),
      padCell(row.steps, stepsWidth),
      padCell(row.started, startedWidth),
      padCell(row.finished, finishedWidth),
    ].join("  "),
  );

  return [header, separator, ...lines].join("\n");
};

const renderAgentInfo = (agent: AgentRecord): string =>
  [
    `id: ${agent.id}`,
    `name: ${agent.name}`,
    `prompt: ${agent.prompt}`,
    `toolsets: ${agent.toolsets?.join(", ") ?? "(default)"}`,
    `status: ${agent.status}`,
    `chatId: ${agent.chatId}`,
    `sourceChatId: ${agent.sourceChatId ?? "(none)"}`,
    `createdBy: ${agent.createdBy ?? "(unknown)"}`,
    `createdByAgentId: ${agent.createdByAgentId ?? "(none)"}`,
    `origin: ${agent.origin ? JSON.stringify(agent.origin) : "(none)"}`,
    `notify: ${agent.notify ? JSON.stringify(agent.notify) : "(default)"}`,
    `notifyTarget: ${agent.notifyTarget ? JSON.stringify(agent.notifyTarget) : "(default)"}`,
    `steps: ${
      agent.maxSteps === undefined
        ? `${agent.stepCount}`
        : `${agent.stepCount}/${agent.maxSteps}`
    }`,
    `maxSteps: ${agent.maxSteps ?? "(none)"}`,
    `timeoutMs: ${agent.timeoutMs}`,
    `stepIntervalMs: ${agent.stepIntervalMs ?? 0}`,
    `createdAt: ${agent.createdAt}`,
    `startedAt: ${agent.startedAt ?? "(not started)"}`,
    `finishedAt: ${agent.finishedAt ?? "(not finished)"}`,
    `lastMessage: ${agent.lastMessage ?? "(none)"}`,
    `lastError: ${agent.lastError ?? "(none)"}`,
  ].join("\n");

const renderAgentInbox = (entries: AgentInboxEntry[]): string => {
  if (entries.length === 0) {
    return "(empty)";
  }

  return entries
    .map((entry) =>
      [
        `${entry.id} [${entry.sourceType}] ${entry.createdAt}`,
        `from: ${entry.sourceType} ${entry.sourceName ?? entry.sourceId}`,
        entry.text,
      ].join("\n"),
    )
    .join("\n\n");
};

const renderProjectInfo = (harness: Harness, currentChatId: string): string => {
  const projectConfig = harness.config;
  const isProjectInitialized = harness.isProjectInitialized();
  return [
    `name: ${projectConfig.name}`,
    `initialized: ${isProjectInitialized ? "yes" : "no"}`,
    `createdAt: ${projectConfig.createdAt ?? "(not set)"}`,
    `folder: ${projectConfig.projectFolder}`,
    `config: ${isProjectInitialized ? projectConfig.projectConfigFile : "(not set)"}`,
    `model: ${projectConfig.model}`,
    `modelProvider: ${parseConfiguredModel(projectConfig.model).provider}`,
    `storage: ${projectConfig.storage}`,
    `tools: ${JSON.stringify(projectConfig.tools)}`,
    `notifications: ${JSON.stringify(projectConfig.notifications)}`,
    `defaultTaskTime: ${projectConfig.defaultTaskTime}`,
    `defaultAgentMaxSteps: ${projectConfig.defaultAgentMaxSteps}`,
    `defaultAgentTimeout: ${projectConfig.defaultAgentTimeout}`,
    `contextMessages: ${projectConfig.contextMessages}`,
    `maxToolIterations: ${projectConfig.maxToolIterations}`,
    `retentionDays: ${projectConfig.retentionDays}`,
    `currentChat: ${currentChatId}`,
    `skillsDir: ${projectConfig.skillsDir}`,
  ].join("\n");
};

const renderUsage = (scope: string, usage: UsageSummary): string =>
  [
    `${scope}: ${usage.messageCount}`,
    `inputTokens: ${usage.inputTokens}`,
    `outputTokens: ${usage.outputTokens}`,
    `totalTokens: ${usage.totalTokens}`,
    `cachedInputTokens: ${usage.cachedInputTokens}`,
    `reasoningTokens: ${usage.reasoningTokens}`,
  ].join("\n");

const renderUsageReportTable = (
  headers: string[],
  rows: string[][],
): string => {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index]?.length ?? 0)),
  );

  const header = headers
    .map((value, index) => padCell(value, widths[index] ?? value.length))
    .join("  ");
  const separator = widths.map((width) => "-".repeat(width)).join("  ");
  const lines = rows.map((row) =>
    row
      .map((value, index) => padCell(value, widths[index] ?? value.length))
      .join("  "),
  );
  return [header, separator, ...lines].join("\n");
};

const renderProjectUsageReport = async (
  report: Awaited<ReturnType<Harness["getProjectUsageReport"]>>,
): Promise<string> => {
  const chatsTable =
    report.chats.length === 0
      ? "No chats with usage."
      : renderUsageReportTable(
          [
            "chat",
            "messages",
            "totalTokens",
            "inputTokens",
            "outputTokens",
            "lastActivity",
          ],
          report.chats.map((row) => [
            row.id,
            String(row.usage.messageCount),
            String(row.usage.totalTokens),
            String(row.usage.inputTokens),
            String(row.usage.outputTokens),
            row.updatedAt ? formatChatTimestamp(row.updatedAt) : "(unknown)",
          ]),
        );

  const agentsTable =
    report.agents.length === 0
      ? "No agents."
      : renderUsageReportTable(
          [
            "agent",
            "status",
            "messages",
            "totalTokens",
            "inputTokens",
            "outputTokens",
          ],
          report.agents.map((row) => [
            row.name ?? row.id,
            row.status ?? "(unknown)",
            String(row.usage.messageCount),
            String(row.usage.totalTokens),
            String(row.usage.inputTokens),
            String(row.usage.outputTokens),
          ]),
        );

  const weeksTable =
    report.weeks.length === 0
      ? "No usage yet."
      : renderUsageReportTable(
          ["weekOf", "messages", "totalTokens", "inputTokens", "outputTokens"],
          report.weeks.map((row) => [
            row.weekOf,
            String(row.usage.messageCount),
            String(row.usage.totalTokens),
            String(row.usage.inputTokens),
            String(row.usage.outputTokens),
          ]),
        );

  return [
    "project usage report",
    renderUsage("messagesWithUsage", report.usage),
    "",
    "Chats",
    chatsTable,
    "",
    "Agents",
    agentsTable,
    "",
    "Weeks",
    weeksTable,
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

const renderChatInfo = (
  chat: Awaited<ReturnType<Harness["loadChat"]>>,
  model: string,
  contextMessages: number,
): string => {
  const contextSlice = chat.messages.slice(-contextMessages);
  const contextBytes = Buffer.byteLength(
    JSON.stringify(
      contextSlice.map((message) => ({
        content: message.content,
        role: message.role,
      })),
    ),
    "utf8",
  );

  return [
    `model: ${model}`,
    `id: ${chat.id}`,
    `createdAt: ${chat.createdAt}`,
    `updatedAt: ${chat.updatedAt}`,
    `messageCount: ${chat.messages.length}`,
    `contextMessageCount: ${contextSlice.length}`,
    `contextBytes: ${contextBytes}`,
    `retentionDays: ${chat.retentionDays}`,
    `compressionMode: ${chat.compressionMode}`,
    `summary: ${chat.summary ?? "(none)"}`,
  ].join("\n");
};

const renderInbox = (entries: InboxEntry[]): string => {
  if (entries.length === 0) {
    return "Inbox is empty.";
  }

  return [...entries]
    .reverse()
    .map((entry) =>
      [
        `id: ${entry.id}`,
        `${entry.kind} ${formatTaskTimestamp(entry.createdAt)}`,
        `to: ${entry.origin.channel}/${entry.origin.userId}`,
        entry.text,
      ].join("\n"),
    )
    .join("\n\n");
};

const getScopedChatId = (harness: Harness, options?: DispatchOptions): string =>
  options?.chatId ?? harness.getCurrentChatId();

const isPinnedChannelContext = (options?: DispatchOptions): boolean => {
  return Boolean(options?.chatId) && options?.origin?.channel !== "web";
};

const readCurrentProjectConfig = (harness: Harness) =>
  loadConfig(harness.config.projectFolder);

const parseNotifyTarget = (value: unknown): NotificationTarget | undefined => {
  if (value === "inbox" || value === "origin") {
    return value;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const object = value as {
    channel?: unknown;
    userId?: unknown;
    conversationId?: unknown;
    threadId?: unknown;
  };
  if (
    typeof object.channel !== "string" ||
    object.channel.trim().length === 0
  ) {
    return undefined;
  }

  if (object.userId === undefined) {
    return { channel: object.channel };
  }

  if (typeof object.userId !== "string" || object.userId.trim().length === 0) {
    return undefined;
  }

  return {
    channel: object.channel,
    userId: object.userId,
    ...(typeof object.conversationId === "string"
      ? { conversationId: object.conversationId }
      : {}),
    ...(typeof object.threadId === "string"
      ? { threadId: object.threadId }
      : {}),
  };
};

const parseNotificationOverride = (
  value: unknown,
): NotificationOverride | string => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const object = value as { notify?: unknown; notifyTarget?: unknown };
  const override: NotificationOverride = {};

  if (object.notify !== undefined) {
    if (
      object.notify !== "all" &&
      object.notify !== "none" &&
      !Array.isArray(object.notify) &&
      (typeof object.notify !== "object" || object.notify === null)
    ) {
      return "notify must be 'all', 'none', or a valid notification policy object";
    }

    override.notify = object.notify as NotificationPolicy;
  }

  if (object.notifyTarget !== undefined) {
    const notifyTarget = parseNotifyTarget(object.notifyTarget);
    if (!notifyTarget) {
      return "notifyTarget must be 'inbox', 'origin', { channel }, or a full notification target object";
    }

    override.notifyTarget = notifyTarget;
  }

  return override;
};

const parseAgentCreateOptions = (
  value: string,
):
  | Pick<
      AgentCreateOptions,
      | "maxSteps"
      | "timeoutMs"
      | "stepIntervalMs"
      | "notify"
      | "notifyTarget"
      | "toolsets"
    >
  | string => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return "Invalid agent options JSON.";
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return "Agent options must be a JSON object.";
  }

  const optionsObject = parsed as Record<string, unknown>;
  for (const key of Object.keys(optionsObject)) {
    if (
      ![
        "maxSteps",
        "timeoutMs",
        "stepIntervalMs",
        "notify",
        "notifyTarget",
        "toolsets",
      ].includes(key)
    ) {
      return `Unknown agent option: ${key}`;
    }
  }

  if (
    optionsObject.toolsets !== undefined &&
    (!Array.isArray(optionsObject.toolsets) ||
      optionsObject.toolsets.some((value) => typeof value !== "string"))
  ) {
    return "toolsets must be an array of toolset names";
  }

  const notificationOverride = parseNotificationOverride(optionsObject);
  if (typeof notificationOverride === "string") {
    return notificationOverride;
  }

  return {
    maxSteps: optionsObject.maxSteps as AgentCreateOptions["maxSteps"],
    timeoutMs: optionsObject.timeoutMs as AgentCreateOptions["timeoutMs"],
    stepIntervalMs:
      optionsObject.stepIntervalMs as AgentCreateOptions["stepIntervalMs"],
    toolsets: optionsObject.toolsets as AgentCreateOptions["toolsets"],
    ...notificationOverride,
  };
};

const parseTaskScheduleOptions = (
  value: string,
): NotificationOverride | string => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return "Invalid task options JSON.";
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return "Task options must be a JSON object.";
  }

  const optionsObject = parsed as Record<string, unknown>;
  for (const key of Object.keys(optionsObject)) {
    if (!["notify", "notifyTarget"].includes(key)) {
      return `Unknown task option: ${key}`;
    }
  }

  return parseNotificationOverride(optionsObject);
};

type CommandHandler = (
  harness: Harness,
  input: string,
  options: DispatchOptions,
) => Promise<string>;

const handleHelpCommand: CommandHandler = async (_harness, input) => {
  const topic = input.slice("/help".length).trim();
  return helpTopics[topic] ?? helpText;
};

const renderProjectShow = async (
  harness: Harness,
  options: DispatchOptions,
): Promise<string> => {
  if (options.project?.show) {
    return options.project.show();
  }

  return renderProjectInfo(harness, getScopedChatId(harness, options));
};

const renderProjectList = async (
  harness: Harness,
  options: DispatchOptions,
): Promise<string> => {
  if (options.project?.list) {
    return options.project.list();
  }

  return renderProjectInfo(harness, getScopedChatId(harness, options));
};

const projectSubcommands: Record<string, RegisteredSubcommand> = {
  show: {
    run: async (harness, _args, options) => renderProjectShow(harness, options),
  },
  list: {
    run: async (harness, _args, options) => renderProjectList(harness, options),
  },
  new: {
    help: "Usage: /project new <name>",
    run: async (_harness, args, options) => {
      const name = parseProjectName(args);
      if (!name) {
        return "Usage: /project new <name>";
      }

      if (!options.project) {
        return "/project new is not supported in this channel yet.";
      }

      return options.project.create(name);
    },
  },
  switch: {
    help: "Usage: /project switch <name>",
    run: async (_harness, args, options) => {
      const name = parseProjectName(args);
      if (!name) {
        return "Usage: /project switch <name>";
      }

      if (!options.project) {
        return "/project switch is not supported in this channel yet.";
      }

      return options.project.switch(name);
    },
  },
  usage: {
    run: async (harness) =>
      renderUsage("messagesWithUsage", await harness.getProjectUsage()),
  },
  init: {
    run: async (harness) => {
      if (harness.isProjectInitialized()) {
        return `project already initialized: ${harness.config.projectConfigFile}`;
      }

      await harness.initProject();
      return (
        `initialized project: ${harness.config.projectConfigFile}\n` +
        `current chat: ${harness.getCurrentChatId()}\n` +
        "switched this REPL into persistent project mode"
      );
    },
  },
  wipeout: {
    run: async (harness, args) => {
      if (args === "confirm") {
        const wiped = await harness.wipeProject();
        if (!wiped) {
          return "project is not initialized";
        }

        return (
          "deleted project data: .maclaw\n" +
          `project is now headless at: ${harness.config.projectFolder}`
        );
      }

      if (!harness.isProjectInitialized()) {
        return "project is not initialized";
      }

      return (
        "This will delete the project's .maclaw folder, including chats, tasks, agents, and config.\n" +
        "Run /project wipeout confirm to continue."
      );
    },
  },
};

const handleProjectCommand: CommandHandler = async (
  harness,
  input,
  options,
) => {
  if (input === "/projects") {
    return handleProjectCommand(harness, "/project list", options);
  }

  return dispatchRegisteredSubcommand(
    harness,
    input,
    options,
    "/project",
    projectHelpText,
    projectSubcommands,
    {
      defaultSubcommand: "show",
    },
  );
};

const handleSaveCommand: CommandHandler = async (harness, input, options) => {
  return dispatchRegisteredSubcommand(
    harness,
    input,
    options,
    "/save",
    saveHelpText,
    {
      default: {
        run: async (saveHarness, args, saveOptions) => {
          const outputPath = args.trim();
          const savedPath = await saveHarness.saveChatTranscript(
            outputPath.length > 0 ? outputPath : undefined,
            saveOptions.chatId,
          );
          return `saved chat transcript to: ${savedPath}`;
        },
      },
    },
    {
      defaultSubcommand: "default",
      implicitDefault: true,
    },
  );
};

const handleCompressCommand: CommandHandler = async (
  harness,
  input,
  options,
) => {
  return dispatchRegisteredSubcommand(
    harness,
    input,
    options,
    "/compress",
    compressHelpText,
    {
      default: {
        run: async (compressHarness, _args, compressOptions) =>
          handleChatCommand(compressHarness, "/chat compress", compressOptions),
      },
    },
    {
      defaultSubcommand: "default",
    },
  );
};

const inboxSubcommands: Record<string, RegisteredSubcommand> = {
  list: {
    run: async (harness) => renderInbox(await harness.listInbox()),
  },
  clear: {
    run: async (harness) => {
      const cleared = await harness.clearInbox();
      return `cleared inbox: ${cleared}`;
    },
  },
  rm: {
    help: "Usage: /inbox rm <id>",
    run: async (harness, args) => {
      const entryId = args.trim();
      if (entryId.length === 0) {
        return "Usage: /inbox rm <id>";
      }

      return (await harness.deleteInboxEntry(entryId))
        ? `deleted inbox entry: ${entryId}`
        : `inbox entry not found: ${entryId}`;
    },
  },
};

const handleInboxCommand: CommandHandler = async (harness, input, options) => {
  return dispatchRegisteredSubcommand(
    harness,
    input,
    options,
    "/inbox",
    inboxHelpText,
    inboxSubcommands,
    {
      defaultSubcommand: "list",
    },
  );
};

const sendSubcommands: Record<string, RegisteredSubcommand> = {
  default: {
    run: async (harness, args, options) => {
      const body = args.trim();
      if (body.length === 0 || body === "help") {
        return sendHelpText;
      }

      const separator = body.indexOf("|");
      if (separator < 0) {
        await harness.notify({
          destination: "inbox",
          text: body,
          origin: options.origin,
          saveToInbox: true,
        });
        return "saved notification to inbox";
      }

      const target = body.slice(0, separator).trim();
      const text = body.slice(separator + 1).trim();
      if (target.length === 0 || text.length === 0) {
        return sendHelpText;
      }

      if (target === "inbox") {
        await harness.notify({
          destination: "inbox",
          text,
          origin: options.origin,
          saveToInbox: true,
        });
        return "saved notification to inbox";
      }

      if (target === "origin") {
        if (!options.origin) {
          return "No current origin available for /send origin.";
        }

        const result = await harness.notify({
          destination: "origin",
          text,
          origin: options.origin,
          saveToInbox: true,
        });
        if (!result.delivered || !result.target) {
          return "No current origin available for /send origin.";
        }
        return `sent notification to ${result.target.channel}/${result.target.userId}`;
      }

      const result = await harness.notify({
        destination: target,
        text,
        origin: options.origin,
        saveToInbox: true,
      });
      if (!result.delivered || !result.target) {
        return `Cannot route to channel: ${target}`;
      }

      return `sent notification to ${result.target.channel}/${result.target.userId}`;
    },
  },
};

const handleSendCommand: CommandHandler = async (harness, input, options) => {
  return dispatchRegisteredSubcommand(
    harness,
    input,
    options,
    "/send",
    sendHelpText,
    sendSubcommands,
    {
      defaultSubcommand: "default",
      implicitDefault: true,
    },
  );
};

const usageSubcommands: Record<string, RegisteredSubcommand> = {
  default: {
    run: async (harness, args, options) => {
      const requestedId = parseChatId(args);
      if (!args.trim()) {
        return renderUsage(
          "messagesWithUsage",
          await harness.getChatUsage(getScopedChatId(harness, options)),
        );
      }

      if (!requestedId) {
        return usageHelpText;
      }

      return renderUsage(
        "messagesWithUsage",
        await harness.getChatUsage(requestedId),
      );
    },
  },
  project: {
    run: async (harness) =>
      renderUsage("messagesWithUsage", await harness.getProjectUsage()),
  },
  report: {
    help: formatSubcommandHelp(
      "Usage: /usage report",
      "Show a project-wide usage report with totals plus chat, agent, and weekly breakdowns.",
    ),
    run: async (harness) =>
      renderProjectUsageReport(await harness.getProjectUsageReport()),
  },
};

const handleUsageCommand: CommandHandler = async (harness, input, options) => {
  return dispatchRegisteredSubcommand(
    harness,
    input,
    options,
    "/usage",
    usageHelpText,
    usageSubcommands,
    {
      defaultSubcommand: "default",
      implicitDefault: true,
    },
  );
};

const modelSubcommands: Record<string, RegisteredSubcommand> = {
  list: {
    run: async () => renderModelSuggestions(),
  },
};

const handleModelCommand: CommandHandler = async (harness, input, options) => {
  return dispatchRegisteredSubcommand(
    harness,
    input,
    options,
    "/model",
    modelHelpText,
    modelSubcommands,
    {
      defaultSubcommand: "list",
    },
  );
};

const configSubcommands: Record<string, RegisteredSubcommand> = {
  show: {
    run: async (harness) =>
      renderProjectConfig(readCurrentProjectConfig(harness)),
  },
  get: {
    help: "Usage: /config get <key>",
    run: async (harness, args) => {
      const key = args.trim();
      if (key.length === 0) {
        return "Usage: /config get <key>";
      }

      const config = readCurrentProjectConfig(harness);
      if (!(key in config)) {
        return `Unknown config key: ${key}`;
      }

      return String(config[key as keyof typeof config]);
    },
  },
  set: {
    help: "Usage: /config set <key> <value>",
    run: async (harness, args) => {
      const firstSpace = args.indexOf(" ");
      if (firstSpace <= 0) {
        return "Usage: /config set <key> <value>";
      }

      const key = args.slice(0, firstSpace);
      const value = args.slice(firstSpace + 1).trim();
      if (value.length === 0) {
        return "Usage: /config set <key> <value>";
      }

      if (!editableProjectConfigKeys.has(key)) {
        return `Unknown or non-editable config key: ${key}`;
      }

      const parsedValue = parseProjectConfigValue(key, value);
      if (typeof parsedValue === "string") {
        return parsedValue;
      }

      let config;
      try {
        config = await harness.updateProjectConfig(parsedValue);
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }

      return `${key} = ${String(config[key as keyof typeof config])}`;
    },
  },
};

const handleConfigCommand: CommandHandler = async (harness, input, options) => {
  return dispatchRegisteredSubcommand(
    harness,
    input,
    options,
    "/config",
    configHelpText,
    configSubcommands,
    {
      defaultSubcommand: "show",
    },
  );
};

const chatSubcommands: Record<string, RegisteredSubcommand> = {
  show: {
    run: async (harness, args, options) => {
      if (args.length === 0) {
        return renderChatInfo(
          await harness.loadChat(getScopedChatId(harness, options)),
          harness.config.model,
          harness.config.contextMessages,
        );
      }

      const requestedId = parseChatId(args);
      if (!requestedId) {
        return "Chat ids may only contain letters, numbers, dots, underscores, and hyphens.";
      }

      return renderChatInfo(
        await harness.loadChat(requestedId),
        harness.config.model,
        harness.config.contextMessages,
      );
    },
  },
  usage: {
    run: async (harness, args, options) => {
      if (args.length === 0) {
        return renderUsage(
          "messagesWithUsage",
          await harness.getChatUsage(getScopedChatId(harness, options)),
        );
      }

      const requestedId = parseChatId(args);
      if (!requestedId) {
        return "Chat ids may only contain letters, numbers, dots, underscores, and hyphens.";
      }

      return renderUsage(
        "messagesWithUsage",
        await harness.getChatUsage(requestedId),
      );
    },
  },
  list: {
    run: async (harness, _args, options) =>
      renderChatList(
        await harness.listChats(),
        getScopedChatId(harness, options),
      ),
  },
  prune: {
    run: async (harness) => {
      const pruned = await harness.pruneExpiredChats();
      return `pruned expired chats: ${pruned}`;
    },
  },
  new: {
    run: async (harness, args, options) => {
      if (isPinnedChannelContext(options)) {
        return "/chat new is not supported in this channel yet.";
      }

      const result = await harness.createChat(
        args.length > 0 ? args : undefined,
      );
      if (result.error) {
        return result.error;
      }
      if (!result.chat) {
        return "Could not create chat.";
      }

      const chat = await harness.switchChat(result.chat.id);
      return `switched to chat: ${chat.id}`;
    },
  },
  switch: {
    run: async (harness, args, options) => {
      if (isPinnedChannelContext(options)) {
        return "/chat switch is not supported in this channel yet.";
      }

      const requestedId = parseChatId(args);
      if (!requestedId) {
        return "Chat ids may only contain letters, numbers, dots, underscores, and hyphens.";
      }

      const chat = await harness.switchChat(requestedId);
      return `switched to chat: ${chat.id}`;
    },
  },
  fork: {
    run: async (harness, args, options) => {
      if (isPinnedChannelContext(options)) {
        return "/chat fork is not supported in this channel yet.";
      }

      const result = await harness.forkChat(args.trim());
      if (result.error) {
        return result.error;
      }
      if (!result.chat) {
        return "Could not fork chat.";
      }

      return `forked current chat to: ${result.chat.id}`;
    },
  },
  reset: {
    run: async (harness, _args, options) => {
      const chat = await harness.resetChat(getScopedChatId(harness, options));
      return `reset chat: ${chat.id}`;
    },
  },
  compress: {
    run: async (harness, _args, options) => {
      let result;
      try {
        result = await harness.compressChat(getScopedChatId(harness, options));
      } catch (error) {
        return `failed to compress chat: ${
          error instanceof Error ? error.message : String(error)
        }`;
      }

      if (result.removedMessages === 0) {
        return `nothing to compress in chat: ${result.chat.id}`;
      }

      return [
        `compressed chat: ${result.chat.id}`,
        `removedMessages: ${result.removedMessages}`,
        `keptMessages: ${result.keptMessages}`,
      ].join("\n");
    },
  },
  rm: {
    run: async (harness, args, options) => {
      const requestedId = parseChatId(args);
      if (!requestedId) {
        return "Chat ids may only contain letters, numbers, dots, underscores, and hyphens.";
      }

      if (requestedId === getScopedChatId(harness, options)) {
        return "Cannot delete the current chat. Switch to another chat first.";
      }

      const deleted = await harness.deleteChat(requestedId);
      return deleted
        ? `deleted chat: ${requestedId}`
        : `chat not found: ${requestedId}`;
    },
  },
};

const handleChatCommand: CommandHandler = async (harness, input, options) => {
  if (input === "/chats") {
    return handleChatCommand(harness, "/chat list", options);
  }

  if (input.startsWith("/chats ")) {
    return handleChatCommand(
      harness,
      `/chat ${input.slice("/chats ".length)}`,
      options,
    );
  }

  if (input === "/chat") {
    return getScopedChatId(harness, options);
  }

  return dispatchRegisteredSubcommand(
    harness,
    input,
    options,
    "/chat",
    chatHelpText,
    chatSubcommands,
  );
};

const taskSubcommands: Record<string, RegisteredSubcommand> = {
  list: {
    run: async (harness, _args, options) =>
      renderTaskList(
        await harness.listTasks(getScopedChatId(harness, options)),
      ),
  },
  prune: {
    run: async (harness, _args, options) => {
      const pruned = await harness.pruneTasks(
        getScopedChatId(harness, options),
      );
      return `pruned inactive tasks: ${pruned}`;
    },
  },
  schedule: {
    run: async (harness, args, options) => {
      if (args === "help") {
        return taskScheduleHelpText;
      }

      let parsed = parseTaskSchedule(args, harness.config.defaultTaskTime);
      let taskOptions: NotificationOverride = {};

      if (!parsed) {
        const segments = args.split("|").map((segment) => segment.trim());
        if (segments.length >= 4) {
          const parsedOptions = parseTaskScheduleOptions(segments.at(-1) ?? "");
          if (typeof parsedOptions === "string") {
            return parsedOptions;
          }

          parsed = parseTaskSchedule(
            segments.slice(0, -1).join(" | "),
            harness.config.defaultTaskTime,
          );
          taskOptions = parsedOptions;
        }
      }

      if (!parsed) {
        return taskScheduleHelpText;
      }

      const task = await harness.createTask({
        chatId: getScopedChatId(harness, options),
        sourceChatId: getScopedChatId(harness, options),
        createdBy: "user",
        origin: options.origin,
        ...taskOptions,
        title: parsed.title,
        prompt: parsed.prompt,
        schedule: parsed.schedule,
      });

      return `scheduled task: ${task.id}`;
    },
  },
  delete: {
    aliases: ["cancel"],
    run: async (harness, args, options) => {
      const taskId = args.trim();
      if (taskId.length === 0) {
        return "Usage: /task delete <task id>";
      }

      const deleted = await harness.deleteTask(
        taskId,
        getScopedChatId(harness, options),
      );
      return deleted
        ? `cancelled task: ${taskId}`
        : `task not found: ${taskId}`;
    },
  },
};

const handleTaskCommand: CommandHandler = async (harness, input, options) => {
  if (input === "/tasks") {
    return handleTaskCommand(harness, "/task list", options);
  }

  if (input.startsWith("/tasks ")) {
    return handleTaskCommand(
      harness,
      `/task ${input.slice("/tasks ".length)}`,
      options,
    );
  }

  return dispatchRegisteredSubcommand(
    harness,
    input,
    options,
    "/task",
    taskHelpText,
    taskSubcommands,
  );
};

const agentSubcommands: Record<string, RegisteredSubcommand> = {
  list: {
    help: formatSubcommandHelp(
      "Usage: /agent list",
      "List agents in the current project, with running agents shown first.",
    ),
    run: async (harness) => renderAgentList(harness.listAgents()),
  },
  create: {
    help: formatSubcommandHelp(
      "Usage: /agent create <name> | <prompt> [| <json options>]",
      "Create a new agent with its own chat, using the current chat as provenance only.",
      [
        "JSON options can include `toolsets`, `maxSteps`, `timeoutMs`, `stepIntervalMs`, `notify`, and `notifyTarget`.",
      ],
    ),
    run: async (harness, args, options) => {
      const segments = args.split("|").map((segment) => segment.trim());
      if (segments.length < 2) {
        return "Usage: /agent create <name> | <prompt> [| <json options>]";
      }

      const name = segments[0];
      const prompt =
        segments.length === 2 ? segments[1] : segments.slice(1, -1).join(" | ");
      if (name.length === 0 || prompt.length === 0) {
        return "Usage: /agent create <name> | <prompt> [| <json options>]";
      }

      let agentOptions: Pick<
        AgentCreateOptions,
        "maxSteps" | "timeoutMs" | "stepIntervalMs"
      > = {};
      if (segments.length >= 3) {
        const parsedOptions = parseAgentCreateOptions(segments.at(-1) ?? "");
        if (typeof parsedOptions === "string") {
          return parsedOptions;
        }
        agentOptions = parsedOptions;
      }

      const agent = await harness.createAgent({
        name,
        prompt,
        sourceChatId: getScopedChatId(harness, options),
        createdBy: "user",
        origin: options.origin,
        ...agentOptions,
      });
      if (!agent.agent) {
        return agent.error ?? "Could not create agent.";
      }

      return `started agent: ${agent.agent.id}`;
    },
  },
  show: {
    help: formatSubcommandHelp(
      "Usage: /agent show <name>",
      "Show detailed metadata for one agent.",
    ),
    run: async (harness, args) => {
      const agentRef = args.trim();
      if (agentRef.length === 0) {
        return "Usage: /agent show <name>";
      }

      const agent = harness.findAgent(agentRef);
      return agent ? renderAgentInfo(agent) : `agent not found: ${agentRef}`;
    },
  },
  rm: {
    help: formatSubcommandHelp(
      "Usage: /agent rm <name>",
      "Stop and delete an agent, including its saved chat and memory.",
    ),
    run: async (harness, args) => {
      const agentRef = args.trim();
      if (agentRef.length === 0) {
        return "Usage: /agent rm <name>";
      }

      const removed = await harness.removeAgent(agentRef);
      return removed
        ? `deleted agent: ${removed.name}`
        : `agent not found: ${agentRef}`;
    },
  },
  send: {
    help: formatSubcommandHelp(
      "Usage: /agent send <name> | <message>",
      "Send a message into an agent's inbox without switching into its chat.",
    ),
    run: async (harness, args, options) => {
      const separatorIndex = args.indexOf("|");
      if (separatorIndex < 0) {
        return "Usage: /agent send <name> | <message>";
      }

      const agentRef = args.slice(0, separatorIndex).trim();
      const text = args.slice(separatorIndex + 1).trim();
      if (agentRef.length === 0 || text.length === 0) {
        return "Usage: /agent send <name> | <message>";
      }

      const entry = await harness.sendAgentInboxMessage({
        agentRef,
        text,
        sourceType: "user",
        sourceId: options.origin?.userId ?? "user",
        sourceName: options.origin?.userId,
        sourceChatId: getScopedChatId(harness, options),
      });
      return entry
        ? `sent message to agent: ${agentRef}`
        : `agent not found: ${agentRef}`;
    },
  },
  inbox: {
    help: formatSubcommandHelp(
      "Usage: /agent inbox <name>",
      "Show or manage one agent's inbox messages.",
      [
        "Use `/agent inbox clear <name>` to remove all inbox messages.",
        "Use `/agent inbox rm <name> <id>` to remove one inbox message.",
      ],
    ),
    run: async (harness, args) => {
      if (args.startsWith("clear ")) {
        const agentRef = args.slice("clear ".length).trim();
        if (agentRef.length === 0) {
          return "Usage: /agent inbox clear <name>";
        }

        const cleared = await harness.clearAgentInbox(agentRef);
        return cleared === undefined
          ? `agent not found: ${agentRef}`
          : `cleared agent inbox: ${cleared}`;
      }

      if (args.startsWith("rm ")) {
        const body = args.slice("rm ".length).trim();
        const spaceIndex = body.lastIndexOf(" ");
        if (spaceIndex < 0) {
          return "Usage: /agent inbox rm <name> <id>";
        }

        const agentRef = body.slice(0, spaceIndex).trim();
        const entryId = body.slice(spaceIndex + 1).trim();
        if (agentRef.length === 0 || entryId.length === 0) {
          return "Usage: /agent inbox rm <name> <id>";
        }

        const deleted = await harness.deleteAgentInboxEntry(agentRef, entryId);
        return deleted
          ? `deleted agent inbox entry: ${entryId}`
          : `agent inbox entry not found: ${entryId}`;
      }

      const agentRef = args.trim();
      if (agentRef.length === 0) {
        return "Usage: /agent inbox <name>";
      }

      const entries = await harness.listAgentInbox(agentRef);
      return entries
        ? renderAgentInbox(entries)
        : `agent not found: ${agentRef}`;
    },
  },
  prune: {
    help: formatSubcommandHelp(
      "Usage: /agent prune [now|<age like 1h, 30m, 2d>]",
      "Delete inactive agents, defaulting to agents older than 24 hours.",
    ),
    run: async (harness, args) => {
      const trimmed = args.trim();
      if (trimmed.length === 0) {
        const pruned = await harness.pruneAgents();
        return `pruned inactive agents older than 24h: ${pruned}`;
      }

      const age = parseAgentPruneAge(trimmed);
      if (age === undefined) {
        return "Usage: /agent prune [now|<age like 1h, 30m, 2d>]";
      }

      const pruned = await harness.pruneAgents({ olderThanMs: age });
      if (age === 0) {
        return `pruned inactive agents: ${pruned}`;
      }

      return `pruned inactive agents older than ${trimmed}: ${pruned}`;
    },
  },
  chat: {
    help: formatSubcommandHelp(
      "Usage: /agent chat <name>",
      "Pause an agent and switch the REPL into that agent's chat.",
    ),
    run: async (harness, args, options) => {
      if (options.chatId) {
        return "/agent chat is not supported in this channel yet.";
      }

      const agentRef = args.trim();
      if (agentRef.length === 0) {
        return "Usage: /agent chat <name>";
      }

      const result = await harness.attachAgentChat(agentRef);
      if (!result.agent) {
        return result.error ?? `agent not found: ${agentRef}`;
      }

      return `paused agent: ${result.agent.name}\nswitched to chat: ${result.chatId}`;
    },
  },
  tail: {
    help: formatSubcommandHelp(
      "Usage: /agent tail [-f] <name> [N]",
      "Show the latest messages from one agent's chat.",
      [
        "`N` defaults to 1 assistant message.",
        "Use `-f` in the REPL to keep following new messages as they arrive.",
      ],
    ),
    run: async (harness, args) => {
      const parsed = parseAgentTailArgs(args);
      if (parsed.error || !parsed.agentRef) {
        return "Usage: /agent tail [-f] <name> [N]";
      }

      if (parsed.follow) {
        return "/agent tail -f is only supported in the REPL right now.";
      }

      const agent = harness.findAgent(parsed.agentRef);
      if (!agent) {
        return `agent not found: ${parsed.agentRef}`;
      }

      const chat = await harness.loadChat(agent.chatId);
      return tailAgentMessages(chat.messages, parsed.count);
    },
  },
  return: {
    help: formatSubcommandHelp(
      "Usage: /agent return <name>",
      "Switch back to the previous chat and resume the paused agent.",
    ),
    run: async (harness, args, options) => {
      if (options.chatId) {
        return "/agent return is not supported in this channel yet.";
      }

      const agentRef = args.trim();
      if (agentRef.length === 0) {
        return "Usage: /agent return <name>";
      }

      const result = await harness.returnAgentChat(agentRef);
      if (!result.agent) {
        return result.error ?? `agent not found: ${agentRef}`;
      }

      return `resumed agent: ${result.agent.name}\nswitched to chat: ${result.chatId}`;
    },
  },
  stop: {
    help: formatSubcommandHelp(
      "Usage: /agent stop <name>",
      "Cancel a running agent without deleting its records.",
    ),
    run: async (harness, args) => {
      const agentRef = args.trim();
      if (agentRef.length === 0) {
        return "Usage: /agent stop <name>";
      }

      const agent = harness.cancelAgent(agentRef);
      return agent
        ? `stopped agent: ${agent.name}`
        : `agent not found: ${agentRef}`;
    },
  },
  pause: {
    help: formatSubcommandHelp(
      "Usage: /agent pause <name>",
      "Pause a running agent so it stops taking new steps.",
    ),
    run: async (harness, args) => {
      const agentRef = args.trim();
      if (agentRef.length === 0) {
        return "Usage: /agent pause <name>";
      }

      const agent = harness.pauseAgent(agentRef);
      return agent
        ? `paused agent: ${agent.name}`
        : `agent not found: ${agentRef}`;
    },
  },
  resume: {
    help: formatSubcommandHelp(
      "Usage: /agent resume <name>",
      "Resume a paused agent.",
    ),
    run: async (harness, args) => {
      const agentRef = args.trim();
      if (agentRef.length === 0) {
        return "Usage: /agent resume <name>";
      }

      const agent = harness.resumeAgent(agentRef);
      return agent
        ? `resumed agent: ${agent.name}`
        : `agent not found: ${agentRef}`;
    },
  },
  steer: {
    help: formatSubcommandHelp(
      "Usage: /agent steer <name> | <prompt>",
      "Queue a steering message for an agent while it keeps working in its own chat.",
    ),
    run: async (harness, args) => {
      const separatorIndex = args.indexOf("|");
      if (separatorIndex < 0) {
        return "Usage: /agent steer <name> | <prompt>";
      }

      const agentRef = args.slice(0, separatorIndex).trim();
      const prompt = args.slice(separatorIndex + 1).trim();
      if (agentRef.length === 0 || prompt.length === 0) {
        return "Usage: /agent steer <name> | <prompt>";
      }

      const agent = await harness.steerAgent(agentRef, prompt);
      return agent
        ? `steered agent: ${agent.name}`
        : `agent not found: ${agentRef}`;
    },
  },
};

const handleAgentCommand: CommandHandler = async (harness, input, options) => {
  if (input === "/agents") {
    return handleAgentCommand(harness, "/agent list", options);
  }

  return dispatchRegisteredSubcommand(
    harness,
    input,
    options,
    "/agent",
    agentHelpText,
    agentSubcommands,
  );
};

const skillsSubcommands: Record<string, RegisteredSubcommand> = {
  list: {
    run: async (harness) => {
      const skills = await harness.listSkills();
      return skills.length === 0
        ? "No skills found."
        : skills
            .map((skill) => `- ${skill.name}: ${skill.description}`)
            .join("\n");
    },
  },
};

const handleSkillsCommand: CommandHandler = async (harness, input, options) => {
  return dispatchRegisteredSubcommand(
    harness,
    input,
    options,
    "/skills",
    "Usage: /skills",
    skillsSubcommands,
    {
      defaultSubcommand: "list",
    },
  );
};

const toolCategoryOrder = [
  "Project",
  "Chats",
  "Agents",
  "Tasks",
  "Notifications",
  "Files",
  "Shell",
  "Skills",
  "Utilities",
] as const;

const defaultToolCategory = "Utilities";

const renderTools = (
  permissions: string,
  toolsets: ReturnType<Harness["listToolsets"]>,
  tools: ReturnType<Harness["listTools"]>,
): string => {
  if (tools.length === 0) {
    return `permissions: ${permissions}\nNo tools found.`;
  }

  const grouped = new Map<string, typeof tools>();
  for (const category of toolCategoryOrder) {
    grouped.set(category, []);
  }

  for (const tool of tools) {
    const category = tool.category ?? defaultToolCategory;
    if (!grouped.has(category)) {
      grouped.set(category, []);
    }
    grouped.get(category)?.push(tool);
  }

  return [
    `**Permissions:** ${permissions}`,
    ...(toolsets.length > 0
      ? [
          "",
          "## Toolsets",
          ...toolsets.map(
            (toolset) => `- ${toolset.name}: ${toolset.description}`,
          ),
        ]
      : []),
    ...Array.from(grouped.entries()).flatMap(([category, entries]) => {
      if (entries.length === 0) {
        return [];
      }

      return [
        "",
        `## ${category}`,
        ...entries.map(
          (tool) => `- ${tool.name} [${tool.permission}]: ${tool.description}`,
        ),
      ];
    }),
  ].join("\n");
};

const toolsSubcommands: Record<string, RegisteredSubcommand> = {
  list: {
    run: async (harness) => {
      const tools = harness.listTools();
      const toolsets = harness.listToolsets();
      const permissions = harness.config.tools.join(", ");
      return renderTools(permissions, toolsets, tools);
    },
  },
};

const handleToolsCommand: CommandHandler = async (harness, input, options) => {
  return dispatchRegisteredSubcommand(
    harness,
    input,
    options,
    "/tools",
    toolsHelpText,
    toolsSubcommands,
    {
      defaultSubcommand: "list",
    },
  );
};

const historySubcommands: Record<string, RegisteredSubcommand> = {
  show: {
    run: async (harness, _args, options) =>
      harness.getChatTranscript(options.chatId),
  },
};

const handleHistoryCommand: CommandHandler = async (
  harness,
  input,
  options,
) => {
  return dispatchRegisteredSubcommand(
    harness,
    input,
    options,
    "/history",
    "Usage: /history",
    historySubcommands,
    {
      defaultSubcommand: "show",
    },
  );
};

const parseTeleportFlagValue = (
  value: string,
  name: string,
): string | undefined => {
  const index = value.indexOf(name);
  if (index < 0) {
    return undefined;
  }

  const remainder = value.slice(index + name.length).trimStart();
  if (remainder.length === 0) {
    return undefined;
  }

  const nextSpace = remainder.indexOf(" ");
  return (nextSpace < 0 ? remainder : remainder.slice(0, nextSpace)).trim();
};

const removeTeleportFlag = (value: string, name: string): string => {
  const pattern = new RegExp(
    `${name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\s+\\S+`,
    "u",
  );
  return value.replace(pattern, "").trim();
};

export const parseTeleportConnectArgs = (
  args: string,
): { requestedChatId?: string; requestedProject?: string; target?: string } => {
  const body = args.trim();
  const requestedProject = parseTeleportFlagValue(body, "--project");
  const requestedChatId = parseTeleportFlagValue(body, "--chat");
  const target =
    removeTeleportFlag(
      removeTeleportFlag(body, "--project"),
      "--chat",
    ).trim() || undefined;

  return {
    requestedChatId,
    requestedProject,
    target,
  };
};

const renderTeleportStatus = (
  target: ReturnType<TeleportControl["getTarget"]>,
): string =>
  !target
    ? "teleport: disconnected"
    : [
        "teleport: connected",
        `target: ${target.target}`,
        `project: ${target.project ?? "(default)"}`,
        `chat: ${target.chatId}`,
      ].join("\n");

const renderTeleportRemotes = (
  remotes: ReturnType<TeleportControl["listRemotes"]>,
): string =>
  remotes.length === 0
    ? "No remotes configured."
    : remotes
        .map((remote) => `- ${remote.name}: ${summarizeRemote(remote)}`)
        .join("\n");

const handleTeleportCommand: CommandHandler = async (
  harness,
  input,
  options,
) => {
  if (input === "/teleport") {
    return teleportHelpText;
  }

  const teleportSubcommands: Record<string, RegisteredSubcommand> = {
    status: {
      run: async () => renderTeleportStatus(options.teleport?.getTarget()),
    },
    list: {
      run: async () =>
        options.teleport
          ? renderTeleportRemotes(options.teleport.listRemotes())
          : "Teleport is not supported in this interface yet.",
    },
    disconnect: {
      run: async () => {
        if (!options.teleport) {
          return "Teleport is not supported in this interface yet.";
        }

        await options.teleport.disconnect();
        return "teleport: disconnected";
      },
    },
    connect: {
      help: teleportHelpText,
      run: async (_teleportHarness, args) => {
        if (!options.teleport) {
          return "Teleport is not supported in this interface yet.";
        }

        const { requestedProject, requestedChatId, target } =
          parseTeleportConnectArgs(args);
        if (!target) {
          return teleportHelpText;
        }

        let attachedTarget;
        try {
          attachedTarget = await options.teleport.connect(target, {
            project: requestedProject,
            chatId: requestedChatId ?? getScopedChatId(harness, options),
          });
        } catch (error) {
          return error instanceof Error ? error.message : String(error);
        }

        return `attached to remote: ${attachedTarget.target}\n${renderTeleportStatus(attachedTarget)}`;
      },
    },
  };

  return dispatchRegisteredSubcommand(
    harness,
    input,
    options,
    "/teleport",
    teleportHelpText,
    teleportSubcommands,
    {
      implicitDefault: true,
      defaultSubcommand: "connect",
    },
  );
};

const handleRemoteCommand: CommandHandler = async (harness, input, options) => {
  if (input === "/remotes") {
    return handleRemoteCommand(harness, "/remote list", options);
  }

  if (input.startsWith("/remotes ")) {
    return handleRemoteCommand(
      harness,
      `/remote ${input.slice("/remotes ".length)}`,
      options,
    );
  }

  const serverConfig = await loadEditableServerConfig();
  const remotes = [...(serverConfig.remotes ?? [])];
  const findRemoteConfig = (name: string): RemoteConfig | string => {
    if (!name) {
      return "remote name is required";
    }

    return (
      remotes.find((entry) => entry.name === name) ??
      `remote not found: ${name}`
    );
  };

  const remoteSubcommands: Record<string, RegisteredSubcommand> = {
    list: {
      run: async () => renderRemoteList(remotes),
    },
    show: {
      help: "Usage: /remote show <name>",
      run: async (_remoteHarness, args) => {
        const name = args.trim();
        if (!name) {
          return "Usage: /remote show <name>";
        }

        const remote = findRemoteConfig(name);
        return typeof remote === "string" ? remote : renderRemoteInfo(remote);
      },
    },
    bootstrap: {
      help: "Usage: /remote bootstrap <name>",
      run: async (_remoteHarness, args) => {
        const name = args.trim();
        if (!name) {
          return "Usage: /remote bootstrap <name>";
        }

        const remote = findRemoteConfig(name);
        if (typeof remote === "string") {
          return remote;
        }

        const result = await createRemote(remote).bootstrap({
          project: harness.config,
          server: serverConfig,
        });
        return formatRemoteActionResult("bootstrap", name, result);
      },
    },
    start: {
      help: "Usage: /remote start <name>",
      run: async (_remoteHarness, args) => {
        const name = args.trim();
        if (!name) {
          return "Usage: /remote start <name>";
        }

        const remote = findRemoteConfig(name);
        if (typeof remote === "string") {
          return remote;
        }

        const result = await createRemote(remote).start({
          project: harness.config,
          server: serverConfig,
        });
        return formatRemoteActionResult("start", name, result);
      },
    },
    stop: {
      help: "Usage: /remote stop <name>",
      run: async (_remoteHarness, args) => {
        const name = args.trim();
        if (!name) {
          return "Usage: /remote stop <name>";
        }

        const remote = findRemoteConfig(name);
        if (typeof remote === "string") {
          return remote;
        }

        const result = await createRemote(remote).stop({
          project: harness.config,
          server: serverConfig,
        });
        return formatRemoteActionResult("stop", name, result);
      },
    },
    rm: {
      help: "Usage: /remote rm <name>",
      run: async (_remoteHarness, args) => {
        const name = args.trim();
        if (!name) {
          return "Usage: /remote rm <name>";
        }

        const nextRemotes = remotes.filter((entry) => entry.name !== name);
        if (nextRemotes.length === remotes.length) {
          return `remote not found: ${name}`;
        }

        serverConfig.remotes = nextRemotes.length > 0 ? nextRemotes : undefined;
        await saveEditableServerConfig(serverConfig);
        return `deleted remote: ${name}`;
      },
    },
    create: {
      help: "Usage: /remote create <json>",
      run: async (_remoteHarness, args) => {
        const body = args.trim();
        if (!body) {
          return "Interactive /remote create is not supported yet. Use /remote create <json>.";
        }

        const remote = parseRemoteCreateJson(body);
        if (typeof remote === "string") {
          return remote;
        }

        serverConfig.remotes = [
          ...remotes.filter((entry) => entry.name !== remote.name),
          remote,
        ];
        await saveEditableServerConfig(serverConfig);
        return `saved remote: ${remote.name}`;
      },
    },
  };

  return dispatchRegisteredSubcommand(
    harness,
    input,
    {},
    "/remote",
    remoteHelpText,
    remoteSubcommands,
  );
};

const handleNewCommand: CommandHandler = async (harness, input, options) => {
  if (input === "/new") {
    return handleChatCommand(harness, "/chat new", options);
  }

  if (input.startsWith("/new ")) {
    return handleChatCommand(
      harness,
      `/chat new ${input.slice("/new ".length).trim()}`,
      options,
    );
  }

  return handleChatCommand(harness, "/chat new", options);
};

const handleSwitchCommand: CommandHandler = async (harness, input, options) => {
  if (input === "/switch" || input === "/switch help") {
    return "Usage: /switch <chat id>";
  }

  if (input.startsWith("/switch ")) {
    return handleChatCommand(
      harness,
      `/chat switch ${input.slice("/switch ".length).trim()}`,
      options,
    );
  }

  return "Usage: /switch <chat id>";
};

const handleResetCommand: CommandHandler = async (harness, input, options) => {
  if (input === "/reset") {
    return handleChatCommand(harness, "/chat reset", options);
  }

  if (input.startsWith("/reset")) {
    return "Usage: /reset";
  }

  return handleChatCommand(harness, "/chat reset", options);
};

const handleForkCommand: CommandHandler = async (harness, input, options) => {
  if (input === "/fork") {
    return handleChatCommand(harness, "/chat fork", options);
  }

  if (input.startsWith("/fork ")) {
    return handleChatCommand(
      harness,
      `/chat fork ${input.slice("/fork ".length).trim()}`,
      options,
    );
  }

  return handleChatCommand(harness, "/chat fork", options);
};

const handleCostCommand: CommandHandler = async (harness, _input, options) =>
  handleUsageCommand(harness, "/usage report", options);

const commandHandlers: Record<string, CommandHandler> = {
  help: handleHelpCommand,
  new: handleNewCommand,
  switch: handleSwitchCommand,
  fork: handleForkCommand,
  reset: handleResetCommand,
  send: handleSendCommand,
  inbox: handleInboxCommand,
  save: handleSaveCommand,
  compress: handleCompressCommand,
  usage: handleUsageCommand,
  cost: handleCostCommand,
  model: handleModelCommand,
  project: handleProjectCommand,
  projects: handleProjectCommand,
  config: handleConfigCommand,
  chat: handleChatCommand,
  chats: handleChatCommand,
  task: handleTaskCommand,
  tasks: handleTaskCommand,
  agent: handleAgentCommand,
  agents: handleAgentCommand,
  tools: handleToolsCommand,
  skills: handleSkillsCommand,
  history: handleHistoryCommand,
  remote: handleRemoteCommand,
  remotes: handleRemoteCommand,
  teleport: handleTeleportCommand,
};

// Parses user input and dispatches it to a project.
export const dispatchCommand = async (
  harness: Harness,
  input: string,
  options: DispatchOptions = {},
): Promise<string | null> => {
  if (input === "/chats") {
    return handleChatCommand(harness, "/chat list", options);
  }

  if (input === "?") {
    return helpText;
  }

  if (!input.startsWith("/")) {
    return null;
  }

  const commandName = input.slice(1).trim().split(/\s+/u, 1)[0] ?? "";
  const handler = commandHandlers[commandName];
  if (!handler) {
    return helpText;
  }

  return handler(harness, input, options);
};

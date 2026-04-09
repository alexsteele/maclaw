import { Harness, type AgentCreateOptions } from "./harness.js";
import { initProjectConfig, loadConfig, parseConfiguredModel } from "./config.js";
import {
  editableProjectConfigKeys,
  parseProjectConfigValue,
  renderProjectConfig,
} from "./project-config.js";
import { renderModelSuggestions } from "./models.js";
import { parseTaskSchedule } from "./task.js";
import type {
  AgentRecord,
  InboxEntry,
  NotificationOverride,
  NotificationPolicy,
  NotificationTarget,
  Origin,
  TaskSchedule,
  UsageSummary,
} from "./types.js";

type DispatchOptions = {
  chatId?: string;
  origin?: Origin;
};

export const helpText = [
  "Commands:",
  "  /help              Show this help",
  "  /new               Create and switch to a new chat",
  "  /fork              Fork the current chat",
  "  /reset             Clear the current chat",
  "  /compress          Compress the current chat",
  "  /save              Save the current chat transcript to a file",
  "  /usage             Show token usage for the current chat",
  "  /model             Show suggested models",
  "  /config            Project config commands",
  "  /project           Project information commands",
  "  /chat              Chat management commands",
  "  /history           Show the current chat transcript",
  "  /tools             Show the current tools",
  "  /skills            List local skills",
  "  /agent             Agent management commands",
  "  /task              Task scheduling commands",
  "  /send              Send a test notification",
  "  /inbox             Show saved notifications",
].join("\n");

export const projectHelpText = [
  "Command: /project",
  "  /project           Show the active project",
  "  /project show      Show the active project",
  "  /project usage     Show token usage for the project",
  "  /project init      Create .maclaw/maclaw.json for this project",
  "  /project wipeout   Delete .maclaw/ for this project after confirmation",
].join("\n");

export const configHelpText = [
  "Command: /config",
  "  /config                Show the current project config",
  "  /config show           Show the current project config",
  "  /config get <key>      Show one config value",
  "  /config set <key> <v>  Update a config value",
  "",
  "Editable keys:",
  ...Array.from(editableProjectConfigKeys, (key) => `  ${key}`),
].join("\n");

export const chatHelpText = [
  "Command: /chat",
  "  /chat              Show the current chat id",
  "  /chat show [X]     Show the current or named chat",
  "  /chat usage [X]    Show token usage for the current or named chat",
  "  /chat list         List saved chats",
  "  /chat new [X]      Create and switch to a new chat",
  "  /chat switch X     Switch to chat X",
  "  /chat fork [X]     Fork the current chat and switch to it",
  "  /chat reset        Clear the current chat",
  "  /chat compress     Compress the current chat",
  "  /chat rm X         Delete chat X",
].join("\n");

export const modelHelpText = [
  "Command: /model",
  "  /model              Show suggested models",
  "  /model list         Show suggested models",
].join("\n");

export const taskHelpText = [
  "Command: /task",
  "  /task list",
  "  /task schedule <date> | <title> | <prompt> [| <json options>]",
  "  /task delete <task id>",
  "  /task cancel <task id>",
  "",
  "Run /help task schedule for scheduling syntax and examples.",
].join("\n");

export const taskScheduleHelpText = [
  "Command: /task schedule",
  "  /task schedule <date> | <title> | <prompt> [| <json options>]",
  "  /task schedule once <today|tomorrow|now|4/5/2026 [9:00 AM]> | <title> | <prompt> [| <json options>]",
  "  /task schedule hourly | <title> | <prompt> [| <json options>]",
  "  /task schedule daily 9:00 AM | <title> | <prompt> [| <json options>]",
  "  /task schedule weekly mon,wed,fri 5:30 PM | <title> | <prompt> [| <json options>]",
  "",
  "One-time schedules:",
  "  today",
  "  tomorrow",
  "  now",
  "  4/5/2026",
  "  4/5/2026 9:00 AM",
  "",
  "Notes:",
  "  Date-only one-time schedules use the project's defaultTaskTime.",
  "  JSON options currently support notify and notifyTarget overrides.",
  "",
  "Examples:",
  "  /task schedule once today | Daily Brief | Send the brief",
  "  /task schedule once tomorrow 5:30 PM | Check In | Ask me how the day went",
  '  /task schedule daily 9:00 AM | Daily Brief | Send the brief | {"notify":"none"}',
].join("\n");

export const agentHelpText = [
  "Command: /agent",
  "  /agent",
  "  /agent list",
  "  /agent create <name> | <prompt> [| <json options>]",
  "  /agent chat <name>",
  "  /agent return <name>",
  "  /agent show <name>",
  "  /agent pause <name>",
  "  /agent resume <name>",
  "  /agent stop <name>",
  "  /agent steer <name> | <prompt>",
].join("\n");

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
  "  /send inbox | <message>      Save a test notification to the inbox",
  "  /send origin | <message>     Send a test notification to the current origin",
  "  /send <channel> | <message>  Send to the current origin when it matches the channel",
].join("\n");

export const usageHelpText = [
  "Command: /usage",
  "  /usage             Show token usage for the current chat",
  "  /usage <chat>      Show token usage for a named chat",
  "  /usage project     Show token usage for the project",
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
    `stepIntervalMs: ${agent.stepIntervalMs ?? 0}`,
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
    `model: ${projectConfig.model}`,
    `modelProvider: ${parseConfiguredModel(projectConfig.model).provider}`,
    `storage: ${projectConfig.storage}`,
    `tools: ${JSON.stringify(projectConfig.tools)}`,
    `notifications: ${JSON.stringify(projectConfig.notifications)}`,
    `defaultTaskTime: ${projectConfig.defaultTaskTime}`,
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
    .map(
      (entry) =>
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
  if (value === "origin") {
    return "origin";
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
  if (typeof object.channel !== "string" || object.channel.trim().length === 0) {
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
    ...(typeof object.conversationId === "string" ? { conversationId: object.conversationId } : {}),
    ...(typeof object.threadId === "string" ? { threadId: object.threadId } : {}),
  };
};

const parseNotificationOverride = (value: unknown): NotificationOverride | string => {
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
      return "notifyTarget must be 'origin', { channel }, or a full notification target object";
    }

    override.notifyTarget = notifyTarget;
  }

  return override;
};

const parseAgentCreateOptions = (
  value: string,
): Pick<
  AgentCreateOptions,
  "maxSteps" | "timeoutMs" | "stepIntervalMs" | "notify" | "notifyTarget"
> | string => {
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
    if (!["maxSteps", "timeoutMs", "stepIntervalMs", "notify", "notifyTarget"].includes(key)) {
      return `Unknown agent option: ${key}`;
    }
  }

  const notificationOverride = parseNotificationOverride(optionsObject);
  if (typeof notificationOverride === "string") {
    return notificationOverride;
  }

  return {
    maxSteps: optionsObject.maxSteps as AgentCreateOptions["maxSteps"],
    timeoutMs: optionsObject.timeoutMs as AgentCreateOptions["timeoutMs"],
    stepIntervalMs: optionsObject.stepIntervalMs as AgentCreateOptions["stepIntervalMs"],
    ...notificationOverride,
  };
};

const parseTaskScheduleOptions = (value: string): NotificationOverride | string => {
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
  if (input === "/help") {
    return helpText;
  }

  if (input === "/help config") {
    return configHelpText;
  }

  if (input === "/help save") {
    return saveHelpText;
  }

  if (input === "/help model") {
    return modelHelpText;
  }

  if (input === "/help compress") {
    return compressHelpText;
  }

  if (input === "/help usage") {
    return usageHelpText;
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

  if (input === "/help task schedule") {
    return taskScheduleHelpText;
  }

  if (input === "/help agent") {
    return agentHelpText;
  }

  if (input === "/help tools") {
    return toolsHelpText;
  }

  if (input.startsWith("/help")) {
    return helpText;
  }

  return helpText;
};

const handleProjectCommand: CommandHandler = async (harness, input, options) => {
  if (input === "/project help") {
    return projectHelpText;
  }

  if (input === "/project" || input === "/project show") {
    return renderProjectInfo(harness, getScopedChatId(harness, options));
  }

  if (input === "/project usage") {
    return renderUsage("messagesWithUsage", await harness.getProjectUsage());
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

  if (input === "/project wipeout") {
    if (!harness.isProjectInitialized()) {
      return "project is not initialized";
    }

    return (
      "This will delete the project's .maclaw folder, including chats, tasks, agents, and config.\n" +
      "Run /project wipeout confirm to continue."
    );
  }

  if (input === "/project wipeout confirm") {
    const wiped = await harness.wipeProject();
    if (!wiped) {
      return "project is not initialized";
    }

    return (
      "deleted project data: .maclaw\n" +
      `project is now headless at: ${harness.config.projectFolder}`
    );
  }

  if (input.startsWith("/project")) {
    return projectHelpText;
  }

  return projectHelpText;
};

const handleSaveCommand: CommandHandler = async (harness, input, options) => {
  if (input === "/save") {
    const savedPath = await harness.saveChatTranscript(undefined, options.chatId);
    return `saved chat transcript to: ${savedPath}`;
  }

  if (input === "/save help") {
    return saveHelpText;
  }

  if (input.startsWith("/save ")) {
    const outputPath = input.slice("/save ".length).trim();
    if (outputPath.length === 0) {
      return saveHelpText;
    }

    const savedPath = await harness.saveChatTranscript(outputPath, options.chatId);
    return `saved chat transcript to: ${savedPath}`;
  }

  return saveHelpText;
};

const handleCompressCommand: CommandHandler = async (harness, input, options) => {
  if (input === "/compress") {
    return handleChatCommand(harness, "/chat compress", options);
  }

  if (input === "/compress help" || input.startsWith("/compress ")) {
    return compressHelpText;
  }

  return compressHelpText;
};

const handleInboxCommand: CommandHandler = async (harness, input) => {
  if (input === "/inbox") {
    return renderInbox(await harness.listInbox());
  }

  if (input === "/inbox clear") {
    const cleared = await harness.clearInbox();
    return `cleared inbox: ${cleared}`;
  }

  if (input.startsWith("/inbox rm ")) {
    const entryId = input.slice("/inbox rm ".length).trim();
    if (entryId.length === 0) {
      return "Usage: /inbox rm <id>";
    }

    return (await harness.deleteInboxEntry(entryId))
      ? `deleted inbox entry: ${entryId}`
      : `inbox entry not found: ${entryId}`;
  }

  if (input === "/inbox help" || input.startsWith("/inbox ")) {
    return inboxHelpText;
  }

  return inboxHelpText;
};

const handleSendCommand: CommandHandler = async (harness, input, options) => {
  if (input === "/send") {
    return sendHelpText;
  }

  if (input === "/send help" || input.startsWith("/send ")) {
    const body = input.slice("/send".length).trim();
    if (body.length === 0 || body === "help") {
      return sendHelpText;
    }

    const separator = body.indexOf("|");
    if (separator < 0) {
      await harness.sendManualNotification({
        text: body,
        origin: options.origin,
        deliver: false,
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
      await harness.sendManualNotification({
        text,
        origin: options.origin,
        deliver: false,
        saveToInbox: true,
      });
      return "saved notification to inbox";
    }

    if (target === "origin") {
      if (!options.origin) {
        return "No current origin available for /send origin.";
      }

      await harness.sendManualNotification({
        text,
        origin: options.origin,
        deliver: true,
        saveToInbox: true,
      });
      return `sent notification to ${options.origin.channel}/${options.origin.userId}`;
    }

    if (!options.origin || options.origin.channel !== target) {
      return `Cannot route to channel: ${target}`;
    }

    await harness.sendManualNotification({
      text,
      origin: options.origin,
      deliver: true,
      saveToInbox: true,
    });
    return `sent notification to ${options.origin.channel}/${options.origin.userId}`;
  }

  return sendHelpText;
};

const handleUsageCommand: CommandHandler = async (harness, input, options) => {
  if (input === "/usage") {
    return renderUsage("messagesWithUsage", await harness.getChatUsage(getScopedChatId(harness, options)));
  }

  if (input === "/usage help") {
    return usageHelpText;
  }

  if (input === "/usage project") {
    return renderUsage("messagesWithUsage", await harness.getProjectUsage());
  }

  if (input.startsWith("/usage ")) {
    const requestedId = parseChatId(input.slice("/usage ".length));
    if (!requestedId) {
      return usageHelpText;
    }

    return renderUsage("messagesWithUsage", await harness.getChatUsage(requestedId));
  }

  return usageHelpText;
};

const handleModelCommand: CommandHandler = async (_harness, input) => {
  if (input === "/model" || input === "/model list") {
    return renderModelSuggestions();
  }

  if (input === "/model help" || input.startsWith("/model ")) {
    return modelHelpText;
  }

  return modelHelpText;
};

const handleConfigCommand: CommandHandler = async (harness, input) => {
  if (input === "/config help") {
    return configHelpText;
  }

  if (input === "/config" || input === "/config show") {
    return renderProjectConfig(readCurrentProjectConfig(harness));
  }

  if (input.startsWith("/config get ")) {
    const key = input.slice("/config get ".length).trim();
    if (key.length === 0) {
      return "Usage: /config get <key>";
    }

    const config = readCurrentProjectConfig(harness);
    if (!(key in config)) {
      return `Unknown config key: ${key}`;
    }

    return String(config[key as keyof typeof config]);
  }

  if (input.startsWith("/config set ")) {
    const body = input.slice("/config set ".length).trim();
    const firstSpace = body.indexOf(" ");
    if (firstSpace <= 0) {
      return "Usage: /config set <key> <value>";
    }

    const key = body.slice(0, firstSpace);
    const value = body.slice(firstSpace + 1).trim();
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

    await initProjectConfig(harness.config.projectFolder, parsedValue);
    const config = await harness.reloadConfig();
    return `${key} = ${String(config[key as keyof typeof config])}`;
  }

  return configHelpText;
};

const handleChatCommand: CommandHandler = async (harness, input, options) => {
  if (input === "/chat help") {
    return chatHelpText;
  }

  if (input === "/chat") {
    return getScopedChatId(harness, options);
  }

  if (input === "/chat show") {
    return renderChatInfo(
      await harness.loadChat(getScopedChatId(harness, options)),
      harness.config.model,
      harness.config.contextMessages,
    );
  }

  if (input === "/chat usage") {
    return renderUsage("messagesWithUsage", await harness.getChatUsage(getScopedChatId(harness, options)));
  }

  if (input.startsWith("/chat show ")) {
    const requestedId = parseChatId(input.slice("/chat show ".length));
    if (!requestedId) {
      return "Chat ids may only contain letters, numbers, dots, underscores, and hyphens.";
    }

    return renderChatInfo(
      await harness.loadChat(requestedId),
      harness.config.model,
      harness.config.contextMessages,
    );
  }

  if (input.startsWith("/chat usage ")) {
    const requestedId = parseChatId(input.slice("/chat usage ".length));
    if (!requestedId) {
      return "Chat ids may only contain letters, numbers, dots, underscores, and hyphens.";
    }

    return renderUsage("messagesWithUsage", await harness.getChatUsage(requestedId));
  }

  if (input === "/chat list") {
    return renderChatList(await harness.listChats(), getScopedChatId(harness, options));
  }

  if (input === "/chat new" || input.startsWith("/chat new ")) {
    if (isPinnedChannelContext(options)) {
      return "/chat new is not supported in this channel yet.";
    }

    const requestedId = input.slice("/chat new".length).trim();
    const result = await harness.createChat(requestedId.length > 0 ? requestedId : undefined);
    if (result.error) {
      return result.error;
    }
    if (!result.chat) {
      return "Could not create chat.";
    }

    const chat = await harness.switchChat(result.chat.id);
    return `switched to chat: ${chat.id}`;
  }

  if (input.startsWith("/chat switch ")) {
    if (isPinnedChannelContext(options)) {
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
    if (isPinnedChannelContext(options)) {
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

  if (input === "/chat reset") {
    const chat = await harness.resetChat(getScopedChatId(harness, options));
    return `reset chat: ${chat.id}`;
  }

  if (input === "/chat compress") {
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
  }

  if (input.startsWith("/chat rm ")) {
    const requestedId = parseChatId(input.slice("/chat rm ".length));
    if (!requestedId) {
      return "Chat ids may only contain letters, numbers, dots, underscores, and hyphens.";
    }

    if (requestedId === getScopedChatId(harness, options)) {
      return "Cannot delete the current chat. Switch to another chat first.";
    }

    const deleted = await harness.deleteChat(requestedId);
    return deleted ? `deleted chat: ${requestedId}` : `chat not found: ${requestedId}`;
  }

  if (input.startsWith("/chat")) {
    return chatHelpText;
  }

  return chatHelpText;
};

const handleTaskCommand: CommandHandler = async (harness, input, options) => {
  if (input === "/task" || input === "/task help") {
    return taskHelpText;
  }

  if (input === "/task schedule help") {
    return taskScheduleHelpText;
  }

  if (input === "/task list") {
    return renderTaskList(await harness.listTasks(getScopedChatId(harness, options)));
  }

  if (input.startsWith("/task schedule ")) {
    const body = input.slice("/task schedule ".length).trim();
    let parsed = parseTaskSchedule(body, harness.config.defaultTaskTime);
    let taskOptions: NotificationOverride = {};

    if (!parsed) {
      const segments = body.split("|").map((segment) => segment.trim());
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
  }

  if (input.startsWith("/task delete ") || input.startsWith("/task cancel ")) {
    const taskId = input.startsWith("/task delete ")
      ? input.slice("/task delete ".length).trim()
      : input.slice("/task cancel ".length).trim();
    if (taskId.length === 0) {
      return input.startsWith("/task delete ")
        ? "Usage: /task delete <task id>"
        : "Usage: /task cancel <task id>";
    }

    const deleted = await harness.deleteTask(taskId, getScopedChatId(harness, options));
    return deleted ? `cancelled task: ${taskId}` : `task not found: ${taskId}`;
  }

  if (input.startsWith("/task")) {
    return taskHelpText;
  }

  return taskHelpText;
};

const handleAgentCommand: CommandHandler = async (harness, input, options) => {
  if (input === "/agent" || input === "/agent help") {
    return agentHelpText;
  }

  if (input === "/agent list") {
    return renderAgentList(harness.listAgents());
  }

  if (input.startsWith("/agent create ")) {
    const body = input.slice("/agent create ".length).trim();
    const segments = body.split("|").map((segment) => segment.trim());
    if (segments.length < 2) {
      return "Usage: /agent create <name> | <prompt> [| <json options>]";
    }

    const name = segments[0];
    const prompt = segments.length === 2 ? segments[1] : segments.slice(1, -1).join(" | ");
    if (name.length === 0 || prompt.length === 0) {
      return "Usage: /agent create <name> | <prompt> [| <json options>]";
    }

    let agentOptions: Pick<AgentCreateOptions, "maxSteps" | "timeoutMs" | "stepIntervalMs"> = {};
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
      chatId: getScopedChatId(harness, options),
      sourceChatId: getScopedChatId(harness, options),
      createdBy: "user",
      origin: options.origin,
      ...agentOptions,
    });
    if (!agent.agent) {
      return agent.error ?? "Could not create agent.";
    }

    return `started agent: ${agent.agent.id}`;
  }

  if (input.startsWith("/agent show ")) {
    const agentRef = input.slice("/agent show ".length).trim();
    if (agentRef.length === 0) {
      return "Usage: /agent show <name>";
    }

    const agent = harness.findAgent(agentRef);
    return agent ? renderAgentInfo(agent) : `agent not found: ${agentRef}`;
  }

  if (input.startsWith("/agent chat ")) {
    if (options.chatId) {
      return "/agent chat is not supported in this channel yet.";
    }

    const agentRef = input.slice("/agent chat ".length).trim();
    if (agentRef.length === 0) {
      return "Usage: /agent chat <name>";
    }

    const result = await harness.attachAgentChat(agentRef);
    if (!result.agent) {
      return result.error ?? `agent not found: ${agentRef}`;
    }

    return `paused agent: ${result.agent.name}\nswitched to chat: ${result.chatId}`;
  }

  if (input.startsWith("/agent return ")) {
    if (options.chatId) {
      return "/agent return is not supported in this channel yet.";
    }

    const agentRef = input.slice("/agent return ".length).trim();
    if (agentRef.length === 0) {
      return "Usage: /agent return <name>";
    }

    const result = await harness.returnAgentChat(agentRef);
    if (!result.agent) {
      return result.error ?? `agent not found: ${agentRef}`;
    }

    return `resumed agent: ${result.agent.name}\nswitched to chat: ${result.chatId}`;
  }

  if (input.startsWith("/agent stop ")) {
    const agentRef = input.slice("/agent stop ".length).trim();
    if (agentRef.length === 0) {
      return "Usage: /agent stop <name>";
    }

    const agent = harness.cancelAgent(agentRef);
    return agent ? `stopped agent: ${agent.name}` : `agent not found: ${agentRef}`;
  }

  if (input.startsWith("/agent pause ")) {
    const agentRef = input.slice("/agent pause ".length).trim();
    if (agentRef.length === 0) {
      return "Usage: /agent pause <name>";
    }

    const agent = harness.pauseAgent(agentRef);
    return agent ? `paused agent: ${agent.name}` : `agent not found: ${agentRef}`;
  }

  if (input.startsWith("/agent resume ")) {
    const agentRef = input.slice("/agent resume ".length).trim();
    if (agentRef.length === 0) {
      return "Usage: /agent resume <name>";
    }

    const agent = harness.resumeAgent(agentRef);
    return agent ? `resumed agent: ${agent.name}` : `agent not found: ${agentRef}`;
  }

  if (input.startsWith("/agent steer ")) {
    const body = input.slice("/agent steer ".length).trim();
    const separatorIndex = body.indexOf("|");
    if (separatorIndex < 0) {
      return "Usage: /agent steer <name> | <prompt>";
    }

    const agentRef = body.slice(0, separatorIndex).trim();
    const prompt = body.slice(separatorIndex + 1).trim();
    if (agentRef.length === 0 || prompt.length === 0) {
      return "Usage: /agent steer <name> | <prompt>";
    }

    const agent = await harness.steerAgent(agentRef, prompt);
    return agent ? `steered agent: ${agent.name}` : `agent not found: ${agentRef}`;
  }

  if (input.startsWith("/agent")) {
    return agentHelpText;
  }

  return agentHelpText;
};

const handleSkillsCommand: CommandHandler = async (harness, input) => {
  if (input === "/skills") {
    const skills = await harness.listSkills();
    return skills.length === 0
      ? "No skills found."
      : skills.map((skill) => `- ${skill.name}: ${skill.description}`).join("\n");
  }

  if (input.startsWith("/skills")) {
    return "Usage: /skills";
  }

  return "Usage: /skills";
};

const handleToolsCommand: CommandHandler = async (harness, input) => {
  if (input === "/tools") {
    const tools = harness.listTools();
    return tools.length === 0
      ? "No tools found."
      : tools.map((tool) => `- ${tool.name}: ${tool.description}`).join("\n");
  }

  if (input === "/tools help" || input.startsWith("/tools ")) {
    return toolsHelpText;
  }

  return toolsHelpText;
};

const handleHistoryCommand: CommandHandler = async (harness, input, options) => {
  if (input === "/history") {
    return harness.getChatTranscript(options.chatId);
  }

  if (input.startsWith("/history")) {
    return "Usage: /history";
  }

  return "Usage: /history";
};

const handleNewCommand: CommandHandler = async (harness, input, options) => {
  if (input === "/new") {
    return handleChatCommand(harness, "/chat new", options);
  }

  if (input.startsWith("/new ")) {
    return handleChatCommand(harness, `/chat new ${input.slice("/new ".length).trim()}`, options);
  }

  return handleChatCommand(harness, "/chat new", options);
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
    return handleChatCommand(harness, `/chat fork ${input.slice("/fork ".length).trim()}`, options);
  }

  return handleChatCommand(harness, "/chat fork", options);
};

const commandHandlers: Record<string, CommandHandler> = {
  help: handleHelpCommand,
  new: handleNewCommand,
  fork: handleForkCommand,
  reset: handleResetCommand,
  send: handleSendCommand,
  inbox: handleInboxCommand,
  save: handleSaveCommand,
  compress: handleCompressCommand,
  usage: handleUsageCommand,
  model: handleModelCommand,
  project: handleProjectCommand,
  config: handleConfigCommand,
  chat: handleChatCommand,
  task: handleTaskCommand,
  agent: handleAgentCommand,
  tools: handleToolsCommand,
  skills: handleSkillsCommand,
  history: handleHistoryCommand,
};

// Parses user input and dispatches it to a project.
export const dispatchCommand = async (
  harness: Harness,
  input: string,
  options: DispatchOptions = {},
): Promise<string | null> => {
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

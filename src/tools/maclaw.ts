// Maclaw tools expose project-specific read and act capabilities.
import type {
  AgentInboxEntry,
  AgentRecord,
  ChatRecord,
  ChatSummary,
  NotificationDestination,
  ScheduledTask,
} from "../types.js";
import type { Tool, Toolset } from "./types.js";
import { parseTaskSchedule } from "../task.js";
import { parseEmptyInput, parseObjectInput, requiredString } from "./input.js";

export type MaclawToolContext = {
  defaultTaskTime: string;
  contextMessages: number;
  getCurrentChatId(): string;
  getChatAgent(): AgentRecord | undefined;
  listTools(): Tool[];
  listToolsets(): Toolset[];
  listChannels(): string[];
  listChats(): Promise<ChatSummary[]>;
  loadChat(chatId: string): Promise<ChatRecord>;
  readChat(chatId?: string, limit?: number): Promise<ChatRecord>;
  listAgents(): AgentRecord[];
  findAgent(agentRef: string): AgentRecord | undefined;
  listAgentInbox(agentRef?: string): Promise<AgentInboxEntry[] | undefined>;
  readAgentMemory(agentRef?: string): Promise<string | undefined>;
  listTasks(chatId?: string): Promise<ScheduledTask[]>;
  sendAgentInboxMessage(input: {
    agentRef: string;
    text: string;
  }): Promise<AgentInboxEntry | undefined>;
  writeAgentMemory(input: {
    agentRef: string;
    text: string;
  }): Promise<boolean>;
  createAgent(input: {
    name: string;
    prompt: string;
    toolsets?: string[];
    maxSteps?: number;
    timeoutMs?: number;
    stepIntervalMs?: number;
  }): Promise<{ agent?: AgentRecord; error?: string }>;
  createTask(input: {
    title: string;
    prompt: string;
    schedule: ScheduledTask["schedule"];
  }): Promise<ScheduledTask>;
  notify(input: {
    text: string;
    destination: NotificationDestination;
  }): Promise<{ delivered: boolean; saved: boolean; target?: AgentRecord["origin"] }>;
};

const parseOptionalChatInput = (input: unknown): { chatId?: string } => {
  const object = parseObjectInput(input);
  const chatId = object.chatId;
  if (chatId === undefined) {
    return {};
  }

  return { chatId: requiredString(object, "chatId") };
};

const parseReadChatInput = (
  input: unknown,
): {
  chatId?: string;
  limit?: number;
} => {
  const object = parseObjectInput(input);
  const chatId = object.chatId;
  const limit = object.limit;

  return {
    ...(chatId === undefined ? {} : { chatId: requiredString(object, "chatId") }),
    ...(typeof limit === "number" ? { limit } : {}),
  };
};

const parseShowAgentInput = (input: unknown): { agent: string } => {
  const object = parseObjectInput(input);
  return {
    agent: requiredString(object, "agent"),
  };
};

const parseReadAgentInboxInput = (input: unknown): { agent?: string } => {
  const object = parseObjectInput(input);
  const agent = object.agent;

  return {
    ...(agent === undefined ? {} : { agent: requiredString(object, "agent") }),
  };
};

const parseSendAgentMessageInput = (input: unknown): { agent: string; text: string } => {
  const object = parseObjectInput(input);
  return {
    agent: requiredString(object, "agent"),
    text: requiredString(object, "text"),
  };
};

const parseReadAgentMemoryInput = (input: unknown): { agent?: string } => {
  const object = parseObjectInput(input);
  const agent = object.agent;

  return {
    ...(agent === undefined ? {} : { agent: requiredString(object, "agent") }),
  };
};

const parseWriteAgentMemoryInput = (
  input: unknown,
): { agent?: string; text: string } => {
  const object = parseObjectInput(input);
  const agent = object.agent;

  return {
    ...(agent === undefined ? {} : { agent: requiredString(object, "agent") }),
    text: requiredString(object, "text"),
  };
};

const parseShowTaskInput = (input: unknown): { taskId: string; chatId?: string } => {
  const object = parseObjectInput(input);
  const taskId = requiredString(object, "taskId");
  const chatId = object.chatId;

  return {
    taskId,
    ...(chatId === undefined ? {} : { chatId: requiredString(object, "chatId") }),
  };
};

const parseCreateAgentInput = (
  input: unknown,
): {
  name: string;
  prompt: string;
  toolsets?: string[];
  maxSteps?: number;
  timeoutMs?: number;
  stepIntervalMs?: number;
} => {
  const object = parseObjectInput(input);
  const toolsets = object.toolsets;
  const maxSteps = object.maxSteps;
  const timeoutMs = object.timeoutMs;
  const stepIntervalMs = object.stepIntervalMs;

  if (
    toolsets !== undefined &&
    (!Array.isArray(toolsets) || toolsets.some((value) => typeof value !== "string"))
  ) {
    throw new Error('Expected "toolsets" to be an array of strings.');
  }

  return {
    name: requiredString(object, "name"),
    prompt: requiredString(object, "prompt"),
    ...(toolsets === undefined ? {} : { toolsets: toolsets as string[] }),
    ...(typeof maxSteps === "number" ? { maxSteps } : {}),
    ...(typeof timeoutMs === "number" ? { timeoutMs } : {}),
    ...(typeof stepIntervalMs === "number" ? { stepIntervalMs } : {}),
  };
};

const parseCreateTaskInput = (
  input: unknown,
): {
  title: string;
  prompt: string;
  when: string;
} => {
  const object = parseObjectInput(input);
  return {
    title: requiredString(object, "title"),
    prompt: requiredString(object, "prompt"),
    when: requiredString(object, "when"),
  };
};

const parseNotifyInput = (
  input: unknown,
): {
  text: string;
  destination: NotificationDestination;
} => {
  const object = parseObjectInput(input);
  const channel = object.channel;

  if (channel !== undefined && (typeof channel !== "string" || channel.trim().length === 0)) {
    throw new Error('Expected "channel" to be a non-empty string.');
  }

  // TODO: simplify at router level. Everything is a channel.
  const destination =
    channel === undefined || channel === "origin"
      ? "origin"
      : channel === "inbox"
        ? "inbox"
        : { channel: channel.trim() };

  return {
    text: requiredString(object, "text"),
    destination,
  };
};

const formatChatSummary = (chat: ChatSummary): string =>
  `- ${chat.id}: ${chat.messageCount} messages, updated ${chat.updatedAt}`;

const formatChat = (chat: ChatRecord): string =>
  [
    `id: ${chat.id}`,
    `createdAt: ${chat.createdAt}`,
    `updatedAt: ${chat.updatedAt}`,
    `messageCount: ${chat.messages.length}`,
    `retentionDays: ${chat.retentionDays}`,
    `compressionMode: ${chat.compressionMode}`,
    `summary: ${chat.summary ?? "(none)"}`,
  ].join("\n");

const formatChatMessages = (chat: ChatRecord): string => {
  const parts: string[] = [];
  if (chat.summary) {
    parts.push(`summary:\n${chat.summary}`);
  }

  if (chat.messages.length === 0) {
    parts.push("messages:\n(none)");
    return parts.join("\n\n");
  }

  parts.push(
    [
      "messages:",
      ...chat.messages.map(
        (message) => `[${message.role}] ${message.content}`,
      ),
    ].join("\n"),
  );
  return parts.join("\n\n");
};

const formatAgent = (agent: AgentRecord): string =>
  [
    `id: ${agent.id}`,
    `name: ${agent.name}`,
    `status: ${agent.status}`,
    `chatId: ${agent.chatId}`,
    `stepCount: ${agent.stepCount}`,
    `maxSteps: ${agent.maxSteps ?? "(none)"}`,
    `timeoutMs: ${agent.timeoutMs}`,
    `stepIntervalMs: ${agent.stepIntervalMs ?? 0}`,
    `lastError: ${agent.lastError ?? "(none)"}`,
  ].join("\n");

const formatAgentInbox = (entries: AgentInboxEntry[]): string => {
  if (entries.length === 0) {
    return "(empty)";
  }

  return entries
    .map((entry) => [
      `${entry.id} [${entry.sourceType}] ${entry.createdAt}`,
      `from: ${entry.sourceType} ${entry.sourceName ?? entry.sourceId}`,
      entry.text,
    ].join("\n"))
    .join("\n\n");
};

const formatAgentMemory = (text: string | undefined): string =>
  text && text.trim().length > 0 ? text : "(empty)";

const formatTask = (task: ScheduledTask): string =>
  [
    `id: ${task.id}`,
    `title: ${task.title}`,
    `chatId: ${task.chatId}`,
    `status: ${task.status}`,
    `nextRunAt: ${task.nextRunAt}`,
    `createdAt: ${task.createdAt}`,
    `updatedAt: ${task.updatedAt}`,
    `lastRunAt: ${task.lastRunAt ?? "(not run yet)"}`,
    `lastError: ${task.lastError ?? "(none)"}`,
  ].join("\n");

const formatToolSchema = (label: string, schema: Record<string, unknown> | undefined): string =>
  schema ? `${label}: ${JSON.stringify(schema)}` : `${label}: (unspecified)`;

const formatTool = (tool: Tool): string =>
  [
    `- ${tool.name} [${tool.permission}]: ${tool.description}`,
    `  ${formatToolSchema("input", tool.inputSchema)}`,
    `  ${formatToolSchema("output", tool.outputSchema)}`,
  ].join("\n");

const formatToolset = (toolset: Toolset): string =>
  `- ${toolset.name}: ${toolset.description}`;

export const createMaclawTools = (context: MaclawToolContext): Tool[] => {
  return [
    {
      name: "list_tools",
      description: "List the currently enabled tools, including their permission level.",
      category: "Project",
      permission: "read",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: async (input) => {
        parseEmptyInput(input);
        const toolsets = context.listToolsets();
        return [
          ...(toolsets.length > 0
            ? [
                "Toolsets:",
                ...toolsets.map(formatToolset),
                "",
              ]
            : []),
          ...context.listTools().map(formatTool),
        ].join("\n");
      },
    },
    {
      name: "list_chats",
      description: "List saved chats in the current project.",
      category: "Chats",
      permission: "read",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: async (input) => {
        parseEmptyInput(input);
        const chats = await context.listChats();
        if (chats.length === 0) {
          return "No saved chats.";
        }

        return chats.map(formatChatSummary).join("\n");
      },
    },
    {
      name: "list_channels",
      description: "List the available notification destination channels like origin, inbox, email, repl, or web.",
      category: "Notifications",
      permission: "read",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: async (input) => {
        parseEmptyInput(input);
        const channels = context.listChannels();
        return channels.length === 0 ? "No channels found." : channels.map((channel) => `- ${channel}`).join("\n");
      },
    },
    {
      name: "show_chat",
      description: "Show metadata for a saved chat. Defaults to the current chat.",
      category: "Chats",
      permission: "read",
      inputSchema: {
        type: "object",
        properties: {
          chatId: { type: "string" },
        },
        additionalProperties: false,
      },
      execute: async (input) => {
        const { chatId } = parseOptionalChatInput(input);
        const chat = await context.loadChat(chatId ?? context.getCurrentChatId());
        return formatChat(chat);
      },
    },
    {
      name: "read_chat",
      description: "Read the recent chat context, including the compressed summary when present. Defaults to the current chat and the project's context limit.",
      category: "Chats",
      permission: "read",
      inputSchema: {
        type: "object",
        properties: {
          chatId: { type: "string" },
          limit: { type: "number" },
        },
        additionalProperties: false,
      },
      execute: async (input) => {
        const { chatId, limit } = parseReadChatInput(input);
        const chat = await context.readChat(chatId, limit ?? context.contextMessages);
        return formatChatMessages(chat);
      },
    },
    {
      name: "list_agents",
      description: "List agents in the current project.",
      category: "Agents",
      permission: "read",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: async (input) => {
        parseEmptyInput(input);
        const agents = context.listAgents();
        if (agents.length === 0) {
          return "No agents found.";
        }

        return agents.map((agent) => `- ${agent.name}: ${agent.status}`).join("\n");
      },
    },
    {
      name: "show_agent",
      description: "Show details for an agent by name or id.",
      category: "Agents",
      permission: "read",
      inputSchema: {
        type: "object",
        properties: {
          agent: { type: "string" },
        },
        required: ["agent"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const { agent } = parseShowAgentInput(input);
        const record = context.findAgent(agent);
        if (!record) {
          throw new Error(`Agent "${agent}" was not found.`);
        }

        return formatAgent(record);
      },
    },
    {
      name: "read_agent_inbox",
      description: "Read inbox messages for an agent. Defaults to the current agent when called from an agent chat.",
      category: "Agents",
      permission: "read",
      inputSchema: {
        type: "object",
        properties: {
          agent: { type: "string" },
        },
        additionalProperties: false,
      },
      execute: async (input) => {
        const { agent } = parseReadAgentInboxInput(input);
        const agentRef = agent ?? context.getChatAgent()?.id;
        if (!agentRef) {
          throw new Error('Expected "agent", or run this from an agent chat.');
        }

        const entries = await context.listAgentInbox(agentRef);
        if (!entries) {
          throw new Error(`Agent "${agentRef}" was not found.`);
        }

        return formatAgentInbox(entries);
      },
    },
    {
      name: "read_agent_memory",
      description: "Read the durable working memory note for an agent. Defaults to the current agent when called from an agent chat.",
      category: "Agents",
      permission: "read",
      inputSchema: {
        type: "object",
        properties: {
          agent: { type: "string" },
        },
        additionalProperties: false,
      },
      execute: async (input) => {
        const { agent } = parseReadAgentMemoryInput(input);
        const agentRef = agent ?? context.getChatAgent()?.id;
        if (!agentRef) {
          throw new Error('Expected "agent", or run this from an agent chat.');
        }

        return formatAgentMemory(await context.readAgentMemory(agentRef));
      },
    },
    {
      name: "list_tasks",
      description: "List scheduled tasks for the current chat or a specific chat.",
      category: "Tasks",
      permission: "read",
      inputSchema: {
        type: "object",
        properties: {
          chatId: { type: "string" },
        },
        additionalProperties: false,
      },
      execute: async (input) => {
        const { chatId } = parseOptionalChatInput(input);
        const tasks = await context.listTasks(chatId ?? context.getCurrentChatId());
        if (tasks.length === 0) {
          return "No scheduled tasks.";
        }

        return tasks.map((task) => `- ${task.id}: ${task.title} (${task.status})`).join("\n");
      },
    },
    {
      name: "show_task",
      description: "Show details for a task by id.",
      category: "Tasks",
      permission: "read",
      inputSchema: {
        type: "object",
        properties: {
          taskId: { type: "string" },
          chatId: { type: "string" },
        },
        required: ["taskId"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const { taskId, chatId } = parseShowTaskInput(input);
        const tasks = await context.listTasks(chatId);
        const task = tasks.find((entry) => entry.id === taskId);
        if (!task) {
          throw new Error(`Task "${taskId}" was not found.`);
        }

        return formatTask(task);
      },
    },
    {
      name: "create_agent",
      description: "Start a new agent with its own dedicated chat.",
      category: "Agents",
      permission: "act",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          prompt: { type: "string" },
          toolsets: {
            type: "array",
            items: { type: "string" },
          },
          maxSteps: { type: "number" },
          timeoutMs: { type: "number" },
          stepIntervalMs: { type: "number" },
        },
        required: ["name", "prompt"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const agentInput = parseCreateAgentInput(input);
        const result = await context.createAgent(agentInput);
        if (!result.agent) {
          throw new Error(result.error ?? `Could not create agent "${agentInput.name}".`);
        }

        return `started agent: ${result.agent.name} (${result.agent.id})`;
      },
    },
    {
      name: "send_agent_message",
      description: "Send a durable inbox message to another agent.",
      category: "Agents",
      permission: "act",
      inputSchema: {
        type: "object",
        properties: {
          agent: { type: "string" },
          text: { type: "string" },
        },
        required: ["agent", "text"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const { agent, text } = parseSendAgentMessageInput(input);
        const entry = await context.sendAgentInboxMessage({
          agentRef: agent,
          text,
        });
        if (!entry) {
          throw new Error(`Agent "${agent}" was not found.`);
        }

        return `sent message to agent: ${agent}`;
      },
    },
    {
      name: "write_agent_memory",
      description: "Write a concise durable working memory note for an agent. Defaults to the current agent when called from an agent chat.",
      category: "Agents",
      permission: "act",
      inputSchema: {
        type: "object",
        properties: {
          agent: { type: "string" },
          text: { type: "string" },
        },
        required: ["text"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const { agent, text } = parseWriteAgentMemoryInput(input);
        const agentRef = agent ?? context.getChatAgent()?.id;
        if (!agentRef) {
          throw new Error('Expected "agent", or run this from an agent chat.');
        }

        const written = await context.writeAgentMemory({
          agentRef,
          text,
        });
        if (!written) {
          throw new Error(`Agent "${agentRef}" was not found.`);
        }

        return `updated agent memory: ${agentRef}`;
      },
    },
    {
      name: "create_task",
      description:
        "Schedule a task using a when string like 'once now', 'once today', 'once tomorrow', 'once 4/9/2026', 'once 4/9/2026 2:30 PM', 'daily 9:00 AM', or 'weekly monday 10:00 AM'. If a one-time date omits a time, maclaw uses the project's default task time.",
      category: "Tasks",
      permission: "act",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
          prompt: { type: "string" },
          when: { type: "string" },
        },
        required: ["title", "prompt", "when"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const { title, prompt, when } = parseCreateTaskInput(input);
        const parsed = parseTaskSchedule(
          `${when} | ${title} | ${prompt}`,
          context.defaultTaskTime,
        );
        if (!parsed) {
          throw new Error(`Could not parse task schedule "${when}".`);
        }

        const task = await context.createTask({
          title: parsed.title,
          prompt: parsed.prompt,
          schedule: parsed.schedule,
        });
        return `scheduled task: ${task.id}`;
      },
    },
    {
      name: "notify",
      description: 'Send a notification to the current origin by default, or to a named channel like "inbox", "email", "repl", or "web".',
      category: "Notifications",
      permission: "act",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string" },
          channel: { type: "string" },
        },
        required: ["text"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const { text, destination } = parseNotifyInput(input);
        const result = await context.notify({
          text,
          destination,
        });
        if (!result.saved) {
          throw new Error("Could not deliver notification.");
        }

        if (result.target?.channel === "inbox") {
          return "saved notification to inbox";
        }

        return result.target
          ? `sent notification to ${result.target.channel}/${result.target.userId}`
          : "saved notification to inbox";
      },
    },
  ];
};

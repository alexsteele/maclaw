// Maclaw tools expose project-specific read and act capabilities.
import type { AgentRecord, ChatRecord, ChatSummary, ScheduledTask, ToolDefinition } from "../types.js";
import { parseTaskSchedule } from "../task.js";
import { parseEmptyInput, parseObjectInput, requiredString } from "./input.js";

export type MaclawToolContext = {
  defaultTaskTime: string;
  getCurrentChatId(): string;
  listTools(): ToolDefinition[];
  listChats(): Promise<ChatSummary[]>;
  loadChat(chatId: string): Promise<ChatRecord>;
  listAgents(): AgentRecord[];
  findAgent(agentRef: string): AgentRecord | undefined;
  listTasks(chatId?: string): Promise<ScheduledTask[]>;
  createAgent(input: {
    name: string;
    prompt: string;
    maxSteps?: number;
    timeoutMs?: number;
    stepIntervalMs?: number;
  }): Promise<{ agent?: AgentRecord; error?: string }>;
  createTask(input: {
    title: string;
    prompt: string;
    schedule: ScheduledTask["schedule"];
  }): Promise<ScheduledTask>;
};

const parseOptionalChatInput = (input: unknown): { chatId?: string } => {
  const object = parseObjectInput(input);
  const chatId = object.chatId;
  if (chatId === undefined) {
    return {};
  }

  return { chatId: requiredString(object, "chatId") };
};

const parseShowAgentInput = (input: unknown): { agent: string } => {
  const object = parseObjectInput(input);
  return {
    agent: requiredString(object, "agent"),
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
  maxSteps?: number;
  timeoutMs?: number;
  stepIntervalMs?: number;
} => {
  const object = parseObjectInput(input);
  const maxSteps = object.maxSteps;
  const timeoutMs = object.timeoutMs;
  const stepIntervalMs = object.stepIntervalMs;

  return {
    name: requiredString(object, "name"),
    prompt: requiredString(object, "prompt"),
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

const formatTool = (tool: ToolDefinition): string =>
  `- ${tool.name} [${tool.permission}]: ${tool.description}`;

export const createMaclawTools = (context: MaclawToolContext): ToolDefinition[] => {
  return [
    {
      name: "list_tools",
      description: "List the currently enabled tools, including their permission level.",
      permission: "read",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: async (input) => {
        parseEmptyInput(input);
        return context.listTools().map(formatTool).join("\n");
      },
    },
    {
      name: "list_chats",
      description: "List saved chats in the current project.",
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
      name: "show_chat",
      description: "Show metadata for a saved chat. Defaults to the current chat.",
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
      name: "list_agents",
      description: "List agents in the current project.",
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
      name: "list_tasks",
      description: "List scheduled tasks for the current chat or a specific chat.",
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
      description: "Start a new agent.",
      permission: "act",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          prompt: { type: "string" },
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
      name: "create_task",
      description: "Schedule a task using a natural schedule string.",
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
  ];
};

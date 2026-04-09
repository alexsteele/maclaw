// Maclaw tools expose safe read-only access to chats, agents, and tasks.
import type { AgentRecord, ChatRecord, ChatSummary, ScheduledTask, ToolDefinition } from "../types.js";
import { parseEmptyInput, parseObjectInput, requiredString } from "./input.js";

export type MaclawToolContext = {
  getCurrentChatId(): string;
  listChats(): Promise<ChatSummary[]>;
  loadChat(chatId: string): Promise<ChatRecord>;
  listAgents(): AgentRecord[];
  findAgent(agentRef: string): AgentRecord | undefined;
  listTasks(chatId?: string): Promise<ScheduledTask[]>;
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

export const createMaclawTools = (context: MaclawToolContext): ToolDefinition[] => {
  return [
    {
      name: "list_chats",
      description: "List saved chats in the current project.",
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
  ];
};

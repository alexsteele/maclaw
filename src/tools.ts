import { existsSync } from "node:fs";
import type { ProjectConfig } from "./config.js";
import { TaskScheduler } from "./scheduler.js";
import { loadSkills } from "./skills.js";
import type { ToolDefinition } from "./types.js";

const asObject = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected an object input.");
  }

  return value as Record<string, unknown>;
};

const requiredString = (value: unknown, name: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Expected "${name}" to be a non-empty string.`);
  }

  return value.trim();
};

export const createTools = (
  config: ProjectConfig,
  scheduler: TaskScheduler,
  chatId: string,
): ToolDefinition[] => {
  return [
    {
      name: "list_skills",
      description: "List available local skill files and their short descriptions.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: async () => {
        const skills = await loadSkills(config.skillsDir);
        if (skills.length === 0) {
          return "No local skills were found.";
        }

        return skills
          .map((skill) => `- ${skill.name}: ${skill.description}`)
          .join("\n");
      },
    },
    {
      name: "read_skill",
      description: "Read the full contents of a local skill file by name.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
        },
        required: ["name"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const { name } = asObject(input);
        const skillName = requiredString(name, "name");
        const skills = await loadSkills(config.skillsDir);
        const skill = skills.find((item) => item.name === skillName);
        if (!skill) {
          throw new Error(`Skill "${skillName}" was not found.`);
        }

        return skill.content;
      },
    },
    {
      name: "create_task",
      description:
        "Create a scheduled task that will re-enter the harness later using a stored prompt.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
          prompt: { type: "string" },
          runAt: { type: "string", description: "ISO-8601 timestamp" },
        },
        required: ["title", "prompt", "runAt"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const object = asObject(input);
        const title = requiredString(object.title, "title");
        const prompt = requiredString(object.prompt, "prompt");
        const runAt = requiredString(object.runAt, "runAt");
        const parsed = Date.parse(runAt);
        if (!Number.isFinite(parsed)) {
          throw new Error("runAt must be a valid ISO-8601 timestamp.");
        }

        const task = await scheduler.createTask({
          chatId,
          title,
          prompt,
          runAt,
        });

        return JSON.stringify(task, null, 2);
      },
    },
    {
      name: "list_tasks",
      description: "List scheduled tasks for the current chat.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: async () => {
        const tasks = await scheduler.listTasks(chatId);
        if (tasks.length === 0) {
          return "No tasks are scheduled for this chat.";
        }

        return tasks
          .map((task) => `- [${task.status}] ${task.title} next at ${task.nextRunAt} (${task.id})`)
          .join("\n");
      },
    },
    {
      name: "get_time",
      description: "Return the current local time as an ISO timestamp.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: async () => new Date().toISOString(),
    },
    {
      name: "show_runtime_config",
      description: "Show the current runtime configuration for storage and retention.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: async () =>
        JSON.stringify(
          {
            projectConfigFile: config.projectConfigFile,
            projectFolder: config.projectFolder,
            projectName: config.name,
            isProjectInitialized: existsSync(config.projectConfigFile),
            provider: config.provider,
            storage: config.storage,
            chatId,
            skillsDir: config.skillsDir,
            retentionDays: config.retentionDays,
            compressionMode: config.compressionMode,
            schedulerPollMs: config.schedulerPollMs,
            model: config.model,
          },
          null,
          2,
        ),
    },
  ];
};

// Tool registry for the current chat runtime.
// See `src/tools/` for small domain-focused tool groups.
import type { ProjectConfig } from "../config.js";
import type { Tool, Toolset } from "./types.js";
import { createFileTools } from "./files.js";
import { createMaclawTools, type MaclawToolContext } from "./maclaw.js";
import { createShellTools } from "./shell.js";
import { createSkillTools } from "./skills.js";
import { createTimeTools } from "./time.js";

export const createTools = (
  config: ProjectConfig,
  context?: MaclawToolContext,
): Tool[] => {
  return [
    ...(context ? createMaclawTools(context) : []),
    ...createFileTools(config),
    ...createShellTools(config),
    ...createSkillTools(config),
    ...createTimeTools(),
  ];
};

export const createToolsets = (
  config: ProjectConfig,
  context?: MaclawToolContext,
): Toolset[] => {
  if (!context) {
    return [];
  }

  return [
    {
      name: "maclaw",
      description: "Built-in tools for chats, agents, tasks, and notifications.",
      tools: createMaclawTools(context).map((tool) => tool.name),
    },
    {
      name: "files",
      description: "Workspace-scoped file inspection and editing tools.",
      tools: createFileTools(config).map((tool) => tool.name),
    },
    {
      name: "skills",
      description: "Local skill discovery and reading tools.",
      tools: createSkillTools(config).map((tool) => tool.name),
    },
    {
      name: "shell",
      description: "Reviewed shell command tools for the current workspace.",
      tools: createShellTools(config).map((tool) => tool.name),
    },
    {
      name: "time",
      description: "Basic time and clock tools.",
      tools: createTimeTools().map((tool) => tool.name),
    },
  ];
};

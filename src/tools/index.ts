// Tool registry for the current chat runtime.
// See `src/tools/` for small domain-focused tool groups.
import type { ProjectConfig } from "../config.js";
import type { Tool, Toolset } from "./types.js";
import { createMaclawTools, type MaclawToolContext } from "./maclaw.js";
import { createSkillTools } from "./skills.js";
import { createTimeTools } from "./time.js";

export const createTools = (
  config: ProjectConfig,
  context?: MaclawToolContext,
): Tool[] => {
  return [
    ...(context ? createMaclawTools(context) : []),
    ...createSkillTools(config),
    ...createTimeTools(),
  ];
};

export const createToolsets = (
  _config: ProjectConfig,
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
  ];
};

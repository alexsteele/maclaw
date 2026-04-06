// Tool registry for the current chat runtime.
// See `src/tools/` for small domain-focused tool groups.
import type { ProjectConfig } from "../config.js";
import type { ToolDefinition } from "../types.js";
import { createSkillTools } from "./skills.js";
import { createTimeTools } from "./time.js";

export const createTools = (
  config: ProjectConfig,
): ToolDefinition[] => {
  return [
    ...createSkillTools(config),
    ...createTimeTools(),
  ];
};

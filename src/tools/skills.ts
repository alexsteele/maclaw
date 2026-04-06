// Skill tools expose safe read-only access to the local skills directory.
import type { ProjectConfig } from "../config.js";
import { loadSkills } from "../skills.js";
import type { ToolDefinition } from "../types.js";
import { parseEmptyInput, parseObjectInput, requiredString } from "./input.js";

const parseReadSkillInput = (input: unknown): { name: string } => {
  const object = parseObjectInput(input);
  return {
    name: requiredString(object, "name"),
  };
};

export const createSkillTools = (config: ProjectConfig): ToolDefinition[] => {
  return [
    {
      name: "list_skills",
      description: "List available local skill files and their short descriptions.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: async (input) => {
        parseEmptyInput(input);
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
        const { name } = parseReadSkillInput(input);
        const skills = await loadSkills(config.skillsDir);
        const skill = skills.find((item) => item.name === name);
        if (!skill) {
          throw new Error(`Skill "${name}" was not found.`);
        }

        return skill.content;
      },
    },
  ];
};

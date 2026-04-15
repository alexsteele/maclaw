// Time tools provide simple grounding information such as the current time.
import type { Tool } from "./types.js";
import { parseEmptyInput } from "./input.js";

export const createTimeTools = (): Tool[] => {
  return [
    {
      name: "get_time",
      description: "Return the current local time as an ISO timestamp.",
      category: "Utilities",
      permission: "read",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      execute: async (input) => {
        parseEmptyInput(input);
        return new Date().toISOString();
      },
    },
  ];
};

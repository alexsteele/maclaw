/**
 * Shared tool and toolset types.
 *
 * Tool definitions live alongside the tool registry so the tool domain can
 * evolve without depending on unrelated app-wide types.
 */
export type ToolPermission = "read" | "act" | "dangerous";

export type Tool = {
  name: string;
  description: string;
  category?: string;
  permission: ToolPermission;
  requiresReview?: boolean;
  inputSchema: Record<string, unknown>;
  execute: (input: unknown) => Promise<string>;
};

/**
 * Toolset groups related tools and may reference other toolsets for
 * composition.
 */
export type Toolset = {
  name: string;
  description: string;
  tools?: string[];
  toolsets?: string[];
};

export type ToolCallLogEntry = {
  name: string;
  input: unknown;
};

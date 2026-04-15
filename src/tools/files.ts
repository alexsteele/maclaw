// Rooted file tools expose file reads, writes, and directory listings that are
// scoped to the current project workspace. Tool callers use relative workspace
// paths such as `src/index.ts` or `notes/todo.txt`, and any attempt to escape
// above the project root is rejected.
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ProjectConfig } from "../config.js";
import type { Tool } from "./types.js";
import { parseObjectInput, requiredString } from "./input.js";

const MAX_READ_BYTES = 128 * 1024;

const resolveRootedPath = (rootDir: string, requestedPath?: string): string => {
  const relativePath = requestedPath?.trim().length ? requestedPath.trim() : ".";
  const resolvedRoot = path.resolve(rootDir);
  const resolvedPath = path.resolve(resolvedRoot, relativePath);
  const relative = path.relative(resolvedRoot, resolvedPath);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes the workspace root: ${requestedPath ?? "."}`);
  }

  return resolvedPath;
};

const formatWorkspacePath = (rootDir: string, targetPath: string): string => {
  const relative = path.relative(path.resolve(rootDir), targetPath);
  return relative.length === 0 ? "." : relative;
};

const parseReadFileInput = (input: unknown): { path: string } => {
  const object = parseObjectInput(input);
  return {
    path: requiredString(object, "path"),
  };
};

const parseWriteFileInput = (
  input: unknown,
): {
  path: string;
  content: string;
} => {
  const object = parseObjectInput(input);
  const content = object.content;
  if (typeof content !== "string") {
    throw new Error('Expected "content" to be a string.');
  }

  return {
    path: requiredString(object, "path"),
    content,
  };
};

const parseListDirInput = (input: unknown): { path?: string } => {
  const object = parseObjectInput(input);
  const value = object.path;

  if (value === undefined) {
    return {};
  }

  if (typeof value !== "string") {
    throw new Error('Expected "path" to be a string.');
  }

  return {
    path: value.trim(),
  };
};

export const createFileTools = (config: ProjectConfig): Tool[] => {
  const rootDir = config.projectFolder;

  return [
    {
      name: "read_file",
      description: "Read a text file within the current project workspace.",
      category: "Files",
      permission: "dangerous",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
        },
        required: ["path"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const { path: requestedPath } = parseReadFileInput(input);
        const targetPath = resolveRootedPath(rootDir, requestedPath);
        const info = await stat(targetPath);
        if (!info.isFile()) {
          throw new Error(`Not a file: ${requestedPath}`);
        }
        if (info.size > MAX_READ_BYTES) {
          throw new Error(`File is too large to read safely: ${requestedPath}`);
        }

        return await readFile(targetPath, "utf8");
      },
    },
    {
      name: "write_file",
      description: "Write a text file within the current project workspace, creating parent directories as needed.",
      category: "Files",
      permission: "dangerous",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const { path: requestedPath, content } = parseWriteFileInput(input);
        const targetPath = resolveRootedPath(rootDir, requestedPath);
        await mkdir(path.dirname(targetPath), { recursive: true });
        await writeFile(targetPath, content, "utf8");
        return `wrote file: ${formatWorkspacePath(rootDir, targetPath)}`;
      },
    },
    {
      name: "list_dir",
      description: "List files and directories within the current project workspace.",
      category: "Files",
      permission: "dangerous",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
        },
        additionalProperties: false,
      },
      execute: async (input) => {
        const { path: requestedPath } = parseListDirInput(input);
        const targetPath = resolveRootedPath(rootDir, requestedPath);
        const info = await stat(targetPath);
        if (!info.isDirectory()) {
          throw new Error(`Not a directory: ${requestedPath ?? "."}`);
        }

        const entries = await readdir(targetPath, { withFileTypes: true });
        if (entries.length === 0) {
          return "(empty)";
        }

        return entries
          .sort((left, right) => left.name.localeCompare(right.name))
          .map((entry) => `${entry.isDirectory() ? "dir " : "file"} ${entry.name}${entry.isDirectory() ? "/" : ""}`)
          .join("\n");
      },
    },
  ];
};

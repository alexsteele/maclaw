// Rooted file tools expose file reads, writes, and directory listings that are
// scoped to the current project workspace. Tool callers use relative workspace
// paths such as `src/index.ts` or `notes/todo.txt`, and any attempt to escape
// above the project root or touch `.maclaw/` is rejected.
import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ProjectConfig } from "../config.js";
import type { Tool } from "./types.js";
import { parseObjectInput, requiredString } from "./input.js";

const MAX_READ_BYTES = 128 * 1024;
const MAX_TREE_ENTRIES = 200;
const MAX_SEARCH_RESULTS = 100;
const MAX_READ_FILES = 20;
const DEFAULT_TREE_DEPTH = 2;
const RESERVED_WORKSPACE_SEGMENTS = new Set([".maclaw"]);

type TreeItem = {
  depth: number;
  label: string;
};

const getWorkspaceRelativePath = (rootDir: string, targetPath: string): string =>
  path.relative(path.resolve(rootDir), targetPath);

const getRelativeSegments = (relativePath: string): string[] =>
  relativePath
    .split(path.sep)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== ".");

const isReservedWorkspacePath = (rootDir: string, targetPath: string): boolean => {
  const relativePath = getWorkspaceRelativePath(rootDir, targetPath);
  if (relativePath.length === 0) {
    return false;
  }

  const segments = getRelativeSegments(relativePath);
  return segments.some((segment, index) => index === 0 && RESERVED_WORKSPACE_SEGMENTS.has(segment));
};

const resolveWorkspacePath = (rootDir: string, requestedPath?: string): string => {
  const relativePath = requestedPath?.trim().length ? requestedPath.trim() : ".";
  const resolvedRoot = path.resolve(rootDir);
  const resolvedPath = path.resolve(resolvedRoot, relativePath);
  const relative = path.relative(resolvedRoot, resolvedPath);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes the workspace root: ${requestedPath ?? "."}`);
  }

  if (isReservedWorkspacePath(resolvedRoot, resolvedPath)) {
    throw new Error(`Path is reserved for maclaw metadata: ${requestedPath ?? "."}`);
  }

  return resolvedPath;
};

const formatWorkspacePath = (rootDir: string, targetPath: string): string => {
  const relative = getWorkspaceRelativePath(rootDir, targetPath);
  return relative.length === 0 ? "." : relative;
};

const parseReadFileInput = (input: unknown): { path: string } => {
  const object = parseObjectInput(input);
  return {
    path: requiredString(object, "path"),
  };
};

const parseFindFilesInput = (
  input: unknown,
): { query: string; path?: string; limit: number } => {
  const object = parseObjectInput(input);
  return {
    query: requiredString(object, "query"),
    path: parseOptionalPath(object),
    limit: Math.min(parseOptionalPositiveInteger(object, "limit") ?? 50, MAX_SEARCH_RESULTS),
  };
};

const parseSearchFilesInput = (
  input: unknown,
): { query: string; path?: string; limit: number } => {
  const object = parseObjectInput(input);
  return {
    query: requiredString(object, "query"),
    path: parseOptionalPath(object),
    limit: Math.min(parseOptionalPositiveInteger(object, "limit") ?? 50, MAX_SEARCH_RESULTS),
  };
};

const parseReadFilesInput = (input: unknown): { paths: string[] } => {
  const object = parseObjectInput(input);
  const paths = object.paths;

  if (!Array.isArray(paths) || paths.length === 0) {
    throw new Error('Expected "paths" to be a non-empty array of strings.');
  }

  if (
    paths.length > MAX_READ_FILES
    || paths.some((value) => typeof value !== "string" || value.trim().length === 0)
  ) {
    throw new Error(`Expected "paths" to contain 1-${MAX_READ_FILES} non-empty strings.`);
  }

  return {
    paths: paths.map((value) => value.trim()),
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

const parseOptionalPath = (object: Record<string, unknown>): string | undefined => {
  const value = object.path;

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error('Expected "path" to be a string.');
  }

  return value.trim();
};

const parseOptionalPositiveInteger = (
  object: Record<string, unknown>,
  name: string,
): number | undefined => {
  const value = object[name];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`Expected "${name}" to be a positive integer.`);
  }

  return value;
};

const parseListDirInput = (
  input: unknown,
): { path?: string } => {
  const object = parseObjectInput(input);
  return {
    path: parseOptionalPath(object),
  };
};

const parseTreeInput = (
  input: unknown,
): { path?: string; maxDepth: number } => {
  const object = parseObjectInput(input);
  return {
    path: parseOptionalPath(object),
    maxDepth: parseOptionalPositiveInteger(object, "maxDepth") ?? DEFAULT_TREE_DEPTH,
  };
};

const truncateText = (text: string, maxBytes: number): string => {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) {
    return text;
  }

  let truncated = text.slice(0, maxBytes);
  while (truncated.length > 0 && Buffer.byteLength(truncated, "utf8") > maxBytes) {
    truncated = truncated.slice(0, -1);
  }

  return `${truncated}\n...(truncated)`;
};

const isBinaryBuffer = (buffer: Buffer): boolean =>
  buffer.includes(0);

const shouldSkipEntry = (name: string): boolean =>
  name === ".maclaw";

const walkWorkspace = async (
  startPath: string,
  visitFile: (targetPath: string) => Promise<boolean>,
  maxFiles: number,
): Promise<void> => {
  const queue = [startPath];
  let visitedFiles = 0;

  while (queue.length > 0 && visitedFiles < maxFiles) {
    const currentPath = queue.shift();
    if (!currentPath) {
      break;
    }

    const entries = await readdir(currentPath, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (shouldSkipEntry(entry.name)) {
        continue;
      }

      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        queue.push(entryPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      visitedFiles += 1;
      const shouldStop = await visitFile(entryPath);
      if (shouldStop || visitedFiles >= maxFiles) {
        return;
      }
    }
  }
};

const buildTree = async (
  rootDir: string,
  startPath: string,
  maxDepth: number,
): Promise<TreeItem[]> => {
  const rootDepth = formatWorkspacePath(rootDir, startPath) === "." ? -1 : 0;
  const items: TreeItem[] = [];

  const visit = async (currentPath: string, depth: number): Promise<void> => {
    const entries = await readdir(currentPath, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (shouldSkipEntry(entry.name)) {
        continue;
      }

      if (items.length >= MAX_TREE_ENTRIES) {
        return;
      }

      const isDirectory = entry.isDirectory();
      items.push({
        depth,
        label: `${isDirectory ? "dir " : "file"} ${entry.name}${isDirectory ? "/" : ""}`,
      });

      if (isDirectory && depth < maxDepth) {
        await visit(path.join(currentPath, entry.name), depth + 1);
      }

      if (items.length >= MAX_TREE_ENTRIES) {
        return;
      }
    }
  };

  await visit(startPath, rootDepth + 1);
  return items;
};

const formatTree = (items: TreeItem[]): string => {
  if (items.length === 0) {
    return "(empty)";
  }

  return items
    .map((item) => `${"  ".repeat(Math.max(item.depth, 0))}${item.label}`)
    .join("\n");
};

const formatReadFilesSection = (workspacePath: string, content: string): string =>
  `==> ${workspacePath} <==\n${content}`;

const runTreeCommand = async (
  rootDir: string,
  startPath: string,
  maxDepth: number,
): Promise<string | undefined> => {
  const relativePath = formatWorkspacePath(rootDir, startPath);
  const targetPath = relativePath === "." ? "." : relativePath;

  return await new Promise<string | undefined>((resolve, reject) => {
    const child = spawn(
      "tree",
      [
        "--noreport",
        "-I",
        ".maclaw",
        "-L",
        String(maxDepth),
        targetPath,
      ],
      {
        cwd: rootDir,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString("utf8");
    });

    child.once("error", (error) => {
      if ("code" in error && error.code === "ENOENT") {
        resolve(undefined);
        return;
      }

      reject(error);
    });

    child.once("close", (code) => {
      if (code === 0) {
        const output = stdout.trimEnd();
        resolve(output.length > 0 ? output : "(empty)");
        return;
      }

      if (code === 1 && stderr.trim().length === 0) {
        const output = stdout.trimEnd();
        resolve(output.length > 0 ? output : "(empty)");
        return;
      }

      reject(new Error(stderr.trim() || `tree failed with exit code ${code ?? "unknown"}.`));
    });
  });
};

const runRipgrepSearch = async (
  rootDir: string,
  startPath: string,
  query: string,
  limit: number,
): Promise<string[]> => {
  const relativePath = formatWorkspacePath(rootDir, startPath);
  const targetPath = relativePath === "." ? "." : relativePath;

  return await new Promise<string[]>((resolve, reject) => {
    const child = spawn(
      "rg",
      [
        "--fixed-strings",
        "--line-number",
        "--no-heading",
        "--color",
        "never",
        "--glob",
        "!.maclaw/**",
        "--",
        query,
        targetPath,
      ],
      {
        cwd: rootDir,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString("utf8");
    });

    child.once("error", (error) => {
      if ("code" in error && error.code === "ENOENT") {
        reject(new Error('`rg` is required for search_files but was not found in PATH.'));
        return;
      }

      reject(error);
    });

    child.once("close", (code) => {
      if (code === 0 || code === 1) {
        const matches = stdout
          .split(/\r?\n/u)
          .map((line) => line.trimEnd())
          .filter((line) => line.length > 0)
          .slice(0, limit);
        resolve(matches);
        return;
      }

      reject(new Error(stderr.trim() || `rg failed with exit code ${code ?? "unknown"}.`));
    });
  });
};

const findWorkspaceFiles = async (
  rootDir: string,
  startPath: string,
  query: string,
  limit: number,
): Promise<string[]> => {
  const relativePath = formatWorkspacePath(rootDir, startPath);
  const targetPath = relativePath === "." ? "." : relativePath;

  return await new Promise<string[]>((resolve, reject) => {
    const listChild = spawn(
      "rg",
      [
        "--files",
        "--glob",
        "!.maclaw/**",
        targetPath,
      ],
      {
        cwd: rootDir,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    const filterChild = spawn(
      "rg",
      [
        "--fixed-strings",
        "--ignore-case",
        "--color",
        "never",
        "--",
        query,
      ],
      {
        cwd: rootDir,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    listChild.stdout?.pipe(filterChild.stdin ?? null);

    let stdout = "";
    let listStderr = "";
    let filterStderr = "";

    let listExitCode: number | null = null;
    let filterExitCode: number | null = null;
    let settled = false;

    const finish = (): void => {
      if (settled || listExitCode === null || filterExitCode === null) {
        return;
      }

      settled = true;

      if (listExitCode !== 0 && listExitCode !== 1) {
        reject(new Error(listStderr.trim() || `rg --files failed with exit code ${listExitCode}.`));
        return;
      }

      if (filterExitCode === 0 || filterExitCode === 1) {
        resolve(
          stdout
            .split(/\r?\n/u)
            .map((line) => line.trim())
            .filter((line) => line.length > 0)
            .slice(0, limit),
        );
        return;
      }

      reject(new Error(filterStderr.trim() || `rg filter failed with exit code ${filterExitCode}.`));
    };

    filterChild.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString("utf8");
    });

    listChild.stderr?.on("data", (chunk: Buffer | string) => {
      listStderr += chunk.toString("utf8");
    });

    filterChild.stderr?.on("data", (chunk: Buffer | string) => {
      filterStderr += chunk.toString("utf8");
    });

    listChild.once("error", (error) => {
      if ("code" in error && error.code === "ENOENT") {
        reject(new Error('`rg` is required for find_files but was not found in PATH.'));
        return;
      }

      reject(error);
    });

    filterChild.once("error", (error) => {
      if ("code" in error && error.code === "ENOENT") {
        reject(new Error('`rg` is required for find_files but was not found in PATH.'));
        return;
      }

      reject(error);
    });

    listChild.once("close", (code) => {
      listExitCode = code;
      finish();
    });

    filterChild.once("close", (code) => {
      filterExitCode = code;
      finish();
    });
  });
};

export const createFileTools = (config: ProjectConfig): Tool[] => {
  const rootDir = config.projectFolder;

  return [
    {
      name: "find_files",
      description: "Find project files by path or filename using a ripgrep-style path query within the current workspace.",
      category: "Files",
      permission: "read",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Literal ripgrep path query matched against project-relative file paths, case-insensitively.",
          },
          path: {
            type: "string",
            description: "Optional project-relative directory to search within.",
          },
          limit: {
            type: "number",
            description: "Maximum number of matching file paths to return.",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
      outputSchema: {
        type: "array",
        items: {
          type: "string",
          description: "Project-relative file path.",
        },
      },
      execute: async (input) => {
        const { query, path: requestedPath, limit } = parseFindFilesInput(input);
        const startPath = resolveWorkspacePath(rootDir, requestedPath);
        const matches = await findWorkspaceFiles(rootDir, startPath, query, limit);

        return matches.length === 0 ? "No matching files found." : matches.join("\n");
      },
    },
    {
      name: "search_files",
      description: "Search project files for a literal text query, similar to grep or rg fixed-string search, and return matching lines as path:line: text.",
      category: "Files",
      permission: "read",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Literal text to search for. This is treated like a fixed-string grep or rg query, not a regex.",
          },
          path: {
            type: "string",
            description: "Optional project-relative directory to search within.",
          },
          limit: {
            type: "number",
            description: "Maximum number of matching lines to return.",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
      outputSchema: {
        type: "array",
        items: {
          type: "object",
          properties: {
            path: { type: "string" },
            line: { type: "number" },
            text: { type: "string" },
          },
          required: ["path", "line", "text"],
          additionalProperties: false,
        },
      },
      execute: async (input) => {
        const { query, path: requestedPath, limit } = parseSearchFilesInput(input);
        const startPath = resolveWorkspacePath(rootDir, requestedPath);
        const matches = await runRipgrepSearch(rootDir, startPath, query, limit);

        return matches.length === 0 ? "No matching text found." : matches.join("\n");
      },
    },
    {
      name: "read_files",
      description: "Read one or more text files from the current project workspace.",
      category: "Files",
      permission: "read",
      inputSchema: {
        type: "object",
        properties: {
          paths: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["paths"],
        additionalProperties: false,
      },
      outputSchema: {
        type: "array",
        items: {
          type: "object",
          properties: {
            path: { type: "string" },
            content: { type: "string" },
          },
          required: ["path", "content"],
          additionalProperties: false,
        },
      },
      execute: async (input) => {
        const { paths } = parseReadFilesInput(input);
        const sections: string[] = [];

        for (const requestedPath of paths) {
          const targetPath = resolveWorkspacePath(rootDir, requestedPath);
          const info = await stat(targetPath);
          if (!info.isFile()) {
            throw new Error(`Not a file: ${requestedPath}`);
          }

          const buffer = await readFile(targetPath);
          if (isBinaryBuffer(buffer)) {
            throw new Error(`File is binary and cannot be read safely: ${requestedPath}`);
          }

          sections.push(
            formatReadFilesSection(
              formatWorkspacePath(rootDir, targetPath),
              truncateText(buffer.toString("utf8"), MAX_READ_BYTES),
            ),
          );
        }

        return sections.join("\n\n");
      },
    },
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
      outputSchema: {
        type: "string",
        description: "UTF-8 file contents.",
      },
      execute: async (input) => {
        const { path: requestedPath } = parseReadFileInput(input);
        const targetPath = resolveWorkspacePath(rootDir, requestedPath);
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
      outputSchema: {
        type: "string",
        description: "Confirmation message with the written project-relative path.",
      },
      execute: async (input) => {
        const { path: requestedPath, content } = parseWriteFileInput(input);
        const targetPath = resolveWorkspacePath(rootDir, requestedPath);
        await mkdir(path.dirname(targetPath), { recursive: true });
        await writeFile(targetPath, content, "utf8");
        return `wrote file: ${formatWorkspacePath(rootDir, targetPath)}`;
      },
    },
    {
      name: "list_dir",
      description: "List files and directories within the current project workspace.",
      category: "Files",
      permission: "read",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: "array",
        items: {
          type: "object",
          properties: {
            path: { type: "string" },
            type: { type: "string", enum: ["file", "dir"] },
          },
          required: ["path", "type"],
          additionalProperties: false,
        },
      },
      execute: async (input) => {
        const { path: requestedPath } = parseListDirInput(input);
        const targetPath = resolveWorkspacePath(rootDir, requestedPath);
        const info = await stat(targetPath);
        if (!info.isDirectory()) {
          throw new Error(`Not a directory: ${requestedPath ?? "."}`);
        }

        const entries = await readdir(targetPath, { withFileTypes: true });
        const visibleEntries = entries
          .filter((entry) => !shouldSkipEntry(entry.name))
          .sort((left, right) => left.name.localeCompare(right.name))
          .map((entry) => `${entry.isDirectory() ? "dir " : "file"} ${entry.name}${entry.isDirectory() ? "/" : ""}`);

        return visibleEntries.length === 0 ? "(empty)" : visibleEntries.join("\n");
      },
    },
    {
      name: "tree",
      description: "Show a recursive directory tree for a workspace path, similar to the unix tree command.",
      category: "Files",
      permission: "read",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" },
          maxDepth: { type: "number" },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: "array",
        items: {
          type: "object",
          properties: {
            path: { type: "string" },
            type: { type: "string", enum: ["file", "dir"] },
          },
          required: ["path", "type"],
          additionalProperties: false,
        },
      },
      execute: async (input) => {
        const { path: requestedPath, maxDepth } = parseTreeInput(input);
        const targetPath = resolveWorkspacePath(rootDir, requestedPath);
        const info = await stat(targetPath);
        if (!info.isDirectory()) {
          throw new Error(`Not a directory: ${requestedPath ?? "."}`);
        }

        const shellTree = await runTreeCommand(rootDir, targetPath, maxDepth);
        if (shellTree !== undefined) {
          return shellTree;
        }

        return formatTree(await buildTree(rootDir, targetPath, maxDepth));
      },
    },
  ];
};

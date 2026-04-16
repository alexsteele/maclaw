// Shell tools run reviewed project-scoped shell commands with bounded output.
import { spawn } from "node:child_process";
import type { ProjectConfig } from "../config.js";
import type { Tool } from "./types.js";
import { parseObjectInput, requiredString } from "./input.js";

const MAX_OUTPUT_BYTES = 32 * 1024;

const parseRunShellInput = (input: unknown): { command: string } => {
  const object = parseObjectInput(input);
  return {
    command: requiredString(object, "command"),
  };
};

const truncateUtf8 = (text: string): string => {
  if (Buffer.byteLength(text, "utf8") <= MAX_OUTPUT_BYTES) {
    return text;
  }

  let truncated = text.slice(0, MAX_OUTPUT_BYTES);
  while (truncated.length > 0 && Buffer.byteLength(truncated, "utf8") > MAX_OUTPUT_BYTES) {
    truncated = truncated.slice(0, -1);
  }

  return truncated;
};

const appendOutput = (
  current: string,
  chunk: Buffer | string,
): { text: string; truncated: boolean } => {
  const next = current + chunk.toString("utf8");
  const text = truncateUtf8(next);
  if (text === next) {
    return { text: next, truncated: false };
  }

  return { text, truncated: true };
};

const formatOutput = (stdout: string, stderr: string, truncated: boolean): string => {
  const sections: string[] = [];
  if (stdout.trim().length > 0) {
    sections.push(`stdout:\n${stdout.trimEnd()}`);
  }
  if (stderr.trim().length > 0) {
    sections.push(`stderr:\n${stderr.trimEnd()}`);
  }
  if (sections.length === 0) {
    sections.push("(no output)");
  }
  if (truncated) {
    sections.push("(output truncated)");
  }
  return sections.join("\n\n");
};

const runShellCommand = async (
  rootDir: string,
  command: string,
): Promise<string> => {
  const shell = process.env.SHELL || "/bin/bash";

  return await new Promise<string>((resolve, reject) => {
    const child = spawn(shell, ["-lc", command], {
      cwd: rootDir,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let truncated = false;

    child.stdout?.on("data", (chunk: Buffer | string) => {
      const appended = appendOutput(stdout, chunk);
      stdout = appended.text;
      truncated = truncated || appended.truncated;
    });

    child.stderr?.on("data", (chunk: Buffer | string) => {
      const appended = appendOutput(stderr, chunk);
      stderr = appended.text;
      truncated = truncated || appended.truncated;
    });

    child.once("error", (error) => {
      reject(error);
    });

    child.once("close", (code, signal) => {
      const output = formatOutput(stdout, stderr, truncated);
      if (code !== 0) {
        reject(
          new Error(
            `Command failed with exit code ${code ?? "unknown"}${signal ? ` (${signal})` : ""}.\n${output}`,
          ),
        );
        return;
      }

      resolve(output);
    });
  });
};

export const createShellTools = (config: ProjectConfig): Tool[] => {
  return [
    {
      name: "run_shell",
      description: "Run one shell command in the current project workspace.",
      category: "Shell",
      permission: "dangerous",
      requiresReview: true,
      inputSchema: {
        type: "object",
        properties: {
          command: { type: "string" },
        },
        required: ["command"],
        additionalProperties: false,
      },
      execute: async (input) => {
        const { command } = parseRunShellInput(input);
        return await runShellCommand(config.projectFolder, command);
      },
    },
  ];
};

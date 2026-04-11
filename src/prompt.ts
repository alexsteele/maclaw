import os from "node:os";
import path from "node:path";
import { readFile } from "node:fs/promises";

export const REPL_DISPLAY_INSTRUCTIONS = [
  "Format responses for a terminal-first chat interface.",
  "Use short paragraphs and simple markdown when helpful.",
  "Use bullets for lists, fenced code blocks for code, and inline backticks for commands, paths, and identifiers.",
  "Avoid raw HTML, avoid unnecessary tables, and do not put normal prose inside code fences.",
].join("\n");

export const PORTAL_DISPLAY_INSTRUCTIONS = [
  "Format responses for a chat-style browser interface.",
  "Use short paragraphs and simple markdown when helpful.",
  "Use bullets for lists, fenced code blocks for code, and inline backticks for commands, paths, and identifiers.",
  "Avoid raw HTML and avoid unnecessary tables.",
].join("\n");

const expandHome = (value: string): string => {
  if (value === "~") {
    return os.homedir();
  }

  if (value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }

  return value;
};

// Resolves @file prompt input relative to the project folder.
export const resolvePromptText = async (
  projectFolder: string,
  input: string,
): Promise<string> => {
  const trimmed = input.trim();
  if (!trimmed.startsWith("@")) {
    return input;
  }

  const filePath = trimmed.slice(1).trim();
  if (filePath.length === 0) {
    throw new Error("Expected a file path after @.");
  }

  const resolvedPath = path.resolve(projectFolder, expandHome(filePath));
  return readFile(resolvedPath, "utf8");
};

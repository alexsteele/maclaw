import os from "node:os";
import path from "node:path";
import { readFile } from "node:fs/promises";

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

import path from "node:path";
import { readdir, readFile } from "node:fs/promises";
import type { Skill } from "./types.js";

const supportedExtensions = new Set([".md", ".txt"]);

const firstNonEmptyLine = (text: string): string => {
  return (
    text
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? "No description provided."
  );
};

export const loadSkills = async (skillsDir: string): Promise<Skill[]> => {
  try {
    const entries = await readdir(skillsDir, { withFileTypes: true });
    const skills: Skill[] = [];

    for (const entry of entries) {
      if (!entry.isFile()) {
        continue;
      }

      const extension = path.extname(entry.name);
      if (!supportedExtensions.has(extension)) {
        continue;
      }

      const fullPath = path.join(skillsDir, entry.name);
      const content = await readFile(fullPath, "utf8");
      skills.push({
        name: path.basename(entry.name, extension),
        path: fullPath,
        description: firstNonEmptyLine(content),
        content,
      });
    }

    return skills.sort((left, right) => left.name.localeCompare(right.name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }
};

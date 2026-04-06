import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ensureDir, writeJsonFile } from "./fs-utils.js";
import { normalizeNotifications } from "./notifications.js";
import { loadServerSecrets } from "./server-config.js";
import type { NotificationPolicy } from "./types.js";

export const defaultProjectDataDir = (projectFolder: string): string =>
  path.join(projectFolder, ".maclaw");

export const defaultTasksFile = (projectFolder: string): string =>
  path.join(defaultProjectDataDir(projectFolder), "tasks.json");

export const defaultTaskRunsFile = (projectFolder: string): string =>
  path.join(defaultProjectDataDir(projectFolder), "task-runs.jsonl");

export const defaultAgentsFile = (projectFolder: string): string =>
  path.join(defaultProjectDataDir(projectFolder), "agents.json");

export type ProjectConfig = {
  name: string;
  createdAt?: string;
  provider: "local" | "openai";
  model: string;
  storage: "json" | "none";
  notifications: NotificationPolicy;
  retentionDays: number;
  skillsDir: string;
  compressionMode: "none" | "planned";
  schedulerPollMs: number;
  projectFolder: string;
  projectConfigFile: string;
  chatId: string;
  openAiApiKey?: string;
  chatsDir: string;
};


const toPositiveInt = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};
const readProjectFileConfig = (cwd: string): Partial<ProjectConfig> => {
  const projectConfigFile = path.join(cwd, ".maclaw", "maclaw.json");
  if (!existsSync(projectConfigFile)) {
    return {};
  }

  const raw = readFileSync(projectConfigFile, "utf8");
  return JSON.parse(raw) as Partial<ProjectConfig>;
};

export const initProjectConfig = async (
  cwd: string = process.cwd(),
  overrides: Partial<ProjectConfig> = {},
): Promise<ProjectConfig> => {
  const projectFolder = path.resolve(cwd);
  const projectConfigFile = path.join(projectFolder, ".maclaw", "maclaw.json");
  const existingConfig = readProjectFileConfig(projectFolder);
  const mergedConfig = {
    ...existingConfig,
    ...overrides,
  };

  const nextFileConfig: Partial<ProjectConfig> = {
    createdAt: mergedConfig.createdAt ?? new Date().toISOString(),
    name: mergedConfig.name ?? path.basename(projectFolder),
    retentionDays: mergedConfig.retentionDays ?? 30,
    provider: mergedConfig.provider ?? "openai",
    model: mergedConfig.model ?? "gpt-4.1-mini",
    storage: mergedConfig.storage ?? "json",
    notifications: normalizeNotifications(mergedConfig.notifications),
    skillsDir: mergedConfig.skillsDir ?? ".maclaw/skills",
    compressionMode: mergedConfig.compressionMode ?? "none",
    schedulerPollMs: mergedConfig.schedulerPollMs ?? 15_000,
  };

  await ensureDir(path.dirname(projectConfigFile));
  await ensureDir(path.resolve(projectFolder, nextFileConfig.skillsDir ?? ".maclaw/skills"));
  await writeJsonFile(projectConfigFile, nextFileConfig);
  return loadConfig(projectFolder);
};

export const loadConfig = (cwd: string = process.cwd()): ProjectConfig => {
  const projectFolder = path.resolve(cwd);
  const projectFileConfig = readProjectFileConfig(projectFolder);
  const projectConfigFile = path.join(projectFolder, ".maclaw", "maclaw.json");
  const hasProjectConfig = existsSync(projectConfigFile);
  const serverSecrets = loadServerSecrets();
  const compressionModeValue =
    process.env.MACLAW_COMPRESSION_MODE ?? projectFileConfig.compressionMode ?? "none";
  const providerValue =
    process.env.MACLAW_PROVIDER ?? projectFileConfig.provider ?? "openai";
  const storageValue =
    process.env.MACLAW_STORAGE ?? projectFileConfig.storage ?? (hasProjectConfig ? "json" : "none");
  const skillsDir = path.resolve(
    projectFolder,
    process.env.MACLAW_SKILLS_DIR ?? projectFileConfig.skillsDir ?? ".maclaw/skills",
  );

  return {
    createdAt: projectFileConfig.createdAt,
    name: projectFileConfig.name ?? path.basename(projectFolder),
    provider: providerValue === "local" ? "local" : "openai",
    model:
      process.env.MACLAW_MODEL ??
      process.env.OPENAI_MODEL ??
      projectFileConfig.model ??
      "gpt-4.1-mini",
    storage: storageValue === "json" ? "json" : "none",
    notifications: normalizeNotifications(projectFileConfig.notifications),
    retentionDays: toPositiveInt(
      process.env.MACLAW_RETENTION_DAYS,
      projectFileConfig.retentionDays ?? 30,
    ),
    skillsDir,
    compressionMode: compressionModeValue === "planned" ? "planned" : "none",
    schedulerPollMs: toPositiveInt(
      process.env.MACLAW_SCHEDULER_POLL_MS,
      projectFileConfig.schedulerPollMs ?? 15_000,
    ),
    projectConfigFile,
    projectFolder,
    chatsDir: path.join(defaultProjectDataDir(projectFolder), "chats"),
    chatId: process.env.MACLAW_CHAT_ID ?? "default",
    openAiApiKey: process.env.OPENAI_API_KEY ?? serverSecrets.openai.apiKey,
  };
};

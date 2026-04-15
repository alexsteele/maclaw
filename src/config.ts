/**
 * Project configuration loading, defaults, and path helpers for maclaw.
 *
 * This module defines the main `ProjectConfig` shape used by the harness and
 * runtime. See `docs/config.md` for the user-facing config documentation.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ensureDir, writeJsonFile } from "./fs-utils.js";
import { DEFAULT_MODEL } from "./models.js";
import { normalizeNotifications } from "./notifications.js";
import { loadServerSecrets } from "./server-config.js";
import { normalizeDefaultTaskTime } from "./task.js";
import type { ToolPermission } from "./tools/types.js";
import type { NotificationPolicy } from "./types.js";

export const defaultProjectDataDir = (projectFolder: string): string =>
  path.join(projectFolder, ".maclaw");

export const defaultProjectLockFile = (projectFolder: string): string =>
  path.join(defaultProjectDataDir(projectFolder), "lock.json");

export const defaultTasksFile = (projectFolder: string): string =>
  path.join(defaultProjectDataDir(projectFolder), "tasks.json");

export const defaultTaskRunsFile = (projectFolder: string): string =>
  path.join(defaultProjectDataDir(projectFolder), "task-runs.jsonl");

export const defaultAgentsFile = (projectFolder: string): string =>
  path.join(defaultProjectDataDir(projectFolder), "agents.json");

export const defaultInboxFile = (projectFolder: string): string =>
  path.join(defaultProjectDataDir(projectFolder), "inbox.jsonl");

export const defaultAgentInboxFile = (projectFolder: string): string =>
  path.join(defaultProjectDataDir(projectFolder), "agent-inbox.jsonl");

export const defaultAgentMemoryFile = (projectFolder: string): string =>
  path.join(defaultProjectDataDir(projectFolder), "agent-memory.json");

export const defaultSqliteFile = (projectFolder: string): string =>
  path.join(defaultProjectDataDir(projectFolder), "maclaw.db");

export const defaultSandboxDir = (projectFolder: string): string =>
  path.join(defaultProjectDataDir(projectFolder), "sandboxes");

export type ModelProvider = "dummy" | "openai";

export type ProjectConfig = {
  name: string;
  createdAt?: string;
  model: string;
  storage: "json" | "sqlite" | "none";
  tools: ToolPermission[];
  notifications: NotificationPolicy;
  defaultTaskTime: string;
  contextMessages: number;
  maxToolIterations: number;
  retentionDays: number;
  skillsDir: string;
  basePromptFile?: string;
  compressionMode: "none" | "planned";
  schedulerPollMs: number;
  projectFolder: string;
  projectConfigFile: string;
  chatId: string;
  openAiApiKey?: string;
  chatsDir: string;
};

const defaultTools: ToolPermission[] = ["read"];

export const normalizeToolPermissions = (value: unknown): ToolPermission[] => {
  const parsed =
    typeof value === "string"
      ? [value]
      : Array.isArray(value)
        ? value
        : [];

  const allowed = parsed.filter(
    (entry): entry is ToolPermission =>
      entry === "read" || entry === "act" || entry === "dangerous",
  );

  return allowed.length > 0 ? Array.from(new Set(allowed)) : [...defaultTools];
};

export const normalizeConfiguredModel = (
  value: string | undefined,
  fallbackProvider: ModelProvider = "openai",
): string => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return fallbackProvider === "dummy" ? "dummy/default" : DEFAULT_MODEL;
  }

  const prefixedMatch = trimmed.match(/^(dummy|openai)\/(.+)$/u);
  if (prefixedMatch) {
    return `${prefixedMatch[1]}/${prefixedMatch[2]!.trim()}`;
  }

  return `${fallbackProvider}/${trimmed}`;
};

export const parseConfiguredModel = (
  value: string,
): { modelName: string; provider: ModelProvider } => {
  const normalized = normalizeConfiguredModel(value);
  const separatorIndex = normalized.indexOf("/");
  return {
    provider: normalized.startsWith("dummy/") ? "dummy" : "openai",
    modelName: normalized.slice(separatorIndex + 1),
  };
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
    model: normalizeConfiguredModel(mergedConfig.model),
    storage: mergedConfig.storage ?? "json",
    tools: normalizeToolPermissions(mergedConfig.tools),
    notifications: normalizeNotifications(mergedConfig.notifications),
    defaultTaskTime: normalizeDefaultTaskTime(mergedConfig.defaultTaskTime),
    contextMessages: mergedConfig.contextMessages ?? 20,
    maxToolIterations: mergedConfig.maxToolIterations ?? 8,
    skillsDir: mergedConfig.skillsDir ?? ".maclaw/skills",
    basePromptFile: mergedConfig.basePromptFile,
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
  const legacyProvider = (projectFileConfig as Partial<{ provider: ModelProvider }>).provider;
  const skillsDir = path.resolve(
    projectFolder,
    projectFileConfig.skillsDir ?? ".maclaw/skills",
  );

  return {
    createdAt: projectFileConfig.createdAt,
    name: projectFileConfig.name ?? path.basename(projectFolder),
    model: normalizeConfiguredModel(
      projectFileConfig.model,
      legacyProvider ?? "openai",
    ),
    storage:
      projectFileConfig.storage === "json" || projectFileConfig.storage === "sqlite"
        ? projectFileConfig.storage
        : hasProjectConfig
          ? "json"
          : "none",
    tools: normalizeToolPermissions(projectFileConfig.tools),
    notifications: normalizeNotifications(projectFileConfig.notifications),
    defaultTaskTime: normalizeDefaultTaskTime(projectFileConfig.defaultTaskTime),
    contextMessages: projectFileConfig.contextMessages ?? 20,
    maxToolIterations: projectFileConfig.maxToolIterations ?? 8,
    retentionDays: projectFileConfig.retentionDays ?? 30,
    skillsDir,
    basePromptFile:
      projectFileConfig.basePromptFile
        ? path.resolve(projectFolder, projectFileConfig.basePromptFile)
        : undefined,
    compressionMode: projectFileConfig.compressionMode === "planned" ? "planned" : "none",
    schedulerPollMs: projectFileConfig.schedulerPollMs ?? 15_000,
    projectConfigFile,
    projectFolder,
    chatsDir: path.join(defaultProjectDataDir(projectFolder), "chats"),
    chatId: "default",
    openAiApiKey: process.env.OPENAI_API_KEY ?? serverSecrets.openai.apiKey,
  };
};

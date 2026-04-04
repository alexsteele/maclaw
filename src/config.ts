import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ensureDir, writeJsonFile } from "./fs-utils.js";

export type ProjectFileConfig = {
  compressionMode?: "none" | "planned";
  createdAt?: string;
  model?: string;
  name?: string;
  provider?: "local" | "openai";
  retentionDays?: number;
  schedulerPollMs?: number;
  skillsDir?: string;
};

export type AppConfig = {
  createdAt?: string;
  dataDir: string;
  isProjectInitialized: boolean;
  model: string;
  provider: "local" | "openai";
  projectConfigFile: string;
  projectFolder: string;
  projectName: string;
  sessionsDir: string;
  schedulerFile: string;
  taskRunsFile: string;
  skillsDir: string;
  sessionId: string;
  retentionDays: number;
  compressionMode: "none" | "planned";
  schedulerPollMs: number;
  openAiApiKey?: string;
};

const toPositiveInt = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const readProjectFileConfig = (cwd: string): ProjectFileConfig => {
  const projectConfigFile = path.join(cwd, ".maclaw", "maclaw.json");
  if (!existsSync(projectConfigFile)) {
    return {};
  }

  const raw = readFileSync(projectConfigFile, "utf8");
  return JSON.parse(raw) as ProjectFileConfig;
};

export const initProjectConfig = async (cwd: string = process.cwd()): Promise<ProjectFileConfig> => {
  const projectFolder = path.resolve(cwd);
  const projectConfigFile = path.join(projectFolder, ".maclaw", "maclaw.json");
  const existingConfig = readProjectFileConfig(projectFolder);
  const createdAt = existingConfig.createdAt ?? new Date().toISOString();

  const nextConfig: ProjectFileConfig = {
    createdAt,
    name: existingConfig.name ?? path.basename(projectFolder),
    retentionDays: existingConfig.retentionDays ?? 30,
    provider: existingConfig.provider ?? "openai",
    model: existingConfig.model ?? "gpt-4.1-mini",
    ...(existingConfig.skillsDir ? { skillsDir: existingConfig.skillsDir } : {}),
    ...(existingConfig.compressionMode
      ? { compressionMode: existingConfig.compressionMode }
      : {}),
    ...(existingConfig.schedulerPollMs
      ? { schedulerPollMs: existingConfig.schedulerPollMs }
      : {}),
  };

  await ensureDir(path.dirname(projectConfigFile));
  await ensureDir(path.resolve(projectFolder, nextConfig.skillsDir ?? ".maclaw/skills"));
  await writeJsonFile(projectConfigFile, nextConfig);
  return nextConfig;
};

export const loadConfig = (cwd: string = process.cwd()): AppConfig => {
  const projectFolder = path.resolve(cwd);
  const projectFileConfig = readProjectFileConfig(projectFolder);
  const projectConfigFile = path.join(projectFolder, ".maclaw", "maclaw.json");
  const isProjectInitialized = existsSync(projectConfigFile);
  const maclawDir = path.join(projectFolder, ".maclaw");
  const compressionModeValue =
    process.env.MACLAW_COMPRESSION_MODE ?? projectFileConfig.compressionMode ?? "none";
  const providerValue =
    process.env.MACLAW_PROVIDER ?? projectFileConfig.provider ?? "openai";
  const dataDir = path.resolve(
    projectFolder,
    process.env.MACLAW_DATA_DIR ?? ".maclaw",
  );
  const skillsDir = path.resolve(
    projectFolder,
    process.env.MACLAW_SKILLS_DIR ?? projectFileConfig.skillsDir ?? ".maclaw/skills",
  );

  return {
    createdAt: projectFileConfig.createdAt,
    dataDir,
    isProjectInitialized,
    model:
      process.env.MACLAW_MODEL ??
      process.env.OPENAI_MODEL ??
      projectFileConfig.model ??
      "gpt-4.1-mini",
    provider: providerValue === "local" ? "local" : "openai",
    projectConfigFile,
    projectFolder,
    projectName: projectFileConfig.name ?? path.basename(projectFolder),
    sessionsDir: path.join(dataDir, "chats"),
    schedulerFile: path.join(dataDir, "tasks.json"),
    taskRunsFile: path.join(dataDir, "task-runs.jsonl"),
    skillsDir,
    sessionId: process.env.MACLAW_SESSION_ID ?? "default",
    retentionDays: toPositiveInt(
      process.env.MACLAW_RETENTION_DAYS,
      projectFileConfig.retentionDays ?? 30,
    ),
    compressionMode: compressionModeValue === "planned" ? "planned" : "none",
    schedulerPollMs: toPositiveInt(
      process.env.MACLAW_SCHEDULER_POLL_MS,
      projectFileConfig.schedulerPollMs ?? 15_000,
    ),
    openAiApiKey: process.env.OPENAI_API_KEY,
  };
};

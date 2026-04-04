import path from "node:path";

export type AppConfig = {
  dataDir: string;
  sessionsDir: string;
  schedulerFile: string;
  skillsDir: string;
  sessionId: string;
  retentionDays: number;
  compressionMode: "none" | "planned";
  schedulerPollMs: number;
  openAiApiKey?: string;
  openAiModel: string;
};

const toPositiveInt = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const loadConfig = (cwd: string = process.cwd()): AppConfig => {
  const dataDir = path.resolve(cwd, process.env.MACLAW_DATA_DIR ?? "data");

  return {
    dataDir,
    sessionsDir: path.join(dataDir, "sessions"),
    schedulerFile: path.join(dataDir, "tasks.json"),
    skillsDir: path.resolve(cwd, process.env.MACLAW_SKILLS_DIR ?? "skills"),
    sessionId: process.env.MACLAW_SESSION_ID ?? "default",
    retentionDays: toPositiveInt(process.env.MACLAW_RETENTION_DAYS, 30),
    compressionMode:
      process.env.MACLAW_COMPRESSION_MODE === "planned" ? "planned" : "none",
    schedulerPollMs: toPositiveInt(process.env.MACLAW_SCHEDULER_POLL_MS, 15_000),
    openAiApiKey: process.env.OPENAI_API_KEY,
    openAiModel: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
  };
};

// Shared project config helpers used by CLI and slash commands.
import type { ProjectConfig } from "./config.js";

export const editableProjectConfigKeys = new Set([
  "name",
  "provider",
  "model",
  "storage",
  "notifications",
  "contextMessages",
  "maxToolIterations",
  "retentionDays",
  "skillsDir",
  "compressionMode",
  "schedulerPollMs",
]);

export const renderProjectConfig = (config: ProjectConfig): string =>
  [
    `name: ${config.name}`,
    `folder: ${config.projectFolder}`,
    `config: ${config.projectConfigFile}`,
    `provider: ${config.provider}`,
    `model: ${config.model}`,
    `storage: ${config.storage}`,
    `notifications: ${JSON.stringify(config.notifications)}`,
    `contextMessages: ${config.contextMessages}`,
    `maxToolIterations: ${config.maxToolIterations}`,
    `retentionDays: ${config.retentionDays}`,
    `skillsDir: ${config.skillsDir}`,
    `compressionMode: ${config.compressionMode}`,
    `schedulerPollMs: ${config.schedulerPollMs}`,
    "note: env vars take precedence over file config when present",
  ].join("\n");

export const parseProjectConfigValue = (
  key: string,
  value: string,
): Partial<ProjectConfig> | string => {
  if (key === "provider") {
    if (value !== "openai" && value !== "dummy") {
      return "provider must be 'openai' or 'dummy'";
    }

    return { provider: value };
  }

  if (key === "compressionMode") {
    if (value !== "none" && value !== "planned") {
      return "compressionMode must be 'none' or 'planned'";
    }

    return { compressionMode: value };
  }

  if (key === "storage") {
    if (value !== "json" && value !== "none") {
      return "storage must be 'json' or 'none'";
    }

    return { storage: value };
  }

  if (key === "notifications") {
    if (value === "all" || value === "none") {
      return { notifications: value };
    }

    try {
      return { notifications: JSON.parse(value) };
    } catch {
      return "notifications must be 'all', 'none', or valid JSON";
    }
  }

  if (
    key === "contextMessages" ||
    key === "maxToolIterations" ||
    key === "retentionDays" ||
    key === "schedulerPollMs"
  ) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return `${key} must be a positive integer`;
    }

    if (key === "contextMessages") {
      return { contextMessages: parsed };
    }

    if (key === "maxToolIterations") {
      return { maxToolIterations: parsed };
    }

    return key === "retentionDays" ? { retentionDays: parsed } : { schedulerPollMs: parsed };
  }

  return { [key]: value } as Partial<ProjectConfig>;
};

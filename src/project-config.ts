/**
 * Shared project config helpers used by CLI and slash commands.
 *
 * This keeps config rendering and parsing consistent between `maclaw config`
 * and the shared `/config` command surface. See `docs/config.md`.
 */
import {
  normalizeConfiguredModel,
  normalizeToolPermissions,
  parseConfiguredModel,
  type ProjectConfig,
} from "./config.js";
import { parseTimeOfDay } from "./task.js";

export const editableProjectConfigKeys = new Set([
  "name",
  "model",
  "storage",
  "tools",
  "notifications",
  "defaultTaskTime",
  "contextMessages",
  "maxToolIterations",
  "retentionDays",
  "skillsDir",
  "basePromptFile",
  "compressionMode",
  "schedulerPollMs",
]);

export const renderProjectConfig = (config: ProjectConfig): string =>
  [
    `name: ${config.name}`,
    `folder: ${config.projectFolder}`,
    `config: ${config.projectConfigFile}`,
    `model: ${config.model}`,
    `modelProvider: ${parseConfiguredModel(config.model).provider}`,
    `storage: ${config.storage}`,
    `tools: ${JSON.stringify(config.tools)}`,
    `notifications: ${JSON.stringify(config.notifications)}`,
    `defaultTaskTime: ${config.defaultTaskTime}`,
    `contextMessages: ${config.contextMessages}`,
    `maxToolIterations: ${config.maxToolIterations}`,
    `retentionDays: ${config.retentionDays}`,
    `skillsDir: ${config.skillsDir}`,
    `basePromptFile: ${config.basePromptFile ?? "(none)"}`,
    `compressionMode: ${config.compressionMode}`,
    `schedulerPollMs: ${config.schedulerPollMs}`,
    "note: secrets and global paths can still come from env vars",
  ].join("\n");

export const parseProjectConfigValue = (
  key: string,
  value: string,
): Partial<ProjectConfig> | string => {
  if (key === "model") {
    return { model: normalizeConfiguredModel(value) };
  }

  if (key === "compressionMode") {
    if (value !== "none" && value !== "planned") {
      return "compressionMode must be 'none' or 'planned'";
    }

    return { compressionMode: value };
  }

  if (key === "storage") {
    if (value !== "json" && value !== "sqlite" && value !== "none") {
      return "storage must be 'json', 'sqlite', or 'none'";
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

  if (key === "tools") {
    const trimmed = value.trim();
    const parsedList = trimmed
      .split(/[,\s]+/u)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

    if (
      parsedList.length > 0 &&
      parsedList.every(
        (entry) => entry === "read" || entry === "act" || entry === "dangerous",
      )
    ) {
      return { tools: normalizeToolPermissions(parsedList) };
    }

    try {
      const parsed = JSON.parse(trimmed);
      if (
        !Array.isArray(parsed) ||
        parsed.length === 0 ||
        parsed.some(
          (entry) => entry !== "read" && entry !== "act" && entry !== "dangerous",
        )
      ) {
        return "tools must be a list like 'read act' or a JSON array of tool permissions";
      }

      return { tools: normalizeToolPermissions(parsed) };
    } catch {
      return "tools must be a list like 'read act' or a JSON array of tool permissions";
    }
  }

  if (key === "defaultTaskTime") {
    const trimmed = value.trim();
    if (!trimmed || !parseTimeOfDay(trimmed)) {
      return "defaultTaskTime must be a time like '9:00 AM' or '17:30'";
    }

    return { defaultTaskTime: trimmed };
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

  if (key === "basePromptFile") {
    const trimmed = value.trim();
    return { basePromptFile: trimmed.length > 0 ? trimmed : undefined };
  }

  return { [key]: value } as Partial<ProjectConfig>;
};

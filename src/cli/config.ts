import process from "node:process";
import { initProjectConfig, loadConfig, type ProjectConfig } from "../config.js";

const configHelpText = [
  "Usage: maclaw config [command]",
  "",
  "Commands:",
  "  maclaw config                  Show the current project config",
  "  maclaw config get <key>        Show one config value",
  "  maclaw config set <key> <val>  Update a config value",
  "",
  "Editable keys:",
  "  name",
  "  provider",
  "  model",
  "  storage",
  "  notifications",
  "  contextMessages",
  "  maxToolIterations",
  "  retentionDays",
  "  skillsDir",
  "  compressionMode",
  "  schedulerPollMs",
].join("\n");

const editableKeys = new Set([
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

const renderConfig = (config: ProjectConfig): string =>
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

const parseConfigValue = (
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

export const runConfigCommand = async (args: string[]): Promise<void> => {
  const subcommand = args[0];

  if (!subcommand || subcommand === "-h" || subcommand === "--help" || subcommand === "help") {
    process.stdout.write(`${configHelpText}\n`);
    if (!subcommand) {
      process.stdout.write(`\n${renderConfig(loadConfig())}\n`);
    }
    return;
  }

  if (subcommand === "get") {
    const key = args[1];
    if (!key) {
      throw new Error("Usage: maclaw config get <key>");
    }

    const config = loadConfig();
    if (!(key in config)) {
      throw new Error(`Unknown config key: ${key}`);
    }

    process.stdout.write(`${String(config[key as keyof ProjectConfig])}\n`);
    return;
  }

  if (subcommand === "set") {
    const key = args[1];
    const value = args.slice(2).join(" ");
    if (!key || !value) {
      throw new Error("Usage: maclaw config set <key> <value>");
    }

    if (!editableKeys.has(key)) {
      throw new Error(`Unknown or non-editable config key: ${key}`);
    }

    const parsedValue = parseConfigValue(key, value);
    if (typeof parsedValue === "string") {
      throw new Error(parsedValue);
    }

    const config = await initProjectConfig(process.cwd(), parsedValue);
    process.stdout.write(`${key} = ${String(config[key as keyof ProjectConfig])}\n`);
    return;
  }

  throw new Error(`Unknown config command: ${subcommand}`);
};

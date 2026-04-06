import process from "node:process";
import { initProjectConfig, loadConfig, type ProjectConfig } from "../config.js";
import {
  editableProjectConfigKeys,
  parseProjectConfigValue,
  renderProjectConfig,
} from "../project-config.js";

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

export const runConfigCommand = async (args: string[]): Promise<void> => {
  const subcommand = args[0];

  if (!subcommand || subcommand === "-h" || subcommand === "--help" || subcommand === "help") {
    process.stdout.write(`${configHelpText}\n`);
    if (!subcommand) {
      process.stdout.write(`\n${renderProjectConfig(loadConfig())}\n`);
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

    if (!editableProjectConfigKeys.has(key)) {
      throw new Error(`Unknown or non-editable config key: ${key}`);
    }

    const parsedValue = parseProjectConfigValue(key, value);
    if (typeof parsedValue === "string") {
      throw new Error(parsedValue);
    }

    const config = await initProjectConfig(process.cwd(), parsedValue);
    process.stdout.write(`${key} = ${String(config[key as keyof ProjectConfig])}\n`);
    return;
  }

  throw new Error(`Unknown config command: ${subcommand}`);
};

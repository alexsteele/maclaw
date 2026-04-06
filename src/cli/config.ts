import process from "node:process";
import { dispatchCommand } from "../commands.js";
import { Harness } from "../harness.js";

const configHelpText = [
  "Usage: maclaw config [command]",
  "",
  "Commands:",
  "  maclaw config                  Show the current project config",
  "  maclaw config get <key>        Show one config value",
  "  maclaw config set <key> <val>  Update a config value",
].join("\n");

export const runConfigCommand = async (args: string[]): Promise<void> => {
  const subcommand = args[0];
  const harness = Harness.load(process.cwd());

  if (!subcommand || subcommand === "-h" || subcommand === "--help" || subcommand === "help") {
    process.stdout.write(`${configHelpText}\n`);
    if (!subcommand) {
      const reply = await dispatchCommand(harness, "/config");
      process.stdout.write(`\n${reply}\n`);
    }
    return;
  }

  const input = `/config ${args.join(" ")}`;
  const reply = await dispatchCommand(harness, input);
  if (reply === null) {
    process.stderr.write(`Unknown config command: ${subcommand}\n`);
    process.exitCode = 1;
    return;
  }

  if (
    reply.startsWith("Usage:") ||
    reply.startsWith("Unknown ") ||
    reply.startsWith("Invalid ")
  ) {
    process.stderr.write(`${reply}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`${reply}\n`);
};

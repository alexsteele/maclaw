#!/usr/bin/env node

import { runConfigCommand } from "./cli/config.js";
import { runRepl } from "./cli/repl.js";
import { normalizeSetupSection, runSetup } from "./cli/setup.js";
import { loadServerConfig } from "./server-config.js";
import { MaclawServer } from "./server.js";
import { isTeleportUrl, sendTeleportCommand } from "./teleport.js";

const cliHelpText = [
  "Usage: maclaw [command]",
  "",
  "Commands:",
  "  repl            Start the local REPL (default)",
  "  server          Start the maclaw server",
  "  teleport        Send one command or message to a remote maclaw server",
  "  setup [section] Run guided setup",
  "  config          Show or update project config",
  "  -h, --help      Show this help",
].join("\n");

const runReplCommand = async (): Promise<void> => {
  await runRepl();
};

const parsePortFlag = (args: string[]): number | undefined => {
  const portIndex = args.indexOf("--port");
  if (portIndex < 0) {
    return undefined;
  }

  const rawPort = args[portIndex + 1];
  const port = Number.parseInt(rawPort ?? "", 10);
  if (!Number.isFinite(port) || port < 0) {
    throw new Error("Usage: maclaw server [--port <port>] [--api-only]");
  }

  return port;
};

const hasFlag = (args: string[], name: string): boolean => args.includes(name);

const runServer = async (args: string[]): Promise<void> => {
  const server = MaclawServer.load({
    port: parsePortFlag(args),
    serveHttp: hasFlag(args, "--api-only") || hasFlag(args, "--no-portal"),
    servePortal: !(hasFlag(args, "--api-only") || hasFlag(args, "--no-portal")),
  });
  await server.start();
};

const runSetupCommand = async (args: string[]): Promise<void> => {
  const startSection = normalizeSetupSection(args[0]);
  if (args[0] && !startSection) {
    throw new Error("Usage: maclaw setup [all|model|project|server|channels]");
  }

  await runSetup({ startSection });
};

const parseFlagValue = (args: string[], name: string): string | undefined => {
  const index = args.indexOf(name);
  if (index < 0) {
    return undefined;
  }

  const value = args[index + 1]?.trim();
  if (!value) {
    throw new Error(`Usage: maclaw teleport <url|remote> [--project <name>] [--chat <id>] <message>`);
  }

  return value;
};

const removeFlag = (args: string[], name: string): string[] => {
  const index = args.indexOf(name);
  if (index < 0) {
    return [...args];
  }

  return [...args.slice(0, index), ...args.slice(index + 2)];
};

const runTeleportCommand = async (args: string[]): Promise<void> => {
  const project = parseFlagValue(args, "--project");
  const chatId = parseFlagValue(args, "--chat");
  const withoutProject = removeFlag(args, "--project");
  const positional = removeFlag(withoutProject, "--chat");
  const target = positional[0]?.trim();
  const text = positional.slice(1).join(" ").trim();

  if (!target || !text) {
    throw new Error("Usage: maclaw teleport <url|remote> [--project <name>] [--chat <id>] <message>");
  }

  const serverConfig = isTeleportUrl(target) ? undefined : loadServerConfig();
  const result = await sendTeleportCommand(
    target,
    {
      project,
      chatId,
      text,
    },
    serverConfig,
  );

  process.stdout.write(`${result.reply}\n`);
};

const main = async (): Promise<void> => {
  const command = process.argv[2];

  if (command === "-h" || command === "--help" || command === "help") {
    process.stdout.write(`${cliHelpText}\n`);
    return;
  }

  if (!command || command === "repl") {
    await runReplCommand();
    return;
  }

  if (command === "server") {
    await runServer(process.argv.slice(3));
    return;
  }

  if (command === "teleport") {
    await runTeleportCommand(process.argv.slice(3));
    return;
  }

  if (command === "setup") {
    await runSetupCommand(process.argv.slice(3));
    return;
  }

  if (command === "config") {
    await runConfigCommand(process.argv.slice(3));
    return;
  }

  throw new Error(`Unknown command: ${command}`);
};

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});

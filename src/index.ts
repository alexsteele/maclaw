#!/usr/bin/env node

import { runConfigCommand } from "./cli/config.js";
import { runRepl } from "./cli/repl.js";
import { normalizeSetupSection, runSetup } from "./cli/setup.js";
import { findRemoteConfig, isHttpRemoteTarget } from "./remote/index.js";
import { loadServerConfig } from "./server-config.js";
import { MaclawServer } from "./server.js";
import { sendTeleportCommand, TeleportController } from "./teleport.js";

const cliHelpText = [
  "Usage: maclaw [command]",
  "",
  "Commands:",
  "  repl            Start the local REPL (default)",
  "  server          Start the maclaw server",
  "  teleport        Send one command or attach to a remote maclaw runtime",
  "  setup [section] Run guided setup",
  "  config          Show or update project config",
  "  -h, --help      Show this help",
].join("\n");

const serverHelpText = [
  "Usage: maclaw server [options]",
  "",
  "Options:",
  "  --port <port>    Bind the local server to a specific port",
  "  --api-only       Serve the command API without the portal UI",
  "  --no-portal      Alias for --api-only",
  "  --log-stderr     Mirror server logs to stderr in addition to the log file",
  "  -h, --help       Show this help",
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
    throw new Error("Usage: maclaw server [--port <port>] [--api-only] [--log-stderr]");
  }

  return port;
};

const hasFlag = (args: string[], name: string): boolean => args.includes(name);

const runServer = async (args: string[]): Promise<void> => {
  if (args.includes("help") || hasFlag(args, "-h") || hasFlag(args, "--help")) {
    process.stdout.write(`${serverHelpText}\n`);
    return;
  }

  const server = MaclawServer.load({
    port: parsePortFlag(args),
    logStderr: hasFlag(args, "--log-stderr"),
    serveHttp: hasFlag(args, "--api-only") || hasFlag(args, "--no-portal"),
    servePortal: !(hasFlag(args, "--api-only") || hasFlag(args, "--no-portal")),
  });
  await server.start();
};

const runSetupCommand = async (args: string[]): Promise<void> => {
  const startSection = normalizeSetupSection(args[0]);
  if (args[0] && !startSection) {
    throw new Error("Usage: maclaw setup [all|model|project|server|channels|remotes]");
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
    throw new Error(teleportUsageText);
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

const teleportUsageText = [
  "Usage:",
  "  maclaw teleport <url|remote> [--project <name>] [--chat <id>] <message>",
  "  maclaw teleport <shell-remote>",
].join("\n");

const runTeleportCommand = async (args: string[]): Promise<void> => {
  const project = parseFlagValue(args, "--project");
  const chatId = parseFlagValue(args, "--chat");
  const withoutProject = removeFlag(args, "--project");
  const positional = removeFlag(withoutProject, "--chat");
  const target = positional[0]?.trim();
  const text = positional.slice(1).join(" ").trim();

  if (!target) {
    throw new Error(teleportUsageText);
  }

  try {
    const serverConfig = isHttpRemoteTarget(target) ? undefined : loadServerConfig();
    const remoteConfig = serverConfig ? findRemoteConfig(serverConfig, target) : undefined;

    if (remoteConfig?.client === "shell") {
      if (text) {
        throw new Error("Shell remotes attach interactively. Run: maclaw teleport <remote>");
      }

      const controller = new TeleportController(serverConfig);
      const result = await controller.attachShell(target);
      if (result.exitCode !== 0 && result.message.trim().length > 0) {
        process.stderr.write(`${result.message}\n`);
        process.exitCode = result.exitCode || 1;
      }
      return;
    }

    if (!text) {
      throw new Error(teleportUsageText);
    }

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
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
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

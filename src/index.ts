#!/usr/bin/env node

import { runConfigCommand } from "./cli/config.js";
import { runRepl } from "./cli/repl.js";
import { runSetup } from "./cli/setup.js";
import { MaclawServer } from "./server.js";

const cliHelpText = [
  "Usage: maclaw [command]",
  "",
  "Commands:",
  "  repl            Start the local REPL (default)",
  "  server          Start the maclaw server and web portal",
  "  setup           Run guided setup",
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
    throw new Error("Usage: maclaw server [--port <port>]");
  }

  return port;
};

const runServer = async (args: string[]): Promise<void> => {
  const server = MaclawServer.load({
    port: parsePortFlag(args),
  });
  await server.start();
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

  if (command === "setup") {
    await runSetup();
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

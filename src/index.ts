#!/usr/bin/env node

import { Harness } from "./harness.js";
import { runRepl } from "./repl.js";
import { MaclawServer } from "./server.js";
import { runSetup } from "./setup.js";

const cliHelpText = [
  "Usage: maclaw [command]",
  "",
  "Commands:",
  "  repl            Start the local REPL (default)",
  "  server          Start the maclaw server",
  "  setup           Run guided setup",
  "  -h, --help      Show this help",
].join("\n");

const runReplCommand = async (): Promise<void> => {
  const harness = Harness.load();
  await runRepl(harness);
};

const runServer = async (): Promise<void> => {
  const server = MaclawServer.load();
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
    await runServer();
    return;
  }

  if (command === "setup") {
    await runSetup();
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

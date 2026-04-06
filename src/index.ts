#!/usr/bin/env node

import { Harness } from "./harness.js";
import { runRepl } from "./repl.js";
import { MaclawServer } from "./server.js";
import { runSetup } from "./setup.js";

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

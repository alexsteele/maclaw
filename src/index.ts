import { Harness } from "./harness.js";
import { runRepl } from "./repl.js";

const main = async (): Promise<void> => {
  const harness = Harness.load();

  await harness.pruneExpiredChats();

  await runRepl(harness);
};

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});

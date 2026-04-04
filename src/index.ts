import { Harness } from "./harness.js";
import { runRepl } from "./repl.js";

const main = async (): Promise<void> => {
  let harness = Harness.load();

  await harness.pruneExpiredChats();

  const timer = setInterval(() => {
    void harness.runDueTasks(async (task) => {
      const message = await harness.handleScheduledTask(task.sessionId, task.prompt);
      process.stdout.write(`\n[scheduled:${task.title}] ${message.content}\n\n> `);
    });
  }, harness.config.schedulerPollMs);

  timer.unref();

  await runRepl({
    getHarness: () => harness,
    setHarness: (nextHarness) => {
      harness = nextHarness;
    },
  });
};

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});

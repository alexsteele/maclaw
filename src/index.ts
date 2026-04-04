import { loadConfig } from "./config.js";
import { ensureDir } from "./fs-utils.js";
import { MaclawAgent } from "./agent.js";
import { runRepl } from "./repl.js";
import { TaskScheduler } from "./scheduler.js";
import { pruneExpiredSessions } from "./sessions.js";

const main = async (): Promise<void> => {
  const config = loadConfig();
  await ensureDir(config.dataDir);
  await ensureDir(config.sessionsDir);
  await ensureDir(config.skillsDir);

  const scheduler = new TaskScheduler(config.schedulerFile);
  const agent = new MaclawAgent(config, scheduler);

  await pruneExpiredSessions(config.sessionsDir, config.retentionDays);

  const timer = setInterval(() => {
    void scheduler.runDueTasks(async (task) => {
      const message = await agent.handleScheduledTask(task.sessionId, task.prompt);
      process.stdout.write(`\n[scheduled:${task.title}] ${message.content}\n\n> `);
    });
  }, config.schedulerPollMs);

  timer.unref();

  await runRepl(config, agent, scheduler);
};

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});

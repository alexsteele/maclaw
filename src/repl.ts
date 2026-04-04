import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { AppConfig } from "./config.js";
import { loadSession } from "./sessions.js";
import { loadSkills } from "./skills.js";
import { MaclawAgent } from "./agent.js";
import { TaskScheduler } from "./scheduler.js";

const helpText = [
  "Commands:",
  "  /help              Show this help",
  "  /skills            List local skills",
  "  /history           Show the current session transcript",
  "  /tasks             List scheduled tasks",
  "  /quit              Exit the REPL",
].join("\n");

export const runRepl = async (
  config: AppConfig,
  agent: MaclawAgent,
  scheduler: TaskScheduler,
): Promise<void> => {
  const rl = readline.createInterface({ input, output });

  output.write("maclaw REPL\n");
  output.write(`session: ${config.sessionId}\n`);
  output.write("type /help for commands\n\n");

  while (true) {
    const line = (await rl.question("> ")).trim();
    if (line.length === 0) {
      continue;
    }

    if (line === "/quit") {
      rl.close();
      break;
    }

    if (line === "/help") {
      output.write(`${helpText}\n\n`);
      continue;
    }

    if (line === "/skills") {
      const skills = await loadSkills(config.skillsDir);
      output.write(
        skills.length === 0
          ? "No skills found.\n\n"
          : `${skills.map((skill) => `- ${skill.name}: ${skill.description}`).join("\n")}\n\n`,
      );
      continue;
    }

    if (line === "/history") {
      const session = await loadSession(
        config.sessionsDir,
        config.sessionId,
        config.retentionDays,
        config.compressionMode,
      );

      const transcript =
        session.messages.length === 0
          ? "No history yet."
          : session.messages
              .map((message) => `[${message.role}] ${message.content}`)
              .join("\n");

      output.write(`${transcript}\n\n`);
      continue;
    }

    if (line === "/tasks") {
      const tasks = await scheduler.listTasks(config.sessionId);
      const rendered =
        tasks.length === 0
          ? "No scheduled tasks."
          : tasks
              .map((task) => `- [${task.status}] ${task.title} at ${task.runAt}`)
              .join("\n");
      output.write(`${rendered}\n\n`);
      continue;
    }

    const reply = await agent.handleUserInput(line);
    output.write(`${reply.content}\n\n`);
  }
};

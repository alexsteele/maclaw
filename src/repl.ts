import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { Harness } from "./harness.js";
import { dispatchCommand, helpText } from "./commands.js";

const replHelpText = `${helpText}\n  /quit              Exit the REPL`;

class Repl {
  private readonly rl = readline.createInterface({ input, output });
  private harness: Harness;

  constructor(harness: Harness) {
    this.harness = harness;
  }

  async run(): Promise<void> {
    await this.harness.start(async (task, message) => {
      output.write(`\n[scheduled:${task.title}] ${message.content}\n\n> `);
    });
    this.showStartup();

    while (true) {
      const line = (await this.rl.question("> ")).trim();
      if (line.length === 0) {
        continue;
      }

      const shouldExit = await this.handleLine(line);
      if (shouldExit) {
        this.harness.teardown();
        this.rl.close();
        break;
      }
    }
  }

  private showStartup(): void {
    output.write("maclaw REPL\n");
    output.write(`chat: ${this.harness.getCurrentChatId()}\n`);
    if (!this.harness.isProjectInitialized()) {
      output.write(
        "warning: running without a project config; chats, tasks, and logs will not be saved. run /project init to set up a project\n",
      );
    }
    output.write("type /help for commands\n\n");
  }

  private writeLine(text: string): void {
    output.write(`${text}\n\n`);
  }

  private async handleLine(line: string): Promise<boolean> {
    if (line === "/quit") {
      return true;
    }

    if (line === "/help") {
      this.writeLine(replHelpText);
      return false;
    }

    const commandReply = await dispatchCommand(this.harness, line);
    if (commandReply !== null) {
      this.writeLine(commandReply);
      return false;
    }

    const reply = await this.harness.handleUserInput(line);
    this.writeLine(reply.content);
    return false;
  }
}

export const runRepl = async (harness: Harness): Promise<void> => {
  const repl = new Repl(harness);
  await repl.run();
};

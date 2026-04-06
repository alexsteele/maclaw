import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { dispatchCommand, helpText, projectHelpText } from "../commands.js";
import { Harness } from "../harness.js";
import type { ProviderResult } from "../types.js";

const replHelpText = [
  helpText,
  "  /switch X         Switch the REPL to project folder X",
  "  /quit             Exit the REPL",
  "  /verbose <on|off>  Toggle verbose reply metadata",
].join("\n");

const replProjectHelpText = [
  projectHelpText,
  "  /switch X         Switch the REPL to project folder X",
  "  /verbose <on|off>  Toggle verbose reply metadata",
].join("\n");

const expandHome = (value: string): string => {
  if (value === "~") {
    return os.homedir();
  }

  if (value.startsWith("~/")) {
    return path.join(os.homedir(), value.slice(2));
  }

  return value;
};

class Repl {
  private readonly rl = readline.createInterface({ input, output });
  private harness: Harness;
  private verbose = false;
  private readonly onTaskMessage = async (task: Parameters<Parameters<Harness["start"]>[0]>[0], message: Parameters<Parameters<Harness["start"]>[0]>[1]): Promise<void> => {
    output.write(`\n[scheduled:${task.title}] ${message.content}\n\n> `);
  };

  constructor(harness: Harness) {
    this.harness = harness;
  }

  async run(): Promise<void> {
    await this.harness.start(this.onTaskMessage);
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

  private formatVerboseFooter(result?: ProviderResult): string | null {
    if (!result) {
      return null;
    }

    const parts = [
      result.model ? `model=${result.model}` : null,
      result.usage?.inputTokens !== undefined ? `input=${result.usage.inputTokens}` : null,
      result.usage?.outputTokens !== undefined ? `output=${result.usage.outputTokens}` : null,
      result.usage?.totalTokens !== undefined ? `total=${result.usage.totalTokens}` : null,
      result.usage?.cachedInputTokens !== undefined
        ? `cached=${result.usage.cachedInputTokens}`
        : null,
      result.usage?.reasoningTokens !== undefined
        ? `reasoning=${result.usage.reasoningTokens}`
        : null,
    ].filter((value): value is string => value !== null);

    return parts.length > 0 ? `[usage] ${parts.join(" ")}` : null;
  }

  private async switchProject(requestedFolder: string): Promise<string> {
    const trimmedFolder = requestedFolder.trim();
    if (trimmedFolder.length === 0) {
      return "Provide a project folder, for example: /switch ../other-project";
    }
    const nextFolder = path.resolve(
      this.harness.config.projectFolder,
      expandHome(trimmedFolder),
    );

    this.harness.teardown();
    this.harness = Harness.load(nextFolder);
    await this.harness.start(this.onTaskMessage);

    const lines = [
      `switched to project: ${this.harness.config.name}`,
      `folder: ${this.harness.config.projectFolder}`,
      `chat: ${this.harness.getCurrentChatId()}`,
    ];
    if (!this.harness.isProjectInitialized()) {
      lines.push(
        "warning: running without a project config; run /project init to set up this project",
      );
    }

    return lines.join("\n");
  }

  private async handleLine(line: string): Promise<boolean> {
    if (line === "/quit") {
      return true;
    }

    if (line === "/help") {
      this.writeLine(replHelpText);
      return false;
    }

    if (line === "/help project") {
      this.writeLine(replProjectHelpText);
      return false;
    }

    if (line === "/verbose") {
      this.writeLine(`verbose: ${this.verbose ? "on" : "off"}`);
      return false;
    }

    if (line === "/verbose on") {
      this.verbose = true;
      this.writeLine("verbose: on");
      return false;
    }

    if (line === "/verbose off") {
      this.verbose = false;
      this.writeLine("verbose: off");
      return false;
    }

    if (line.startsWith("/verbose")) {
      this.writeLine("Usage: /verbose <on|off>");
      return false;
    }

    if (line.startsWith("/switch ")) {
      this.writeLine(await this.switchProject(line.slice("/switch ".length)));
      return false;
    }

    const commandReply = await dispatchCommand(this.harness, line);
    if (commandReply !== null) {
      this.writeLine(commandReply);
      return false;
    }

    const reply = await this.harness.handleUserInputDetailed(line);
    const verboseFooter = this.verbose ? this.formatVerboseFooter(reply.providerResult) : null;
    this.writeLine(verboseFooter ? `${reply.message.content}\n${verboseFooter}` : reply.message.content);
    return false;
  }
}

export const runRepl = async (harness: Harness): Promise<void> => {
  const repl = new Repl(harness);
  await repl.run();
};

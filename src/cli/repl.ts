import os from "node:os";
import { existsSync } from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { dispatchCommand, helpText, projectHelpText } from "../commands.js";
import { Harness, type HarnessNotification } from "../harness.js";
import {
  defaultServerConfigFile,
  loadServerConfig,
  maclawHomeDir,
} from "../server-config.js";
import type { Origin, ProviderResult } from "../types.js";

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

const replOrigin: Origin = {
  channel: "repl",
  userId: "local",
};

export const loadReplHarness = (cwd: string = process.cwd()): Harness => {
  const harness = Harness.load(cwd);
  if (harness.isProjectInitialized()) {
    return harness;
  }

  const serverConfigFile = defaultServerConfigFile();
  if (existsSync(serverConfigFile)) {
    const serverConfig = loadServerConfig(serverConfigFile);
    if (serverConfig.defaultProject) {
      const defaultProject = serverConfig.projects.find(
        (project) => project.name === serverConfig.defaultProject,
      );
      if (defaultProject) {
        return Harness.load(defaultProject.folder);
      }
    }
  }

  const defaultProjectFolder = path.join(maclawHomeDir(), "projects", "default");
  const defaultProjectConfigFile = path.join(defaultProjectFolder, ".maclaw", "maclaw.json");
  if (!existsSync(defaultProjectConfigFile)) {
    return harness;
  }

  return Harness.load(defaultProjectFolder);
};

class Repl {
  private readonly rl = readline.createInterface({ input, output });
  private harness: Harness;
  private verbose = false;
  private readonly onTaskMessage = async (task: Parameters<Parameters<Harness["start"]>[0]>[0], message: Parameters<Parameters<Harness["start"]>[0]>[1]): Promise<void> => {
    output.write(`\n[scheduled:${task.title}] ${message.content}\n\n> `);
  };
  private readonly onNotification = async (
    notification: HarnessNotification,
  ): Promise<void> => {
    output.write(`\n[notification:${notification.kind}] ${notification.text}\n\n> `);
  };

  constructor(harness: Harness) {
    this.harness = harness;
  }

  async run(): Promise<void> {
    await this.harness.start(this.onTaskMessage, this.onNotification);
    this.showStartup();

    while (true) {
      let line: string;
      try {
        line = (await this.rl.question("> ")).trim();
      } catch {
        output.write("\n");
        this.harness.teardown();
        this.rl.close();
        break;
      }

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
    output.write(`model: ${this.harness.config.model}\n`);
    output.write(`project: ${this.harness.config.name}\n`);
    output.write(`folder: ${this.harness.config.projectFolder}\n`);
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
    await this.harness.start(this.onTaskMessage, this.onNotification);

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

    const commandReply = await dispatchCommand(this.harness, line, {
      origin: replOrigin,
    });
    if (commandReply !== null) {
      this.writeLine(commandReply);
      return false;
    }

    const reply = await this.harness.promptDetailed(line, {
      origin: replOrigin,
    });
    const verboseFooter = this.verbose ? this.formatVerboseFooter(reply.providerResult) : null;
    this.writeLine(verboseFooter ? `${reply.message.content}\n${verboseFooter}` : reply.message.content);
    return false;
  }
}

export const runRepl = async (harness: Harness): Promise<void> => {
  const repl = new Repl(harness);
  await repl.run();
};

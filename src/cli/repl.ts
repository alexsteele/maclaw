import os from "node:os";
import { existsSync } from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { Channel } from "../channels/channel.js";
import { EmailChannel } from "../channels/email.js";
import { dispatchCommand, helpText, projectHelpText } from "../commands.js";
import { Harness, type HarnessOptions } from "../harness.js";
import { ChannelRouter } from "../router.js";
import { REPL_DISPLAY_INSTRUCTIONS } from "../prompt.js";
import { renderMarkdownForTerminal } from "./render.js";
import {
  defaultServerConfigFile,
  defaultServerSecretsFile,
  loadServerConfig,
  loadServerSecrets,
  maclawHomeDir,
  type ServerConfig,
  type ServerSecrets,
} from "../server-config.js";
import { TeleportController } from "../teleport.js";
import type { TeleportTarget } from "../teleport.js";
import type { Tool } from "../tools/types.js";
import type { Message, Origin, ProviderResult, ScheduledTask } from "../types.js";

const replHelpText = [
  helpText,
  "  /project switch X  Switch the REPL to project folder X",
  "  /quit             Exit the REPL",
  "  /verbose <on|off>  Toggle verbose reply metadata",
  "  /wrap [off|N]     Set REPL output wrap width",
].join("\n");

const replProjectHelpText = [
  projectHelpText,
  "  /project switch X  Switch the REPL to project folder X",
  "  /verbose <on|off>  Toggle verbose reply metadata",
  "  /wrap [off|N]     Set REPL output wrap width",
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

export const formatReplPrompt = (
  target?: TeleportTarget,
): string =>
  !target
    ? "> "
    : `${formatTeleportPromptHeader(target.target)}> `;

const formatTeleportPromptHeader = (target: string): string => {
  if (/^https?:\/\//u.test(target)) {
    try {
      return new URL(target).hostname;
    } catch {
      return target;
    }
  }

  return target;
};

export const wrapReplLine = (line: string, width: number): string => {
  if (line.length <= width || line.trim().length === 0) {
    return line;
  }

  const indentMatch = line.match(/^(\s*)/u);
  const indent = indentMatch?.[1] ?? "";
  const content = line.trim();
  const words = content.split(/\s+/u);
  const wrapped: string[] = [];
  let current = indent;

  for (const word of words) {
    const next = current.trim().length === 0 ? `${indent}${word}` : `${current} ${word}`;
    if (current.length > indent.length && next.length > width) {
      wrapped.push(current);
      current = `${indent}${word}`;
      continue;
    }

    current = next;
  }

  if (current.length > 0) {
    wrapped.push(current);
  }

  return wrapped.join("\n");
};

export const looksLikeMarkdown = (text: string): boolean => {
  return /(^|\n)#{1,6}\s/u.test(text)
    || /(^|\n)-\s/u.test(text)
    || /(^|\n)\d+\.\s/u.test(text)
    || text.includes("```")
    || /`[^`\n]+`/u.test(text);
};

export const loadReplHarness = (
  cwd?: string,
  options: HarnessOptions = {},
): Harness => {
  const resolvedCwd = cwd ?? process.cwd();
  const harness = Harness.load(resolvedCwd, options);
  if (harness.isProjectInitialized()) {
    return harness;
  }

  const serverConfig = loadReplServerConfig();
  if (serverConfig?.defaultProject) {
    const defaultProject = serverConfig.projects.find(
      (project) => project.name === serverConfig.defaultProject,
    );
    if (defaultProject) {
      return Harness.load(defaultProject.folder, options);
    }
  }

  const defaultProjectFolder = path.join(maclawHomeDir(), "projects", "default");
  const defaultProjectConfigFile = path.join(defaultProjectFolder, ".maclaw", "maclaw.json");
  if (!existsSync(defaultProjectConfigFile)) {
    return harness;
  }

  return Harness.load(defaultProjectFolder, options);
};

export const loadReplServerConfig = (
  serverConfigFile?: string,
): ServerConfig | undefined => {
  const resolvedServerConfigFile = serverConfigFile ?? defaultServerConfigFile();
  if (!existsSync(resolvedServerConfigFile)) {
    return undefined;
  }

  return loadServerConfig(resolvedServerConfigFile);
};

export const loadReplChannels = (
  serverConfig?: ServerConfig,
  serverSecrets?: ServerSecrets,
): Map<string, Channel> => {
  const resolvedServerConfig = serverConfig ?? loadReplServerConfig();
  const resolvedServerSecrets =
    serverSecrets ?? loadServerSecrets(defaultServerSecretsFile());
  const channels = new Map<string, Channel>();
  if (resolvedServerConfig?.channels?.email?.enabled) {
    channels.set(
      "email",
      new EmailChannel(
        resolvedServerConfig.channels.email,
        resolvedServerSecrets.email,
      ),
    );
  }

  return channels;
};

class ReplChannel implements Channel {
  readonly name = "repl";
  private readonly formatForDisplay: (text: string) => string;
  private readonly getPrompt: () => string;

  constructor(formatForDisplay: (text: string) => string, getPrompt: () => string) {
    this.formatForDisplay = formatForDisplay;
    this.getPrompt = getPrompt;
  }

  async start(): Promise<void> {
    return Promise.resolve();
  }

  async send(_origin: Origin, text: string): Promise<void> {
    output.write(`\n${this.formatForDisplay(`[notification] ${text}`)}\n\n${this.getPrompt()}`);
  }

  async stop(): Promise<void> {
    return Promise.resolve();
  }
}

class Repl {
  private readonly rl = readline.createInterface({ input, output });
  private readonly channels = new Map<string, Channel>();
  private harness: Harness;
  private _router?: ChannelRouter;
  private serverConfig: ServerConfig | undefined;
  private serverSecrets: ServerSecrets;
  private teleport: TeleportController;
  private verbose = false;
  private wrapWidth = 100;
  private readonly onTaskMessage = async (task: ScheduledTask, message: Message): Promise<void> => {
    output.write(
      `\n${this.formatForDisplay(`[scheduled:${task.title}] ${message.content}`)}\n\n${this.getPrompt()}`,
    );
  };
  private readonly reviewToolCall = async (tool: Tool, toolInput: unknown): Promise<boolean> => {
    output.write(
      `\n${this.formatForDisplay(`Tool review required: ${tool.name}\n${JSON.stringify(toolInput, null, 2)}`)}\n\n`,
    );

    while (true) {
      const reply = (await this.rl.question("Approve tool call? [y/N] ")).trim().toLowerCase();
      if (reply === "y" || reply === "yes") {
        output.write("\n");
        return true;
      }

      if (reply === "" || reply === "n" || reply === "no") {
        output.write("\n");
        return false;
      }
    }
  };

  constructor() {
    this.serverConfig = loadReplServerConfig();
    this.serverSecrets = loadServerSecrets(defaultServerSecretsFile());
    this.teleport = new TeleportController(this.serverConfig);
    this.refreshChannels();
    this.harness = loadReplHarness(process.cwd(), {
      onTaskMessage: this.onTaskMessage,
      router: this._router,
      reviewToolCall: this.reviewToolCall,
    });
  }

  async run(): Promise<void> {
    await this.startChannels();
    await this.harness.start();
    this.showStartup();

    while (true) {
      let line: string;
      try {
        line = (await this.rl.question(this.getPrompt())).trim();
      } catch {
        output.write("\n");
        await this.teleport.disconnect();
        await this.harness.teardown();
        await this.stopChannels();
        this.rl.close();
        break;
      }

      if (line.length === 0) {
        continue;
      }

      const shouldExit = await this.handleLine(line);
      if (shouldExit) {
        await this.teleport.disconnect();
        await this.harness.teardown();
        await this.stopChannels();
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
    const body = looksLikeMarkdown(text)
      ? renderMarkdownForTerminal(text, this.wrapWidth)
      : this.formatForDisplay(text);
    output.write(`${body}\n\n`);
  }

  private writeAssistantReply(text: string, result?: ProviderResult): void {
    const body = renderMarkdownForTerminal(text, this.wrapWidth);
    const verboseFooter = this.verbose ? this.formatVerboseFooter(result) : null;
    output.write(
      `${body}${verboseFooter ? `\n${this.formatForDisplay(verboseFooter)}` : ""}\n\n`,
    );
  }

  private getPrompt(): string {
    return formatReplPrompt(this.teleport.getTarget());
  }

  private formatForDisplay(text: string): string {
    if (this.wrapWidth <= 0) {
      return text;
    }

    return text
      .split("\n")
      .map((line) => wrapReplLine(line, this.wrapWidth))
      .join("\n");
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
      result.latencyMs !== undefined ? `latency=${result.latencyMs}ms` : null,
      result.toolIterations !== undefined ? `iterations=${result.toolIterations}` : null,
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
      return "Provide a project folder, for example: /project switch ../other-project";
    }
    const nextFolder = path.resolve(
      this.harness.config.projectFolder,
      expandHome(trimmedFolder),
    );

    await this.harness.teardown();
    await this.teleport.disconnect();
    await this.stopChannels();
    this.serverConfig = loadReplServerConfig();
    this.serverSecrets = loadServerSecrets(defaultServerSecretsFile());
    this.teleport = new TeleportController(this.serverConfig);
    this.refreshChannels();
    this.harness = Harness.load(nextFolder, {
      onTaskMessage: this.onTaskMessage,
      router: this._router,
      reviewToolCall: this.reviewToolCall,
    });
    await this.startChannels();
    await this.harness.start();

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

    if (line === "/wrap") {
      this.writeLine(`wrap: ${this.wrapWidth > 0 ? this.wrapWidth : "off"}`);
      return false;
    }

    if (line === "/wrap off") {
      this.wrapWidth = 0;
      this.writeLine("wrap: off");
      return false;
    }

    if (line.startsWith("/wrap ")) {
      const value = Number.parseInt(line.slice("/wrap ".length).trim(), 10);
      if (!Number.isFinite(value) || value <= 0) {
        this.writeLine("Usage: /wrap [off|N]");
        return false;
      }

      this.wrapWidth = value;
      this.writeLine(`wrap: ${this.wrapWidth}`);
      return false;
    }

    if (line.startsWith("/project switch ")) {
      this.writeLine(
        await this.switchProject(line.slice("/project switch ".length)),
      );
      return false;
    }

    if (line.startsWith("/teleport")) {
      const commandReply = await dispatchCommand(this.harness, line, {
        origin: replOrigin,
        teleport: this.teleport,
      });
      this.writeLine(commandReply ?? "");
      return false;
    }

    if (this.teleport.isAttached()) {
      const reply = await this.teleport.sendMessage(line);
      if (!reply) {
        this.writeLine("teleport: disconnected");
        return false;
      }

      this.writeLine(reply.reply);
      return false;
    }

    const commandReply = await dispatchCommand(this.harness, line, {
      origin: replOrigin,
      teleport: this.teleport,
    });
    if (commandReply !== null) {
      this.writeLine(commandReply);
      return false;
    }

    const reply = await this.harness.promptDetailed(line, {
      displayInstructions: REPL_DISPLAY_INSTRUCTIONS,
      origin: replOrigin,
    });
    this.writeAssistantReply(reply.message.content, reply.providerResult);
    return false;
  }

  private refreshChannels(): void {
    this.channels.clear();
    this.channels.set(
      "repl",
      new ReplChannel(this.formatForDisplay.bind(this), this.getPrompt.bind(this)),
    );
    for (const [name, channel] of loadReplChannels(this.serverConfig, this.serverSecrets)) {
      this.channels.set(name, channel);
    }
    this._router = this.serverConfig
      ? new ChannelRouter(this.serverConfig, this.channels)
      : undefined;
  }

  private async startChannels(): Promise<void> {
    for (const channel of this.channels.values()) {
      await channel.start();
    }
  }

  private async stopChannels(): Promise<void> {
    for (const channel of [...this.channels.values()].reverse()) {
      await channel.stop();
    }
    this.channels.clear();
  }
}

export const runRepl = async (): Promise<void> => {
  const repl = new Repl();
  await repl.run();
};

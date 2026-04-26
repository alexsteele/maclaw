import os from "node:os";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { Channel } from "../channels/channel.js";
import { EmailChannel } from "../channels/email.js";
import {
  dispatchCommand,
  helpText,
  parseTeleportConnectArgs,
} from "../commands.js";
import { Harness, type HarnessOptions } from "../harness.js";
import { writeJsonFile } from "../fs-utils.js";
import { initProjectConfig } from "../config.js";
import { ChannelRouter } from "../router.js";
import { REPL_DISPLAY_INSTRUCTIONS } from "../prompt.js";
import { renderMarkdownForTerminal } from "./render.js";
import {
  defaultServerConfigFile,
  defaultServerSecretsFile,
  loadServerConfig,
  loadServerSecrets,
  maclawHomeDir,
  type EditableServerConfig,
  type ServerConfig,
  type ServerSecrets,
} from "../server-config.js";
import { TeleportController } from "../teleport.js";
import type { TeleportTarget } from "../teleport.js";
import type { Tool } from "../tools/types.js";
import type { Message, Origin, ProviderResult, ScheduledTask } from "../types.js";

type ReplCommandDefinition = {
  description: string;
  usage: string;
  run(args: string): Promise<boolean>;
};

const formatReplCommandLine = (usage: string, description: string): string =>
  `* ${usage.padEnd(20)} ${description}`;

const findReplCommand = (
  registry: Record<string, ReplCommandDefinition>,
  line: string,
): {
  command?: ReplCommandDefinition;
  args: string;
} => {
  if (!line.startsWith("/")) {
    return { args: "" };
  }

  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return { args: "" };
  }

  const firstSpace = trimmed.indexOf(" ");
  const commandName =
    firstSpace < 0 ? trimmed : trimmed.slice(0, firstSpace);
  const args = firstSpace < 0 ? "" : trimmed.slice(firstSpace + 1).trim();

  return {
    command: registry[commandName],
    args,
  };
};

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
  promptPrefix: string | undefined = process.env.MACLAW_PROMPT,
): string =>
  !target
    ? `${promptPrefix?.trim() ? `${promptPrefix.trim()}> ` : "> "}`
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

  const bulletMatch = /^(\s*)((?:[*+-]|\d+\.))\s+(.*)$/u.exec(line);
  const indentMatch = line.match(/^(\s*)/u);
  const indent = indentMatch?.[1] ?? "";
  const firstIndent = bulletMatch ? `${bulletMatch[1] ?? ""}${bulletMatch[2] ?? ""}` : indent;
  const continuationIndent = bulletMatch
    ? `${bulletMatch[1] ?? ""}${" ".repeat((bulletMatch[2] ?? "").length + 1)}`
    : indent;
  const content = bulletMatch ? (bulletMatch[3] ?? "").trim() : line.trim();
  const words = content.split(/\s+/u);
  const wrapped: string[] = [];
  let current = firstIndent;

  for (const word of words) {
    const baseIndent = wrapped.length === 0 ? firstIndent : continuationIndent;
    const next = current.trim().length === 0 ? `${baseIndent}${word}` : `${current} ${word}`;
    if (current.length > baseIndent.length && next.length > width) {
      wrapped.push(current);
      current = `${continuationIndent}${word}`;
      continue;
    }

    current = next;
  }

  if (current.length > 0) {
    wrapped.push(current);
  }

  return wrapped.join("\n");
};

export const defaultReplWrapWidth = (
  columns: number | undefined = output.columns,
): number => {
  if (!Number.isFinite(columns) || columns === undefined || columns <= 4) {
    return 100;
  }

  return Math.max(20, columns - 2);
};

export const looksLikeMarkdown = (text: string): boolean => {
  return /(^|\n)#{1,6}\s/u.test(text)
    || /(^|\n)-\s/u.test(text)
    || /(^|\n)\d+\.\s/u.test(text)
    || text.includes("```")
    || /`[^`\n]+`/u.test(text);
};

export const parseAgentTailFollow = (
  line: string,
): { agentRef: string; count: number } | undefined => {
  if (!line.startsWith("/agent tail -f")) {
    return undefined;
  }

  const remainder = line.slice("/agent tail -f".length).trim();
  if (remainder.length === 0) {
    return undefined;
  }

  const parts = remainder.split(/\s+/u).filter((part) => part.length > 0);
  if (parts.length === 0) {
    return undefined;
  }

  let count = 10;
  const maybeCount = parts[parts.length - 1];
  if (maybeCount && /^\d+$/u.test(maybeCount)) {
    count = Number.parseInt(maybeCount, 10);
    parts.pop();
  }

  if (!Number.isFinite(count) || count <= 0 || parts.length === 0) {
    return undefined;
  }

  return {
    agentRef: parts.join(" "),
    count,
  };
};

export const parseShellEscape = (line: string): string | undefined => {
  if (!line.startsWith("!")) {
    return undefined;
  }

  const command = line.slice(1).trim();
  return command.length > 0 ? command : undefined;
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
  private readonly replCommands: Record<string, ReplCommandDefinition>;
  private harness: Harness;
  private _router?: ChannelRouter;
  private serverConfig: ServerConfig | undefined;
  private serverSecrets: ServerSecrets;
  private teleport: TeleportController;
  private verbose = false;
  private wrapWidthOverride?: number;
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
    this.replCommands = this.createReplCommands();
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
      ? renderMarkdownForTerminal(text, this.getWrapWidth())
      : this.formatForDisplay(text);
    output.write(`${body}\n\n`);
  }

  private writeAssistantReply(text: string, result?: ProviderResult): void {
    const body = renderMarkdownForTerminal(text, this.getWrapWidth());
    const verboseFooter = this.verbose ? this.formatVerboseFooter(result) : null;
    output.write(
      `${body}${verboseFooter ? `\n${this.formatForDisplay(verboseFooter)}` : ""}\n\n`,
    );
  }

  private getPrompt(): string {
    return formatReplPrompt(this.teleport.getTarget());
  }

  private formatMessages(messages: Message[]): string {
    return messages.length === 0
      ? "No history yet."
      : messages.map((message) => `[${message.role}] ${message.content}`).join("\n");
  }

  private getWrapWidth(): number {
    return this.wrapWidthOverride ?? defaultReplWrapWidth();
  }

  private formatForDisplay(text: string): string {
    const width = this.getWrapWidth();
    if (width <= 0) {
      return text;
    }

    return text
      .split("\n")
      .map((line) => wrapReplLine(line, width))
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

  private async followAgentTail(agentRef: string, count: number): Promise<void> {
    const agent = this.harness.findAgent(agentRef);
    if (!agent) {
      this.writeLine(`agent not found: ${agentRef}`);
      return;
    }

    const initialChat = await this.harness.loadChat(agent.chatId);
    this.writeLine(this.formatMessages(initialChat.messages.slice(-count)));

    let seenMessages = initialChat.messages.length;
    while (true) {
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const currentAgent = this.harness.findAgent(agent.id);
      const chat = await this.harness.loadChat(agent.chatId);
      const nextMessages = chat.messages.slice(seenMessages);
      if (nextMessages.length > 0) {
        this.writeLine(this.formatMessages(nextMessages));
        seenMessages = chat.messages.length;
      }

      if (!currentAgent || (currentAgent.status !== "running" && currentAgent.status !== "pending")) {
        if (currentAgent) {
          this.writeLine(`agent ${currentAgent.name}: ${currentAgent.status}`);
        }
        return;
      }
    }
  }

  private async switchProject(requestedFolder: string): Promise<string> {
    const nextFolder = requestedFolder;
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

  private async createManagedProject(name: string): Promise<string> {
    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      return "Usage: /project new <name>";
    }

    const editableConfig = this.loadEditableServerConfig();
    if (editableConfig.projects?.some((project) => project.name === trimmedName)) {
      return `project already exists: ${trimmedName}`;
    }

    const projectFolder = path.join(maclawHomeDir(), "projects", trimmedName);
    await initProjectConfig(projectFolder, {
      name: trimmedName,
      model: this.harness.config.model,
    });

    const nextServerConfig: EditableServerConfig = {
      ...editableConfig,
      projects: [
        ...(editableConfig.projects ?? []),
        { name: trimmedName, folder: projectFolder },
      ],
    };
    if (!nextServerConfig.defaultProject) {
      nextServerConfig.defaultProject = trimmedName;
    }

    await writeJsonFile(defaultServerConfigFile(), nextServerConfig);
    return this.switchProject(projectFolder);
  }

  private async switchManagedProject(name: string): Promise<string> {
    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      return "Usage: /project switch <name>";
    }

    const project = this.serverConfig?.projects.find((entry) => entry.name === trimmedName);
    if (!project) {
      return `project not found: ${trimmedName}`;
    }

    return this.switchProject(project.folder);
  }

  private loadEditableServerConfig(): EditableServerConfig {
    return this.serverConfig ?? {
      projects: [],
    };
  }

  private async runShellCommand(command: string): Promise<void> {
    output.write("\n");
    this.rl.pause();

    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(command, {
          cwd: this.harness.config.projectFolder,
          shell: process.env.SHELL ?? true,
          stdio: "inherit",
        });

        child.on("error", reject);
        child.on("exit", () => resolve());
      });
    } finally {
      this.rl.resume();
      output.write("\n");
    }
  }

  private createReplCommands(): Record<string, ReplCommandDefinition> {
    return {
      "/help": {
        usage: "/help",
        description: "Show REPL help",
        run: async () => {
          this.writeLine(this.renderReplHelpText());
          return false;
        },
      },
      "/quit": {
        usage: "/quit",
        description: "Exit the REPL",
        run: async () => true,
      },
      "/verbose": {
        usage: "/verbose <on|off>",
        description: "Toggle verbose reply metadata",
        run: async (args) => {
          if (args.length === 0) {
            this.verbose = !this.verbose;
            this.writeLine(`verbose: ${this.verbose ? "on" : "off"}`);
            return false;
          }

          if (args === "on") {
            this.verbose = true;
            this.writeLine("verbose: on");
            return false;
          }

          if (args === "off") {
            this.verbose = false;
            this.writeLine("verbose: off");
            return false;
          }

          this.writeLine("Usage: /verbose <on|off>");
          return false;
        },
      },
      "/wrap": {
        usage: "/wrap [auto|off|N]",
        description: "Set REPL output wrap width",
        run: async (args) => {
          if (args.length === 0) {
            const value = this.wrapWidthOverride;
            this.writeLine(
              value === undefined
                ? `wrap: auto (${this.getWrapWidth()})`
                : `wrap: ${value > 0 ? value : "off"}`,
            );
            return false;
          }

          if (args === "off") {
            this.wrapWidthOverride = 0;
            this.writeLine("wrap: off");
            return false;
          }

          if (args === "auto") {
            this.wrapWidthOverride = undefined;
            this.writeLine(`wrap: auto (${this.getWrapWidth()})`);
            return false;
          }

          const value = Number.parseInt(args, 10);
          if (!Number.isFinite(value) || value <= 0) {
            this.writeLine("Usage: /wrap [auto|off|N]");
            return false;
          }

          this.wrapWidthOverride = value;
          this.writeLine(`wrap: ${value}`);
          return false;
        },
      },
    };
  }

  private renderReplHelpText(): string {
    const commands = Object.values(this.replCommands);
    return [
      helpText.trimEnd(),
      ...commands.map((command) =>
        formatReplCommandLine(command.usage, command.description),
      ),
      formatReplCommandLine("!<command>", "Run a shell command"),
    ].join("\n");
  }

  private async dispatchReplCommand(line: string): Promise<boolean | undefined> {
    const { command, args } = findReplCommand(this.replCommands, line);
    if (!command) {
      return undefined;
    }

    return command.run(args);
  }

  private async handleLine(line: string): Promise<boolean> {
    const shellCommand = parseShellEscape(line);
    if (shellCommand) {
      await this.runShellCommand(shellCommand);
      return false;
    }

    const replCommandResult = await this.dispatchReplCommand(line);
    if (replCommandResult !== undefined) {
      return replCommandResult;
    }

    const followTail = parseAgentTailFollow(line);
    if (followTail) {
      await this.followAgentTail(followTail.agentRef, followTail.count);
      return false;
    }

    if (line.startsWith("/teleport")) {
      const shellTarget = this.getShellTeleportTarget(line);
      if (shellTarget) {
        output.write("\n");
        this.rl.pause();
        try {
          const result = await this.teleport.attachShell(shellTarget);
          if (result.exitCode !== 0) {
            this.writeLine(
              result.message.trim().length > 0
                ? result.message
                : `shell session exited with code ${result.exitCode}`,
            );
          }
        } finally {
          this.rl.resume();
        }
        return false;
      }

      const commandReply = await dispatchCommand(this.harness, line, {
        origin: replOrigin,
        project: {
          create: this.createManagedProject.bind(this),
          switch: this.switchManagedProject.bind(this),
        },
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
      project: {
        create: this.createManagedProject.bind(this),
        switch: this.switchManagedProject.bind(this),
      },
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

  private getShellTeleportTarget(line: string): string | undefined {
    if (line === "/teleport" || line === "/teleport list" || line === "/teleport status" || line === "/teleport disconnect") {
      return undefined;
    }

    const args = line.startsWith("/teleport connect ")
      ? line.slice("/teleport connect ".length)
      : line.startsWith("/teleport ")
        ? line.slice("/teleport ".length)
        : undefined;
    if (args === undefined) {
      return undefined;
    }

    const parsed = parseTeleportConnectArgs(args);
    return parsed.target && this.teleport.isShellTarget(parsed.target)
      ? parsed.target
      : undefined;
  }
}

export const runRepl = async (): Promise<void> => {
  const repl = new Repl();
  await repl.run();
};

import type {
  Channel,
  ChannelMessage,
} from "./channels/channel.js";
import { DiscordChannel } from "./channels/discord.js";
import { dispatchCommand } from "./commands.js";
import { Harness, type HarnessNotification } from "./harness.js";
import {
  loadServerConfig,
  loadServerSecrets,
  type ServerConfig,
  type ServerSecrets,
} from "./server-config.js";
import type { Message, Origin, ScheduledTask } from "./types.js";
import { SlackChannel } from "./channels/slack.js";
import { WhatsAppChannel } from "./channels/whatsapp.js";

const logScheduledTask = async (
  projectName: string,
  task: ScheduledTask,
  message: Message,
): Promise<void> => {
  process.stdout.write(`[${projectName}][scheduled:${task.title}] ${message.content}\n`);
};

const helpText = [
  "Commands:",
  "  /help                    Show this help",
  "  /project                 Show the current project",
  "  /project list            List available projects",
  "  /project switch <name>   Switch to a different project",
  "  /switch <name>           Alias for /project switch <name>",
  "",
  "Any other message is sent to the current project's chat.",
].join("\n");

type ProjectName = string;
type ChannelName = string;
type ChannelUser = string;  // ${channel}:${userId}

export class MaclawServer {
  private readonly config: ServerConfig;
  private readonly secrets: ServerSecrets;
  private readonly projects = new Map<ProjectName, Harness>();
  private readonly channels = new Map<ChannelName, Channel>();
  private readonly activeProjects = new Map<ChannelUser, ProjectName>();
  private started = false;

  private constructor(config: ServerConfig, secrets: ServerSecrets) {
    this.config = config;
    this.secrets = secrets;
  }

  static load(): MaclawServer {
    return new MaclawServer(loadServerConfig(), loadServerSecrets());
  }

  static create(config: ServerConfig, secrets: ServerSecrets): MaclawServer {
    return new MaclawServer(config, secrets);
  }

  private requireStarted(): void {
    if (!this.started) {
      throw new Error("Server has not been started.");
    }
  }

  private resetRuntimeState(): void {
    this.channels.clear();
    this.projects.clear();
    this.activeProjects.clear();
    this.started = false;
  }

  getHarness(projectName: ProjectName): Harness {
    this.requireStarted();
    const harness = this.projects.get(projectName);
    if (!harness) {
      throw new Error(`Project not found: ${projectName}`);
    }

    return harness;
  }

  getDefaultProjectName(): ProjectName | undefined {
    if (this.config.projects.length === 1) {
      return this.config.projects[0]!.name;
    }

    return this.config.defaultProject;
  }

  listProjectNames(): ProjectName[] {
    return this.config.projects.map((project) => project.name);
  }

  private getRouteKey(
    message: Pick<ChannelMessage, "channel" | "userId">,
  ): ChannelUser {
    return `${message.channel}:${message.userId}`;
  }

  private getActiveProjectName(
    message: Pick<ChannelMessage, "channel" | "userId">,
  ): ProjectName | undefined {
    return this.activeProjects.get(this.getRouteKey(message)) ?? this.config.defaultProject;
  }

  private setActiveProjectName(
    message: Pick<ChannelMessage, "channel" | "userId">,
    projectName: ProjectName,
  ): void {
    this.activeProjects.set(this.getRouteKey(message), projectName);
  }

  private handleProjectSwitch(
    message: Pick<ChannelMessage, "channel" | "userId">,
    projectName: string,
  ): string {
    if (!this.projects.has(projectName)) {
      return `Unknown project: ${projectName}`;
    }

    this.setActiveProjectName(message, projectName);
    return `Switched to project: ${projectName}`;
  }

  private async handleNotification(notification: HarnessNotification): Promise<void> {
    const channel = this.channels.get(notification.origin.channel);
    if (!channel) {
      return;
    }

    await channel.send(notification.origin, notification.text);
  }

  async handleMessage(message: ChannelMessage): Promise<string | null> {
    this.requireStarted();

    if (message.text === "/help") {
      return helpText;
    }

    if (message.text === "/project") {
      const projectName = this.getActiveProjectName(message);
      return projectName
        ? `Current project: ${projectName}`
        : `No project selected. Choose one with /project switch <name>\n${this.listProjectNames().join("\n")}`;
    }

    if (message.text === "/project list") {
      return this.listProjectNames().join("\n");
    }

    if (message.text.startsWith("/project switch ")) {
      return this.handleProjectSwitch(
        message,
        message.text.slice("/project switch ".length).trim(),
      );
    }

    if (message.text.startsWith("/switch ")) {
      return this.handleProjectSwitch(
        message,
        message.text.slice("/switch ".length).trim(),
      );
    }

    const projectName = this.getActiveProjectName(message) ?? this.getDefaultProjectName();
    if (!projectName) {
      return `No project selected. Choose one with /project switch <name>\n${this.listProjectNames().join("\n")}`;
    }

    const harness = this.getHarness(projectName);
    const origin: Origin = {
      channel: message.channel,
      conversationId: message.conversationId,
      userId: message.userId,
      threadId: message.threadId,
    };
    const commandReply = await dispatchCommand(harness, message.text, {
      chatId: message.userId,
      origin,
    });
    if (commandReply !== null) {
      return commandReply;
    }

    const reply = await harness.promptChat(message.userId, message.text, {
      origin,
    });
    return reply.content;
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }

    for (const project of this.config.projects) {
      this.projects.set(project.name, Harness.load(project.folder));
    }

    if (this.config.channels.slack.enabled) {
      this.channels.set(
        "slack",
        new SlackChannel(this.config.channels.slack, this.secrets.slack),
      );
    }

    if (this.config.channels.discord.enabled) {
      this.channels.set(
        "discord",
        new DiscordChannel(this.config.channels.discord, this.secrets.discord),
      );
    }

    if (this.config.channels.whatsapp.enabled) {
      this.channels.set(
        "whatsapp",
        new WhatsAppChannel(this.config.channels.whatsapp, this.secrets.whatsapp),
      );
    }

    for (const [projectName, harness] of this.projects.entries()) {
      await harness.start(async (task, message) =>
        logScheduledTask(projectName, task, message),
        this.handleNotification.bind(this),
      );
    }

    for (const channel of this.channels.values()) {
      await channel.start(this.handleMessage.bind(this));
    }

    this.started = true;
  }

  async stop(): Promise<void> {
    for (const channel of [...this.channels.values()].reverse()) {
      await channel.stop();
    }

    for (const harness of this.projects.values()) {
      harness.teardown();
    }

    this.resetRuntimeState();
  }
}

import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import { loadConfig } from "./config.js";
import type {
  Channel,
  ChannelMessage,
} from "./channels/channel.js";
import { DiscordChannel } from "./channels/discord.js";
import { EmailChannel } from "./channels/email.js";
import { dispatchCommand } from "./commands.js";
import { Harness } from "./harness.js";
import { logger } from "./logger.js";
import { PORTAL_DISPLAY_INSTRUCTIONS } from "./prompt.js";
import { ChannelRouter } from "./router.js";
import {
  defaultServerLogFile,
  defaultServerLogMaxBytes,
  defaultServerLogMaxFiles,
  defaultServerPort,
  loadServerConfig,
  loadServerSecrets,
  type ServerConfig,
  type ServerSecrets,
} from "./server-config.js";
import type { Message, Origin, ScheduledTask } from "./types.js";
import type { RemoteCommandRequest, RemoteCommandResponse } from "./teleport.js";
import { TeleportController } from "./teleport.js";
import { SlackChannel } from "./channels/slack.js";
import { WhatsAppChannel } from "./channels/whatsapp.js";
import { WebChannel } from "./channels/web.js";
import { renderPortalHtml } from "./portal/index.js";

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
  "",
  "Any other message is sent to the current project's chat.",
].join("\n");

const readRequestBody = async (request: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
};

const json = (response: ServerResponse, statusCode: number, body: unknown): void => {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(`${JSON.stringify(body)}\n`);
};

const text = (response: ServerResponse, statusCode: number, body: string): void => {
  response.statusCode = statusCode;
  response.setHeader("content-type", "text/plain; charset=utf-8");
  response.end(`${body}\n`);
};

type ProjectName = string;
type ChannelName = string;
type ChannelUser = string;  // ${channel}:${userId}

export type ServerOptions = {
  port?: number;
  servePortal?: boolean;
  serveHttp?: boolean;
  logStderr?: boolean;
};

export class MaclawServer {
  private readonly config: ServerConfig;
  private readonly secrets: ServerSecrets;
  private readonly options: ServerOptions;
  private readonly projects = new Map<ProjectName, Harness>();
  private readonly channels = new Map<ChannelName, Channel>();
  private readonly webChannel = new WebChannel();
  private readonly _router: ChannelRouter;
  private readonly activeProjects = new Map<ChannelUser, ProjectName>();
  private readonly teleports = new Map<ChannelUser, TeleportController>();
  private httpServer?: http.Server;
  private portalPort?: number;
  private started = false;

  private constructor(config: ServerConfig, secrets: ServerSecrets, options: ServerOptions = {}) {
    this.config = {
      ...config,
      logging: config.logging ?? {
        file: defaultServerLogFile(),
        maxBytes: defaultServerLogMaxBytes(),
        maxFiles: defaultServerLogMaxFiles(),
      },
    };
    this.secrets = secrets;
    this.options = options;
    this._router = new ChannelRouter(this.config, this.channels);
  }

  static load(options: ServerOptions = {}): MaclawServer {
    return new MaclawServer(loadServerConfig(), loadServerSecrets(), options);
  }

  static create(
    config: ServerConfig,
    secrets: ServerSecrets,
    options: ServerOptions = {},
  ): MaclawServer {
    return new MaclawServer(config, secrets, options);
  }

  private requireStarted(): void {
    if (!this.started) {
      throw new Error("Server has not been started.");
    }
  }

  private resetRuntimeState(): void {
    this.httpServer = undefined;
    this.portalPort = undefined;
    this.channels.clear();
    this.projects.clear();
    this.activeProjects.clear();
    this.teleports.clear();
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

  getPortalPort(): number | undefined {
    return this.portalPort;
  }

  renderPortal(): string {
    return renderPortalHtml({
      channels: this.getPortalChannels(),
      currentProject: this.getDefaultProjectName(),
      projects: this.getPortalProjects(),
    });
  }

  private getPortalChannels(): string[] {
    if (this.channels.size > 0) {
      return Array.from(this.channels.keys()).sort();
    }

    const configured = ["web"];
    if (this.config.channels?.discord) {
      configured.push("discord");
    }
    if (this.config.channels?.email) {
      configured.push("email");
    }
    if (this.config.channels?.slack) {
      configured.push("slack");
    }
    if (this.config.channels?.whatsapp) {
      configured.push("whatsapp");
    }

    return configured.sort();
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }

    logger.setFile(this.config.logging.file, {
      maxBytes: this.config.logging.maxBytes,
      maxFiles: this.config.logging.maxFiles,
    });
    logger.setStderr(this.options.logStderr);
    logger.info("server", "start", {
      configuredProjects: this.config.projects.length,
      servePortal: this.options.servePortal !== false,
      serveHttp: this.options.serveHttp === true,
    });

    for (const project of this.config.projects) {
      this.projects.set(
        project.name,
        Harness.load(project.folder, {
          onTaskMessage: async (task, message) =>
            logScheduledTask(project.name, task, message),
          router: this._router,
        }),
      );
    }

    this.channels.set("web", this.webChannel);

    if (this.config.channels?.slack?.enabled) {
      this.channels.set(
        "slack",
        new SlackChannel(this.config.channels.slack, this.secrets.slack),
      );
    }

    if (this.config.channels?.discord?.enabled) {
      this.channels.set(
        "discord",
        new DiscordChannel(this.config.channels.discord, this.secrets.discord),
      );
    }

    if (this.config.channels?.email?.enabled) {
      this.channels.set(
        "email",
        new EmailChannel(this.config.channels.email, this.secrets.email),
      );
    }

    if (this.config.channels?.whatsapp?.enabled) {
      this.channels.set(
        "whatsapp",
        new WhatsAppChannel(this.config.channels.whatsapp, this.secrets.whatsapp),
      );
    }

    for (const harness of this.projects.values()) {
      await harness.start();
    }

    if (this.options.servePortal !== false || this.options.serveHttp === true) {
      await this.startHttpServer();
    }

    for (const channel of this.channels.values()) {
      await channel.start(this.handleMessage.bind(this));
    }

    this.started = true;
    logger.info("server", "started", {
      projects: this.projects.size,
      channels: Array.from(this.channels.keys()),
      port: this.portalPort ?? this.options.port ?? this.config.port ?? defaultServerPort(),
    });
  }

  async stop(): Promise<void> {
    logger.info("server", "stop", {
      projects: this.projects.size,
      channels: this.channels.size,
      teleports: this.teleports.size,
    });
    for (const teleport of this.teleports.values()) {
      await teleport.disconnect();
    }

    for (const channel of [...this.channels.values()].reverse()) {
      await channel.stop();
    }
    if (this.httpServer) {
      const server = this.httpServer;
      this.httpServer = undefined;
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    }

    for (const harness of this.projects.values()) {
      await harness.teardown();
    }

    this.resetRuntimeState();
    logger.info("server", "stopped");
    await logger.close();
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

  private getTeleportController(
    message: Pick<ChannelMessage, "channel" | "userId">,
  ): TeleportController {
    const key = this.getRouteKey(message);
    let controller = this.teleports.get(key);
    if (!controller) {
      controller = new TeleportController(this.config);
      this.teleports.set(key, controller);
    }

    return controller;
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

  private getPortalOrigin(projectName: string, chatId: string): Origin {
    return {
      channel: "web",
      conversationId: `portal:${projectName}`,
      userId: chatId,
    };
  }

  private getPortalProjects() {
    return this.config.projects.map((project) => ({
      defaultChatId: this.projects.get(project.name)?.config.chatId ?? loadConfig(project.folder).chatId,
      isDefault: project.name === this.getDefaultProjectName(),
      name: project.name,
    }));
  }

  private getPortalHarness(
    response: ServerResponse,
    projectName: string,
  ): Harness | undefined {
    const harness = this.projects.get(projectName);
    if (!harness) {
      json(response, 404, { error: `unknown project: ${projectName}` });
      return undefined;
    }

    return harness;
  }

  private sendPortal(response: ServerResponse): void {
    response.statusCode = 200;
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(this.renderPortal());
  }

  private async postRemoteCommand(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const rawBody = await readRequestBody(request);
    const parsed = JSON.parse(rawBody || "{}") as RemoteCommandRequest;

    try {
      json(response, 200, await this.handleRemoteCommand(parsed));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const statusCode = /^unknown project:/u.test(message) ? 404 : 400;
      json(response, statusCode, { error: message });
    }
  }

  /**
   * Handles one structured remote command request from teleport or another
   * remote client without requiring an HTTP listener in the caller.
   */
  async handleRemoteCommand(
    request: RemoteCommandRequest,
  ): Promise<RemoteCommandResponse> {
    this.requireStarted();

    const userInput = request.text?.trim();
    if (!userInput) {
      throw new Error("text is required");
    }

    const projectName = request.project ?? this.getDefaultProjectName();
    if (!projectName) {
      throw new Error(
        `No project selected. Choose one with /project switch <name>\n${this.listProjectNames().join("\n")}`,
      );
    }

    const harness = this.projects.get(projectName);
    if (!harness) {
      throw new Error(`unknown project: ${projectName}`);
    }

    const chatId = request.chatId?.trim() || harness.config.chatId;
    const origin: Origin = request.origin ?? {
      channel: "teleport",
      conversationId: `teleport:${projectName}`,
      userId: chatId,
    };

    logger.info("server", "remote-command", {
      project: projectName,
      chatId,
      channel: origin.channel,
      handledAsCommand: userInput.startsWith("/"),
    });

    const commandReply = await dispatchCommand(harness, userInput, {
      chatId,
      origin,
    });
    const reply =
      commandReply !== null
        ? commandReply
        : (
            await harness.promptChat(chatId, userInput, {
              origin,
            })
          ).content;

    return {
      project: projectName,
      chatId,
      reply,
      handledAsCommand: commandReply !== null,
    };
  }

  private sendPortalProjects(response: ServerResponse): void {
    json(response, 200, {
      currentProject: this.getDefaultProjectName(),
      projects: this.getPortalProjects(),
    });
  }

  private async sendPortalChat(
    response: ServerResponse,
    projectName: string,
    chatId: string,
  ): Promise<void> {
    const harness = this.getPortalHarness(response, projectName);
    if (!harness) {
      return;
    }

    const chat = await harness.loadChat(chatId);
    json(response, 200, {
      chat: {
        id: chat.id,
        messages: chat.messages,
      },
      project: projectName,
    });
  }

  private async sendPortalChats(
    response: ServerResponse,
    projectName: string,
  ): Promise<void> {
    const harness = this.getPortalHarness(response, projectName);
    if (!harness) {
      return;
    }

    const chats = await harness.listChats();
    json(response, 200, {
      chats,
      project: projectName,
    });
  }

  private subscribePortalEvents(
    response: ServerResponse,
    projectName: string,
    chatId: string,
  ): void {
    this.webChannel.subscribe(this.getPortalOrigin(projectName, chatId), response);
  }

  private async postPortalChatMessage(
    request: IncomingMessage,
    response: ServerResponse,
    projectName: string,
    chatId: string,
  ): Promise<void> {
    const harness = this.getPortalHarness(response, projectName);
    if (!harness) {
      return;
    }

    const rawBody = await readRequestBody(request);
    const parsed = JSON.parse(rawBody || "{}") as { text?: string };
    const userInput = parsed.text?.trim();
    if (!userInput) {
      json(response, 400, { error: "text is required" });
      return;
    }

    const origin = this.getPortalOrigin(projectName, chatId);
    const commandReply = await dispatchCommand(harness, userInput, {
      chatId,
      origin,
    });
    if (commandReply !== null) {
      const chat = await harness.loadChat(chatId);
      json(response, 200, {
        chat: {
          id: chat.id,
          messages: chat.messages,
        },
        command: {
          reply: commandReply,
          text: userInput,
        },
        project: projectName,
      });
      return;
    }

    await harness.promptChat(chatId, userInput, {
      displayInstructions: PORTAL_DISPLAY_INSTRUCTIONS,
      origin,
    });

    await this.sendPortalChat(response, projectName, chatId);
  }

  private async handlePortalRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === "/api/command") {
      if (request.method !== "POST") {
        text(response, 405, "method_not_allowed");
        return;
      }

      await this.postRemoteCommand(request, response);
      return;
    }

    if (url.pathname === "/") {
      if (request.method !== "GET") {
        text(response, 405, "method_not_allowed");
        return;
      }

      if (this.options.servePortal === false) {
        text(response, 404, "not_found");
        return;
      }

      this.sendPortal(response);
      return;
    }

    if (url.pathname === "/api/projects") {
      if (request.method !== "GET") {
        text(response, 405, "method_not_allowed");
        return;
      }

      this.sendPortalProjects(response);
      return;
    }

    const chatMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/chats\/([^/]+)$/u);
    if (chatMatch) {
      if (request.method !== "GET") {
        text(response, 405, "method_not_allowed");
        return;
      }

      await this.sendPortalChat(
        response,
        decodeURIComponent(chatMatch[1] ?? ""),
        decodeURIComponent(chatMatch[2] ?? ""),
      );
      return;
    }

    const chatsMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/chats$/u);
    if (chatsMatch) {
      if (request.method !== "GET") {
        text(response, 405, "method_not_allowed");
        return;
      }

      await this.sendPortalChats(
        response,
        decodeURIComponent(chatsMatch[1] ?? ""),
      );
      return;
    }

    const chatMessagesMatch = url.pathname.match(
      /^\/api\/projects\/([^/]+)\/chats\/([^/]+)\/messages$/u,
    );
    if (chatMessagesMatch) {
      if (request.method !== "POST") {
        text(response, 405, "method_not_allowed");
        return;
      }

      await this.postPortalChatMessage(
        request,
        response,
        decodeURIComponent(chatMessagesMatch[1] ?? ""),
        decodeURIComponent(chatMessagesMatch[2] ?? ""),
      );
      return;
    }

    const chatEventsMatch = url.pathname.match(
      /^\/api\/projects\/([^/]+)\/chats\/([^/]+)\/events$/u,
    );
    if (chatEventsMatch) {
      if (request.method !== "GET") {
        text(response, 405, "method_not_allowed");
        return;
      }

      this.subscribePortalEvents(
        response,
        decodeURIComponent(chatEventsMatch[1] ?? ""),
        decodeURIComponent(chatEventsMatch[2] ?? ""),
      );
      return;
    }

    text(response, 404, "not_found");
  }

  private async startHttpServer(): Promise<void> {
    this.httpServer = http.createServer((request, response) => {
      void this.handlePortalRequest(request, response).catch((error) => {
        response.statusCode = 500;
        response.setHeader("content-type", "text/plain; charset=utf-8");
        response.end(
          `${error instanceof Error ? error.message : String(error)}\n`,
        );
      });
    });

    await new Promise<void>((resolve, reject) => {
      this.httpServer?.once("error", reject);
      this.httpServer?.listen(
        this.options.port ?? this.config.port ?? defaultServerPort(),
        "127.0.0.1",
        resolve,
      );
    });

    const address = this.httpServer.address();
    if (address && typeof address === "object") {
      this.portalPort = address.port;
      process.stdout.write(
        this.options.servePortal === false
          ? `Server API listening on http://localhost:${address.port}/\n`
          : `Web portal listening on http://localhost:${address.port}/\n`,
      );
    }
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
    const teleport = this.getTeleportController(message);
    if (message.text.startsWith("/teleport")) {
      const commandReply = await dispatchCommand(harness, message.text, {
        chatId: message.userId,
        origin,
        teleport,
      });
      return commandReply;
    }

    if (teleport.isAttached()) {
      const remoteReply = await teleport.sendMessage(message.text);
      return remoteReply?.reply ?? "teleport: disconnected";
    }

    const commandReply = await dispatchCommand(harness, message.text, {
      chatId: message.userId,
      origin,
      teleport,
    });
    if (commandReply !== null) {
      return commandReply;
    }

    const reply = await harness.promptChat(message.userId, message.text, {
      displayInstructions: PORTAL_DISPLAY_INSTRUCTIONS,
      origin,
    });
    return reply.content;
  }

}

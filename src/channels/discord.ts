/**
 * Discord API references:
 * - Gateway overview: https://docs.discord.com/developers/docs/events/gateway
 * - Gateway events: https://docs.discord.com/developers/docs/events/gateway-events
 * - Create message: https://docs.discord.com/developers/docs/resources/message#create-message
 */
import type { Channel, ChannelMessageHandler } from "./channel.js";
import type { DiscordConfig, ServerSecrets } from "../server-config.js";

type DiscordGatewayPayload = {
  // Event data for the opcode.
  d?: unknown;
  // Gateway opcode, such as dispatch, hello, or heartbeat request.
  op: number;
  // Last sequence number for resume/heartbeat state.
  s?: number | null;
  // Dispatch event name, such as MESSAGE_CREATE or READY.
  t?: string | null;
};

type DiscordHello = {
  // Milliseconds between heartbeats for this connection.
  heartbeat_interval: number;
};

type DiscordReadyEvent = {
  // Gateway URL used when resuming a dropped session.
  resume_gateway_url?: string;
  // Session id assigned after a successful identify.
  session_id?: string;
  user?: {
    // The bot user id for this connection.
    id?: string;
  };
};

type DiscordMessageCreate = {
  author?: {
    // True when the message was sent by a bot/app account.
    bot?: boolean;
    // Discord user id of the message author.
    id?: string;
  };
  // Channel where the message was sent.
  channel_id?: string;
  // Message body text.
  content?: string;
  // Present for guild/server messages. Missing for DMs.
  guild_id?: string;
  // Discord message id.
  id?: string;
};

type DiscordTextEvent = {
  channelId: string;
  text: string;
  userId: string;
};

type DiscordGatewayBotResponse = {
  url?: string;
};

type WebSocketLike = {
  addEventListener(
    type: string,
    listener: (event: { data?: unknown }) => void | Promise<void>,
  ): void;
  close(): void;
  send(data: string): void;
};

const DISCORD_GATEWAY_VERSION = 10;
const DISCORD_INTENT_DIRECT_MESSAGES = 1 << 12;

const getDiscordWebSocket = (): new (url: string) => WebSocketLike => {
  const ctor = (globalThis as typeof globalThis & { WebSocket?: new (url: string) => WebSocketLike })
    .WebSocket;
  if (!ctor) {
    throw new Error("WebSocket is not available in this Node runtime.");
  }

  return ctor;
};

export const createDiscordHeartbeatPayload = (sequence: number | null): string =>
  JSON.stringify({
    op: 1,
    d: sequence,
  });

export const createDiscordIdentifyPayload = (botToken: string): string =>
  JSON.stringify({
    op: 2,
    d: {
      token: botToken,
      intents: DISCORD_INTENT_DIRECT_MESSAGES,
      properties: {
        os: process.platform,
        browser: "maclaw",
        device: "maclaw",
      },
    },
  });

export const extractDiscordTextEvent = (
  payload: DiscordGatewayPayload,
): DiscordTextEvent | null => {
  if (payload.op !== 0 || payload.t !== "MESSAGE_CREATE") {
    return null;
  }

  const event = payload.d as DiscordMessageCreate | undefined;
  if (!event?.author?.id || !event.channel_id || !event.content) {
    return null;
  }

  if (event.author.bot) {
    return null;
  }

  // v1: only handle DMs. Guild messages can come later with mention-based routing.
  if (event.guild_id) {
    return null;
  }

  return {
    channelId: event.channel_id,
    text: event.content.trim(),
    userId: `discord-${event.author.id}`,
  };
};

export class DiscordChannel implements Channel {
  readonly name = "discord";
  private readonly config: DiscordConfig;
  private readonly secrets: ServerSecrets["discord"];
  private messageHandler?: ChannelMessageHandler;
  private websocket?: WebSocketLike;
  private heartbeatTimer?: NodeJS.Timeout;
  private reconnectTimer?: NodeJS.Timeout;
  private stopping = false;
  private sequence: number | null = null;

  constructor(config: DiscordConfig, secrets: ServerSecrets["discord"]) {
    this.config = config;
    this.secrets = secrets;
  }

  async start(messageHandler?: ChannelMessageHandler): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    this.messageHandler = messageHandler;
    this.stopping = false;

    if (!this.secrets.botToken) {
      throw new Error(
        "Discord bot token is required. Set MACLAW_DISCORD_BOT_TOKEN or ~/.maclaw/secrets.json.",
      );
    }

    await this.connect();
    process.stdout.write("Discord channel connected to the gateway\n");
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    this.websocket?.close();
    this.websocket = undefined;
  }

  async send(
    origin: { conversationId?: string },
    text: string,
  ): Promise<void> {
    if (!origin.conversationId) {
      throw new Error("Discord origin is missing conversationId.");
    }

    await this.sendMessage(origin.conversationId, text);
  }

  private async connect(): Promise<void> {
    const gatewayUrl = await this.getGatewayUrl();
    const WebSocketCtor = getDiscordWebSocket();
    const socket = new WebSocketCtor(
      `${gatewayUrl}?v=${DISCORD_GATEWAY_VERSION}&encoding=json`,
    );
    this.websocket = socket;

    socket.addEventListener("message", (event) => {
      void this.handleGatewayMessage(event.data);
    });
    socket.addEventListener("close", () => {
      this.websocket = undefined;
      this.scheduleReconnect();
    });
    socket.addEventListener("error", () => {
      this.websocket = undefined;
      this.scheduleReconnect();
    });
  }

  private async getGatewayUrl(): Promise<string> {
    const response = await fetch("https://discord.com/api/v10/gateway/bot", {
      headers: {
        authorization: `Bot ${this.secrets.botToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Discord gateway lookup failed: ${response.status} ${await response.text()}`);
    }

    const payload = (await response.json()) as DiscordGatewayBotResponse;
    if (!payload.url) {
      throw new Error("Discord gateway lookup failed: missing gateway url");
    }

    return payload.url;
  }

  private scheduleReconnect(): void {
    if (this.stopping || this.reconnectTimer) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect().catch((error) => {
        process.stderr.write(
          `Discord gateway reconnect failed: ${
            error instanceof Error ? error.message : String(error)
          }\n`,
        );
        this.scheduleReconnect();
      });
    }, 1_000);
    this.reconnectTimer.unref?.();
  }

  private startHeartbeat(heartbeatIntervalMs: number): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    this.heartbeatTimer = setInterval(() => {
      this.websocket?.send(createDiscordHeartbeatPayload(this.sequence));
    }, heartbeatIntervalMs);
    this.heartbeatTimer.unref?.();
  }

  private async handleGatewayMessage(raw: unknown): Promise<void> {
    if (typeof raw !== "string") {
      return;
    }

    const payload = JSON.parse(raw) as DiscordGatewayPayload;
    if (payload.s !== undefined && payload.s !== null) {
      this.sequence = payload.s;
    }

    if (payload.op === 10) {
      const hello = payload.d as DiscordHello;
      this.startHeartbeat(hello.heartbeat_interval);
      this.websocket?.send(createDiscordIdentifyPayload(this.secrets.botToken ?? ""));
      return;
    }

    if (payload.op === 1) {
      this.websocket?.send(createDiscordHeartbeatPayload(this.sequence));
      return;
    }

    if (payload.op === 7 || payload.op === 9) {
      this.websocket?.close();
      return;
    }

    if (payload.op !== 0) {
      return;
    }

    if (payload.t === "READY") {
      return;
    }

    const event = extractDiscordTextEvent(payload);
    if (!event) {
      return;
    }

    const reply = await this.messageHandler?.({
      channel: this.name,
      conversationId: event.channelId,
      threadId: event.channelId,
      userId: event.userId,
      text: event.text,
    });

    if (reply) {
      await this.sendMessage(event.channelId, reply);
    }
  }

  private async sendMessage(channelId: string, content: string): Promise<void> {
    const response = await fetch(
      `https://discord.com/api/v10/channels/${channelId}/messages`,
      {
        method: "POST",
        headers: {
          authorization: `Bot ${this.secrets.botToken}`,
          "content-type": "application/json; charset=utf-8",
        },
        body: JSON.stringify({ content }),
      },
    );

    if (!response.ok) {
      throw new Error(`Discord send failed: ${response.status} ${await response.text()}`);
    }
  }
}

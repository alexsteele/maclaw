/**
 * Slack API references:
 * - Socket Mode: https://docs.slack.dev/apis/events-api/using-socket-mode/
 * - Open socket connection: https://docs.slack.dev/reference/methods/apps.connections.open
 * - Post message: https://docs.slack.dev/reference/methods/chat.postMessage
 *
 * This channel uses Slack Socket Mode over websocket for inbound events and
 * the Slack Web API for outbound messages.
 */
import type { Channel, ChannelMessageHandler } from "./channel.js";
import type { SlackConfig, ServerSecrets } from "../server-config.js";

type SlackEventEnvelope = {
  challenge?: string;
  event?: {
    bot_id?: string;
    channel?: string;
    text?: string;
    thread_ts?: string;
    ts?: string;
    type?: string;
    user?: string;
  };
  team_id?: string;
  type?: string;
};

type SlackSocketEnvelope = {
  envelope_id?: string;
  payload?: SlackEventEnvelope;
  type?: string;
};

type SlackTextEvent = {
  channel: string;
  teamId: string;
  text: string;
  threadTs?: string;
  userId: string;
};

type SlackOpenConnectionResponse = {
  error?: string;
  ok?: boolean;
  url?: string;
};

type WebSocketLike = {
  addEventListener(
    type: string,
    listener: (event: { data?: unknown }) => void | Promise<void>,
  ): void;
  close(): void;
  readyState?: number;
  send(data: string): void;
};

const normalizeUserId = (teamId: string, userId: string): string =>
  `slack-${teamId}-${userId}`;

const stripLeadingMention = (text: string): string =>
  text.replace(/^<@[^>]+>\s*/u, "").trim();

export const extractSlackTextEvent = (
  payload: SlackEventEnvelope,
  config: Pick<SlackConfig, "botUserId">,
): SlackTextEvent | null => {
  const event = payload.event;
  if (!event || payload.type !== "event_callback") {
    return null;
  }

  if (event.type !== "app_mention" && event.type !== "message") {
    return null;
  }

  if (!payload.team_id || !event.user || !event.channel || !event.text) {
    return null;
  }

  if (event.bot_id) {
    return null;
  }

  if (config.botUserId && event.user === config.botUserId) {
    return null;
  }

  const text = event.type === "app_mention" ? stripLeadingMention(event.text) : event.text.trim();
  if (!text) {
    return null;
  }

  return {
    channel: event.channel,
    teamId: payload.team_id,
    text,
    threadTs: event.thread_ts ?? event.ts,
    userId: normalizeUserId(payload.team_id, event.user),
  };
};

export const createSlackSocketAck = (envelopeId: string): string =>
  JSON.stringify({ envelope_id: envelopeId });

const getSocketModeWebSocket = (): new (url: string) => WebSocketLike => {
  const ctor = (globalThis as typeof globalThis & { WebSocket?: new (url: string) => WebSocketLike })
    .WebSocket;
  if (!ctor) {
    throw new Error("WebSocket is not available in this Node runtime.");
  }

  return ctor;
};

export class SlackChannel implements Channel {
  readonly name = "slack";
  private readonly config: SlackConfig;
  private readonly secrets: ServerSecrets["slack"];
  private messageHandler?: ChannelMessageHandler;
  private websocket?: WebSocketLike;
  private reconnectTimer?: NodeJS.Timeout;
  private stopping = false;

  constructor(config: SlackConfig, secrets: ServerSecrets["slack"]) {
    this.config = config;
    this.secrets = secrets;
  }

  async start(messageHandler?: ChannelMessageHandler): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    this.messageHandler = messageHandler;
    this.stopping = false;

    if (!this.secrets.appToken) {
      throw new Error(
        "Slack app token is required. Set MACLAW_SLACK_APP_TOKEN or ~/.maclaw/secrets.json.",
      );
    }

    if (!this.secrets.botToken) {
      throw new Error(
        "Slack bot token is required. Set MACLAW_SLACK_BOT_TOKEN or ~/.maclaw/secrets.json.",
      );
    }

    await this.connect();
    process.stdout.write("Slack channel connected with Socket Mode\n");
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    this.websocket?.close();
    this.websocket = undefined;
  }

  async send(
    origin: { conversationId?: string; threadId?: string },
    text: string,
  ): Promise<void> {
    if (!origin.conversationId) {
      throw new Error("Slack origin is missing conversationId.");
    }

    await this.sendTextMessage(origin.conversationId, text, origin.threadId);
  }

  private async connect(): Promise<void> {
    const socketUrl = await this.openSocketUrl();
    const WebSocketCtor = getSocketModeWebSocket();
    const socket = new WebSocketCtor(socketUrl);
    this.websocket = socket;

    socket.addEventListener("message", (event) => {
      void this.handleSocketMessage(event.data);
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

  private scheduleReconnect(): void {
    if (this.stopping || this.reconnectTimer) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect().catch((error) => {
        process.stderr.write(
          `Slack Socket Mode reconnect failed: ${
            error instanceof Error ? error.message : String(error)
          }\n`,
        );
        this.scheduleReconnect();
      });
    }, 1_000);
    this.reconnectTimer.unref?.();
  }

  private async openSocketUrl(): Promise<string> {
    const response = await fetch("https://slack.com/api/apps.connections.open", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.secrets.appToken}`,
        "content-type": "application/x-www-form-urlencoded",
      },
    });

    if (!response.ok) {
      throw new Error(`Slack socket open failed: ${response.status} ${await response.text()}`);
    }

    const payload = (await response.json()) as SlackOpenConnectionResponse;
    if (!payload.ok || !payload.url) {
      throw new Error(`Slack socket open failed: ${payload.error ?? "unknown_error"}`);
    }

    return payload.url;
  }

  private async handleSocketMessage(raw: unknown): Promise<void> {
    if (typeof raw !== "string") {
      return;
    }

    const payload = JSON.parse(raw) as SlackSocketEnvelope;
    if (!payload.envelope_id) {
      return;
    }

    this.websocket?.send(createSlackSocketAck(payload.envelope_id));

    const event = extractSlackTextEvent(payload.payload ?? {}, this.config);
    if (!event) {
      return;
    }

    const reply = await this.messageHandler?.({
      channel: this.name,
      conversationId: event.channel,
      threadId: event.threadTs,
      userId: event.userId,
      text: event.text,
    });

    if (reply) {
      await this.sendTextMessage(event.channel, reply, event.threadTs);
    }
  }

  private async sendTextMessage(
    channel: string,
    body: string,
    threadTs?: string,
  ): Promise<void> {
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.secrets.botToken}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        channel,
        text: body,
        thread_ts: threadTs,
      }),
    });

    if (!response.ok) {
      throw new Error(`Slack send failed: ${response.status} ${await response.text()}`);
    }

    const payload = (await response.json()) as { error?: string; ok?: boolean };
    if (!payload.ok) {
      throw new Error(`Slack send failed: ${payload.error ?? "unknown_error"}`);
    }
  }
}

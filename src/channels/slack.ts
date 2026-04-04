import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
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

type SlackTextEvent = {
  channel: string;
  teamId: string;
  text: string;
  threadTs?: string;
  userId: string;
};

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
  response.end(body);
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

export const verifySlackSignature = (
  body: string,
  headers: IncomingHttpHeaders,
  signingSecret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean => {
  const timestampHeader = headers["x-slack-request-timestamp"];
  const signatureHeader = headers["x-slack-signature"];

  const timestamp = Array.isArray(timestampHeader) ? timestampHeader[0] : timestampHeader;
  const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
  if (!timestamp || !signature) {
    return false;
  }

  const parsedTimestamp = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(parsedTimestamp)) {
    return false;
  }

  if (Math.abs(nowSeconds - parsedTimestamp) > 60 * 5) {
    return false;
  }

  const base = `v0:${timestamp}:${body}`;
  const digest = createHmac("sha256", signingSecret).update(base).digest("hex");
  const expected = Buffer.from(`v0=${digest}`, "utf8");
  const actual = Buffer.from(signature, "utf8");
  if (expected.length !== actual.length) {
    return false;
  }

  return timingSafeEqual(expected, actual);
};

export class SlackChannel implements Channel {
  readonly name = "slack";
  private readonly config: SlackConfig;
  private readonly secrets: ServerSecrets["slack"];
  private httpServer?: http.Server;
  private messageHandler?: ChannelMessageHandler;

  constructor(config: SlackConfig, secrets: ServerSecrets["slack"]) {
    this.config = config;
    this.secrets = secrets;
  }

  async start(messageHandler?: ChannelMessageHandler): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    this.messageHandler = messageHandler;

    if (!this.secrets.signingSecret) {
      throw new Error(
        "Slack signing secret is required. Set MACLAW_SLACK_SIGNING_SECRET or ~/.maclaw/secrets.json.",
      );
    }

    if (!this.secrets.botToken) {
      throw new Error(
        "Slack bot token is required. Set MACLAW_SLACK_BOT_TOKEN or ~/.maclaw/secrets.json.",
      );
    }

    this.httpServer = http.createServer(async (request, response) => {
      try {
        await this.handleRequest(request, response);
      } catch (error) {
        json(response, 500, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    await new Promise<void>((resolve, reject) => {
      this.httpServer?.once("error", reject);
      this.httpServer?.listen(this.config.port, resolve);
    });

    process.stdout.write(
      `Slack channel listening on http://localhost:${this.config.port}${this.config.webhookPath}\n`,
    );
  }

  async stop(): Promise<void> {
    if (!this.httpServer) {
      return;
    }

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

  private async handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (url.pathname !== this.config.webhookPath) {
      json(response, 404, { error: "not_found" });
      return;
    }

    if (request.method !== "POST") {
      json(response, 405, { error: "method_not_allowed" });
      return;
    }

    await this.handleWebhook(request, response);
  }

  private async handleWebhook(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const raw = await readRequestBody(request);
    if (
      !this.secrets.signingSecret ||
      !verifySlackSignature(raw, request.headers, this.secrets.signingSecret)
    ) {
      json(response, 403, { error: "verification_failed" });
      return;
    }

    const payload = JSON.parse(raw) as SlackEventEnvelope;
    if (payload.type === "url_verification" && payload.challenge) {
      text(response, 200, payload.challenge);
      return;
    }

    const event = extractSlackTextEvent(payload, this.config);
    if (!event) {
      json(response, 200, { ok: true, processed: 0 });
      return;
    }

    const reply = await this.messageHandler?.({
      channel: this.name,
      userId: event.userId,
      text: event.text,
    });

    if (reply) {
      await this.sendTextMessage(event.channel, reply, event.threadTs);
    }

    json(response, 200, { ok: true, processed: 1 });
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

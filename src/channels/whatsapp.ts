import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import type { Channel, ChannelMessageHandler } from "./channel.js";
import type {
  WhatsAppConfig,
  ServerSecrets,
} from "../server-config.js";

type WhatsAppTextEvent = {
  from: string;
  text: string;
};

type WhatsAppWebhookPayload = {
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: Array<{
          from?: string;
          text?: {
            body?: string;
          };
          type?: string;
        }>;
      };
    }>;
  }>;
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

const normalizeChatId = (from: string): string => {
  const digits = from.replace(/[^0-9]/gu, "");
  return `whatsapp-${digits || "unknown"}`;
};

export const extractWhatsAppTextEvents = (
  payload: WhatsAppWebhookPayload,
): WhatsAppTextEvent[] => {
  const events: WhatsAppTextEvent[] = [];

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const message of change.value?.messages ?? []) {
        if (message.type !== "text") {
          continue;
        }

        const from = message.from?.trim();
        const textBody = message.text?.body?.trim();
        if (!from || !textBody) {
          continue;
        }

        events.push({ from, text: textBody });
      }
    }
  }

  return events;
};

export class WhatsAppChannel implements Channel {
  readonly name = "whatsapp";
  private readonly config: WhatsAppConfig;
  private readonly secrets: ServerSecrets["whatsapp"];
  private httpServer?: http.Server;
  private messageHandler?: ChannelMessageHandler;

  constructor(
    config: WhatsAppConfig,
    secrets: ServerSecrets["whatsapp"],
  ) {
    this.config = config;
    this.secrets = secrets;
  }

  async start(messageHandler?: ChannelMessageHandler): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    this.messageHandler = messageHandler;

    if (!this.secrets.verifyToken) {
      throw new Error(
        "WhatsApp verify token is required. Set MACLAW_WHATSAPP_VERIFY_TOKEN or ~/.maclaw/secrets.json.",
      );
    }

    if (!this.secrets.accessToken) {
      throw new Error(
        "WhatsApp access token is required. Set MACLAW_WHATSAPP_ACCESS_TOKEN or ~/.maclaw/secrets.json.",
      );
    }

    if (!this.config.phoneNumberId) {
      throw new Error(
        "WhatsApp phone number id is required. Set channels.whatsapp.phoneNumberId or MACLAW_WHATSAPP_PHONE_NUMBER_ID.",
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
      `WhatsApp channel listening on http://localhost:${this.config.port}${this.config.webhookPath}\n`,
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

    if (request.method === "GET") {
      this.handleVerification(url, response);
      return;
    }

    if (request.method === "POST") {
      await this.handleWebhook(request, response);
      return;
    }

    json(response, 405, { error: "method_not_allowed" });
  }

  private handleVerification(url: URL, response: ServerResponse): void {
    const mode = url.searchParams.get("hub.mode");
    const challenge = url.searchParams.get("hub.challenge");
    const verifyToken = url.searchParams.get("hub.verify_token");

    if (
      mode === "subscribe" &&
      challenge &&
      verifyToken === this.secrets.verifyToken
    ) {
      text(response, 200, challenge);
      return;
    }

    json(response, 403, { error: "verification_failed" });
  }

  private async handleWebhook(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const raw = await readRequestBody(request);
    const payload = JSON.parse(raw) as WhatsAppWebhookPayload;
    const events = extractWhatsAppTextEvents(payload);

    for (const event of events) {
      const reply = await this.messageHandler?.({
        channel: this.name,
        userId: normalizeChatId(event.from),
        text: event.text,
      });

      if (reply) {
        await this.sendTextMessage(event.from, reply);
      }
    }

    json(response, 200, { ok: true, processed: events.length });
  }

  private async sendTextMessage(to: string, body: string): Promise<void> {
    const endpoint =
      `https://graph.facebook.com/${this.config.graphApiVersion}/` +
      `${this.config.phoneNumberId}/messages`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.secrets.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: {
          body,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`WhatsApp send failed: ${response.status} ${await response.text()}`);
    }
  }
}

/**
 * Outbound email notifications over SMTP.
 *
 * This channel is outbound-only for now. It uses a small SMTP client with
 * optional STARTTLS and AUTH LOGIN so users can route notifications to an
 * email address such as Gmail without adding another dependency.
 */
import net from "node:net";
import tls from "node:tls";
import type { Channel, ChannelMessageHandler } from "./channel.js";
import type { EmailConfig, ServerSecrets } from "../server-config.js";
import type { Origin } from "../types.js";

type SocketLike = net.Socket | tls.TLSSocket;

const base64 = (value: string): string => Buffer.from(value, "utf8").toString("base64");

const smtpLine = (value: string): string => `${value}\r\n`;

const formatMessage = (from: string, to: string, text: string): string => {
  const escapedBody = text.replace(/\r?\n/gu, "\r\n").replace(/^\./gmu, "..");
  return [
    `From: ${from}`,
    `To: ${to}`,
    "Subject: [maclaw] Notification",
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    escapedBody,
    ".",
  ].join("\r\n");
};

class SmtpClient {
  private readonly host: string;
  private readonly port: number;
  private readonly startTls: boolean;
  private readonly user?: string;
  private readonly password?: string;
  private socket?: SocketLike;
  private buffer = "";

  constructor(config: EmailConfig, secrets: ServerSecrets["email"]) {
    this.host = config.host;
    this.port = config.port;
    this.startTls = config.startTls;
    this.user = secrets.smtpUser;
    this.password = secrets.smtpPassword;
  }

  async send(from: string, to: string, text: string): Promise<void> {
    this.socket = await this.connect();
    await this.readResponse();
    await this.writeCommand(`EHLO localhost`);

    if (this.startTls) {
      await this.writeCommand("STARTTLS");
      this.socket = await this.upgradeToTls(this.socket);
      await this.writeCommand(`EHLO localhost`);
    }

    if (this.user && this.password) {
      await this.writeCommand("AUTH LOGIN");
      await this.writeCommand(base64(this.user));
      await this.writeCommand(base64(this.password));
    }

    await this.writeCommand(`MAIL FROM:<${from}>`);
    await this.writeCommand(`RCPT TO:<${to}>`);
    await this.writeCommand("DATA");
    await this.writeRaw(formatMessage(from, to, text));
    await this.readResponse();
    await this.writeCommand("QUIT");
    this.socket.end();
  }

  private connect(): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const socket = net.connect(this.port, this.host);
      socket.once("error", reject);
      socket.once("connect", () => resolve(socket));
    });
  }

  private upgradeToTls(socket: SocketLike): Promise<tls.TLSSocket> {
    return new Promise((resolve, reject) => {
      const secureSocket = tls.connect({
        host: this.host,
        port: this.port,
        socket,
      });
      secureSocket.once("error", reject);
      secureSocket.once("secureConnect", () => resolve(secureSocket));
    });
  }

  private async writeCommand(command: string): Promise<void> {
    await this.writeRaw(command);
    await this.readResponse();
  }

  private writeRaw(value: string): Promise<void> {
    const socket = this.socket;
    if (!socket) {
      throw new Error("SMTP socket is not connected.");
    }

    return new Promise((resolve, reject) => {
      socket.write(smtpLine(value), (error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  private readResponse(): Promise<string> {
    const socket = this.socket;
    if (!socket) {
      throw new Error("SMTP socket is not connected.");
    }

    return new Promise((resolve, reject) => {
      const onData = (chunk: Buffer | string) => {
        this.buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
        const lines = this.buffer.split("\r\n");
        this.buffer = lines.pop() ?? "";
        const completeLines = lines.filter((line) => line.length > 0);
        if (completeLines.length === 0) {
          return;
        }

        const lastLine = completeLines[completeLines.length - 1] ?? "";
        if (!/^\d{3} /u.test(lastLine)) {
          return;
        }

        cleanup();
        const code = Number.parseInt(lastLine.slice(0, 3), 10);
        if (code >= 400) {
          reject(new Error(completeLines.join("\n")));
          return;
        }

        resolve(completeLines.join("\n"));
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };

      const cleanup = () => {
        socket.off("data", onData);
        socket.off("error", onError);
      };

      socket.on("data", onData);
      socket.on("error", onError);
    });
  }
}

type SmtpTransport = {
  send(from: string, to: string, text: string): Promise<void>;
};

export class EmailChannel implements Channel {
  readonly name = "email";
  private readonly config: EmailConfig;
  private readonly secrets: ServerSecrets["email"];
  private readonly createClient: () => SmtpTransport;

  constructor(
    config: EmailConfig,
    secrets: ServerSecrets["email"],
    createClient?: () => SmtpTransport,
  ) {
    this.config = config;
    this.secrets = secrets;
    this.createClient = createClient ?? (() => new SmtpClient(config, secrets));
  }

  async start(_messageHandler?: ChannelMessageHandler): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    if (!this.config.from) {
      throw new Error("Email channel requires channels.email.from in server config.");
    }

    if (!this.config.host) {
      throw new Error("Email channel requires channels.email.host in server config.");
    }

    if (!this.secrets.smtpUser || !this.secrets.smtpPassword) {
      throw new Error(
        "Email channel requires MACLAW_EMAIL_SMTP_USER and MACLAW_EMAIL_SMTP_PASSWORD or matching secrets.json entries.",
      );
    }
  }

  async send(origin: Origin, text: string): Promise<void> {
    const to = origin.userId.includes("@")
      ? origin.userId
      : this.config.to ?? this.config.from;

    const client = this.createClient();
    await client.send(this.config.from, to, text);
  }

  async stop(): Promise<void> {
    return Promise.resolve();
  }
}

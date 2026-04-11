/**
 * Remote maclaw command client for SSH-forwarded server usage.
 *
 * This v1 client talks to a single structured `/api/command` endpoint. It is
 * intended to run against a remote maclaw server that is reachable through an
 * SSH tunnel, usually via `http://127.0.0.1:<forwarded-port>`.
 */
import type { Origin } from "./types.js";

export type RemoteCommandRequest = {
  project?: string;
  chatId?: string;
  text: string;
  origin?: Origin;
};

export type RemoteCommandResponse = {
  project: string;
  chatId: string;
  reply: string;
  handledAsCommand: boolean;
};

const normalizeBaseUrl = (baseUrl: string): string => {
  const trimmed = baseUrl.trim();
  if (trimmed.length === 0) {
    throw new Error("baseUrl is required");
  }

  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
};

// TODO: ssh
export class RemoteRuntimeClient {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
  }

  async sendCommand(request: RemoteCommandRequest): Promise<RemoteCommandResponse> {
    const response = await fetch(`${this.baseUrl}/api/command`, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(request),
    });

    const rawBody = await response.text();
    const parsed = rawBody.trim().length === 0
      ? {}
      : JSON.parse(rawBody) as { error?: string } & Partial<RemoteCommandResponse>;

    if (!response.ok) {
      throw new Error(parsed.error ?? `Remote command failed with status ${response.status}`);
    }

    if (
      typeof parsed.project !== "string" ||
      typeof parsed.chatId !== "string" ||
      typeof parsed.reply !== "string" ||
      typeof parsed.handledAsCommand !== "boolean"
    ) {
      throw new Error("Remote command response was invalid.");
    }

    return {
      project: parsed.project,
      chatId: parsed.chatId,
      reply: parsed.reply,
      handledAsCommand: parsed.handledAsCommand,
    };
  }
}

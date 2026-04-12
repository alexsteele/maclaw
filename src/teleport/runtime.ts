/**
 * Remote runtime request/response types and client.
 *
 * This module owns the `/api/command` runtime protocol used by teleport
 * sessions once a transport has connected to a remote maclaw server.
 */
import type { Origin } from "../types.js";
import type { TeleportRuntimeOptions } from "./options.js";

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

export type TeleportRuntime = {
  sendCommand(request: RemoteCommandRequest): Promise<RemoteCommandResponse>;
};

const normalizeBaseUrl = (baseUrl: string): string => {
  const trimmed = baseUrl.trim();
  if (trimmed.length === 0) {
    throw new Error("baseUrl is required");
  }

  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
};

/**
 * Small client for the remote `POST /api/command` endpoint.
 */
export class RemoteRuntimeClient implements TeleportRuntime {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(baseUrl: string, options: TeleportRuntimeOptions = {}) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async sendCommand(request: RemoteCommandRequest): Promise<RemoteCommandResponse> {
    const response = await this.fetchFn(`${this.baseUrl}/api/command`, {
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

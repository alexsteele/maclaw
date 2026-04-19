/**
 * Maclaw request/response types and client implementations.
 *
 * This module owns the shared `/api/command` protocol used to talk to a maclaw
 * runtime over HTTP.
 */
import type { Origin } from "../types.js";

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

export type MaclawClient = {
  sendCommand(request: RemoteCommandRequest): Promise<RemoteCommandResponse>;
};

export type HttpMaclawClientOptions = {
  fetchFn?: typeof fetch;
};

const normalizeBaseUrl = (baseUrl: string): string => {
  const trimmed = baseUrl.trim();
  if (trimmed.length === 0) {
    throw new Error("baseUrl is required");
  }

  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
};

const parseRemoteCommandResponse = (rawBody: string): RemoteCommandResponse => {
  const parsed = rawBody.trim().length === 0
    ? {}
    : JSON.parse(rawBody) as { error?: string } & Partial<RemoteCommandResponse>;

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
};

/**
 * Small client for the remote `POST /api/command` endpoint.
 */
export class HttpMaclawClient implements MaclawClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(baseUrl: string, options: HttpMaclawClientOptions = {}) {
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

    return parseRemoteCommandResponse(rawBody);
  }
}

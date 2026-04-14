/**
 * Teleport session lifecycle and one-shot command helpers.
 *
 * This module owns attached session state, retries, and one-shot teleport
 * command execution.
 */
import { spawn } from "node:child_process";
import { logger } from "../logger.js";
import type {
  RemoteCommandRequest,
  RemoteCommandResponse,
} from "../remote/client.js";
import { resolveRemoteTarget, type RemoteConnection } from "../remote/index.js";
import type { ServerConfig } from "../server-config.js";
import type {
  TeleportOptions,
  TeleportRuntimeOptions,
  TeleportTunnelOptions,
} from "./options.js";

export type TeleportTarget = {
  chatId: string;
  project?: string;
  target: string;
};

type TeleportSessionState = {
  client?: RemoteConnection;
};

const defaultSleep = async (ms: number): Promise<void> =>
  await new Promise((resolve) => setTimeout(resolve, ms));

const getSleep = (
  options: TeleportRuntimeOptions,
): ((ms: number) => Promise<void>) => options.sleep ?? defaultSleep;

const getSpawnFn = (options: TeleportTunnelOptions): typeof spawn =>
  options.spawnFn ?? spawn;

const getStartupDelayMs = (options: TeleportTunnelOptions): number =>
  options.startupDelayMs ?? 150;

const isRetryableError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return /ECONNREFUSED|ECONNRESET|fetch failed|socket hang up|UND_ERR/u.test(message);
};

/**
 * Teleport session that can talk to either a raw HTTP target or a named
 * configured remote.
 *
 * One-shot teleport commands use this class internally today. It also gives us
 * a natural place to hang a future long-lived remote REPL or portal session.
 */
export class TeleportSession {
  private readonly target: string;
  private readonly config?: Pick<ServerConfig, "remotes">;
  private readonly options: TeleportOptions;
  private state: TeleportSessionState = {};

  constructor(
    target: string,
    config?: Pick<ServerConfig, "remotes">,
    options: TeleportOptions = {},
  ) {
    this.target = target;
    this.config = config;
    this.options = options;
  }

  private async connect(): Promise<RemoteConnection> {
    const remote = resolveRemoteTarget(this.target, this.config);
    if (!remote) {
      throw new Error(`Unknown remote: ${this.target}`);
    }

    return await remote.connect({
      fetchFn: this.options.runtime?.fetchFn,
      spawnFn: getSpawnFn(this.options.tunnel ?? {}),
      startupDelayMs: getStartupDelayMs(this.options.tunnel ?? {}),
    });
  }

  async start(): Promise<RemoteConnection> {
    if (this.state.client) {
      return this.state.client;
    }

    this.state.client = await this.connect();
    logger.info("teleport", "connected", {
      target: this.target,
      mode: this.state.client.getMode(),
      remote: this.state.client.describe(),
    });
    return this.state.client;
  }

  async stop(): Promise<void> {
    const target = this.target;
    if (!this.state.client) {
      logger.info("teleport", "disconnected", {
        target,
      });
      return;
    }

    const client = this.state.client;
    this.state.client = undefined;
    await client.close();
    logger.info("teleport", "disconnected", {
      target,
    });
  }

  async sendCommand(request: RemoteCommandRequest): Promise<RemoteCommandResponse> {
    const conn = await this.start();

    const requestWithOrigin: RemoteCommandRequest = {
      ...request,
      origin: {
        channel: request.origin?.channel ?? "teleport",
        userId: request.origin?.userId ?? (request.chatId?.trim() || "teleport"),
        conversationId:
          request.origin?.conversationId
          ?? (request.project ? `teleport:${request.project}` : undefined),
        threadId: request.origin?.threadId,
        metadata: {
          ...(this.state.client?.buildOriginMetadata(this.target) ?? {}),
          ...(request.origin?.metadata ?? {}),
        },
      },
    };

    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await conn.sendCommand(requestWithOrigin);
      } catch (error) {
        lastError = error;
        if (!isRetryableError(error) || attempt === 2) {
          throw error;
        }

        await getSleep(this.options.runtime ?? {})(100);
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}

export const sendTeleportCommand = async (
  target: string,
  request: RemoteCommandRequest,
  config?: Pick<ServerConfig, "remotes">,
  options: TeleportOptions = {},
): Promise<RemoteCommandResponse> => {
  const session = new TeleportSession(target, config, options);
  try {
    return await session.sendCommand(request);
  } finally {
    await session.stop();
  }
};

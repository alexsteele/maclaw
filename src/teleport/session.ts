/**
 * Teleport session lifecycle and one-shot command helpers.
 *
 * This module owns attached session state, retries, and one-shot teleport
 * command execution.
 */
import { spawn } from "node:child_process";
import { logger } from "../logger.js";
import type { ServerConfig } from "../server-config.js";
import type {
  TeleportOptions,
  TeleportRuntimeOptions,
  TeleportTunnelOptions,
} from "./options.js";
import {
  buildTeleportOriginMetadata,
  createDirectTransport,
  createTransport,
  findTeleportRemote,
  isTeleportUrl,
  type TeleportTransport,
} from "./transport.js";
import {
  RemoteRuntimeClient,
  type RemoteCommandRequest,
  type RemoteCommandResponse,
  type TeleportRuntime,
} from "./runtime.js";

export type TeleportTarget = {
  chatId: string;
  project?: string;
  target: string;
};

type TeleportSessionState = {
  runtime?: TeleportRuntime;
  transport?: TeleportTransport;
};

const defaultSleep = async (ms: number): Promise<void> =>
  await new Promise((resolve) => setTimeout(resolve, ms));

const getFetchFn = (options: TeleportRuntimeOptions): typeof fetch =>
  options.fetchFn ?? fetch;

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
 * Teleport session that can talk to either a direct URL or a named SSH remote.
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

  private createRuntime = (baseUrl: string): TeleportRuntime =>
    new RemoteRuntimeClient(baseUrl, {
      fetchFn: getFetchFn(this.options.runtime ?? {}),
    });

  private createTransport(): TeleportTransport {
    if (isTeleportUrl(this.target)) {
      return createDirectTransport(this.target, this.createRuntime);
    }

    const remote = findTeleportRemote(this.config ?? {}, this.target);
    if (!remote) {
      throw new Error(`Unknown remote: ${this.target}`);
    }

    return createTransport(
      this.target,
      remote,
      {
        spawnFn: getSpawnFn(this.options.tunnel ?? {}),
        startupDelayMs: getStartupDelayMs(this.options.tunnel ?? {}),
      },
      this.createRuntime,
    );
  }

  async start(): Promise<TeleportRuntime> {
    if (this.state.runtime) {
      return this.state.runtime;
    }

    this.state.transport = this.createTransport();
    this.state.runtime = await this.state.transport.start();
    logger.info("teleport", "connected", {
      target: this.target,
      mode: this.state.transport.getMode(),
      remote: this.state.transport.describe(),
    });
    return this.state.runtime;
  }

  async stop(): Promise<void> {
    const target = this.target;
    this.state.runtime = undefined;
    if (!this.state.transport) {
      logger.info("teleport", "disconnected", {
        target,
      });
      return;
    }

    const transport = this.state.transport;
    this.state.transport = undefined;
    await transport.stop();
    logger.info("teleport", "disconnected", {
      target,
    });
  }

  async sendCommand(request: RemoteCommandRequest): Promise<RemoteCommandResponse> {
    const runtime = await this.start();

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
          ...(this.state.transport?.buildOriginMetadata(this.target)
            ?? buildTeleportOriginMetadata(this.target, this.config)),
          ...(request.origin?.metadata ?? {}),
        },
      },
    };

    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await runtime.sendCommand(requestWithOrigin);
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

/**
 * Remote maclaw command helpers for SSH-forwarded server usage.
 *
 * This module keeps remote command transport, named remote lookup, and
 * short-lived SSH tunnel management in one place. See `docs/teleport.md`.
 */
import { spawn, type ChildProcess } from "node:child_process";
import type { ServerConfig, TeleportRemoteConfig } from "./server-config.js";
import { defaultServerPort } from "./server-config.js";
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

type FetchLike = typeof fetch;
type SpawnLike = typeof spawn;

type SpawnedTunnel = Pick<ChildProcess, "kill" | "once" | "stderr">;

type TeleportDependencies = {
  fetchFn?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  spawnFn?: SpawnLike;
  startupDelayMs?: number;
};

const normalizeBaseUrl = (baseUrl: string): string => {
  const trimmed = baseUrl.trim();
  if (trimmed.length === 0) {
    throw new Error("baseUrl is required");
  }

  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
};

const defaultSleep = async (ms: number): Promise<void> =>
  await new Promise((resolve) => setTimeout(resolve, ms));

const describeRemote = (remote: TeleportRemoteConfig): string =>
  remote.sshUser ? `${remote.sshUser}@${remote.sshHost}` : remote.sshHost;

const getRemoteServerPort = (remote: TeleportRemoteConfig): number =>
  remote.remoteServerPort ?? defaultServerPort();

const getLocalForwardPort = (remote: TeleportRemoteConfig): number =>
  remote.localForwardPort ?? getRemoteServerPort(remote);

const toRemoteBaseUrl = (remote: TeleportRemoteConfig): string =>
  `http://127.0.0.1:${getLocalForwardPort(remote)}`;

const isRetryableError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return /ECONNREFUSED|ECONNRESET|fetch failed|socket hang up|UND_ERR/u.test(message);
};

const waitForTunnelStartup = async (
  process: SpawnedTunnel,
  remote: TeleportRemoteConfig,
  startupDelayMs: number,
): Promise<void> => {
  let stderr = "";
  process.stderr?.on("data", (chunk: Buffer | string) => {
    stderr += chunk.toString();
  });

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    const finish = (callback: () => void): void => {
      if (settled) {
        return;
      }

      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      callback();
    };

    process.once("error", (error) => {
      finish(() => reject(error));
    });
    process.once("exit", (code, signal) => {
      finish(() => reject(
        new Error(
          stderr.trim().length > 0
            ? stderr.trim()
            : `ssh tunnel exited for ${remote.name} (${describeRemote(remote)}) with code ${code ?? "null"} signal ${signal ?? "null"}`,
        ),
      ));
    });

    timer = setTimeout(() => {
      finish(resolve);
    }, startupDelayMs);
  });
};

const closeTunnel = async (process: SpawnedTunnel): Promise<void> => {
  if (!process.kill("SIGTERM")) {
    return;
  }

  await new Promise<void>((resolve) => {
    process.once("exit", () => resolve());
  });
};

/**
 * Returns true when the teleport target is already a direct HTTP base URL.
 */
export const isTeleportUrl = (value: string): boolean => /^https?:\/\//u.test(value.trim());

/**
 * Resolves a named teleport remote from the global server config.
 */
export const findTeleportRemote = (
  config: Pick<ServerConfig, "remotes">,
  name: string,
): TeleportRemoteConfig | undefined => config.remotes?.find((remote) => remote.name === name);

/**
 * Small client for the remote `POST /api/command` endpoint.
 */
export class RemoteRuntimeClient {
  private readonly baseUrl: string;
  private readonly fetchFn: FetchLike;

  constructor(baseUrl: string, options: { fetchFn?: FetchLike } = {}) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.fetchFn = options.fetchFn ?? fetch;
  }

  /**
   * Sends one command or chat message to a remote maclaw runtime.
   */
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

/**
 * Teleport session that can talk to either a direct URL or a named SSH remote.
 *
 * One-shot teleport commands use this class internally today. It also gives us
 * a natural place to hang a future long-lived remote REPL or portal session.
 */
export class TeleportSession {
  private readonly target: string;
  private readonly config?: Pick<ServerConfig, "remotes">;
  private readonly fetchFn: FetchLike;
  private readonly spawnFn: SpawnLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly startupDelayMs: number;
  private client?: RemoteRuntimeClient;
  private tunnel?: SpawnedTunnel;

  constructor(
    target: string,
    config?: Pick<ServerConfig, "remotes">,
    dependencies: TeleportDependencies = {},
  ) {
    this.target = target;
    this.config = config;
    this.fetchFn = dependencies.fetchFn ?? fetch;
    this.spawnFn = dependencies.spawnFn ?? spawn;
    this.sleep = dependencies.sleep ?? defaultSleep;
    this.startupDelayMs = dependencies.startupDelayMs ?? 150;
  }

  /**
   * Starts the teleport transport if it is not already running.
   */
  async start(): Promise<void> {
    if (this.client) {
      return;
    }

    if (isTeleportUrl(this.target)) {
      this.client = new RemoteRuntimeClient(this.target, { fetchFn: this.fetchFn });
      return;
    }

    const remote = findTeleportRemote(this.config ?? {}, this.target);
    if (!remote) {
      throw new Error(`Unknown remote: ${this.target}`);
    }

    const sshArgs = [
      "-o",
      "ExitOnForwardFailure=yes",
      "-N",
      "-L",
      `${getLocalForwardPort(remote)}:127.0.0.1:${getRemoteServerPort(remote)}`,
      ...(remote.sshPort ? ["-p", String(remote.sshPort)] : []),
      describeRemote(remote),
    ];
    this.tunnel = this.spawnFn("ssh", sshArgs, {
      stdio: ["ignore", "ignore", "pipe"],
    }) as SpawnedTunnel;

    await waitForTunnelStartup(this.tunnel, remote, this.startupDelayMs);
    this.client = new RemoteRuntimeClient(toRemoteBaseUrl(remote), { fetchFn: this.fetchFn });
  }

  /**
   * Stops the SSH tunnel for a named remote session.
   */
  async stop(): Promise<void> {
    this.client = undefined;
    if (!this.tunnel) {
      return;
    }

    const tunnel = this.tunnel;
    this.tunnel = undefined;
    await closeTunnel(tunnel);
  }

  /**
   * Sends one command through the current teleport session.
   */
  async sendCommand(request: RemoteCommandRequest): Promise<RemoteCommandResponse> {
    await this.start();
    const client = this.client;
    if (!client) {
      throw new Error("Teleport session failed to start.");
    }

    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await client.sendCommand(request);
      } catch (error) {
        lastError = error;
        if (!isRetryableError(error) || attempt === 2) {
          throw error;
        }

        await this.sleep(100);
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}

/**
 * Sends a teleport command to either a direct URL or a named SSH remote.
 */
export const sendTeleportCommand = async (
  target: string,
  request: RemoteCommandRequest,
  config?: Pick<ServerConfig, "remotes">,
  dependencies: TeleportDependencies = {},
): Promise<RemoteCommandResponse> => {
  const session = new TeleportSession(target, config, dependencies);
  try {
    return await session.sendCommand(request);
  } finally {
    await session.stop();
  }
};

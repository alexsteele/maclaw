/**
 * Shared tunnel helpers for remote connections.
 *
 * A tunnel is a long-lived local process, such as `ssh -L` or
 * `aws ssm start-session`, that forwards a local port to a remote maclaw HTTP
 * server. Remote implementations use this module to start that process and to
 * wrap the forwarded local URL in a connected maclaw client with cleanup.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { HttpMaclawClient } from "./client.js";
import type { RemoteConnectOptions } from "./types.js";
import type { RemoteConnection } from "./types.js";

type SpawnLike = typeof spawn;
export type SpawnedTunnel = Pick<ChildProcess, "kill" | "once" | "stderr">;

const getSpawnFn = (options: RemoteConnectOptions): SpawnLike =>
  options.spawnFn ?? spawn;

const getStartupDelayMs = (options: RemoteConnectOptions): number =>
  options.startupDelayMs ?? 150;

export const createTunnelConnection = async (
  command: string,
  args: string[],
  baseUrl: string,
  description: string,
  buildOriginMetadata: () => Record<string, string>,
  mode: string,
  options: RemoteConnectOptions,
): Promise<RemoteConnection> => {
  const tunnel = await startTunnelProcess(command, args, description, options);
  const client = new HttpMaclawClient(baseUrl, {
    fetchFn: options.fetchFn,
  });
  let openTunnel: typeof tunnel | undefined = tunnel;

  return {
    buildOriginMetadata,
    close: async () => {
      if (!openTunnel) {
        return;
      }

      const activeTunnel = openTunnel;
      openTunnel = undefined;
      await stopTunnelProcess(activeTunnel);
    },
    describe: () => description,
    getMode: () => mode,
    sendCommand: async (request) => await client.sendCommand(request),
  };
};

export const startTunnelProcess = async (
  command: string,
  args: string[],
  target: string,
  options: RemoteConnectOptions,
): Promise<SpawnedTunnel> => {
  const process = getSpawnFn(options)(command, args, {
    stdio: ["ignore", "ignore", "pipe"],
  }) as SpawnedTunnel;

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
      finish(() =>
        reject(
          new Error(
            stderr.trim().length > 0
              ? stderr.trim()
              : `teleport transport exited for ${target} with code ${code ?? "null"} signal ${signal ?? "null"}`,
          ),
        ),
      );
    });

    timer = setTimeout(() => {
      finish(resolve);
    }, getStartupDelayMs(options));
  });

  return process;
};

export const stopTunnelProcess = async (process: SpawnedTunnel): Promise<void> => {
  if (!process.kill("SIGTERM")) {
    return;
  }

  await new Promise<void>((resolve) => {
    process.once("exit", () => resolve());
  });
};

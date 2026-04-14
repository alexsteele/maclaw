/**
 * Small helpers for spawned remote tunnel process lifecycle.
 *
 * Remote implementations own the actual teleport transport shape and use these
 * helpers only to start and stop the underlying tunnel process.
 */
import { spawn, type ChildProcess } from "node:child_process";
import type { RemoteConnectOptions } from "./types.js";

type SpawnLike = typeof spawn;
export type SpawnedTunnel = Pick<ChildProcess, "kill" | "once" | "stderr">;

const getSpawnFn = (options: RemoteConnectOptions): SpawnLike =>
  options.spawnFn ?? spawn;

const getStartupDelayMs = (options: RemoteConnectOptions): number =>
  options.startupDelayMs ?? 150;

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

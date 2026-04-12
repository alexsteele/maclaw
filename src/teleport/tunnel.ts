/**
 * SSH and EC2 tunnel helpers for teleport.
 *
 * This module owns provider-specific tunnel specs and process lifecycle used
 * by `createTransport` in `transport.ts`.
 */
import { spawn, type ChildProcess } from "node:child_process";
import type {
  Ec2Config,
  RemoteConfig,
  SshConfig,
} from "../server-config.js";
import { defaultServerPort } from "../server-config.js";
import type { TeleportTransport } from "./transport.js";
import type { TeleportTunnelOptions } from "./options.js";
import type { TeleportRuntime } from "./runtime.js";

type SpawnLike = typeof spawn;
type SpawnedTunnel = Pick<ChildProcess, "kill" | "once" | "stderr">;

export type TunnelSpec = {
  args: string[];
  command: string;
  describe: string;
  mode: string;
  originMetadata: Record<string, string>;
};

type CreateRuntimeFn = (baseUrl: string) => TeleportRuntime;

const getRemoteServerPort = (remote: RemoteConfig): number =>
  remote.remoteServerPort ?? defaultServerPort();

const getLocalForwardPort = (remote: RemoteConfig): number =>
  remote.localForwardPort ?? getRemoteServerPort(remote);

const toRemoteBaseUrl = (remote: RemoteConfig): string =>
  `http://127.0.0.1:${getLocalForwardPort(remote)}`;

const asSshConfig = (remote: RemoteConfig): SshConfig =>
  remote.metadata as SshConfig;

const asEc2Config = (remote: RemoteConfig): Ec2Config =>
  remote.metadata as Ec2Config;

const getSpawnFn = (options: TeleportTunnelOptions): SpawnLike =>
  options.spawnFn ?? spawn;

const getStartupDelayMs = (options: TeleportTunnelOptions): number =>
  options.startupDelayMs ?? 150;

const waitForTunnelStartup = async (
  process: SpawnedTunnel,
  target: string,
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

const describeSshRemote = (remote: RemoteConfig): string => {
  const metadata = asSshConfig(remote);
  return metadata.user ? `${metadata.user}@${metadata.host}` : metadata.host;
};

const describeEc2Remote = (remote: RemoteConfig): string => {
  const metadata = asEc2Config(remote);
  return `${metadata.instanceId} (${metadata.region})`;
};

const buildSshOriginMetadata = (
  target: string,
  remote: RemoteConfig,
): Record<string, string> => {
  const metadata = asSshConfig(remote);
  return {
    teleportMode: "ssh",
    teleportTarget: target,
    teleportRemote: remote.name,
    teleportHost: metadata.host,
  };
};

const buildEc2OriginMetadata = (
  target: string,
  remote: RemoteConfig,
): Record<string, string> => {
  const metadata = asEc2Config(remote);
  return {
    teleportMode: "aws-ec2",
    teleportTarget: target,
    teleportRemote: remote.name,
    teleportHost: metadata.instanceId,
  };
};

export const buildTunnelSpec = (
  target: string,
  remote: RemoteConfig,
): TunnelSpec => {
  if (remote.provider === "ssh") {
    const metadata = asSshConfig(remote);
    return {
      command: "ssh",
      args: [
        "-o",
        "ExitOnForwardFailure=yes",
        "-N",
        "-L",
        `${getLocalForwardPort(remote)}:127.0.0.1:${getRemoteServerPort(remote)}`,
        ...(metadata.port ? ["-p", String(metadata.port)] : []),
        describeSshRemote(remote),
      ],
      describe: describeSshRemote(remote),
      mode: "ssh",
      originMetadata: buildSshOriginMetadata(target, remote),
    };
  }

  const metadata = asEc2Config(remote);
  return {
    command: "aws",
    args: [
      "ssm",
      "start-session",
      "--region",
      metadata.region,
      "--target",
      metadata.instanceId,
      "--document-name",
      "AWS-StartPortForwardingSession",
      "--parameters",
      JSON.stringify({
        portNumber: [String(getRemoteServerPort(remote))],
        localPortNumber: [String(getLocalForwardPort(remote))],
      }),
    ],
    describe: describeEc2Remote(remote),
    mode: "aws-ec2",
    originMetadata: buildEc2OriginMetadata(target, remote),
  };
};

export const createTunnelTransport = (
  target: string,
  remote: RemoteConfig,
  options: TeleportTunnelOptions,
  createRuntime: CreateRuntimeFn,
): TeleportTransport => {
  let tunnel: SpawnedTunnel | undefined;
  const spec = buildTunnelSpec(target, remote);

  return {
    buildOriginMetadata: () => spec.originMetadata,
    describe: () => spec.describe,
    getMode: () => spec.mode,
    async start() {
      tunnel = getSpawnFn(options)(spec.command, spec.args, {
        stdio: ["ignore", "ignore", "pipe"],
      }) as SpawnedTunnel;

      await waitForTunnelStartup(
        tunnel,
        `${remote.name} (${spec.describe})`,
        getStartupDelayMs(options),
      );
      return createRuntime(toRemoteBaseUrl(remote));
    },
    async stop() {
      if (!tunnel) {
        return;
      }

      const activeTunnel = tunnel;
      tunnel = undefined;
      await closeTunnel(activeTunnel);
    },
  };
};

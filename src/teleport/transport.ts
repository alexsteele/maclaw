/**
 * Transport helpers for teleport.
 *
 * This module owns remote lookup and transport selection used by
 * `TeleportSession`.
 */
import type {
  Ec2Config,
  RemoteConfig,
  ServerConfig,
  SshConfig,
} from "../server-config.js";
import type { TeleportTunnelOptions } from "./options.js";
import type { TeleportRuntime } from "./runtime.js";
import { buildTunnelSpec, createTunnelTransport } from "./tunnel.js";

/**
 * Transport lifecycle used by `TeleportSession`.
 */
export type TeleportTransport = {
  buildOriginMetadata(target: string): Record<string, string>;
  describe(): string;
  getMode(): string;
  start(): Promise<TeleportRuntime>;
  stop(): Promise<void>;
};

const asSshConfig = (remote: RemoteConfig): SshConfig => remote.metadata as SshConfig;

const asEc2Config = (remote: RemoteConfig): Ec2Config => remote.metadata as Ec2Config;

const summarizeSshRemote = (remote: RemoteConfig): string => {
  const metadata = asSshConfig(remote);
  return `${metadata.host}${metadata.port ? `:${metadata.port}` : ""}`;
};

const summarizeEc2Remote = (remote: RemoteConfig): string => {
  const metadata = asEc2Config(remote);
  return `aws-ec2 ${metadata.instanceId} (${metadata.region})`;
};

export const createDirectTransport = (
  target: string,
  createRuntime: (baseUrl: string) => TeleportRuntime,
): TeleportTransport => ({
  buildOriginMetadata() {
    const url = new URL(target);
    return {
      teleportMode: "direct",
      teleportTarget: target,
      teleportHost: url.hostname,
    };
  },
  describe() {
    return target;
  },
  getMode() {
    return "direct";
  },
  async start() {
    return createRuntime(target);
  },
  async stop() {
    return;
  },
});

export const createTransport = (
  target: string,
  remote: RemoteConfig,
  options: TeleportTunnelOptions,
  createRuntime: (baseUrl: string) => TeleportRuntime,
): TeleportTransport =>
  createTunnelTransport(target, remote, options, createRuntime);

export const buildTeleportOriginMetadata = (
  target: string,
  config?: Pick<ServerConfig, "remotes">,
): Record<string, string> => {
  if (isTeleportUrl(target)) {
    const url = new URL(target);
    return {
      teleportMode: "direct",
      teleportTarget: target,
      teleportHost: url.hostname,
    };
  }

  const remote = findTeleportRemote(config ?? {}, target);
  if (!remote) {
    return {
      teleportMode: "ssh",
      teleportTarget: target,
    };
  }

  return buildTunnelSpec(target, remote).originMetadata;
};

export const summarizeTeleportRemote = (remote: RemoteConfig): string =>
  remote.provider === "ssh"
    ? summarizeSshRemote(remote)
    : summarizeEc2Remote(remote);

export const isTeleportUrl = (value: string): boolean => /^https?:\/\//u.test(value.trim());

export const findTeleportRemote = (
  config: Pick<ServerConfig, "remotes">,
  name: string,
): RemoteConfig | undefined => config.remotes?.find((remote) => remote.name === name);

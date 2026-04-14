/**
 * AWS EC2-backed remote lifecycle.
 *
 * This keeps EC2 provider behavior in its own file while reusing the existing
 * teleport transport path for remote connection.
 */
import {
  defaultServerPort,
  defaultTeleportForwardPort,
  type Ec2Config,
  type RemoteConfig,
} from "../server-config.js";
import { HttpMaclawClient } from "./client.js";
import { startTunnelProcess, stopTunnelProcess } from "./tunnel.js";
import type {
  Remote,
  RemoteActionResult,
  RemoteConnectOptions,
  RemoteConnection,
  RemotePrompter,
  RemoteRecipe,
  RemoteSetupResult,
} from "./types.js";

const unsupported = (action: string): RemoteActionResult => ({
  exitCode: 64,
  message: `${action} is not implemented for aws-ec2 remotes yet.`,
});

const getRemoteServerPort = (remote: RemoteConfig): number =>
  remote.remoteServerPort ?? defaultServerPort();

const getLocalForwardPort = (remote: RemoteConfig): number =>
  remote.localForwardPort ?? getRemoteServerPort(remote);

export const summarizeEc2Remote = (remote: RemoteConfig): string => {
  const metadata = remote.metadata as Ec2Config;
  return `aws-ec2 ${metadata.instanceId} (${metadata.region})`;
};

const buildEc2OriginMetadata = (
  target: string,
  remote: RemoteConfig,
): Record<string, string> => {
  const metadata = remote.metadata as Ec2Config;
  return {
    teleportMode: "aws-ec2",
    teleportTarget: target,
    teleportRemote: remote.name,
    teleportHost: metadata.instanceId,
  };
};

const createEc2Connection = async (
  target: string,
  remote: RemoteConfig,
  options: RemoteConnectOptions = {},
): Promise<RemoteConnection> => {
  const metadata = remote.metadata as Ec2Config;
  const args = [
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
  ];
  const baseUrl = `http://127.0.0.1:${getLocalForwardPort(remote)}`;
  const description = `${remote.name} (${metadata.instanceId} ${metadata.region})`;
  const tunnel = await startTunnelProcess("aws", args, description, options);
  const client = new HttpMaclawClient(baseUrl, {
    fetchFn: options.fetchFn,
  });
  let openTunnel: typeof tunnel | undefined = tunnel;

  return {
    buildOriginMetadata: () => buildEc2OriginMetadata(target, remote),
    close: async () => {
      if (!openTunnel) {
        return;
      }

      const activeTunnel = openTunnel;
      openTunnel = undefined;
      await stopTunnelProcess(activeTunnel);
    },
    describe: () => description,
    getMode: () => "aws-ec2",
    sendCommand: async (request) => await client.sendCommand(request),
  };
};

/**
 * Registered EC2 remote recipe.
 */
export const ec2RemoteRecipe: RemoteRecipe = {
  name: "aws-ec2",
  description: "Remote maclaw runtime accessed through AWS EC2 Session Manager.",
  exampleConfig: {
    name: "remote",
    provider: "aws-ec2",
    metadata: {
      region: "us-west-2",
      instanceId: "i-1234567890abcdef0",
    },
    remoteServerPort: defaultServerPort(),
    localForwardPort: defaultTeleportForwardPort(),
  },
  async setup(
    prompter: RemotePrompter,
    config?: RemoteConfig,
  ): Promise<RemoteSetupResult> {
    const existingMetadata =
      config?.provider === "aws-ec2"
        ? config.metadata as { instanceId?: string; region?: string }
        : {};

    prompter.print("EC2 remote setup:");
    const name = await prompter.askLine("Remote name", config?.name ?? "remote");
    const region = await prompter.askLine("AWS region", existingMetadata.region ?? "");
    const instanceId = await prompter.askLine(
      "Instance ID",
      existingMetadata.instanceId ?? "",
    );
    const remoteServerPort = await prompter.askInt(
      "Remote maclaw server port",
      config?.remoteServerPort ?? defaultServerPort(),
    );
    const localForwardPort = await prompter.askInt(
      "Local forwarded port",
      config?.localForwardPort ?? defaultTeleportForwardPort(),
    );

    return {
      name,
      provider: "aws-ec2",
      metadata: {
        region,
        instanceId,
      },
      remoteServerPort,
      localForwardPort,
    };
  },
  create(config: RemoteConfig): Remote {
    return createEc2Remote(config);
  },
};

/**
 * Concrete EC2 remote that supports teleport connection today.
 */
export const createEc2Remote = (config: RemoteConfig): Remote => ({
  config,
  async bootstrap() {
    return unsupported("bootstrap");
  },
  async start() {
    return unsupported("start");
  },
  async connect(options: RemoteConnectOptions = {}) {
    return await createEc2Connection(this.config.name, this.config, options);
  },
  async stop() {
    return unsupported("stop");
  },
});

/**
 * HTTP-backed remote lifecycle.
 *
 * This remote talks directly to an existing maclaw HTTP endpoint. It is meant
 * mainly for local use or access through a secure tunnel such as SSH port
 * forwarding. Plain HTTP is not encrypted; prefer tunneling or HTTPS for
 * non-local connections.
 */
import type { HttpConfig, RemoteConfig } from "../server-config.js";
import { HttpMaclawClient } from "./client.js";
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
  message: `${action} is not implemented for http remotes.`,
});

const noop = (action: string): RemoteActionResult => ({
  exitCode: 0,
  message: `${action} is a no-op for http remotes.`,
});

export const isHttpRemoteTarget = (value: string): boolean => /^https?:\/\//u.test(value.trim());

export const summarizeHttpRemote = (remote: RemoteConfig): string => {
  const metadata = remote.metadata as HttpConfig;
  return metadata.url;
};

const buildHttpOriginMetadata = (
  target: string,
  remote: RemoteConfig,
): Record<string, string> => {
  const metadata = remote.metadata as HttpConfig;
  const url = new URL(metadata.url);
  return {
    teleportMode: "http",
    teleportTarget: target,
    teleportRemote: remote.name,
    teleportHost: url.hostname,
  };
};

const createHttpConnection = (
  target: string,
  remote: RemoteConfig,
  options: RemoteConnectOptions = {},
): RemoteConnection => {
  const metadata = remote.metadata as HttpConfig;
  const client = new HttpMaclawClient(metadata.url, {
    fetchFn: options.fetchFn,
  });
  return {
    buildOriginMetadata: () => buildHttpOriginMetadata(target, remote),
    close: async () => {},
    describe: () => metadata.url,
    getMode: () => "http",
    sendCommand: async (request) => await client.sendCommand(request),
  };
};

/**
 * Registered HTTP remote recipe.
 */
export const httpRemoteRecipe: RemoteRecipe = {
  name: "http",
  description:
    "HTTP remote maclaw runtime. Intended mainly for local use or access through a secure tunnel such as SSH port forwarding. Plain HTTP is not encrypted; prefer tunneling or HTTPS for non-local connections.",
  exampleConfig: {
    name: "local-http",
    provider: "http",
    metadata: {
      url: "http://127.0.0.1:4001",
    },
  },
  async setup(
    prompter: RemotePrompter,
    config?: RemoteConfig,
  ): Promise<RemoteSetupResult> {
    const existingMetadata =
      config?.provider === "http"
        ? config.metadata as { url?: string }
        : {};

    prompter.print("HTTP remote setup:");
    prompter.print("  Plain HTTP is not encrypted.");
    prompter.print("  Prefer local use, HTTPS, or access through a secure tunnel.");
    const name = await prompter.askLine("Remote name", config?.name ?? "http-remote");
    const url = await prompter.askLine("Remote URL", existingMetadata.url ?? "http://127.0.0.1:4001");

    return {
      name,
      provider: "http",
      metadata: {
        url,
      },
    };
  },
  create(config: RemoteConfig): Remote {
    return createHttpRemote(config);
  },
};

/**
 * Create an ephemeral HTTP remote from a raw URL target.
 */
export const createHttpTargetRemote = (url: string): Remote =>
  createHttpRemote({
    name: url,
    provider: "http",
    metadata: {
      url,
    },
  });

/**
 * Concrete HTTP remote that connects directly to an existing HTTP endpoint.
 */
export const createHttpRemote = (config: RemoteConfig): Remote => ({
  config,
  async bootstrap() {
    return unsupported("bootstrap");
  },
  async start() {
    return noop("start");
  },
  async connect(options: RemoteConnectOptions = {}) {
    return createHttpConnection(this.config.name, this.config, options);
  },
  async stop() {
    return noop("stop");
  },
});

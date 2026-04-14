/**
 * SSH-backed remote lifecycle implementation.
 *
 * This module keeps the public SSH recipe and remote near the top, with shell
 * and tunnel details below.
 */
import { spawn } from "node:child_process";
import { logger } from "../logger.js";
import {
  defaultServerPort,
  defaultTeleportForwardPort,
  type RemoteConfig,
  type SshConfig,
} from "../server-config.js";
import { buildSshBootstrapCommand } from "./bootstrap.js";
import { buildRemoteServerStartCommand, buildRemoteServerStopCommand } from "./server-process.js";
import { createTunnelConnection } from "./tunnel.js";
import type {
  Remote,
  RemoteActionResult,
  RemoteConnectOptions,
  RemoteConnection,
  RemoteInitOptions,
  RemotePrompter,
  RemoteRecipe,
  RemoteSetupResult,
} from "./types.js";

/**
 * Registered SSH remote recipe.
 */
export const sshRemoteRecipe: RemoteRecipe = {
  name: "ssh",
  description: "Remote maclaw runtime accessed over SSH.",
  exampleConfig: {
    name: "remote",
    provider: "ssh",
    metadata: {
      host: "example.com",
      user: "alex",
      port: 22,
    },
    remoteServerPort: defaultServerPort(),
    localForwardPort: defaultTeleportForwardPort(),
  },
  async setup(
    prompter: RemotePrompter,
    config?: RemoteConfig,
  ): Promise<RemoteSetupResult> {
    const existingMetadata =
      config?.provider === "ssh"
        ? config.metadata as { host?: string; port?: number; user?: string }
        : {};

    prompter.print("SSH remote setup:");
    const name = await prompter.askLine("Remote name", config?.name ?? "remote");
    const host = await prompter.askLine("SSH host", existingMetadata.host ?? "");
    const user = await prompter.askLine(
      "SSH user (optional)",
      existingMetadata.user ?? "",
      { preserveBlank: true },
    );
    const port = await prompter.askInt("SSH port", existingMetadata.port ?? 22);
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
      provider: "ssh",
      metadata: {
        host,
        ...(user ? { user } : {}),
        port,
      },
      remoteServerPort,
      localForwardPort,
    };
  },
  create(config: RemoteConfig): Remote {
    return createSshRemote(config);
  },
};

/**
 * Concrete SSH remote that owns bootstrap/start and remote client creation.
 */
export function createSshRemote(config: RemoteConfig): Remote {
  return {
    config,
    async bootstrap(options?: RemoteInitOptions) {
      if (this.config.provider !== "ssh") {
        return unsupportedSshAction("bootstrap");
      }

      return await runSshCommand(
        this.config,
        buildSshBootstrapCommand(options?.project, options?.server, options?.bootstrap),
      );
    },
    async start(options?: RemoteInitOptions) {
      if (this.config.provider !== "ssh") {
        return unsupportedSshAction("start");
      }

      return await runSshCommand(
        this.config,
        buildRemoteServerStartCommand(
          this.config.remoteServerPort,
          options?.project,
          options?.server,
          options?.bootstrap,
        ),
      );
    },
    async connect(options: RemoteConnectOptions = {}) {
      return await createSshConnection(this.config.name, this.config, options);
    },
    async stop(options?: RemoteInitOptions) {
      if (this.config.provider !== "ssh") {
        return unsupportedSshAction("stop");
      }

      return await runSshCommand(
        this.config,
        buildRemoteServerStopCommand(options?.bootstrap),
      );
    },
  };
}

export function summarizeSshRemote(remote: RemoteConfig): string {
  const metadata = remote.metadata as SshConfig;
  return `${metadata.host}${metadata.port ? `:${metadata.port}` : ""}`;
}

function unsupportedSshAction(action: string): RemoteActionResult {
  return {
    exitCode: 64,
    message: `${action} only supports ssh remotes.`,
  };
}


function createSshConnection(
  target: string,
  remote: RemoteConfig,
  options: RemoteConnectOptions = {},
): Promise<RemoteConnection> {
  const metadata = remote.metadata as SshConfig;
  const args = [
    "-o",
    "ExitOnForwardFailure=yes",
    "-N",
    "-L",
    `${getLocalForwardPort(remote)}:127.0.0.1:${getRemoteServerPort(remote)}`,
    ...(metadata.port ? ["-p", String(metadata.port)] : []),
    sshDestination(remote),
  ];
  const baseUrl = `http://127.0.0.1:${getLocalForwardPort(remote)}`;
  const description = `${remote.name} (${sshDestination(remote)})`;

  return createTunnelConnection(
    "ssh",
    args,
    baseUrl,
    description,
    () => buildSshOriginMetadata(target, remote),
    "ssh",
    options,
  );
}

function buildSshOriginMetadata(
  target: string,
  remote: RemoteConfig,
): Record<string, string> {
  const metadata = remote.metadata as SshConfig;
  return {
    teleportMode: "ssh",
    teleportTarget: target,
    teleportRemote: remote.name,
    teleportHost: metadata.host,
  };
}

function sshDestination(remote: RemoteConfig): string {
  const metadata = remote.metadata as SshConfig;
  return metadata.user ? `${metadata.user}@${metadata.host}` : metadata.host;
}

function sshArgs(remote: RemoteConfig, command: string): string[] {
  const metadata = remote.metadata as SshConfig;
  return [
    ...(metadata.port ? ["-p", String(metadata.port)] : []),
    sshDestination(remote),
    "sh",
    "-lc",
    command,
  ];
}

function createSshShell(remote: RemoteConfig) {
  return {
    async run(command: string): Promise<RemoteActionResult> {
      logger.info("remote", "run", {
        name: remote.name,
        provider: remote.provider,
      });

      const child = spawn("ssh", sshArgs(remote, command), {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (chunk: Buffer | string) => {
        stdout += chunk.toString();
      });
      child.stderr?.on("data", (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });

      return await new Promise<RemoteActionResult>((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code, signal) => {
          const exitCode = code ?? (signal ? 1 : 0);
          const message = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n").trim();
          resolve({
            exitCode,
            message,
          });
        });
      });
    },
  };
}

function runSshCommand(
  remote: RemoteConfig,
  command: string,
): Promise<RemoteActionResult> {
  return createSshShell(remote).run(command);
}

function getRemoteServerPort(remote: RemoteConfig): number {
  return remote.remoteServerPort ?? defaultServerPort();
}

function getLocalForwardPort(remote: RemoteConfig): number {
  return remote.localForwardPort ?? getRemoteServerPort(remote);
}

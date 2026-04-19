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
import {
  buildDockerBootstrapCommand,
  buildDockerStartCommand,
  buildDockerStopCommand,
  isDockerRuntime,
} from "./docker.js";
import {
  buildRemoteReplStartCommand,
  buildRemoteServerStartCommand,
  buildRemoteServerStopCommand,
} from "./server-process.js";
import { createTunnelConnection } from "./tunnel.js";
import type {
  Remote,
  RemoteAttachOptions,
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
    client: "http",
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
    const runtimeKind = await prompter.askLine(
      "Runtime mode (host or docker)",
      config?.runtime?.kind ?? "host",
    );

    return {
      name,
      provider: "ssh",
      client: config?.client ?? "http",
      metadata: {
        host,
        ...(user ? { user } : {}),
        port,
      },
      remoteServerPort,
      localForwardPort,
      runtime: runtimeKind.trim() === "docker" ? { kind: "docker" } : { kind: "host" },
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
        isDockerRuntime(this.config)
          ? buildDockerBootstrapCommand(
              this.config,
              options?.project,
              options?.server,
              options?.bootstrap,
            )
          : buildSshBootstrapCommand(options?.project, options?.server, options?.bootstrap),
      );
    },
    async start(options?: RemoteInitOptions) {
      if (this.config.provider !== "ssh") {
        return unsupportedSshAction("start");
      }

      return await runSshCommand(
        this.config,
        isDockerRuntime(this.config)
          ? buildDockerStartCommand(
              this.config,
              this.config.remoteServerPort ?? defaultServerPort(),
              options?.project,
              options?.server,
              options?.bootstrap,
            )
          : buildRemoteServerStartCommand(
              this.config.remoteServerPort,
              options?.project,
              options?.server,
              options?.bootstrap,
            ),
      );
    },
    async connect(options: RemoteConnectOptions = {}) {
      if (this.config.client === "shell") {
        throw new Error("Shell remotes require an interactive /teleport session in the REPL.");
      }

      return await createSshConnection(this.config.name, this.config, options);
    },
    async attachShell(options: RemoteAttachOptions = {}) {
      return await runAttachedSshSession(this.config, options);
    },
    async stop(options?: RemoteInitOptions) {
      if (this.config.provider !== "ssh") {
        return unsupportedSshAction("stop");
      }

      return await runSshCommand(
        this.config,
        isDockerRuntime(this.config)
          ? buildDockerStopCommand(this.config)
          : buildRemoteServerStopCommand(options?.bootstrap),
      );
    },
  };
}

export function summarizeSshRemote(remote: RemoteConfig): string {
  const metadata = remote.metadata as SshConfig;
  return `${metadata.host}${metadata.port ? `:${metadata.port}` : ""}${isDockerRuntime(remote) ? " [docker]" : ""}`;
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

function createSshShell(
  remote: RemoteConfig,
  options: RemoteConnectOptions = {},
) {
  return {
    async run(command: string): Promise<RemoteActionResult> {
      logger.info("remote", "run", {
        name: remote.name,
        provider: remote.provider,
      });

      const child = createSshProcess(remote, command, options);

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

function createSshProcess(
  remote: RemoteConfig,
  command: string,
  options: RemoteConnectOptions | RemoteAttachOptions = {},
  stdio: "inherit" | ["pipe", "pipe", "pipe"] = ["pipe", "pipe", "pipe"],
) {
  const spawnFn = options.spawnFn ?? spawn;
  return spawnFn("ssh", sshArgs(remote, command), {
    stdio,
  });
}

function runSshCommand(
  remote: RemoteConfig,
  command: string,
  options: RemoteConnectOptions = {},
): Promise<RemoteActionResult> {
  return createSshShell(remote, options).run(command);
}

function runAttachedSshSession(
  remote: RemoteConfig,
  options: RemoteAttachOptions = {},
): Promise<RemoteActionResult> {
  logger.info("remote", "attach-shell", {
    name: remote.name,
    provider: remote.provider,
  });

  const child = createSshProcess(
    remote,
    buildRemoteReplStartCommand(remote.name),
    options,
    "inherit",
  );
  return waitForAttachedProcess(child, "SSH shell session exited.");
}

function waitForAttachedProcess(
  child: ReturnType<typeof createSshProcess>,
  defaultMessage: string,
): Promise<RemoteActionResult> {
  return new Promise<RemoteActionResult>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      resolve({
        exitCode: code ?? (signal ? 1 : 0),
        message: signal ? `${defaultMessage} (${signal})` : defaultMessage,
      });
    });
  });
}

function getRemoteServerPort(remote: RemoteConfig): number {
  return remote.remoteServerPort ?? defaultServerPort();
}

function getLocalForwardPort(remote: RemoteConfig): number {
  return remote.localForwardPort ?? getRemoteServerPort(remote);
}

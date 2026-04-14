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
import { DEFAULT_REMOTE_REPO_URL, DEFAULT_REMOTE_WORKSPACE } from "./constants.js";
import { createTunnelConnection } from "./tunnel.js";
import type {
  Remote,
  RemoteActionResult,
  RemoteConnectOptions,
  RemoteConnection,
  RemotePrompter,
  RemoteRecipe,
  RemoteSetupResult,
} from "./types.js";


function buildSshBootstrapCommand(): string {
  return shellLines([
    "set -e",
    "command -v node >/dev/null 2>&1 || { echo 'node is required'; exit 1; }",
    "command -v npm >/dev/null 2>&1 || { echo 'npm is required'; exit 1; }",
    "command -v git >/dev/null 2>&1 || { echo 'git is required'; exit 1; }",
    `mkdir -p ${DEFAULT_REMOTE_WORKSPACE}`,
    `cd ${DEFAULT_REMOTE_WORKSPACE}`,
    "if [ ! -f package.json ]; then",
    "  if [ -n \"$(ls -A . 2>/dev/null)\" ]; then",
    `    echo 'workspace is not a maclaw repo and is not empty: ${DEFAULT_REMOTE_WORKSPACE}'`,
    "    exit 2",
    "  fi",
    `  git clone ${DEFAULT_REMOTE_REPO_URL} .`,
    "fi",
    "npm install",
    "npm run build",
  ]);
}

function buildSshStartCommand(remote: RemoteConfig): string {
  return shellLines([
    "set -e",
    `cd ${DEFAULT_REMOTE_WORKSPACE}`,
    "mkdir -p .maclaw",
    `nohup npm start -- server --api-only --port ${remote.remoteServerPort ?? defaultServerPort()} >> .maclaw/server.log 2>&1 < /dev/null &`,
    `echo 'started maclaw server on port ${remote.remoteServerPort ?? defaultServerPort()}'`,
  ]);
}

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
    async bootstrap() {
      if (this.config.provider !== "ssh") {
        return unsupportedSshAction("bootstrap");
      }

      return await runSshCommand(this.config, buildSshBootstrapCommand());
    },
    async start() {
      if (this.config.provider !== "ssh") {
        return unsupportedSshAction("start");
      }

      return await runSshCommand(this.config, buildSshStartCommand(this.config));
    },
    async connect(options: RemoteConnectOptions = {}) {
      return await createSshConnection(this.config.name, this.config, options);
    },
    async stop() {
      return {
        exitCode: 64,
        message: "stop is not implemented for ssh remotes yet.",
      };
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


function shellLines(lines: string[]): string {
  return lines.join("\n");
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

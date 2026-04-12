/**
 * Remote access interfaces shared by teleport and future remote lifecycle work.
 *
 * These are intentionally lightweight for now. Teleport transport already owns
 * "how do we connect a local client to a remote runtime?", while these types
 * outline the sibling concepts we expect to add next:
 * - `RemoteExecutor`: run a shell command on a remote host
 * - `RemoteRecipe`: describe how to bootstrap/start/stop maclaw remotely
 * - `RemoteAccess`: group the executor and transport capabilities for one
 *   remote provider
 */
import { spawn } from "node:child_process";
import { logger } from "../logger.js";
import { defaultServerPort, type RemoteConfig } from "../server-config.js";
import type { TeleportOptions } from "./options.js";
import { createTransport as createTeleportTransport } from "./transport.js";
import { RemoteRuntimeClient } from "./runtime.js";
import type { TeleportTransport } from "./transport.js";

export type RemoteActionResult = {
  exitCode: number;
  message: string;
};

/**
 * Run a one-shot remote shell command.
 */
export type RemoteExecutor = {
  run(command: string): Promise<RemoteActionResult>;
};

/**
 * Remote lifecycle recipe such as bootstrap/start/stop.
 */
export type RemoteRecipe = {
  description: string;
  name: string;
  remote: RemoteConfig;
  executor: RemoteExecutor;
  bootstrap(): Promise<RemoteActionResult>;
  start(): Promise<RemoteActionResult>;
  stop?(): Promise<RemoteActionResult>;
};

/**
 * Provider-specific remote access primitives.
 */
export type RemoteAccess = {
  remote: RemoteConfig;
  createExecutor(): RemoteExecutor;
  createRecipe(name?: string): RemoteRecipe;
  createTransport(options?: TeleportOptions): TeleportTransport;
};

const defaultRemoteWorkspace = "~/maclaw";

const shellLines = (lines: string[]): string => lines.join("\n");

/**
 * Default SSH recipe for preparing a remote maclaw workspace and starting the
 * API server from that workspace.
 */
export const createSshBootstrapRecipe = (
  remote: RemoteConfig,
  executor: RemoteExecutor,
  name = "ssh-bootstrap",
): RemoteRecipe => {
  const port = remote.remoteServerPort ?? defaultServerPort();
  const workspace = defaultRemoteWorkspace;

  return {
    name,
    description: "Prepare a maclaw workspace over SSH and start the remote API server.",
    remote,
    executor,
    async bootstrap() {
      if (remote.provider !== "ssh") {
        return {
          exitCode: 64,
          message: `Recipe ${name} only supports ssh remotes.`,
        };
      }

      return await executor.run(shellLines([
        "set -e",
        "command -v node >/dev/null 2>&1 || { echo 'node is required'; exit 1; }",
        "command -v npm >/dev/null 2>&1 || { echo 'npm is required'; exit 1; }",
        `mkdir -p ${workspace}`,
        `cd ${workspace}`,
        "if [ ! -f package.json ]; then",
        "  echo 'Place the maclaw source tree in ~/maclaw before bootstrapping.'",
        "  exit 2",
        "fi",
        "npm install",
        "npm run build",
      ]));
    },
    async start() {
      if (remote.provider !== "ssh") {
        return {
          exitCode: 64,
          message: `Recipe ${name} only supports ssh remotes.`,
        };
      }

      return await executor.run(shellLines([
        "set -e",
        `cd ${workspace}`,
        "mkdir -p .maclaw",
        `nohup npm start -- server --api-only --port ${port} >> .maclaw/server.log 2>&1 < /dev/null &`,
        `echo 'started maclaw server on port ${port}'`,
      ]));
    },
  };
};

const sshDestination = (remote: RemoteConfig): string => {
  const metadata = remote.metadata as {
    host: string;
    port?: number;
    user?: string;
  };
  return metadata.user ? `${metadata.user}@${metadata.host}` : metadata.host;
};

const sshArgs = (remote: RemoteConfig, command: string): string[] => {
  const metadata = remote.metadata as {
    port?: number;
  };
  return [
    ...(metadata.port ? ["-p", String(metadata.port)] : []),
    sshDestination(remote),
    "sh",
    "-lc",
    command,
  ];
};

const createSshExecutor = (remote: RemoteConfig): RemoteExecutor => ({
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
});

/**
 * Concrete SSH remote access that can execute remote shell commands, create the
 * default SSH bootstrap recipe, and open a teleport transport.
 */
export const createSshRemoteAccess = (remote: RemoteConfig): RemoteAccess => ({
  remote,
  createExecutor() {
    return createSshExecutor(remote);
  },
  createRecipe(name?: string) {
    return createSshBootstrapRecipe(remote, createSshExecutor(remote), name);
  },
  createTransport(options: TeleportOptions = {}) {
    return createTeleportTransport(
      remote.name,
      remote,
      options.tunnel ?? {},
      (baseUrl) => new RemoteRuntimeClient(baseUrl, options.runtime ?? {}),
    );
  },
});

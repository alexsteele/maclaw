/**
 * AWS EC2-backed remote lifecycle.
 *
 * This keeps EC2 provider behavior in its own file while reusing the existing
 * tunnel and HTTP client helpers from `src/remote`.
 */
import { spawn } from "node:child_process";
import { logger } from "../logger.js";
import {
  defaultServerPort,
  defaultTeleportForwardPort,
  type Ec2Config,
  type RemoteConfig,
} from "../server-config.js";
import { buildEc2BootstrapCommand } from "./bootstrap.js";
import {
  buildDockerBootstrapCommand,
  buildDockerStartCommand,
  buildDockerStopCommand,
  isDockerRuntime,
} from "./docker.js";
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
 * Registered EC2 remote recipe.
 */
export const ec2RemoteRecipe: RemoteRecipe = {
  name: "aws-ec2",
  description: "Remote maclaw runtime accessed through AWS EC2 Session Manager.",
  exampleConfig: {
    name: "remote",
    provider: "aws-ec2",
    client: "http",
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
    const runtimeKind = await prompter.askLine(
      "Runtime mode (host or docker)",
      config?.runtime?.kind ?? "host",
    );

    return {
      name,
      provider: "aws-ec2",
      client: config?.client ?? "http",
      metadata: {
        region,
        instanceId,
      },
      remoteServerPort,
      localForwardPort,
      runtime: runtimeKind.trim() === "docker" ? { kind: "docker" } : { kind: "host" },
    };
  },
  create(config: RemoteConfig): Remote {
    return createEc2Remote(config);
  },
};

/**
 * Concrete EC2 remote that supports remote client creation today.
 */
export function createEc2Remote(config: RemoteConfig): Remote {
  return {
    config,
    async bootstrap(options?: RemoteInitOptions) {
      return await runEc2Bootstrap(this.config, options);
    },
    async start(options?: RemoteInitOptions) {
      return await runEc2ShellCommand(
        this.config,
        (
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
              )
        ).split("\n"),
        `maclaw start ${this.config.name}`,
      );
    },
    async connect(options: RemoteConnectOptions = {}) {
      return await createEc2Connection(this.config.name, this.config, options);
    },
    async stop(options?: RemoteInitOptions) {
      return await runEc2ShellCommand(
        this.config,
        (
          isDockerRuntime(this.config)
            ? buildDockerStopCommand(this.config)
            : buildRemoteServerStopCommand(options?.bootstrap)
        ).split("\n"),
        `maclaw stop ${this.config.name}`,
      );
    },
  };
}

export function summarizeEc2Remote(remote: RemoteConfig): string {
  const metadata = remote.metadata as Ec2Config;
  return `aws-ec2 ${metadata.instanceId} (${metadata.region})${isDockerRuntime(remote) ? " [docker]" : ""}`;
}

async function runEc2Bootstrap(
  remote: RemoteConfig,
  options?: RemoteInitOptions,
): Promise<RemoteActionResult> {
  return await runEc2ShellCommand(
    remote,
    (
      isDockerRuntime(remote)
        ? buildDockerBootstrapCommand(
            remote,
            options?.project,
            options?.server,
            options?.bootstrap,
            true,
          )
        : buildEc2BootstrapCommand(
            options?.project,
            options?.server,
            options?.bootstrap,
          )
    ).split("\n"),
    `maclaw bootstrap ${remote.name}`,
  );
}

async function runEc2ShellCommand(
  remote: RemoteConfig,
  commands: string[],
  comment: string,
): Promise<RemoteActionResult> {
  const commandId = await sendEc2ShellCommand(remote, commands, comment);
  if (typeof commandId !== "string") {
    return commandId;
  }

  return await waitForEc2Command(remote, commandId);
}

async function waitForEc2Command(
  remote: RemoteConfig,
  commandId: string,
): Promise<RemoteActionResult> {
  const metadata = remote.metadata as Ec2Config;

  for (let attempt = 0; attempt < 120; attempt += 1) {
    const result = await runAwsCli(remote, [
      "ssm",
      "get-command-invocation",
      "--region",
      metadata.region,
      "--instance-id",
      metadata.instanceId,
      "--command-id",
      commandId,
      "--output",
      "json",
    ]);

    if (result.exitCode !== 0) {
      const message = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n");
      if (/InvocationDoesNotExist/u.test(message) && attempt < 5) {
        await sleep(1000);
        continue;
      }

      return {
        exitCode: result.exitCode,
        message,
      };
    }

    const parsed = JSON.parse(result.stdout) as {
      ResponseCode?: number;
      StandardErrorContent?: string;
      StandardOutputContent?: string;
      Status?: string;
      StatusDetails?: string;
    };
    const status = parsed.Status ?? parsed.StatusDetails ?? "Unknown";

    if (status === "Pending" || status === "InProgress" || status === "Delayed") {
      await sleep(1000);
      continue;
    }

    const output = [parsed.StandardOutputContent, parsed.StandardErrorContent]
      .filter((value): value is string => Boolean(value && value.trim().length > 0))
      .map((value) => value.trim())
      .join("\n");

    if (status === "Success") {
      return {
        exitCode: 0,
        message: output,
      };
    }

    return {
      exitCode: parsed.ResponseCode && parsed.ResponseCode >= 0 ? parsed.ResponseCode : 1,
      message: [status, output].filter(Boolean).join("\n"),
    };
  }

  return {
    exitCode: 124,
    message: `Timed out waiting for EC2 command ${commandId}.`,
  };
}

async function sendEc2ShellCommand(
  remote: RemoteConfig,
  commands: string[],
  comment: string,
): Promise<string | RemoteActionResult> {
  const metadata = remote.metadata as Ec2Config;
  const result = await runAwsCli(remote, [
    "ssm",
    "send-command",
    "--region",
    metadata.region,
    "--instance-ids",
    metadata.instanceId,
    "--document-name",
    "AWS-RunShellScript",
    "--comment",
    comment,
    "--parameters",
    JSON.stringify({ commands }),
    "--output",
    "json",
  ]);
  if (result.exitCode !== 0) {
    return {
      exitCode: result.exitCode,
      message: [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n"),
    };
  }

  const parsed = JSON.parse(result.stdout) as {
    Command?: { CommandId?: string };
  };
  const commandId = parsed.Command?.CommandId?.trim();
  if (!commandId) {
    return {
      exitCode: 1,
      message: "AWS send-command did not return a command id.",
    };
  }

  return commandId;
}

async function runAwsCli(
  remote: RemoteConfig,
  args: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  logger.info("remote", "aws-cli", {
    name: remote.name,
    provider: remote.provider,
    args: args.join("\n"),
  });

  const child = spawn("aws", args, {
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

  return await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      resolve({
        exitCode: code ?? (signal ? 1 : 0),
        stdout,
        stderr,
      });
    });
  });
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function createEc2Connection(
  target: string,
  remote: RemoteConfig,
  options: RemoteConnectOptions = {},
): Promise<RemoteConnection> {
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

  return createTunnelConnection(
    "aws",
    args,
    baseUrl,
    description,
    () => buildEc2OriginMetadata(target, remote),
    "aws-ec2",
    options,
  );
}

function getRemoteServerPort(remote: RemoteConfig): number {
  return remote.remoteServerPort ?? defaultServerPort();
}

function getLocalForwardPort(remote: RemoteConfig): number {
  return remote.localForwardPort ?? getRemoteServerPort(remote);
}

function buildEc2OriginMetadata(
  target: string,
  remote: RemoteConfig,
): Record<string, string> {
  const metadata = remote.metadata as Ec2Config;
  return {
    teleportMode: "aws-ec2",
    teleportTarget: target,
    teleportRemote: remote.name,
    teleportHost: metadata.instanceId,
  };
}

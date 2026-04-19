/**
 * High-level teleport controller for interactive clients.
 *
 * This controller manages one attached teleport session for the REPL or
 * server-backed chat channels.
 */
import { logger } from "../logger.js";
import type { RemoteCommandResponse } from "../remote/client.js";
import { createRemote, findRemoteConfig } from "../remote/index.js";
import type { RemoteActionResult } from "../remote/index.js";
import type { RemoteConfig, ServerConfig } from "../server-config.js";
import type { TeleportOptions } from "./options.js";
import { TeleportSession, type TeleportTarget } from "./session.js";

export class TeleportController {
  private readonly config?: Pick<ServerConfig, "remotes">;
  private readonly options: TeleportOptions;
  private attachedTarget?: TeleportTarget;
  private session?: TeleportSession;

  constructor(
    config?: Pick<ServerConfig, "remotes">,
    options: TeleportOptions = {},
  ) {
    this.config = config;
    this.options = options;
  }

  isAttached(): boolean {
    return this.attachedTarget !== undefined;
  }

  getTarget(): TeleportTarget | undefined {
    return this.attachedTarget;
  }

  listRemotes(): RemoteConfig[] {
    return [...(this.config?.remotes ?? [])];
  }

  isShellTarget(target: string): boolean {
    return findRemoteConfig(this.config ?? {}, target)?.client === "shell";
  }

  async connect(
    target: string,
    options: Pick<TeleportTarget, "chatId" | "project">,
  ): Promise<TeleportTarget> {
    await this.disconnect();

    const session = new TeleportSession(target, this.config, this.options);
    await session.start();

    this.session = session;
    this.attachedTarget = {
      target,
      project: options.project,
      chatId: options.chatId,
    };
    logger.info("teleport", "attached", {
      target,
      project: options.project ?? "(default)",
      chatId: options.chatId,
    });
    return this.attachedTarget;
  }

  async disconnect(): Promise<boolean> {
    const target = this.attachedTarget?.target;
    this.attachedTarget = undefined;
    if (!this.session) {
      return false;
    }

    const session = this.session;
    this.session = undefined;
    await session.stop();
    logger.info("teleport", "detached", {
      target,
    });
    return true;
  }

  async sendMessage(text: string): Promise<RemoteCommandResponse | null> {
    if (!this.session || !this.attachedTarget) {
      return null;
    }

    return await this.session.sendCommand({
      project: this.attachedTarget.project,
      chatId: this.attachedTarget.chatId,
      text,
    });
  }

  async attachShell(target: string): Promise<RemoteActionResult> {
    const remoteConfig = findRemoteConfig(this.config ?? {}, target);
    if (!remoteConfig) {
      throw new Error(`Unknown remote: ${target}`);
    }

    if (remoteConfig.client !== "shell") {
      throw new Error(`Remote ${target} is not configured with client: shell.`);
    }

    await this.disconnect();
    const remote = createRemote(remoteConfig);
    if (!remote.attachShell) {
      throw new Error(`Remote ${target} does not support attached shell sessions.`);
    }

    logger.info("teleport", "attach-shell", {
      target,
    });
    const result = await remote.attachShell({
      spawnFn: this.options.tunnel?.spawnFn,
    });
    logger.info("teleport", "detach-shell", {
      target,
      exitCode: result.exitCode,
    });
    return result;
  }
}

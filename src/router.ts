/**
 * Notification routing for shared harness, server, and REPL flows.
 *
 * The router resolves destination intent like `origin` or `{ channel: "email" }`
 * into an actual channel target and sends the notification through that channel.
 */
import type { Channel } from "./channels/channel.js";
import type { ServerConfig } from "./server-config.js";
import type {
  ChannelTarget,
  NotificationDestination,
  NotificationTarget,
  Origin,
} from "./types.js";

export type RoutedNotification = {
  target: NotificationDestination;
  origin?: Origin;
  kind?: string;
  text: string;
};

export interface NotificationRouter {
  send(
    notification: RoutedNotification,
  ): Promise<{ delivered: boolean; target?: ChannelTarget }>;
  listChannels(origin?: Origin): string[];
}

export class NoopRouter implements NotificationRouter {
  private normalizeTarget(target: NotificationDestination): NotificationTarget {
    if (typeof target !== "string") {
      return target;
    }

    return target === "origin" || target === "inbox" ? target : { channel: target };
  }

  async send(
    notification: RoutedNotification,
  ): Promise<{ delivered: boolean; target?: ChannelTarget }> {
    const target = this.normalizeTarget(notification.target);

    if (target === "inbox") {
      return {
        delivered: true,
        target: {
          channel: "inbox",
          userId: "local",
        },
      };
    }

    if (target === "origin") {
      return {
        delivered: false,
        target: notification.origin,
      };
    }

    if ("userId" in target) {
      return {
        delivered: false,
        target,
      };
    }

    return { delivered: false };
  }

  listChannels(origin?: Origin): string[] {
    const channels = new Set(["inbox", "origin"]);
    if (origin?.channel) {
      channels.add(origin.channel);
    }

    return [...channels];
  }
}

export class ChannelRouter implements NotificationRouter {
  private readonly config: ServerConfig;
  private readonly channels: Map<string, Channel>;

  constructor(config: ServerConfig, channels: Map<string, Channel>) {
    this.config = config;
    this.channels = channels;
  }

  private normalizeTarget(target: NotificationDestination): NotificationTarget {
    if (typeof target !== "string") {
      return target;
    }

    return target === "origin" || target === "inbox" ? target : { channel: target };
  }

  private resolve(
    target: NotificationDestination,
    origin?: Origin,
  ): ChannelTarget | undefined {
    const normalizedTarget = this.normalizeTarget(target);

    if (normalizedTarget === "origin") {
      return origin;
    }

    if (normalizedTarget === "inbox") {
      return {
        channel: "inbox",
        userId: "local",
      };
    }

    if ("userId" in normalizedTarget) {
      return normalizedTarget;
    }

    if (origin?.channel === normalizedTarget.channel) {
      return origin;
    }

    if (normalizedTarget.channel === "email" && this.config.channels?.email?.enabled) {
      const recipient = this.config.channels.email.to ?? this.config.channels.email.from;
      if (!recipient) {
        return undefined;
      }

      return {
        channel: "email",
        userId: recipient,
      };
    }

    return undefined;
  }

  async send(
    notification: RoutedNotification,
  ): Promise<{ delivered: boolean; target?: ChannelTarget }> {
    const target = await this.resolve(notification.target, notification.origin);
    if (!target) {
      return { delivered: false };
    }

    if (target.channel === "inbox") {
      return { delivered: true, target };
    }

    const channel = this.channels.get(target.channel);
    if (!channel) {
      return { delivered: false };
    }

    await channel.send(target, notification.text);
    return { delivered: true, target };
  }

  listChannels(origin?: Origin): string[] {
    const channels = new Set(["inbox", "origin", ...this.channels.keys()]);
    if (origin?.channel) {
      channels.add(origin.channel);
    }

    return [...channels].sort();
  }
}

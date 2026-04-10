/**
 * Notification routing for shared harness, server, and REPL flows.
 *
 * The router resolves destination intent like `origin` or `{ channel: "email" }`
 * into an actual channel target and sends the notification through that channel.
 */
import type { Channel } from "./channels/channel.js";
import type { ServerConfig } from "./server-config.js";
import type { ChannelTarget, NotificationTarget, Origin } from "./types.js";

export type RoutedNotification = {
  target: NotificationTarget;
  origin?: Origin;
  kind?: string;
  text: string;
};

export interface NotificationRouter {
  send(
    notification: RoutedNotification,
  ): Promise<{ delivered: boolean; target?: ChannelTarget }>;
}

export class NoopRouter implements NotificationRouter {
  async send(
    notification: RoutedNotification,
  ): Promise<{ delivered: boolean; target?: ChannelTarget }> {
    if (notification.target === "inbox") {
      return {
        delivered: true,
        target: {
          channel: "inbox",
          userId: "local",
        },
      };
    }

    if (notification.target === "origin") {
      return {
        delivered: false,
        target: notification.origin,
      };
    }

    if ("userId" in notification.target) {
      return {
        delivered: false,
        target: notification.target,
      };
    }

    return { delivered: false };
  }
}

export class ChannelRouter implements NotificationRouter {
  private readonly config: ServerConfig;
  private readonly channels: Map<string, Channel>;

  constructor(config: ServerConfig, channels: Map<string, Channel>) {
    this.config = config;
    this.channels = channels;
  }

  private resolve(
    target: NotificationTarget,
    origin?: Origin,
  ): ChannelTarget | undefined {
    if (target === "origin") {
      return origin;
    }

    if (target === "inbox") {
      return {
        channel: "inbox",
        userId: "local",
      };
    }

    if ("userId" in target) {
      return target;
    }

    if (origin?.channel === target.channel) {
      return origin;
    }

    if (target.channel === "email" && this.config.channels?.email?.enabled) {
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
}

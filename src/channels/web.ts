/**
 * Web portal channel used by the server-hosted browser UI.
 *
 * This channel uses server-sent events (SSE) for outbound notifications.
 */
import type { ServerResponse } from "node:http";
import type { Channel, ChannelMessageHandler } from "./channel.js";
import type { Origin } from "../types.js";

const webRouteKey = (origin: Pick<Origin, "conversationId" | "userId">): string =>
  `${origin.conversationId ?? ""}:${origin.userId}`;

export class WebChannel implements Channel {
  readonly name = "web";
  private readonly subscribers = new Map<string, Set<ServerResponse>>();

  async start(_messageHandler?: ChannelMessageHandler): Promise<void> {
    return;
  }

  async stop(): Promise<void> {
    for (const responses of this.subscribers.values()) {
      for (const response of responses) {
        response.end();
      }
    }

    this.subscribers.clear();
  }

  subscribe(origin: Origin, response: ServerResponse): void {
    const routeKey = webRouteKey(origin);
    const responses = this.subscribers.get(routeKey) ?? new Set<ServerResponse>();
    responses.add(response);
    this.subscribers.set(routeKey, responses);

    response.statusCode = 200;
    response.setHeader("content-type", "text/event-stream; charset=utf-8");
    response.setHeader("cache-control", "no-cache, no-transform");
    response.setHeader("connection", "keep-alive");
    response.write("event: ready\ndata: {}\n\n");

    response.on("close", () => {
      const currentResponses = this.subscribers.get(routeKey);
      if (!currentResponses) {
        return;
      }

      currentResponses.delete(response);
      if (currentResponses.size === 0) {
        this.subscribers.delete(routeKey);
      }
    });
  }

  async send(origin: Origin, text: string): Promise<void> {
    const responses = this.subscribers.get(webRouteKey(origin));
    if (!responses || responses.size === 0) {
      return;
    }

    const payload = JSON.stringify({
      text,
      timestamp: new Date().toISOString(),
    });
    for (const response of responses) {
      response.write(`event: notification\ndata: ${payload}\n\n`);
    }
  }
}

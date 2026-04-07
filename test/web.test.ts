import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import type { ServerResponse } from "node:http";
import { WebChannel } from "../src/channels/web.js";

class FakeServerResponse extends EventEmitter {
  statusCode?: number;
  headers = new Map<string, string>();
  writes: string[] = [];
  ended = false;

  setHeader(name: string, value: string): void {
    this.headers.set(name, value);
  }

  write(chunk: string): void {
    this.writes.push(chunk);
  }

  end(): void {
    this.ended = true;
  }
}

test("WebChannel subscribes an SSE client and sends notifications", async () => {
  const channel = new WebChannel();
  const response = new FakeServerResponse();

  channel.subscribe(
    {
      channel: "web",
      conversationId: "portal:home",
      userId: "web",
    },
    response as unknown as ServerResponse,
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers.get("content-type"), "text/event-stream; charset=utf-8");
  assert.match(response.writes.join(""), /event: ready/u);

  await channel.send(
    {
      channel: "web",
      conversationId: "portal:home",
      userId: "web",
    },
    "Agent planner completed.",
  );

  assert.match(response.writes.join(""), /event: notification/u);
  assert.match(response.writes.join(""), /Agent planner completed\./u);
});

test("WebChannel does not send notifications to a different portal route", async () => {
  const channel = new WebChannel();
  const response = new FakeServerResponse();

  channel.subscribe(
    {
      channel: "web",
      conversationId: "portal:home",
      userId: "web",
    },
    response as unknown as ServerResponse,
  );

  const initialWrites = response.writes.length;
  await channel.send(
    {
      channel: "web",
      conversationId: "portal:work",
      userId: "web",
    },
    "Task Daily Brief completed.",
  );

  assert.equal(response.writes.length, initialWrites);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  createDiscordHeartbeatPayload,
  createDiscordIdentifyPayload,
  extractDiscordTextEvent,
} from "../src/channels/discord.js";

test("extractDiscordTextEvent returns a DM message as a normalized text event", () => {
  const event = extractDiscordTextEvent({
    op: 0,
    t: "MESSAGE_CREATE",
    d: {
      author: {
        id: "123",
      },
      channel_id: "456",
      content: "hello there",
    },
  });

  assert.deepEqual(event, {
    channelId: "456",
    text: "hello there",
    userId: "discord-123",
  });
});

test("extractDiscordTextEvent ignores guild messages for now", () => {
  const event = extractDiscordTextEvent({
    op: 0,
    t: "MESSAGE_CREATE",
    d: {
      author: {
        id: "123",
      },
      channel_id: "456",
      guild_id: "789",
      content: "hello there",
    },
  });

  assert.equal(event, null);
});

test("createDiscordIdentifyPayload builds a gateway identify payload", () => {
  const payload = JSON.parse(createDiscordIdentifyPayload("BotToken")) as {
    d?: { intents?: number; token?: string };
    op?: number;
  };

  assert.equal(payload.op, 2);
  assert.equal(payload.d?.token, "BotToken");
  assert.equal(payload.d?.intents, 1 << 12);
});

test("createDiscordHeartbeatPayload builds a heartbeat payload", () => {
  assert.equal(
    createDiscordHeartbeatPayload(42),
    JSON.stringify({ op: 1, d: 42 }),
  );
});

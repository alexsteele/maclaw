import assert from "node:assert/strict";
import test from "node:test";
import {
  createSlackSocketAck,
  extractSlackTextEvent,
} from "../src/channels/slack.js";

test("extractSlackTextEvent returns an app mention as a normalized text event", () => {
  const event = extractSlackTextEvent(
    {
      type: "event_callback",
      team_id: "T123",
      event: {
        type: "app_mention",
        user: "U123",
        channel: "C123",
        text: "<@U999> hello there",
        ts: "171234.5678",
      },
    },
    {},
  );

  assert.deepEqual(event, {
    channel: "C123",
    teamId: "T123",
    text: "hello there",
    threadTs: "171234.5678",
    userId: "slack-T123-U123",
  });
});

test("extractSlackTextEvent ignores bot events", () => {
  const event = extractSlackTextEvent(
    {
      type: "event_callback",
      team_id: "T123",
      event: {
        type: "message",
        bot_id: "B123",
        channel: "C123",
        text: "hello",
        user: "U123",
      },
    },
    {},
  );

  assert.equal(event, null);
});

test("createSlackSocketAck builds a valid Socket Mode ack payload", () => {
  assert.equal(
    createSlackSocketAck("123.abc"),
    JSON.stringify({ envelope_id: "123.abc" }),
  );
});

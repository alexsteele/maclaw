import { createHmac } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import {
  extractSlackTextEvent,
  verifySlackSignature,
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

test("verifySlackSignature validates a matching v0 signature", () => {
  const body = JSON.stringify({ hello: "world" });
  const signingSecret = "secret";
  const timestamp = "1712345678";
  const base = `v0:${timestamp}:${body}`;
  const digest = createHmac("sha256", signingSecret)
    .update(base)
    .digest("hex");

  const valid = verifySlackSignature(
    body,
    {
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature": `v0=${digest}`,
    },
    signingSecret,
    1712345678,
  );

  assert.equal(valid, true);
});

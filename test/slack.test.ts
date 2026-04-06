import assert from "node:assert/strict";
import test from "node:test";
import {
  createSlackSocketAck,
  extractSlackTextEvent,
  SlackChannel,
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

test("SlackChannel.send posts to the origin conversation and thread", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body?: string }> = [];

  try {
    globalThis.fetch = (async (input, init) => {
      calls.push({
        url: String(input),
        body: typeof init?.body === "string" ? init.body : undefined,
      });

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    const channel = new SlackChannel(
      { enabled: true },
      { appToken: "xapp-test", botToken: "xoxb-test" },
    );

    await channel.send(
      {
        channel: "slack",
        conversationId: "C123",
        userId: "slack-T123-U123",
        threadId: "171234.5678",
      },
      "hello back",
    );

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, "https://slack.com/api/chat.postMessage");
    assert.match(calls[0]?.body ?? "", /"channel":"C123"/u);
    assert.match(calls[0]?.body ?? "", /"thread_ts":"171234\.5678"/u);
    assert.match(calls[0]?.body ?? "", /"text":"hello back"/u);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

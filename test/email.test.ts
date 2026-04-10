import assert from "node:assert/strict";
import test from "node:test";
import { EmailChannel } from "../src/channels/email.js";

test("EmailChannel.send sends to the origin email address", async () => {
  const calls: Array<{ from: string; to: string; text: string }> = [];
  const channel = new EmailChannel(
    {
      enabled: true,
      from: "maclaw@example.com",
      to: "configured@example.com",
      host: "smtp.example.com",
      port: 587,
      startTls: true,
    },
    {
      smtpUser: "maclaw@example.com",
      smtpPassword: "app-password",
    },
    () => ({
      send: async (from, to, text) => {
        calls.push({ from, to, text });
      },
    }),
  );

  await channel.start();
  await channel.send(
    {
      channel: "email",
      userId: "alex@example.com",
    },
    "hello from maclaw",
  );

  assert.deepEqual(calls, [
    {
      from: "maclaw@example.com",
      to: "alex@example.com",
      text: "hello from maclaw",
    },
  ]);
});

test("EmailChannel.send falls back to configured to or from", async () => {
  const calls: Array<{ from: string; to: string; text: string }> = [];
  const channel = new EmailChannel(
    {
      enabled: true,
      from: "maclaw@example.com",
      to: "configured@example.com",
      host: "smtp.example.com",
      port: 587,
      startTls: true,
    },
    {
      smtpUser: "maclaw@example.com",
      smtpPassword: "app-password",
    },
    () => ({
      send: async (from, to, text) => {
        calls.push({ from, to, text });
      },
    }),
  );

  await channel.start();
  await channel.send(
    {
      channel: "email",
      userId: "local",
    },
    "hello from maclaw",
  );

  assert.deepEqual(calls, [
    {
      from: "maclaw@example.com",
      to: "configured@example.com",
      text: "hello from maclaw",
    },
  ]);
});

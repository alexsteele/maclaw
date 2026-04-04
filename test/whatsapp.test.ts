import assert from "node:assert/strict";
import test from "node:test";
import { extractWhatsAppTextEvents } from "../src/whatsapp.js";

test("extractWhatsAppTextEvents returns inbound text messages", () => {
  const events = extractWhatsAppTextEvents({
    entry: [
      {
        changes: [
          {
            value: {
              messages: [
                {
                  from: "15551234567",
                  type: "text",
                  text: {
                    body: "hello there",
                  },
                },
              ],
            },
          },
        ],
      },
    ],
  });

  assert.deepEqual(events, [
    {
      from: "15551234567",
      text: "hello there",
    },
  ]);
});

test("extractWhatsAppTextEvents ignores non-text webhook entries", () => {
  const events = extractWhatsAppTextEvents({
    entry: [
      {
        changes: [
          {
            value: {
              messages: [
                {
                  from: "15551234567",
                  type: "image",
                },
              ],
            },
          },
        ],
      },
    ],
  });

  assert.deepEqual(events, []);
});

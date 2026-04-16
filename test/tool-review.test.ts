import assert from "node:assert/strict";
import test from "node:test";
import { OpenAIResponsesProvider } from "../src/providers.js";
import type { ChatRecord } from "../src/types.js";
import type { Tool } from "../src/tools/types.js";

const createChat = (): ChatRecord => ({
  id: "default",
  createdAt: "2026-04-16T12:00:00.000Z",
  updatedAt: "2026-04-16T12:00:00.000Z",
  retentionDays: 30,
  compressionMode: "none",
  messages: [],
});

test("reviewed tools fail cleanly when no review path is available", async () => {
  const originalFetch = globalThis.fetch;
  const requestBodies: Array<{ input: Array<Record<string, unknown>> }> = [];

  try {
    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { input: Array<Record<string, unknown>> };
      requestBodies.push(body);

      if (requestBodies.length === 1) {
        return new Response(
          JSON.stringify({
            output: [
              {
                type: "function_call",
                name: "dangerous_tool",
                call_id: "call_1",
                arguments: JSON.stringify({ path: "notes.txt" }),
              },
            ],
          }),
          { status: 200 },
        );
      }

      return new Response(
        JSON.stringify({
          output_text: "done",
        }),
        { status: 200 },
      );
    }) as typeof globalThis.fetch;

    let executed = false;
    const tool: Tool = {
      name: "dangerous_tool",
      description: "Dangerous reviewed tool.",
      permission: "dangerous",
      requiresReview: true,
      inputSchema: { type: "object", additionalProperties: false },
      execute: async () => {
        executed = true;
        return "ok";
      },
    };

    const provider = new OpenAIResponsesProvider("test-key", "gpt-test", 2);
    const result = await provider.generate({
      chat: createChat(),
      userInput: "do it",
      systemPrompt: "test",
      tools: [tool],
    });

    assert.equal(result.outputText, "done");
    assert.equal(executed, false);
    const secondInput = requestBodies[1]?.input ?? [];
    const toolOutput = secondInput.find((entry) => entry.type === "function_call_output") as
      | { output?: string }
      | undefined;
    assert.match(toolOutput?.output ?? "", /requires human review/u);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reviewed tools execute after approval", async () => {
  const originalFetch = globalThis.fetch;
  const requestBodies: Array<{ input: Array<Record<string, unknown>> }> = [];

  try {
    globalThis.fetch = (async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { input: Array<Record<string, unknown>> };
      requestBodies.push(body);

      if (requestBodies.length === 1) {
        return new Response(
          JSON.stringify({
            output: [
              {
                type: "function_call",
                name: "dangerous_tool",
                call_id: "call_1",
                arguments: JSON.stringify({ path: "notes.txt" }),
              },
            ],
          }),
          { status: 200 },
        );
      }

      return new Response(
        JSON.stringify({
          output_text: "done",
        }),
        { status: 200 },
      );
    }) as typeof globalThis.fetch;

    let executed = false;
    const tool: Tool = {
      name: "dangerous_tool",
      description: "Dangerous reviewed tool.",
      permission: "dangerous",
      requiresReview: true,
      inputSchema: { type: "object", additionalProperties: false },
      execute: async () => {
        executed = true;
        return "ok";
      },
    };

    const provider = new OpenAIResponsesProvider("test-key", "gpt-test", 2);
    const result = await provider.generate({
      chat: createChat(),
      userInput: "do it",
      systemPrompt: "test",
      tools: [tool],
      reviewToolCall: async (reviewedTool, toolInput) => {
        assert.equal(reviewedTool.name, "dangerous_tool");
        assert.deepEqual(toolInput, { path: "notes.txt" });
        return true;
      },
    });

    assert.equal(result.outputText, "done");
    assert.equal(executed, true);
    const secondInput = requestBodies[1]?.input ?? [];
    const toolOutput = secondInput.find((entry) => entry.type === "function_call_output") as
      | { output?: string }
      | undefined;
    assert.equal(toolOutput?.output, "ok");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

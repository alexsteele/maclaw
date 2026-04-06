import assert from "node:assert/strict";
import test from "node:test";
import { Agent, MemoryAgentStore } from "../src/agent.js";
import type { AgentRecord, Message } from "../src/types.js";

const createRecord = (): AgentRecord => ({
  id: "agent_1",
  name: "test-agent",
  prompt: "Do the thing",
  chatId: "agent-chat",
  status: "pending",
  timeoutMs: 60 * 60 * 1000,
  stepCount: 0,
  createdAt: "2026-04-04T10:00:00.000Z",
});

const waitForAgentToSettle = async (
  store: MemoryAgentStore,
  agentId: string,
): Promise<AgentRecord> => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const record = store.getAgent(agentId);
    if (
      record &&
      record.status !== "pending" &&
      record.status !== "running"
    ) {
      return record;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`Timed out waiting for agent ${agentId} to settle`);
};

test("Agent completes when a step returns the done marker", async () => {
  const store = new MemoryAgentStore();
  const record = createRecord();
  store.saveAgent(record);
  const agent = new Agent(
    record,
    store,
    async (_chatId, input): Promise<Message> => ({
      id: "msg-1",
      role: "assistant",
      content: input === "Do the thing" ? "Finished\n<AGENT_DONE>" : "unexpected",
      createdAt: new Date().toISOString(),
    }),
  );

  agent.start();
  const result = await waitForAgentToSettle(store, record.id);

  assert.equal(result.status, "completed");
  assert.equal(result.stepCount, 1);
  assert.match(result.lastMessage ?? "", /<AGENT_DONE>/u);
  assert.ok(result.startedAt);
});

test("Agent stops when it reaches max steps without the done marker", async () => {
  const store = new MemoryAgentStore();
  const record = { ...createRecord(), maxSteps: 2 };
  store.saveAgent(record);
  const agent = new Agent(
    record,
    store,
    async (): Promise<Message> => ({
      id: "msg-1",
      role: "assistant",
      content: "Still working",
      createdAt: new Date().toISOString(),
    }),
  );

  agent.start();
  const result = await waitForAgentToSettle(store, record.id);

  assert.equal(result.status, "stopped");
  assert.equal(result.stepCount, 2);
});

test("Agent can be cancelled before it starts", async () => {
  const store = new MemoryAgentStore();
  const record = createRecord();
  store.saveAgent(record);
  const agent = new Agent(
    record,
    store,
    async () => {
      throw new Error("should not run");
    },
  );

  agent.cancel();
  const result = store.getAgent(record.id);

  assert.equal(result?.status, "cancelled");
  assert.equal(result?.stepCount, 0);
});

test("Agent steer is used on the next loop iteration", async () => {
  const store = new MemoryAgentStore();
  const inputs: string[] = [];
  const record = { ...createRecord(), maxSteps: 2 };
  store.saveAgent(record);
  const agent = new Agent(
    record,
    store,
    async (_chatId, input): Promise<Message> => {
      inputs.push(input);

      if (inputs.length === 1) {
        agent.steer("Use this new direction");
        return {
          id: "msg-1",
          role: "assistant",
          content: "Still working",
          createdAt: new Date().toISOString(),
        };
      }

      return {
        id: "msg-2",
        role: "assistant",
        content: "Done\n<AGENT_DONE>",
        createdAt: new Date().toISOString(),
      };
    },
  );

  agent.start();
  const result = await waitForAgentToSettle(store, record.id);

  assert.equal(result.status, "completed");
  assert.deepEqual(inputs, ["Do the thing", "Use this new direction"]);
});

test("Agent stops when its timeout is exceeded", async () => {
  const store = new MemoryAgentStore();
  const record = { ...createRecord(), timeoutMs: 1 };
  store.saveAgent(record);
  const agent = new Agent(
    record,
    store,
    async (): Promise<Message> => ({
      id: "msg-timeout",
      role: "assistant",
      content: "Still working",
      createdAt: new Date().toISOString(),
    }),
  );

  agent.start();
  const result = await waitForAgentToSettle(store, record.id);

  assert.equal(result.status, "stopped");
});

test("Agent waits between steps when stepIntervalMs is set", async () => {
  const store = new MemoryAgentStore();
  const timestamps: number[] = [];
  const record = { ...createRecord(), maxSteps: 2, stepIntervalMs: 20 };
  store.saveAgent(record);
  const agent = new Agent(
    record,
    store,
    async (): Promise<Message> => {
      timestamps.push(Date.now());
      return {
        id: `msg-${timestamps.length}`,
        role: "assistant",
        content: "Still working",
        createdAt: new Date().toISOString(),
      };
    },
  );

  agent.start();
  const result = await waitForAgentToSettle(store, record.id);

  assert.equal(result.status, "stopped");
  assert.equal(result.stepCount, 2);
  assert.equal(timestamps.length, 2);
  assert.ok(timestamps[1]! - timestamps[0]! >= 15);
});

import { afterEach, beforeEach } from "node:test";

const providerEnvKeys = [
  "MACLAW_LOG",
  "MACLAW_MODEL",
  "OPENAI_API_KEY",
] as const;

const originalEnv = new Map<string, string | undefined>();
let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  for (const key of providerEnvKeys) {
    originalEnv.set(key, process.env[key]);
  }

  originalFetch = globalThis.fetch;
  delete process.env.MACLAW_MODEL;
  delete process.env.OPENAI_API_KEY;
  globalThis.fetch = (async () => {
    throw new Error("Unexpected network request in tests. Mock fetch in this test.");
  }) as typeof fetch;
});

afterEach(() => {
  for (const key of providerEnvKeys) {
    const originalValue = originalEnv.get(key);
    if (originalValue === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = originalValue;
    }
  }

  originalEnv.clear();
  globalThis.fetch = originalFetch;
});

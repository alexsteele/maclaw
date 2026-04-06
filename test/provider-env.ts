import { afterEach, beforeEach } from "node:test";

const providerEnvKeys = [
  "MACLAW_PROVIDER",
  "MACLAW_MODEL",
  "OPENAI_MODEL",
  "OPENAI_API_KEY",
] as const;

export const useDummyProviderEnv = (): void => {
  const originalEnv = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of providerEnvKeys) {
      originalEnv.set(key, process.env[key]);
    }

    process.env.MACLAW_PROVIDER = "dummy";
    delete process.env.MACLAW_MODEL;
    delete process.env.OPENAI_MODEL;
    delete process.env.OPENAI_API_KEY;
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
  });
};

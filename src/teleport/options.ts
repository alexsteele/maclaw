/**
 * Shared option types for teleport runtime and tunnel helpers.
 *
 * Tests use these hooks to stub fetch, retry timing, and tunnel process
 * startup without coupling that plumbing to one teleport module.
 */
export type TeleportRuntimeOptions = {
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

export type TeleportTunnelOptions = {
  spawnFn?: typeof import("node:child_process").spawn;
  startupDelayMs?: number;
};

export type TeleportOptions = {
  runtime?: TeleportRuntimeOptions;
  tunnel?: TeleportTunnelOptions;
};

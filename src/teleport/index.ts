/**
 * Public teleport module exports and entrypoint overview.
 *
 * Teleport class hierarchy:
 *
 *   TeleportController
 *     -> TeleportSession
 *       -> TeleportTransport
 *         -> RemoteRuntimeClient
 *
 * Typical entrypoints:
 * - Interactive clients like the REPL and server channels use
 *   `TeleportController` to attach to a remote, keep one session alive, and
 *   send multiple messages through it.
 * - One-shot callers use `sendTeleportCommand(...)` from `session.ts` to open a
 *   temporary session, send one command, and cleanly tear it down.
 * - `RemoteRuntimeClient` owns the remote `/api/command` protocol once a
 *   transport has connected to the remote runtime.
 * - `remote.ts` outlines the future remote executor/recipe/access interfaces
 *   for bootstrap and lifecycle commands.
 *
 * Most callers should work with `TeleportController`, `TeleportSession`,
 * `sendTeleportCommand`, and `TeleportOptions` rather than the lower-level
 * transport and tunnel helpers directly.
 */
export * from "./runtime.js";
export * from "./options.js";
export * from "./remote.js";
export * from "./transport.js";
export * from "./tunnel.js";
export * from "./controller.js";
export * from "./session.js";

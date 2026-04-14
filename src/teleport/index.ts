/**
 * Public teleport module exports and entrypoint overview.
 *
 * Teleport class hierarchy:
 *
 *   TeleportController
 *     -> TeleportSession
 *       -> RemoteConnection
 *         -> HttpMaclawClient
 *
 * Typical entrypoints:
 * - Interactive clients like the REPL and server channels use
 *   `TeleportController` to attach to a remote, keep one session alive, and
 *   send multiple messages through it.
 * - One-shot callers use `sendTeleportCommand(...)` from `session.ts` to open a
 *   temporary session, send one command, and cleanly tear it down.
 * - `TeleportSession` resolves a target through `src/remote/`, opens a remote
 *   connection, and then sends structured commands to the remote runtime.
 * - `HttpMaclawClient` owns the remote `/api/command` HTTP protocol once
 *   teleport has an active connection.
 * - `src/remote/` owns provider-specific remote setup and connection behavior
 *   for `http`, `ssh`, and `aws-ec2`.
 *
 * Most callers should work with `TeleportController`, `TeleportSession`,
 * `sendTeleportCommand`, and `TeleportOptions`.
 */
export * from "./runtime.js";
export * from "./options.js";
export * from "./controller.js";
export * from "./session.js";

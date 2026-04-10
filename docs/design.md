## Design

## Overview

```text
REPL / Portal / Channels
          |
          v
       Harness
     /    |    \
    v     v     v
 Chats  Agents  Tasks
    \     |     /
     v    v    v
      ChatRuntime
          |
          v
     Provider + Tools

Notifications:
Harness -> ChannelRouter -> repl / web / email / slack / discord / whatsapp / inbox
```

## Main Modules

- [`src/harness.ts`](../src/harness.ts)
  project orchestration layer for chats, agents, tasks, inbox, and tools; the
  main runtime entrypoint used by the REPL, server, and commands layer
- [`src/server.ts`](../src/server.ts)
  `MaclawServer` hosts projects, channels, notifications, and the portal API
- [`src/cli/repl.ts`](../src/cli/repl.ts)
  `Repl` owns the local interactive terminal experience and wires it to a
  `Harness`
- [`src/chats.ts`](../src/chats.ts)
  `ChatRuntime` handles prompt building, compression, and provider calls
- [`src/agent.ts`](../src/agent.ts)
  `Agent` runs the background autonomous loop in its own dedicated chat
- [`src/portal/`](../src/portal)
  portal HTML, layout, and browser-side interaction code
- [`src/channels/channel.ts`](../src/channels/channel.ts)
  `Channel` is the shared interface for Slack, Discord, WhatsApp, web, email,
  and other message transports
- [`src/router.ts`](../src/router.ts)
  `ChannelRouter` resolves notification destinations and routes outbound sends

## Message Flow

Normal end-to-end message flow:

1. A message enters through the REPL, portal, or a channel.
2. Slash commands go through [`dispatchCommand(...)`](../src/commands.ts).
3. Non-command input is handed to [`Harness`](../src/harness.ts).
4. `Harness` resolves prompt files, picks the active chat, and calls
   [`ChatRuntime`](../src/chats.ts).
5. `ChatRuntime` loads the chat, builds the prompt window, adds any compressed
   summary, and calls the configured provider.
6. The provider may call tools during generation.
7. Tool calls go back through the harness-backed tool context.
8. The final assistant message is saved to the chat transcript and returned to
   the caller.

## Storage

maclaw currently uses a hybrid local storage model:

- project config lives in `.maclaw/maclaw.json`
- chats are stored as metadata plus transcript history
- tasks, agents, and inbox entries can be stored in JSON files or SQLite
- chat transcripts remain append-oriented `jsonl`

Typical project layout:

```text
project/
  .maclaw/
    maclaw.json
    maclaw.db
    chats/
      default.jsonl
      branch-a.jsonl
```

Storage code:

- [`src/storage/json.ts`](../src/storage/json.ts)
  JSON-backed store implementations
- [`src/storage/sqlite.ts`](../src/storage/sqlite.ts)
  SQLite-backed store implementations
- [`src/chats.ts`](../src/chats.ts)
  defines the chat store interface and the hybrid chat behavior

## Notes

- `Harness` is the main seam to reach for first when adding project-level
  behavior.
- `dispatchCommand(...)` should stay thin and push real work into the harness.
- `ChatRuntime` is where prompt-window, summary, and provider behavior should
  live.
- `ChannelRouter` is the right place for notification destination resolution
  rather than pushing that logic into commands or channels.

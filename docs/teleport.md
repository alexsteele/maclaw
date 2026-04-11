# Teleport

`teleport` is a proposed way to connect a local maclaw client to a remote maclaw
runtime running on another machine, likely over SSH.

The goal is to keep the local user experience simple while moving the actual
model execution, agents, and long-running tasks onto a cloud or remote host.

## Direction

The simplest useful first version is:

1. Run `maclaw server --api-only` on a remote machine.
2. Use SSH port forwarding to tunnel a local port to that remote server.
3. Have the local CLI or portal talk to the remote server through the tunnel.

This keeps `teleport` focused on "connect to another maclaw runtime" rather than
turning it into a general-purpose shell or file sync tool.

## Why SSH First

SSH tunneling is a good starting point because:

- many users already have SSH access to cloud machines
- it avoids inventing a new auth layer for v1
- it works well with a locally hosted portal
- it preserves the current server architecture
- it keeps remote access explicit and easy to reason about

## Scope

`teleport` should mean:

- connect to a remote maclaw server
- use the normal maclaw chat, agent, task, and portal flows against that server

`teleport` should not initially mean:

- open an arbitrary remote shell
- sync whole project folders automatically
- execute arbitrary commands outside the maclaw runtime
- invent a full distributed multi-node control plane

## UX

Likely v1 CLI:

```text
maclaw teleport <remote>
```

Current direct form:

```text
maclaw teleport <url> [--project <name>] [--chat <id>] <message>
```

Interactive clients can also attach with a session command:

```text
/teleport <url|remote> [--project <name>] [--chat <id>]
```

Possible future variants:

```text
maclaw teleport <remote> --project <name>
maclaw teleport <remote> --portal
maclaw teleport list
```

Once connected, the local REPL or portal should clearly show that the user is
talking to a remote runtime, including:

- remote name
- active project
- current model

## Config

One possible global config shape:

```json
{
  "remotes": [
    {
      "name": "gpu-box",
      "sshHost": "gpu.example.com",
      "sshUser": "alex",
      "sshPort": 22,
      "remoteServerPort": 4000,
      "localForwardPort": 4100
    }
  ]
}
```

This is intentionally small. A remote definition should be enough to:

- open the SSH tunnel
- know which local port to talk to
- know which remote server port is expected

You can add or update these entries with `maclaw setup remotes`.

## Message Flow

Proposed v1 flow:

1. Start `maclaw server --api-only` on the remote host.
2. Open an SSH tunnel from `localhost:<localForwardPort>` to the remote server
   port.
3. Run `maclaw teleport http://127.0.0.1:<localForwardPort> ...`.
4. The remote maclaw server handles chats, agents, tasks, notifications, and
   storage normally.
5. The local CLI shows the remote reply.

Example:

```shell
remote$ maclaw server --api-only --port 4000

local$ ssh -L 4100:127.0.0.1:4000 alex@gpu.example.com

local$ maclaw teleport http://127.0.0.1:4100 --project home "/help"
```

## Code

Main teleport code lives in [`src/teleport.ts`](../src/teleport.ts).

Key types:

- `RemoteRuntimeClient`
  - thin client for the remote `POST /api/command` endpoint
- `TeleportSession`
  - owns one direct-url or SSH-backed remote connection
  - reuses one SSH tunnel across multiple remote messages
- `TeleportController`
  - attached-session state for interactive clients
  - tracks the active remote target, project, and chat

Main integration points:

- [`src/index.ts`](../src/index.ts)
  - top-level `maclaw teleport ...` CLI entrypoint
- [`src/commands.ts`](../src/commands.ts)
  - shared `/teleport` command parsing and help text
- [`src/cli/repl.ts`](../src/cli/repl.ts)
  - REPL-attached remote sessions and remote-aware prompt UI
- [`src/server.ts`](../src/server.ts)
  - `POST /api/command` on the remote side
  - per-user attached teleport sessions for server-backed chats

Current direction:

- keep teleport sessions process-local and simple for now
- support attached long-lived sessions inside one REPL or channel conversation
- avoid introducing named shared teleport sessions unless we actually need them
- protect projects with local lock/pidfiles so two maclaw runtimes do not work
  on the same project at once

## Lock Files

Teleport makes it more likely that a user may accidentally point multiple maclaw
runtimes at the same project, for example through a local REPL, a local server,
and a remote attached session.

maclaw now uses one advisory lock file per initialized project under
`.maclaw/lock.json`.

Current behavior:

- acquire the project lock from `Harness.start()`
- store ownership info including:
  - pid
  - host
  - an internal owner id
  - acquiredAt
- refuse to start when another live local maclaw already owns that project
- replace stale local locks when the recorded process no longer exists

This should stay simple at first. The goal is not distributed coordination. The
goal is to avoid two local maclaw runtimes both acting as the authority for the
same project at once.

## Open Questions

- Should the portal eventually support the same attached remote-session model as
  the REPL and server-backed chats?
- Do we want remote notifications to route back through the local machine, or
  remain fully remote?
- Should teleport eventually be able to bootstrap remote maclaw itself when the
  remote server is not already running?
- Should we eventually add richer lock metadata such as runtime mode or command?

## Recommended V1

Recommended v1:

- SSH tunnel only
- localhost-bound command API on the remote server
- direct URL and named-remote support
- `maclaw setup remotes` for configuring SSH targets
- one-shot `maclaw teleport ...` for simple remote commands
- attached long-lived teleport sessions inside the REPL and server-backed chats
- very visible "remote" status in the UI
- process-local teleport sessions rather than named shared sessions
- project-level advisory locks to avoid multiple runtimes on one project

This gives maclaw a practical cloud story without committing too early to a more
complicated remote orchestration model.

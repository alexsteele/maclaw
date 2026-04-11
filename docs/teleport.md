# Teleport

`teleport` is a proposed way to connect a local maclaw client to a remote maclaw
runtime running on another machine, likely over SSH.

The goal is to keep the local user experience simple while moving the actual
model execution, agents, and long-running tasks onto a cloud or remote host.

## V1 Direction

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

## Architecture Fit

This approach fits the current code well:

- [`src/server.ts`](../src/server.ts) already hosts the runtime and portal API
- [`src/server.ts`](../src/server.ts) now exposes `POST /api/command` for
  structured remote command dispatch
- [`src/cli/repl.ts`](../src/cli/repl.ts) already owns the local terminal UX
- [`src/teleport.ts`](../src/teleport.ts) provides the thin remote command
  client
- [`src/portal/`](../src/portal) can eventually point at a remote-backed server
- `teleport` can stay a connection concern rather than a harness concern

That suggests a likely split:

- local CLI manages the SSH tunnel and connection state
- remote `MaclawServer` remains the authoritative runtime

## Open Questions

- Should `teleport` attach to a remote server generally, or to a specific remote
  project by default?
- Should the portal connect directly to a remote server, or only through a
  locally managed tunnel?
- Should teleport sessions be purely process-local, or remembered across REPL
  restarts?
- Do we want remote notifications to route back through the local machine, or
  remain fully remote?
- Should there be a matching "return to local" command, or is simply exiting the
  teleport session enough?

## Recommended V1

Recommended v1:

- SSH tunnel only
- localhost-bound command API on the remote server
- one local command to send a remote message
- one remote server as the execution authority
- very visible "remote" status in the UI

This gives maclaw a practical cloud story without committing too early to a more
complicated remote orchestration model.

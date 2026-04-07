# Web Portal

Date: 2026-04-06
Collaborators: alex, codex

## Goal

Add a browser-based portal hosted by `maclaw server`.

The portal should feel minimal and clean. Prefer a small, clear interface over
an ambitious or busy one.

The portal should let a user:

- chat with maclaw
- manage projects/chats/tasks/agents
- update config
- receive notifications in the browser

## Proposal

Treat the browser portal as a normal `Channel`.

That means:

- inbound browser actions enter the server through a `web` channel
- the server routes them to the right `Harness`
- harness notifications flow back out through the same `web` channel

This keeps the portal aligned with Slack, Discord, WhatsApp, and REPL instead
of inventing a separate interaction path.

## Transport

Keep v1 simple:

- HTTP for browser requests
- SSE for server-to-browser events and notifications

This gives us:

- normal request/response chat actions
- live notifications
- no websocket protocol to design yet

## Web Channel

The `web` channel should:

- identify a browser user/session
- normalize inbound browser actions into server events
- send outbound notifications and updates to connected browser clients

Likely browser origin:

```ts
{
  channel: "web",
  userId: "<session or browser user id>",
  conversationId?: "<browser session or tab id>"
}
```

## v1 Scope

The first portal should support:

- project selection
- chat view
- send message
- view chat history
- task list
- create task
- delete task
- agent list
- create agent
- show agent
- pause/resume/stop/steer agent
- browser notifications for:
  - `agentCompleted`
  - `agentFailed`
  - `taskCompleted`
  - `taskFailed`

## Suggested Server Shape

Serve the portal from `maclaw server`.

Likely endpoints:

- `GET /`
  - portal HTML shell
- `GET /assets/...`
  - JS/CSS assets
- `GET /events`
  - SSE stream for notifications and updates
- `GET /api/projects`
  - list projects
- `GET /api/projects/:project/chats/:chat`
  - load chat data
- `POST /api/projects/:project/chats/:chat/messages`
  - send a message
- `GET /api/projects/:project/tasks`
  - list tasks
- `POST /api/projects/:project/tasks`
  - create task
- `DELETE /api/projects/:project/tasks/:id`
  - delete task
- `GET /api/projects/:project/agents`
  - list agents
- `POST /api/projects/:project/agents`
  - create agent
- `POST /api/projects/:project/agents/:name/pause`
- `POST /api/projects/:project/agents/:name/resume`
- `POST /api/projects/:project/agents/:name/stop`
- `POST /api/projects/:project/agents/:name/steer`

## Suggested UI Shape

Keep the portal simple, clean, and utilitarian at first:

- left sidebar:
  - projects
  - chats
  - tasks
  - agents
- main pane:
  - current chat transcript and composer
- right pane or drawer:
  - selected task or agent details
  - notifications

## State Model

The browser should not own core state.

Instead:

- `Harness` remains the source of truth for project data
- the portal fetches current state from the server
- the `web` channel pushes notifications and small live updates

## First Implementation Plan

1. Add a `web` channel type and browser session tracking.
2. Serve a minimal HTML/JS portal from `maclaw server`.
3. Add chat send/load endpoints.
4. Add SSE notifications from harness events.
5. Add task list/create/delete endpoints and UI.
6. Add agent list/create/control endpoints and UI.

## Non-Goals For v1

- auth beyond a simple local/session model
- multi-user collaboration
- websocket transport
- visually busy dashboards or complex UI chrome
- file uploads
- slash-command parity in the browser

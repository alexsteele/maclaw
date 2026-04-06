# Channels

Date: 2026-04-04
Collaborators: alex, codex

## Goal

Control maclaw through different methods such as the REPL, SMS, email, etc.

Make it easy to manage multiple projects and kickoff agents that do tasks autonomously.

Keep projects isolated in terms of system access, chat history, settings, tasks, etc.

Support sandboxing for permissions/security, probably containerized.

Our current model is one running maclaw instance per project, with projects
isolated from each other.

## User Journey

A likely user journey is:

1. A user has multiple maclaw projects they created (at home or via remote chat).
1. They want to interact with those projects remotely.
1. They connect through channels such as WhatsApp, SMS, and email.
1. The system routes each inbound message to the right project and chat.

This is the experience we want to support cleanly over time.

## Proposal

Run maclaw as a long-lived server.

Use **Harness** as the per-project runtime and **Channel** as the abstraction for how a user talks to maclaw.

- one running maclaw server
- one `Harness` per project
- zero or more attached `Channel`s
- users connect through channels such as REPL, WhatsApp, email, or SMS
- inbound messages are routed to the right project and chat

The `Harness` is the core runtime for a project. Config, chats, tasks, tools, agents, etc.

A `Channel` is a long-lived interface layer attached to a harness.

- receives inbound user input
- maps that input into harness calls
- sends the harness response back out

Examples:

- REPL
- WhatsApp
- SMS

## Loop Ownership

Keep the split simple:

- channels own channel-specific user I/O loops
- the harness/runtime owns the core work loop, tasks, agents, etc.

## Routing

For REPL, routing is simple because there is only one local user.

For channels like WhatsApp, we will need explicit mapping between:

- external user or thread identity
- project
- maclaw chat id

This is the main seam for making multi-channel usage feel seamless.

## Notifications

Channels should eventually support outbound notifications that are not tied to
replying to an inbound message.

This would let maclaw notify a user through Slack, Discord, WhatsApp, etc. when
an agent finishes, fails, or needs confirmation.

The likely shape is:

- server passes `MessageContext` to `Harness.handleUserInput` with `user/origin` channel info
- the `Harness` emits a notification event via a callback with the context
- server routes it to the right `channel/user` based on the context.
- the `Channel` sends the notification

## Config

Channel configuration should be explicit and deny-by-default. No default remote access.

We might need some global config for users, allowlists, credentials, project settings etc.

This might live in `~/.maclaw`

Example shape:

```json
{
  "channels": {
    "whatsapp": {
      "enabled": true,
      "allowedPhoneNumbers": ["+15551234567"]
    },
    "email": {
      "enabled": true,
      "allowedSenders": ["alex@example.com"]
    }
  }
}
```

So the startup flow would be something like:

- Load `~/.maclaw` settings
- If whatsapp is enabled, construct WhatsAppChannel with the required access token, etc.
- Register webhook handler.
- On inbound message:
  - Verify the sender
  - Create an event
  - Dispatch it to the right harness
  - Send the response back.

## Concurrency

We allow only one running maclaw per project at a time. We may enforce this with
an advisory lockfile.

That lets us keep storage simple. Single-threaded node process. No locking.

## Near-Term Plan

1. Keep the REPL as the first `Channel`.
2. Define a small `Channel` interface or shape.
3. Add explicit chat-routing support needed for multi-user channels.
4. Implement a WhatsApp channel against the Meta WhatsApp API.

# maclaw

<!-- HUMAN -->

maclaw is a small LLM harness built with OpenAI codex.

The goal of this project is to understand and test the limits of this
technology. I make no strong claims about the reliablity, security, or
robustness, though I do guide, review, and curate all AI code.
No AI slop hits `origin/main` without human eyes in the loop.

Happy hacking friends. May your claws forever be ma'd and your way paved with
gold 🦞❤️

With love,

Alex, your dedicated human-in-the-loop

/endhuman

<!-- END -->

## Features

- Chat with `maclaw` via a REPL, web portal, or connected apps (slack, whatsapp, discord).
- Projects, chats, agents, skills, tools, and tasks.
- Pluggable LLM models.
- Local storage for chats, tasks, etc. sqlite and `jsonl` files.

## Setup

1. Install Node.js 20+.
2. `npm install`.
3. `npm link` to install the `maclaw` command.
4. `maclaw setup` for a guided setup.
5. `maclaw` starts the repl.
6. `maclaw server` starts the server and web portal

## Example

```shell
$ maclaw repl
maclaw REPL
project: default
folder: /Users/alex/.maclaw/projects/default
chat: default
type /help for commands

> 5 popular jazz songs
Here are 5 popular and classic jazz songs:

1. "Take Five" – Dave Brubeck Quartet
2. "So What" – Miles Davis
3. "Summertime" – Ella Fitzgerald & Louis Armstrong
4. "My Favorite Things" – John Coltrane
5. "All of Me" – Billie Holiday

> /new trip-planning
```

## REPL

`maclaw` starts a repl with the following commands.

```text
Commands:
  ?                  Alias for /help
  /help              Show this help
  /new [id]          Create and switch to a new chat
  /fork [id]         Fork the current chat
  /reset             Clear the current chat
  /project           Project information commands
  /chat              Chat management commands
  /history           Show the current chat transcript
  /save              Save the current chat transcript to a file
  /usage             Show token usage for the current chat
  /tools             Show the current tools
  /skills            List local skills
  /agent             Agent management commands
  /task              Task scheduling commands
  /switch X          Switch the REPL to project folder X
  /verbose <on|off>  Toggle verbose reply metadata
  /quit              Exit the REPL
```

These are also available via the portal and connectors.

## Server+Portal

maclaw can also run as a server. The server provides a portal webapp to control
maclaw. It supports WhatsApp, Slack, and Discord channels and notifications.

```shell
$ maclaw server
Web portal listening on http://localhost:4000/
```

See [docs/config.md](docs/config.md) for the full server config and secrets shape.

## Projects

Projects are the main unit of organization in maclaw. A project owns its model
config, chats, agents, tasks, skills, and local state.

Run `/project init` to initialize the current folder, or use `maclaw setup` to
create a managed default project.

Project data lives in `.maclaw/`:

```text
project/
  .maclaw/
    maclaw.db
    chats/
      default.jsonl
```

`maclaw.json` contains the project config. See [docs/config.md](docs/config.md)
for the full shape.

## Chats

Chats are saved conversation threads inside a project. Each chat keeps its own
history, can be switched to directly, and can have tasks scheduled against it.

Useful commands:

- `/chat list`
- `/chat show`
- `/chat switch <id>`
- `/new [id]`
- `/fork [id]`
- `/reset`

## Agents

Agents are long-running background workers that loop over prompts and tools
until they finish, fail, or are stopped.

Useful commands:

- `/agent list`
- `/agent create <name> | <prompt>`
- `/agent pause <name>`
- `/agent resume <name>`
- `/agent steer <name> | <prompt>`
- `/agent stop <name>`

Agents run in a chat, can be paused and resumed, and can notify you when they
finish or fail.

## Tasks

Tasks are scheduled jobs. They run once later or on a recurring schedule and
re-enter the harness through a chat.

Useful commands:

- `/task list`
- `/task schedule <date> | <title> | <prompt> [| <json options>]`
- `/task cancel <task id>`

Run `/help task schedule` for the supported scheduling forms such as `today`,
`tomorrow`, `now`, daily, and weekly schedules.

## Channels

Channels are how you talk to maclaw. maclaw supports:

- REPL (no server needed)
- Portal webapp
- slack via Socket Mode websocket
  - setup: create a Slack app and enable Socket Mode first.
- discord via gateway websocket
  - setup: register a Discord bot in the Discord Developer Portal first.
- whatsapp via webhooks
  - setup: configure a WhatsApp Cloud API app and webhook first.
  - warning: this exposes a public webhook, so be careful about how and where you run it.

## Notifications

maclaw server can send notifications to the user over channels.

Current notifications:

- `agentCompleted`
- `agentFailed`
- `taskCompleted`
- `taskFailed`

By default, notifications go back to the originating channel when available,
such as your slack channel or REPL session.

You can control notifications with a policy (ex: `notifications: "none"`).

See [docs/config.md](docs/config.md) for policy and override examples.

## Concepts

- **Project**: the folder maclaw runs in, including its local config, skills,
  chats, tasks, and logs
- **Model**: the configured LLM target, such as `openai/gpt-5.4-mini` or `dummy/default`
- **Chat**: a conversation thread
- **Agent** autonomously completes tasks by running prompts/tools in a loop
- **Task**: a scheduled prompt
- **Channel**: communication channel for talking to maclaw (whatsapp, sms, etc)
- **Skill**: a file in `skills/` that describes a reusable task, workflow, or prompt
- **Tool**: a callable capability the harness can use, such as editing files,
  calling APIs, etc.
- **Notification**: Sent to the user over a channel by an agent, task, or other event.

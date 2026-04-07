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

- Chat with `maclaw` via a REPL or `maclaw server` connectors (slack etc)
- Projects, chats, skills, tools, and schedulable tasks.
- File-backed storage for chats, tasks, etc.
- Pluggable LLM models.

## Concepts

- **Project**: the folder maclaw runs in, including its local config, skills,
  chats, tasks, and logs
- **Chat**: a saved conversation thread with its own history and scheduled tasks
- **Agent** autonomously completes tasks by running prompts/tools in a loop
- **Channel**: communication channel for talking to maclaw (whatsapp, sms, etc)
- **Skill**: a file in `skills/` that describes a reusable task, workflow, or prompt
- **Tool**: a callable capability the harness can use, such as editing files,
  calling APIs, etc.
- **Model**: the configured LLM target, such as `openai/gpt-5.4-mini` or `dummy/default`
- **Task**: a scheduled job that re-enters the harness later, either once or on
  a recurring schedule
- **Notification**: Sent to the user over a channel by an agent, task, or other event.

## Setup

1. Install Node.js 20+.
2. Install dependencies with `npm install`.
3. Run `npm link` to install the local `maclaw` command.
4. Run `maclaw setup` for a guided first-run setup.
5. Or set `OPENAI_API_KEY` manually if you want live model responses.
6. Start the REPL with `maclaw`.

## Message Flow

- Install and run `maclaw setup` to configure a model, project, and channels
- Run `maclaw server` or `maclaw repl`
- You message maclaw via a channel.
- Maclaw's `Channel` code receives, normalizes, and forwards the message to `MaclawServer`
- `MaclawServer` checks for `/commands` and forwards messages to the
  `Harness` for the right project and chat
- The harness constructs and sends the prompt to the AI model.
- The harness logs the messages and the channel sends the response back to you
- Agents you start run in a loop in their project `Harness` until completion or cancellation.

## REPL

`maclaw` starts a repl with the following commands.

```text
Commands:
  /help              Show this help
  /project           Project information commands
  /chat              Chat management commands
  /history           Show the current chat transcript
  /skills            List local skills
  /agent             Agent management commands
  /task              Task scheduling commands
  /quit              Exit the REPL
```

## Server

maclaw can also run as a long-lived server. The server provides a portal webapp to control maclaw. It also sends notifications.

- `maclaw server`

Server mode currently supports WhatsApp, Slack, and Discord channels, and loads global server settings from:

- `~/.maclaw/server.json`
- `~/.maclaw/secrets.json`

See [docs/config.md](docs/config.md) for the full server config and secrets shape.

## Projects

maclaw organizes work into projects. Projects encompass settings, chats, and tasks.

When you start the repl, maclaw runs in "headless" mode without a project by default.

Run `/project init` to set up a project in the current folder.

By default, project data goes in the `.maclaw/` folder.

```text
my-project/
  .maclaw/
    maclaw.json
    skills/
      daily_summary.md
    chats/
      default.json
      default.jsonl
    tasks.json
    task-runs.jsonl
```

`maclaw.json` contains the config.

See [docs/config.md](docs/config.md) for the full project config shape, environment variables, model configuration, and notification policy.

## Configuration

See [docs/config.md](docs/config.md).

## Connectors

Connectors are how you talk to maclaw. maclaw server currently supports:

- REPL (no server needed)
- slack via Socket Mode websocket
  - setup: create a Slack app and enable Socket Mode first.
- discord via gateway websocket
  - setup: register a Discord bot in the Discord Developer Portal first.
- whatsapp via webhooks
  - setup: configure a WhatsApp Cloud API app and webhook first.
  - warning: this exposes a public webhook, so be careful about how and where you run it.

## Notifications

maclaw can send notifications to the user over channels.

Current notification triggers:

- agent/task completion

By default, notifications go back to the originating channel when available,
such as your slack channel or REPL session.

See [docs/config.md](docs/config.md) for notification policy and override examples.

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
- **Provider**: the LLM backend maclaw uses, such as OpenAI or a local fallback provider
- **Task**: a scheduled job that re-enters the harness later, either once or on
  a recurring schedule

## Setup

1. Install Node.js 20+.
2. Install dependencies with `npm install`.
3. Run `npm run dev -- setup` for a guided first-run setup.
4. Or set `OPENAI_API_KEY` manually if you want live model responses.
5. Start the REPL with `npm run dev`.

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

`npm run dev` starts a repl with the following commands.

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

maclaw can also run as a long-lived server:

- `npm run dev -- server`

Server mode currently supports WhatsApp, Slack, and Discord channels, and loads global server settings from:

- `~/.maclaw/server.json`
- `~/.maclaw/secrets.json`

`server.json` is for non-secret settings such as projects, ports, webhook paths,
and channel options. `secrets.json` is for private credentials such as
WhatsApp tokens, Slack app/bot tokens, and Discord bot tokens.

Example `server.json`:

```json
{
  "defaultProject": "home",
  "projects": [{ "name": "home", "folder": "/path/to/home-project" }],
  "channels": {
    "discord": {
      "enabled": true
    },
    "slack": {
      "enabled": true,
      "botUserId": "U12345678"
    },
    "whatsapp": {
      "enabled": true,
      "port": 3000,
      "webhookPath": "/whatsapp/webhook"
    }
  }
}
```

Example `secrets.json`:

```json
{
  "discord": {
    "botToken": "your-discord-bot-token"
  },
  "slack": {
    "appToken": "xapp-your-slack-app-token",
    "botToken": "xoxb-your-slack-bot-token"
  },
  "whatsapp": {
    "accessToken": "your-whatsapp-access-token",
    "verifyToken": "your-whatsapp-verify-token"
  }
}
```

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
    tasks.json
    task-runs.jsonl
```

`maclaw.json` contains the config.

```json
{
  "createdAt": "2026-04-04T10:00:00.000Z",
  "name": "my-project",
  "retentionDays": 30,
  "provider": "openai",
  "model": "gpt-4.1-mini",
  "skillsDir": ".maclaw/skills"
}
```

`skillsDir` is optional. If you omit it, maclaw uses `.maclaw/skills` by default.

## Configuration

Config precedence is:

1. environment variables
2. `maclaw.json`
3. built-in defaults

Environment variables:

- `MACLAW_PROVIDER`: overrides the configured provider
- `MACLAW_MODEL`: overrides the configured model
- `OPENAI_API_KEY`: enables the OpenAI provider
- `OPENAI_MODEL`: backward-compatible override for OpenAI model selection
- `MACLAW_DATA_DIR`: overrides the default `projectFolder/.maclaw`
- `MACLAW_SKILLS_DIR`: overrides the configured `skillsDir`, which defaults to `projectFolder/.maclaw/skills`
- `MACLAW_CHAT_ID`: defaults to `default`
- `MACLAW_RETENTION_DAYS`: defaults to `30`
- `MACLAW_COMPRESSION_MODE`: `none` or `planned`
- `MACLAW_SCHEDULER_POLL_MS`: defaults to `15000`

## Providers

Providers provide your AI model. You can configure both these variables.

- `openai`: uses the OpenAI Responses API and requires `OPENAI_API_KEY`
- `local`: uses the built-in fallback provider for local testing without live model calls

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


## TODO

- Support other LLMs
- Improve chat storage and retention policies (sqlite)
- Better project management.
- Chat compression and summarization.
- MCP support
- Tool approval and policy controls.
- Tests and end-to-end dev workflow.
- Consolidate server/repl command handling.

# Setup

Date: 2026-04-05
Collaborators: alex, codex

## Goal

Add a `maclaw setup` command that walks the user through the most important
first-run choices in one streamlined terminal dialogue.

## Proposal

Provide an interactive CLI flow. `maclaw setup` will help the user:

1. Choose a model.
1. Choose a default project.
1. Optionally create or initialize that project.
1. Configure server and connectors. Optional.
1. Configure named teleport remotes. Optional.
1. Save the server config in `~/.maclaw`. Confirm with the user.

Steps should ask one question at the time with good defaults and link the user
directly to any required third party pages like connector APIs. The user should
not need to understand how maclaw or its configuration works yet. Everything
should be safe by default.

For now, the default suggested project location should be
`~/.maclaw/projects/default`.

Each major section should be easy to skip. Skipping should leave existing config
alone rather than clearing it.

## Example Flow


```text
$ maclaw setup

Welcome to maclaw setup.

This setup will help you:
  1. Choose a model
  2. Pick a default project
  3. Optionally configure maclaw server and connectors

Once complete, you can run a local maclaw REPL with `maclaw` and a server with
`maclaw server`.

maclaw can save server config and API secrets in ~/.maclaw. Is that OK?
> yes

Provider?
  1. openai
  2. dummy
  3. skip
> 1

OpenAI API setup:
  https://developers.openai.com/api/docs/quickstart
  OpenAI API key:
> sk-...

Model? [gpt-5.4-mini]
> 

Create a default project in ~/.maclaw/projects/default?
  1. yes
  2. no
  3. other location
> 1

Set up maclaw server and connectors?
  1. yes
  2. skip
> 1

Enable channels?
  [x] Slack (Socket Mode websocket)
  [x] Discord (Gateway websocket)
  [ ] WhatsApp (webhook, public endpoint)
  [ ] Email (outbound SMTP notifications)

Slack setup:
  Create a Slack app and enable Socket Mode:
  https://api.slack.com/apps
  Slack app token:
> xapp-...
  Slack bot token:
> xoxb-...

Discord setup:
  Register a bot in the Discord Developer Portal:
  https://discord.com/developers/applications
  Discord bot token:
> ...

Email setup:
  maclaw sends outbound email notifications over SMTP.
  For Gmail, use smtp.gmail.com:587 with STARTTLS and a Google App Password:
  https://myaccount.google.com/apppasswords

Writing:
  .maclaw/maclaw.json
  ~/.maclaw/server.json
  ~/.maclaw/secrets.json

Done.
Run:
  maclaw
  maclaw server
```

## Notes

- The first version can focus on a small set of supported providers and
  channels.
- It is okay if the first version writes config but does not validate every
  token live.
- Later we can add a non-interactive mode such as `maclaw setup --yes` or
  `maclaw setup --model openai/gpt-5.4-mini`.
- Sections currently include `all`, `model`, `project`, `server`, `channels`,
  and `remotes`.

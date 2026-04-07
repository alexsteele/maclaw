# Configuration

maclaw uses:

- project config in `.maclaw/maclaw.json`
- server config in `~/.maclaw/server.json`
- server secrets in `~/.maclaw/secrets.json`

## Precedence

Config precedence is:

1. environment variables
2. config files
3. built-in defaults

## Project Config

Example `maclaw.json`:

```json
{
  "createdAt": "2026-04-04T10:00:00.000Z",
  "name": "my-project",
  "model": "openai/gpt-4.1-mini",
  "storage": "json",
  "notifications": "all",
  "defaultTaskTime": "9:00 AM",
  "contextMessages": 20,
  "maxToolIterations": 8,
  "retentionDays": 30,
  "skillsDir": ".maclaw/skills"
}
```

Notes:

- `skillsDir` is optional. If omitted, maclaw uses `.maclaw/skills`.
- `model` uses `<provider>/<model>` form.
- `storage` currently supports `json`, `sqlite`, and `none`.

## Server Config

maclaw server loads global config from:

- `~/.maclaw/server.json`
- `~/.maclaw/secrets.json`

`server.json` is for non-secret settings such as projects, ports, webhook paths, and channel options.

`secrets.json` is for private credentials such as OpenAI keys, WhatsApp tokens, Slack app/bot tokens, and Discord bot tokens.

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
  "openai": {
    "apiKey": "your-openai-api-key"
  },
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

## Environment Variables

### Project

- `MACLAW_MODEL`: overrides the configured model
- `OPENAI_API_KEY`: enables OpenAI models
- `MACLAW_STORAGE`: overrides the configured storage backend
- `MACLAW_SKILLS_DIR`: overrides the configured `skillsDir`
- `MACLAW_CHAT_ID`: defaults to `default`
- `MACLAW_DEFAULT_TASK_TIME`: default time for one-time `today`, `tomorrow`, or date-only tasks
- `MACLAW_CONTEXT_MESSAGES`: defaults to `20`
- `MACLAW_MAX_TOOL_ITERATIONS`: defaults to `8`
- `MACLAW_RETENTION_DAYS`: defaults to `30`
- `MACLAW_COMPRESSION_MODE`: `none` or `planned`
- `MACLAW_SCHEDULER_POLL_MS`: defaults to `15000`

### Server

- `MACLAW_SERVER_CONFIG`: overrides the path to `server.json`
- `MACLAW_SERVER_SECRETS`: overrides the path to `secrets.json`
- `OPENAI_API_KEY`: overrides `secrets.json` OpenAI API key
- `MACLAW_DISCORD_BOT_TOKEN`: overrides Discord bot token
- `MACLAW_SLACK_APP_TOKEN`: overrides Slack app token
- `MACLAW_SLACK_BOT_TOKEN`: overrides Slack bot token
- `MACLAW_SLACK_BOT_USER_ID`: overrides Slack `botUserId`
- `MACLAW_WHATSAPP_ACCESS_TOKEN`: overrides WhatsApp access token
- `MACLAW_WHATSAPP_VERIFY_TOKEN`: overrides WhatsApp verify token
- `MACLAW_WHATSAPP_PHONE_NUMBER_ID`: overrides WhatsApp `phoneNumberId`

## Models

Project config stores models as `<provider>/<model>`.

- `openai/gpt-5.4-mini`: uses the OpenAI Responses API and requires `OPENAI_API_KEY`
- `dummy/default`: uses the built-in stand-in provider for local testing without live model calls

## Notifications

Example:

```json
{
  "notifications": "agent:*"
}
```

Policies:

- `"all"`: send all current notification types
- `"none"`: suppress all notifications
- `["errors"]`: only send failures
- `{ "allow": ["agent:*", "task:*"], "deny": ["taskCompleted"] }`: notify for
  everything except successful tasks

Agents and scheduled tasks can override project notifications with JSON options:

- `/agent create planner | Do the work | {"notify":["errors"]}`
- `/task schedule daily 9:00 AM | Daily Brief | Send the brief | {"notify":"none"}`
- `/agent create planner | Do the work | {"notifyTarget":{"channel":"slack"}}`

## Server Notes

- Project names must be unique.
- `defaultProject`, if set, must match a configured project name.
- Slack, Discord, and WhatsApp channel config is deny-by-default unless explicitly enabled.
- WhatsApp defaults currently include:
  - `graphApiVersion: "v23.0"`
  - `port: 3000`
  - `webhookPath: "/whatsapp/webhook"`

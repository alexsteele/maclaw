# maclaw

<!-- HUMAN -->

maclaw is a small LLM harness built with OpenAI codex.

<!-- END -->

## Features

- REPL-based chat loop
- Projects, chats, skills, tools, and schedulable tasks.
- File-backed storage for chats, tasks, etc.
- Pluggable LLM provider interface.

## Concepts

- **Project**: the folder maclaw runs in, including its local config, skills,
  chats, tasks, and logs
- **Chat**: a saved conversation thread with its own history and scheduled tasks
- **Skill**: a file in `skills/` that describes a reusable task, workflow, or prompt
- **Tool**: a callable capability the harness can use, such as editing files,
  calling APIs, etc.
- **Provider**: the LLM backend maclaw uses, such as OpenAI or a local fallback provider
- **Task**: a scheduled job that re-enters the harness later, either once or on
  a recurring schedule

## Getting Started

1. Install Node.js 20+.
2. Install dependencies with `npm install`.
3. Set `OPENAI_API_KEY` if you want live model responses.
4. Start the REPL with `npm run dev`.

## Projects

maclaw runs in a project. It treats the current working directory as the project root.

By default, project state lives under `.maclaw/`.

If `.maclaw/maclaw.json` is present, maclaw uses it to configure that project.

Example `maclaw.json`:

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

Example project layout:

```text
my-project/
  .maclaw/
    maclaw.json
    skills/
      daily_summary.md
    data/
      sessions/
        default.json
      tasks.json
      task-runs.jsonl
```

## Commands

```text
Commands:
  /help              Show this help
  /project           Project information commands
  /chat              Chat management commands
  /history           Show the current session transcript
  /skills            List local skills
  /task              Task scheduling commands
  /quit              Exit the REPL
```

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
- `MACLAW_DATA_DIR`: overrides the default `projectFolder/.maclaw/data`
- `MACLAW_SKILLS_DIR`: overrides the configured `skillsDir`, which defaults to `projectFolder/.maclaw/skills`
- `MACLAW_SESSION_ID`: defaults to `default`
- `MACLAW_RETENTION_DAYS`: defaults to `30`
- `MACLAW_COMPRESSION_MODE`: `none` or `planned`
- `MACLAW_SCHEDULER_POLL_MS`: defaults to `15000`

## Providers

Currently supported providers:

- `openai`: uses the OpenAI Responses API and requires `OPENAI_API_KEY`
- `local`: uses the built-in fallback provider for local testing without live model calls

## Notes

- Sessions are stored as JSON files under `.maclaw/data/sessions/`.
- Scheduled tasks are stored in `.maclaw/data/tasks.json`.
- Compression is not implemented yet; `MACLAW_COMPRESSION_MODE=planned` is a forward-compatible placeholder.
- If `OPENAI_API_KEY` is missing, the harness falls back to a local non-LLM response so the REPL still works.

## TODO

- Chat support for WhatsApp, SMS, etc.
- Support other LLMs
- Improve session storage and retention policies (sqlite)
- Better project management.
- Session compression and summarization.
- MCP support
- Tool approval and policy controls.
- Tests and end-to-end dev workflow.

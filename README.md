# maclaw

<!-- HUMAN -->

maclaw is a small LLM harness built with OpenAI codex.

<!-- END -->

## Features

- REPL-based chat loop
- Local `skills/` folder with user-authored task descriptions
- File-backed session history with configurable retention
- Placeholder compression mode for future history summarization
- Scheduled tasks that can trigger the agent later
- OpenAI Responses API provider with local tool calling

## Getting Started

1. Install Node.js 20+.
2. Install dependencies with `npm install`.
3. Set `OPENAI_API_KEY` if you want live model responses.
4. Start the REPL with `npm run dev`.

## REPL Commands

- `/help`
- `/skills`
- `/history`
- `/tasks`
- `/quit`

### Tasks

Tasks can be scheduled once, hourly, daily, or weekly.

Tasks are saved in `data/tasks.json` and logged in `data/task-runs.jsonl`

## Configuration

Environment variables:

- `OPENAI_API_KEY`: enables the OpenAI provider
- `OPENAI_MODEL`: defaults to `gpt-4.1-mini`
- `MACLAW_DATA_DIR`: defaults to `data`
- `MACLAW_SKILLS_DIR`: defaults to `skills`
- `MACLAW_SESSION_ID`: defaults to `default`
- `MACLAW_RETENTION_DAYS`: defaults to `30`
- `MACLAW_COMPRESSION_MODE`: `none` or `planned`
- `MACLAW_SCHEDULER_POLL_MS`: defaults to `15000`

## Data Storage

By default, maclaw stores local data in a `data/` folder at the project root. You can change this with `MACLAW_DATA_DIR`.

Example default layout:

```text
data/
  sessions/
    default.json
    research-fork.json
  tasks.json
  task-runs.jsonl
```

What is stored there:

- `data/sessions/`: saved chat histories, one JSON file per chat
- `data/tasks.json`: the current scheduled task state
- `data/task-runs.jsonl`: append-only task execution log

## Notes

- Sessions are stored as JSON files under `data/sessions/`.
- Scheduled tasks are stored in `data/tasks.json`.
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

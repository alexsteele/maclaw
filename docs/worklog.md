# Worklog

Derived from local git history.

| Date       | # Commits | Hours (First to Last Commit) | Line Changes    |
| ---------- | --------: | ---------------------------: | --------------- |
| 2026-04-04 |        22 |                          6.5 | +8,904 / -2,417 |
| 2026-04-05 |        30 |                          4.3 | +3,555 / -504   |
| 2026-04-06 |        41 |                          3.6 | +5,451 / -1,079 |
| 2026-04-08 |        22 |                          1.9 | +2,055 / -100   |
| 2026-04-09 |         6 |                          1.5 | +1,630 / -329   |
| 2026-04-10 |        10 |                          1.8 | +2,107 / -589   |

Current code size:

- `src/`: `11,596` lines
- `test/`: `5,726` lines

<!-- codex: Include sessions near midnight with the prior day. -->
<!-- codex: Commits hours apart are separate sessions. -->

## 2026-04-04 Notes

- Built the first harness, project, chat, and task flow.
- Added server channels for WhatsApp and Slack.
- Added shared command dispatch and first agent support.
- Added tests and architecture docs.

## 2026-04-05 Notes

- Switched Slack to Socket Mode and added a Discord channel.
- Built `maclaw setup` and cleaned up the CLI layout.
- `maclaw config` command and improved error handling.
- `/project wipeout`
- Got ChatGPT models working.
- Added notifications. Agents, tasks, and policy selectors.
- alex: Frustrated with the setup code iteration. Tons of complex merge code.
  Many rounds of feedback to improve.

## 2026-04-06 Notes

- Starter tools in `src/tools`
- Test isolation. No talking to openai.
- Added `/tools`, `/chat usage`, `/project usage`, `/usage`, and `/save`.
- Basic web portal, SSE notifications, chat-first UI.
- Inbox for notifications. `/inbox`
- Initial sqlite support. Agents, tasks, inbox, chats. Transcripts stay in
  jsonl.
- `docs/config.md`

## 2026-04-08 Notes

- portal polish. sidebar, dark mode, chat switch
- Added `/new`, `/fork`, and `/reset` as chat aliases.
- Added `basePromptFile` project config support.
- Added `MACLAW_HOME` as the global root.
- REPL uses `MACLAW_HOME` default project.
- Removed most env vars. Paths and secrets only.
- `/compress`
- `/model list`
- Tools, permissions, and tool transcripts.
- Added `/send` for test notifications and inbox delivery.
- Added inbox management commands: `/inbox rm` and `/inbox clear`.
- Added response telemetry for latency and tool iterations.
- Refined tool and provenance plumbing for agent/task creation.
- Agents can spawn agents!

## 2026-04-09 Notes

- email support
- `/send email | hello world` works
- repl notification support
- `ChannelRouter` and `ChannelTarget`.
- `Harness::notify()`
- `/switch` for chats. `/project switch` for projects.
- Added `notify`, `read_chat`, and `list_channels` tools.
- Extended inbox provenance with source chat tracking for tool and lifecycle
  notifications.

## 2026-04-10 Notes

- setup streamline. `setup [section]`
- storage migration. `config set storage` snapshot/restore via `ProjectStorage`
- split storage backends
- `Harness` method grouping
- added `/chats` as an alias for `/chat list`
- fixed REPL `/switch` to chats not projects
- documented remote-runtime ideas in `docs/teleport.md`

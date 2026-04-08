# Worklog

Derived from local git history.

| Date       | # Commits | Hours (First to Last Commit) | Line Changes    |
| ---------- | --------: | ---------------------------: | --------------- |
| 2026-04-04 |        22 |                         6.53 | +8,904 / -2,417 |
| 2026-04-05 |        30 |                         4.30 | +3,555 / -504   |
| 2026-04-06 |        41 |                         3.64 | +5,451 / -1,079 |
| 2026-04-08 |         8 |                         0.78 | +658 / -181     |

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
- alex: Frustrated with the setup code iteration. Tons of complex merge
  code. Many rounds of feedback to improve.

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

# Worklog

Derived from local git history.

| Date       | # Commits | Hours (First to Last Commit) | Line Changes    |
| ---------- | --------: | ---------------------------: | --------------- |
| 2026-04-04 |        22 |                         6.53 | +8,904 / -2,417 |
| 2026-04-05 |        30 |                         4.30 | +3,555 / -504   |
| 2026-04-06 |        25 |                         1.82 | +1,981 / -691   |

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

- Cleaned up tool organization into `src/tools/` and kept only the safe
  starter tools.
- Added `/tools`, `/chat usage`, `/project usage`, and `/save`.
- Persisted provider usage on assistant messages and aggregated usage by chat
  and project.
- Improved test isolation so the suite cannot accidentally talk to OpenAI or
  any other network unless a test explicitly mocks it.

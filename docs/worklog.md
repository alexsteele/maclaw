# Worklog

Derived from local git history.

| Date       | # Commits | Hours | Line Changes    |
| ---------- | --------: | ----: | --------------- |
| 2026-04-04 |        22 |   6.5 | +8,904 / -2,417 |
| 2026-04-05 |        30 |   4.3 | +3,555 / -504   |
| 2026-04-06 |        41 |   3.6 | +5,451 / -1,079 |
| 2026-04-08 |        22 |   1.9 | +2,055 / -100   |
| 2026-04-09 |         6 |   1.5 | +1,630 / -329   |
| 2026-04-10 |        10 |   1.8 | +2,107 / -589   |
| 2026-04-11 |        24 |   6.3 | +5,491 / -323   |
| 2026-04-12 |         6 |   5.2 | +1,776 / -779   |
| 2026-04-13 |         1 |   0.0 | +1,119 / -693   |
| 2026-04-15 |         3 |   1.1 | +911 / -78      |
| 2026-04-16 |         4 |   0.5 | +1,032 / -230   |
| 2026-04-18 |        11 |   2.5 | +2,785 / -877   |
| 2026-04-19 |        13 |   3.5 | +1,639 / -476   |
| 2026-04-21 |         5 |   0.5 | +503 / -222     |
| 2026-04-24 |         1 |   0.0 | +44 / -0        |
| 2026-04-25 |         3 |   0.3 | +181 / -18      |

Current code size:

- `src/`: `20,299` lines
- `test/`: `9,400` lines

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

## 2026-04-11 Notes

- Agent inbox persistence and shared inbox type cleanup.
- Continued work on remote runtime and teleport flows.
- Added terminal markdown rendering with `marked` and `marked-terminal`.
- Threaded interface display instructions through the chat prompt path.
- Portal markdown rendering with sanitization.
- Portal polish: channels panel, reply-focused navigation shortcuts, cleaner
  assistant transcript layout, composer cleanup, and README screenshot.
- Kept command output plain in the portal for help/list alignment.

## 2026-04-12 Notes

- EC2 /teleport proof of concept.
- Added config-backed `/remote` commands for list/show/create/delete.
- Simplified `/remote create` to use JSON input plus lightweight validation.
- Removed duplicate editable server-config typing by introducing a shared
  `EditableServerConfig`.
- Refined teleport remote interfaces into `src/teleport/remote.ts`.
- Added `RemoteAccess`, `RemoteExecutor`, and `RemoteRecipe` outlines.
- Proved out SSH remote access with a concrete executor and bootstrap recipe.
- Continued simplifying teleport types and boundaries around runtime, tunnel,
  and remote access.

## 2026-04-13 Notes

- Split provider-specific SSH and EC2 connection behavior out of teleport and
  into `src/remote`.
- Added an `http` remote type for direct HTTP access, with a warning that plain
  HTTP should generally be used locally or through a secure tunnel.
- Simplified the remote/teleport boundary so teleport depends on remote, not the
  other way around.
- Reworked remote connection flow so `remote.connect()` now returns a
  ready-to-use maclaw client plus cleanup metadata.
- Simplified naming across the stack: `RemoteConnection`, `MaclawClient`, and
  `HttpMaclawClient`.
- Moved the shared HTTP client into `src/remote/client.ts`.
- Cleaned up REPL teleport prompt rendering to use a shorter remote-style prompt
  header.
- Improved SSH bootstrap so an empty remote workspace clones the maclaw repo
  automatically before installing and building.

## 2026-04-15 Notes

- Added dangerous rooted file tools: `read_file`, `write_file`, and `list_dir`.
- Grouped built-in tools into toolsets and exposed the `files` toolset in
  `/tools`.
- Proved Docker-on-EC2 as a working remote runtime, including image build,
  mounted data directories, and teleport access through Session Manager.
- Documented the working Docker EC2 recipe in `docs/sandbox.md` and
  `skills/setup_docker.md`.
- Added Docker as a runtime mode on remotes instead of a new remote type.
- Taught SSH and EC2 remotes to bootstrap, start, and stop maclaw in Docker.
- Simplified server remote config loading so sparse remote config stays sparse
  instead of being reshaped with lots of implicit defaults.

## 2026-04-16 Notes

- Added startup-time sqlite column backfill for older local databases.
- Added `/agent prune` and `/agent rm`.
- Continued moving command handling toward smaller alias/subcommand registries.

## 2026-04-18 Notes

- Reorganized command dispatch around cleaner subcommand registries.
- Added `/tasks prune`, `/chats prune`, `/cost`, and `/agent show`.
- Added rooted workspace search/file listing improvements.
- Improved help rendering and `/agent tail`.
- Added project defaults for agent max steps and timeout.
- Started SSH shell-style remote clients.

## 2026-04-19 Notes

- Added shell remote attach flow and `maclaw teleport <remote>`.
- Improved remote setup prompts, recipe-driven setup, and remote prompt labels.
- Continued REPL/help cleanup and agent steering prompt work.
- Changed harness teardown to pause running agents instead of cancelling them.
- Moved agent transcripts into agent-owned folders.

## 2026-04-21 Notes

- Added `!<command>` shell escapes in the REPL.
- Added first-class `/project new` and `/project switch` dispatcher commands.
- Removed backticks from command help bullets for better terminal rendering.
- Moved REPL custom commands to a small command registry.

## 2026-04-24 Notes

- Added short aliases for common command trees: `/p`, `/c`, `/t`, and `/a`.

## 2026-04-25 Notes

- Improved terminal markdown list rendering and list-line wrapping.
- Switched REPL wrap width to follow the live terminal width by default.
- Improved wrapping for both plain-text bullets and markdown-rendered list
  items.

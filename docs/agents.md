# Agents

Date: 2026-04-04
Collaborators: alex, codex

## Goal

Support autonomous agents that run inside a project context to complete tasks
over time.

Agents should be able to:

- run against one project at a time
- use the project base prompt and approved tools
- optionally inherit the chat context they were created in
- work within a time or budget target
- respect rate limits such as prompts per minute
- talk to the user for human-in-the-loop (HITL) style workflows
- keep an inspectable log of their work
- eventually spawn other agents if explicitly allowed

Users should be able to start, stop, list, and maybe steer running agents.

## Proposal

Start simple with an `Agent` class inside a project `Harness`.

`Harness` should own agents inside a project. That means the harness is the main
boundary for creating and managing agents.

A new `Agent` class will manage the agent loop and chat history.

- `Agent`
  - one autonomous worker/run
  - data schema
    - `id` - generated, unique within a project
    - `name` - user given, reusable
    - `prompt`
    - `status`
    - `startedAt`
    - `finishedAt`
    - `deadline`
    - token budget/rate limits
    - tool policy

- `AgentStore` - stores agent info

Agent will reuse the chat storage code for their chats.

`MaclawAgent` will also be refactored to `ChatRuntime` since its main
responsibility is constructing prompts.

## Commands

```
/agents create <name> <prompt> <options...>
/agents list
/agents stop <name>
```

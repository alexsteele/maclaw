# Sandbox

Date: 2026-04-11
Collaborators: alex, codex

## Goal

Let agents use stronger tools like:

- file read/write
- shell commands
- web fetch/search
- cloud integrations

without letting them directly modify the host machine.

The core idea is:

- agents work in a sandbox first
- users review and approve anything that should come back to the host

## Requirements

The first sandbox environment should support:

- isolated filesystem
- isolated process execution
- bounded network policy
- cheap startup
- easy cleanup
- good logging and auditability
- a clear way to copy artifacts or patches back out

Nice-to-haves:

- image/container snapshotting
- reusable base environments
- per-project caches
- resource limits for CPU, memory, and time

## Execution Model

The likely maclaw flow is:

1. user starts an agent in a sandbox
2. the agent gets sandbox-only file and shell tools
3. the agent produces:
   - a patch
   - files
   - logs
   - a summary
4. maclaw shows the result
5. the user explicitly approves any apply/copy-back step

This keeps host writes separate from sandbox writes.

## Capability Tiers

The tool roadmap should move in stages:

1. local read tools
2. web read tools with domain controls
3. sandboxed file and shell tools
4. review/apply back to the host
5. narrow cloud tools like Google Calendar or Docs

This lets us unlock usefulness without going straight to full machine access.

## Environment Options

### Local container

Pros:

- fast iteration
- cheap
- simple developer experience

Cons:

- still runs on the user machine
- harder to treat as a strong trust boundary
- local Docker/runtime requirements may be annoying

This is a good dev path, but not the whole answer.

### AWS runner

Pros:

- stronger isolation story
- easy to separate from the host machine
- clearer network and IAM controls
- fits future hosted/shared maclaw setups

Cons:

- more setup complexity
- instance/container startup cost
- secret handling must be designed carefully

This is the best first cloud direction.

### Other hosted runners

Possibilities:

- Fly.io
- Modal
- ECS/Fargate
- Lambda-style short jobs

These may still be good later, but AWS gives the clearest path for controlled
networking, storage, and identity.

## AWS Recommendation

The first AWS version should be simple:

- one sandbox runner per task/agent
- ephemeral workspace
- uploaded prompt/context bundle
- output bundle with:
  - logs
  - artifacts
  - patch or changed files

The first concrete AWS shape I would explore is:

- ECS Fargate task
- one container image
- S3 for input/output bundles
- CloudWatch for logs

Why Fargate first:

- simpler than managing EC2 instances
- stronger boundary than local-only containers
- easy to run short-lived isolated jobs

## Interfaces We Will Likely Need

We do not need to implement all of this yet, but the likely shape is:

```ts
type SandboxRequest = {
  projectName: string;
  chatId: string;
  agentId?: string;
  prompt: string;
  tools: string[];
};

type SandboxResult = {
  summary: string;
  logs: string[];
  artifacts: string[];
  patch?: string;
};

interface SandboxRunner {
  run(request: SandboxRequest): Promise<SandboxResult>;
}
```

That gives us room for:

- local runner
- AWS runner
- future hosted runners

without changing the higher-level harness too much.

## Near-Term Plan

1. keep adding safe read-only tools locally
2. design the sandbox runner interface
3. build a local dev runner first if needed for iteration
4. build an AWS Fargate prototype runner
5. add `/sandbox` as the user-facing entry point
6. add review/apply flow for artifacts and patches

## Non-Goals For First Pass

Do not start with:

- host file write access
- arbitrary shell access on the host
- broad browser automation
- unrestricted web scraping
- broad cloud document mutation

The first milestone should prove:

- isolated execution
- useful outputs
- explicit approval before host changes

# Sandbox

Date: 2026-04-11 Collaborators: alex, codex

## Goal

Make it easy to run agents in a sandboxed environment.

Let agents use stronger tools.

We want to support local and cloud environments. Both long-lived and ephemeral.
Users should able to easily spin-up and control their sandboxes. We want all of
this to be automatable via maclaw chats eventually, so you can just tell maclaw
to spin up and run an agent.

## Design

### Main Flows

Provisioning and setup:

```shell
maclaw setup remotes
maclaw remote recipe create <name>
maclaw remote create <name>
maclaw remote create <name> --recipe <recipe>
maclaw remote bootstrap <name>
maclaw remote sync <name>
```

Lifecycle and access:

```shell
maclaw remote start <name>
maclaw remote stop <name>
maclaw remote status <name>
maclaw teleport <name>
```

State and teardown:

```shell
maclaw remote pull <name>
maclaw remote snapshot <name>
maclaw remote delete <name>
```

### Remote Work Example

The intended flow is:

```shell
maclaw remote create aws-dev
maclaw remote sync aws-dev
maclaw teleport aws-dev
```

Then from the remote-attached session:

```text
> /agent create pr-fix | Fix the bug, open a GitHub PR, and email me the result
```

### Core Concepts

We likely need three main concepts:

- remote
  - a concrete environment we can start, stop, sync, teleport into, and delete
- remote recipe
  - a reusable template for creating remotes with defaults like provider,
    region, instance type, and ports
- remote state
  - the durable state of the remote workspace, such as git state, `.maclaw/`,
    logs, and artifacts

### Data Model

We likely need a remote config shape along these lines:

```ts
type RemoteConfig = {
  name: string;
  provider: "ssh" | "aws-ec2";
  region?: string;
  instanceId?: string;
  remoteServerPort?: number;
  localForwardPort?: number;
  recipe?: string;
};
```

And a lightweight recipe shape:

```ts
type RemoteRecipe = {
  name: string;
  provider: "ssh" | "aws-ec2";
  region?: string;
  instanceType?: string;
  remoteServerPort?: number;
  localForwardPort?: number;
};
```

## Current Manual Proof

We have already manually validated a first EC2 remote workspace flow:

- local AWS access
- Session Manager plugin
- EC2 instance with SSM access
- remote Node.js install
- remote `maclaw server`
- local teleport via Session Manager port forwarding

That gives us confidence that the remote workspace path is real.

## Docker on EC2

We can also run maclaw in Docker on EC2. Steps in skills/setup_docker.md.

## First Implementation Path

1. extend remote config to support AWS-backed remotes
1. remote setup flow (ec2)
1. remote commands create/status

Milestone

- `maclaw teleport <name>` works against a configured AWS remote workspace

Once that works, the rest of the remote workflow becomes much easier to build.

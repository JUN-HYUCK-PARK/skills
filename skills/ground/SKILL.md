---
name: ground
description: >-
  Ground simplifies local development on one machine: existing project commands,
  service addresses and ports, shared infrastructure, and project data isolation.
  Use when starting, checking, or switching a local environment, resolving port
  conflicts, adopting a shared engine set, or when the user runs /ground.
  Project values live in .agents/runtime-profile.yml.
---

# Ground

Reuse the project's existing development procedure. Keep one app baseline per
project and share engines where the project has chosen to. Values and executable
commands belong in `.agents/runtime-profile.yml`; read it before acting and do
not invent missing commands. Schema: [runtime-profile.md](references/runtime-profile.md).

## Adopt an existing environment

Ground requires Kubernetes for app workloads. k3s, k3d-managed k3s, and an
existing Kubernetes cluster are eligible. A Docker provider hosts the runtime;
it does not replace the Kubernetes requirement. Compose is for shared data engines.

Before configuration, confirm the Kubernetes context, namespace, entrypoint
Service mappings, domains, and data ownership. Reuse settled answers; ask only
for missing choices. Machine gateway bootstrap is explicit and separate from
routine work. Record its values in repo-local configuration.

For named access, opt into the Portless gateway and follow the
[named-access procedure](../../infra/access/README.md). That procedure owns
one-time HTTPS/name-resolution setup, startup, public readiness, and cleanup.
It reuses Portless; no agent launcher or custom proxy is introduced.

A project may retain its own ingress instead; the [DNS procedure](../../infra/dns/README.md)
applies there. Kubernetes Service DNS remains internal to the selected cluster.
Keep host app names and cluster Service names distinct.

Record the context with `init --context NAME` and data ownership with
`--infra machine|project`. Initialization without a context is an incomplete
draft. Profile fields: [runtime requirements](references/runtime-profile.md#environment-choice).
Do not migrate or stop shared data engines to adopt Kubernetes.

## Inspect and run

1. Validate the project profile. Observe its actual target and status through
   the project's existing procedure before mutation.
2. For a configured named entrypoint, inspect `de-novo skills dev` without
   applying, then apply the agreed target. The command deploys or attaches,
   connects, registers, and verifies the public URL before reporting ready.
3. Keep the foreground session while working. Its readiness message is a
   measured startup observation, not a claim that an application can never fail.
4. End the session normally so it removes its route, forwarding process and
   newly created overlay. The baseline and machine gateway remain available.

`urls` remains a read-only name renderer. A printed name is not a ready URL.
Other runtime actions use only the project's configured commands and ownership
mechanism. Never start a competing baseline from another worktree.

## Runtime ownership

Many readers, one baseline writer. Before changing a shared app baseline, read
its status and operating procedure, identify the writer and runtime location,
and obtain ownership through the project's existing mechanism. A profile's
writer count is a policy, not a lock. If ownership cannot be established, report
what is missing before mutating. Verify the result and hand ownership back.
Do not start a competing baseline from another worktree.

Existing authorization remains valid for its target and scope. Machine engine
starts, restarts, provisioning, and shared migrations require the machine
owner's authorization. Inspection alone does not grant it. Machine effects and
commands: the CLI checkout's `infra/README.md`. There is no machine down command.

## Shared data

Use the chosen backend's existing engine set. Separate projects by database,
account, namespace, or prefix. Use the profile's permitted fixture paths and
check their results; never write directly to shared databases. Switching app
profiles must not stop machine infrastructure.

## Verify the development loop

Use the service's measured reflection mode to decide whether a change needs
source reload, restart, or rebuild. Observe the affected running application
before claiming success. Count what was checked and name unmeasured boundaries.
Configuration validation alone does not establish runtime health or routing.
Browser QA and e2e remain with the project's existing verification procedure.

## Optional overlays

Only when the profile enables overlays and supplies a command, use
`de-novo skills overlay` and follow the [lifecycle contract](references/overlay-contract.md).
That reference owns revision checks, recovery, leases, and cleanup. The named
entrypoint command integrates that same contract rather than bypassing it. Keep this
extension out of ordinary setup when a project does not need concurrent instances.

Ground does not configure harnesses, agent tools, hooks, sessions, or task assignment.

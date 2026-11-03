# Ground

Named development URLs for Kubernetes apps and optional service overlays.

## What it does

Runs a declared entrypoint through its existing deployment procedure, connects
its Kubernetes Service, and registers a verified URL with Portless. Runtime and
data values stay in the project profile; shared engines remain independent.

## When to reach for it

A person or model can use Ground to start or inspect a local environment,
resolve port conflicts, or connect a project to shared infrastructure.

## It's working if

- `dev` reports a working named URL after public readiness succeeds.
- The configured app commands work from the designated runtime location.
- Service requests reach the expected application after an edit.
- Projects use distinct data isolation units on their chosen engines.

## Where it fits

Ground is the catalog's published skill. It reuses app scripts and existing
infrastructure; it configures no agent launcher, hooks, or task manager.
Kubernetes and DNS are required; overlays remain off unless explicitly enabled.

## What it does to your machine

| Action | Effect | Cleanup |
| --- | --- | --- |
| `init` | Writes a project values file | Remove that file if unused |
| `doctor`, `validate`, `urls` | Read and report; no engine starts | None |
| Authorized `infra up` or `setup` | Downloads engine images, starts named engines, provisions project data units | Machine owner manages shared infrastructure |
| Explicit gateway bootstrap | Starts Portless; may install CA trust and manage host entries | Gateway owner manages the shared service |
| `dev --apply` | Deploys/connects an entrypoint and owns its route/forward | Normal exit removes owned access and a newly created overlay; baseline remains |
| Opt-in overlay commands | Dispatch the project's adapter and track its environments | `overlay destroy` for the named environment |

## Apply to a project

Follow [planting](references/planting.md): discover the existing environment,
confirm the target and data owner, then complete the
[named-access bootstrap](../../infra/access/README.md). Existing answers are reused.
See [environment choices and integration limits](references/runtime-profile.md#environment-choice).

## Pointers

[Pattern](SKILL.md), [schema](references/runtime-profile.md),
[examples](examples/), [machine backend](../../infra/README.md),
[optional overlay contract](references/overlay-contract.md).

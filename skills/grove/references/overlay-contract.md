# Overlay lifecycle contract

Grove owns the lifecycle gate, lease registry, and counted receipts. The
consuming project owns its overlay workloads and routing implementation through
`runtime.commands.overlay`. Grove never invents a Docker, Compose, or Kubernetes
cleanup command.

Profile fields and value syntax live in
[`runtime-profile.md`](runtime-profile.md). This file owns the command and
receipt contract.

## Lifecycle

```text
absent --create--> live --attach/detach/touch--> live --destroy--> absent
                                   |
                                   +--stale lease--prune --apply--> absent
```

Use only the Grove front door:

```bash
de-novo skills overlay status [env] [--project <root>]
de-novo skills overlay create <env> [--project <root>] [--apply]
de-novo skills overlay attach <env> <service> --image <full-sha> [--project <root>] [--apply]
de-novo skills overlay detach <env> <service> [--project <root>] [--apply]
de-novo skills overlay destroy <env> [--project <root>] [--apply]
de-novo skills overlay touch <env> [--project <root>]
de-novo skills overlay prune [--project <root>] [--stale-after <duration>] [--apply]
```

Do not call `runtime.commands.overlay` directly. A direct call bypasses the
lease registry, so Grove cannot distinguish a live environment from leaked
workloads.

Environment names are DNS labels of at most 63 characters. Attach accepts only
an image tag ending in a 40-character lowercase git SHA or a `sha256` digest.
The service must be listed in `overlay.attachable`.

Project `create`, `attach`, `detach`, and `destroy` implementations must be
idempotent for the same arguments so a command can be retried after a process
interruption. Grove updates its registry only after the project returns a valid
success receipt.

## Leases and stale environments

Grove records `created_at` and `last_used_at` for every environment. Successful
`create --apply`, `attach --apply`, `detach --apply`, and `touch` operations
renew `last_used_at`. Read-only `status` does not renew it.

Staleness means:

```text
now - last_used_at >= stale_after
```

Durations use a positive integer followed by `s`, `m`, `h`, `d`, or `w`.
There is deliberately no default retention period. Put `stale_after` in the
project profile, or pass `--stale-after` to `status` and `prune`. `prune`
refuses to run without one of those explicit policies.

`status` returns non-zero when a tracked environment is stale or when project
runtime inventory differs from the registry. A long-running task renews its
lease with `touch`. A task destroys its environment when work ends; retention
is a backstop for abandoned work, not the normal end path.

`prune` is plan-first regardless of the project implementation:

- Without `--apply`, it prints exactly which stale environments would be
  destroyed and does not invoke the project command.
- With `--apply`, it dispatches `destroy` once per stale environment. A failed
  destroy stays in the registry and is counted as retained. Successful entries
  are removed atomically, including after a partial failure.
- An environment touched after the plan is recalculated under the registry
  lock and is not removed.

An environment reported by project `status` but absent from the registry is
`untracked` drift. Grove does not assign an invented age and will not prune it
automatically. Inspect it, then clean it explicitly with
`overlay destroy <env> --apply`.

## Plan and apply

`overlay.plan_first` tells Grove how the project command behaves:

| Profile value | Grove command without `--apply` | Grove command with `--apply` |
| --- | --- | --- |
| omitted or `true` | Dispatch without `--apply`; require `plan: true`; registry unchanged | Dispatch with `--apply`; reject a plan-only receipt; update registry after success |
| `false` | Refuse without dispatch | Dispatch without forwarding `--apply`; reject a plan-only receipt; update registry after success |

Project-specific arguments may follow `--`. Grove never retries by guessing
from stderr.

## Project command invocation

Grove tokenizes `runtime.commands.overlay` as an executable and arguments. It
does not evaluate a shell expression.

```text
cwd     = project root containing .agents/runtime-profile.yml
timeout = 120000ms
argv    = configured command + verb + lifecycle arguments
```

`GROVE_OVERLAY_TIMEOUT_MS` may set a positive timeout in milliseconds.

The last non-empty stdout line must be one JSON object. Exit code zero without
`ok: true` is a failure. Identity fields must match the request; otherwise the
registry remains unchanged.

```json
{
  "ok": true,
  "verb": "attach",
  "env": "w1",
  "service": "api",
  "image": "example/api:0123456789abcdef0123456789abcdef01234567",
  "plan": false
}
```

Required fields:

| Verb | Required receipt identity |
| --- | --- |
| `create` | `ok`, `verb`, `env` |
| `attach` | `ok`, `verb`, `env`, `service`, `image` |
| `detach` | `ok`, `verb`, `env`, `service` |
| `destroy` | `ok`, `verb`, `env` |
| `status` | `ok`, `verb` |

An applied `attach` with `addressing.proxy: machine` also requires `upstream`.
Grove still does not start a hostname listener; that proxy value is declared
intent.

For drift measurement, `status` may add a complete runtime inventory:

```json
{
  "ok": true,
  "verb": "status",
  "environments": [
    { "env": "w1", "services": ["api"] }
  ]
}
```

If `environments` is omitted, the counted report says `drift notMeasured`.
`project-status 1/1` means only that the command returned a valid receipt; it
is not presented as a clean runtime.

## Registry and concurrency

The machine-local registry is `~/.dev-infra/overlays/<project-slug>.yml`.
`GROVE_STATE_DIR` overrides its directory for isolated tooling and tests.
Files are written by temporary-file rename with private permissions. Mutations
hold a per-project exclusive lock; a dead same-machine process lock is
recovered, while a live or unknown owner is not stolen.

The registry contains lifecycle metadata, image references, optional upstreams,
and the creating agent/worktree. It contains no credentials. It is not a second
workload controller: runtime drift is reported, not silently repaired.

Overlay cleanup never stops Grove's shared engines. There is no `down` command.

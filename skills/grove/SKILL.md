---
name: grove
description: >-
  de-novo Grove — shared local ground on one machine. n projects, m apps each,
  one infra set. Names instead of ports; thin overlays instead of cloned stacks.
  Use when starting, checking, or switching a local environment; when matching
  ports; when several agents work and verify on the same machine at once; when
  planting Grove on a new project; when the user runs /grove. Project values
  live in .agents/runtime-profile.yml. Browser QA and e2e runners are out of
  scope.
---

# Grove

A de-novo skill. Shared local ground for many projects and agents on one machine.
One soil (engines), n trees (projects), m branches (apps) per project. Grafts
(overlays) cover only the apps you changed. Human diagram and apply steps:
[README.md](README.md).

On one machine, several people and agents break the environment in two ways:

- **Ports.** Each project and each agent starts a stack and fights over well-known
  ports. CORS and redirects break. Nobody can answer which port that app is on.
- **Parallel verification.** Several agents each want to open *their* change.
  Cloning a full stack explodes ports. Sharing one stack overwrites deploys.

This skill runs local infra in one place so those two stop happening. It does
not prescribe how you verify — it gives named addresses and the stack they
point at.

**This file is the pattern only.** Domains, ports, service lists, backends, and
real commands live in the project's `.agents/runtime-profile.yml`. Read it
before you work. If there is no profile, first run
`de-novo-skills init <project-root>`. Schema:
[runtime-profile.md](references/runtime-profile.md). Implementation details
belong to the backend the profile chose — this skill does not pick a backend.

`m` is the number of keys in profile `services`. The project is `project.slug`.

## Operating model — four pillars

### 1. One long-lived shared baseline

Sharing has two layers.

- **Infra engines (DB, cache, broker) are one set on the machine.** Projects
  do not own them. Isolate inside the engine (database, account, prefix), not
  by port. The shared name for those units is the project **namespace**
  (profile `project.namespace`, default = slug). App-layer isolation names
  come from here too. Where a backend writes that name is the project's job.
- **One app baseline per project.** Do not run a full stack per agent. The m
  apps live on that one set.

How it runs is `runtime.profiles`. If two profiles own the same fixed ports,
**do not run them at once.** Switch explicitly.

### 2. Thin per-agent overlay

Parallel verification is an overlay, not a cloned stack. Attach **only the
apps you changed**; the rest fall through to baseline. Do not add ports —
split by address.

- Attachable apps are `overlay.attachable`. Never attach `overlay.shared_only`.
- Overlay images are tagged with a full git SHA. There is no "latest".
- Detach as soon as the override is unused, and destroy the env when the unit
  of work ends. Overlay lifetime is the task.
- Run overlay verbs only when `runtime.commands.overlay` exists. If the
  command is missing or `overlay: none`, do not apply this pillar.

### 3. Hostname fallthrough routing

Do not make people pick ports. Addresses are names. One wildcard local domain
on the machine; `addressing.scheme` sets the name rules.

```
shared  : {service}.{tld}              that app on the project's baseline
overlay : {service}--{env}.{tld}       overlay if attached to env,
                                       else fall through to shared
```

When n projects share a machine, put `{project}` in the scheme so names do
not collide. Who listens is `addressing.proxy`. TLD and scheme choices:
addressing section of [runtime-profile.md](references/runtime-profile.md).

### 4. Single writer for runtime

Many readers, one writer (`runtime.writers: 1`).

- **Do not start services from a worktree.** Runtime ownership sits in the
  designated runtime environment.
- Agents do not start, stop, or restart shared infra, do not run shared
  migrations, and do not write the shared DB directly. Declare the need to
  the owner.
- When you need data, create it only on paths `data.fixtures` allows, and
  leave a before/after probe.

## Procedure

Values come from the profile. Commands come from the profile. Do not invent a
missing command.

### Infra setup is the yaml

Declared engines are all of `data.engines`. Do not pick engines by hand; run
the tool that reads the declaration (`de-novo-skills setup <project-root>`
when `data.infra: machine`). Start only those engines, provision internal
units idempotently, and print a counted summary (engines n/n, DBs n/n). When
a new engine is needed, add it to the yaml and run again — do not invent a
new command.

After writing or editing a profile, count invariants with
`de-novo-skills validate <project-root>`. No docker required.

### Status first, always

Before anything else, query the current profile and status. The command is
`runtime.commands.status`. "It is probably up" is not a measurement — hit
`services.*.health`. Health paths differ per app. Do not guess; read the
profile. Apps without health (workers and similar) are omitted from the
profile; do not invent a path.

### Start and switch

1. Check status. If another profile is up, take it down first.
2. Plan-first: if a command prints what would run, run that first.
3. After start, **verify by artifacts** — exit 0 is not the same as the
   environment existing. Count health responses and whether infra is ready.

Commands are `runtime.commands.up` / `status`.

### Overlay lifecycle

Append these verbs to `runtime.commands.overlay`. If that command is missing,
stop here.

```
create <env>
attach <env> <service> --image <full-sha>
  → confirm {service}--{env}.{tld} points at the overlay
detach <env> <service>
destroy <env>
```

### Check how changes land before you say "nothing changed"

How a change shows up is `services.*.reflect`:

```
source    edit is live immediately
rebuild   rebuild and restart before it shows
restart   restart only
```

The usual cause of "I don't see my edit" is changing a rebuild app and
hitting the same address again.

## Setting up a new project

1. `de-novo-skills init <project-root>` plants a minimal profile
   (`overlay: none`). `--slug` `--engines` `--services` can fill values.
   Then edit app list (m), backend tier, address scheme, and data policy in
   the profile. Schema: [runtime-profile.md](references/runtime-profile.md).
   Examples: [examples/](examples/) — shape of values, not a required backend.
2. **Do not over-tier.** If there are few apps and no parallel agents, apply
   addressing and ownership only and leave overlay off (`overlay: none`).
   Overlay pays off when m is large and several agents verify the same
   project at once.
3. Keep the port registry in the file the profile points at, and declare it
   as source of truth. Ports outside the registry die first in CORS and auth.

## Invariants — not weakenable

The profile may change values. These are not values; the profile cannot
weaken them.

- One standing stack per project (`single_stack`)
- One runtime writer (`writers: 1`)
- No starting services from a worktree
- No direct writes to the shared DB; create data only via fixture paths
- Overlay images tagged with an exact revision
- Success of start/install is artifacts existing, not exit code 0

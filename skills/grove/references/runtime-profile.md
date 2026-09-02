# runtime-profile.yml — values the project owns

`.agents/runtime-profile.yml` at the project root. The skill states the
pattern; this file states this project's values. **Do not copy the skill
body here** — keep values, paths, and commands only. Allowed top-level keys:
`version` `project` `addressing` `runtime` `services` `overlay` `data`.
Unknown keys such as `qa` are rejected by `de-novo-skills validate`.

## Full schema (comments are the spec)

```yaml
version: 1

project:
  slug: myproject               # identifier for hostnames and the machine registry
  # namespace: myproject_dev    # shared name for all isolation units. default = slug
  # host: myproject             # DNS label. default = slug with _ → -

addressing:
  tld: local.myproject.dev      # machine-wide wildcard namespace (see below)
  # proxy: none                 # omitted = none. none|machine|project|portless
  scheme:
    shared: "{service}.{tld}"
    overlay: "{service}--{env}.{tld}"
    # several projects on one machine: "{service}.{project}.{tld}"
  ports:
    blocks: { api: 5000, web: 5100, infra: 7000 }
    registry: README.md         # where the port registry lives. if this file disagrees, that file wins

runtime:
  default: developer
  single_stack: true            # invariant — cannot be false
  writers: 1                    # invariant — cannot grow
  profiles:
    planner:                    # light checks / planning
      backend: docker-compose
      compose_file: docker-compose.yml
    developer:                  # development that needs overlay. omit if unused
      backend: k3d
      cluster: local
  commands:                     # real commands the skill procedure calls
    profile: node tools/dev-environment.mjs profile
    status: node tools/dev-environment.mjs status
    up: node tools/dev-environment.mjs up --apply
    overlay: node tools/dev-overlay.mjs   # omit when overlay: none

services:
  my-api:
    kind: api
    port: 5001
    health: /api/health         # write a measured path. guessing yields 404
    reflect: rebuild            # source | rebuild | restart
  my-web:
    kind: web
    port: 5101
    health: /
    reflect: source

overlay:                        # single-service projects: `overlay: none`
  attachable: [my-web, my-api]
  shared_only: [auth-api]       # auth, schedulers, consumers — never attach
  image_tag: full-git-sha

data:
  infra: machine                # machine (default) | project (legacy, pre-migration only)
  engines:                      # machine: engines and isolation units on shared infra
    mysql: [myproject]          #   databases created by bin/provision
    redis: { prefix: "myproject:" }
  migrate: pnpm run db:migrate:local
  fixtures: [ui, official-api, fixture-endpoint, seed-script]
  forbid_direct_db_writes: true # invariant
```

## How to pick values

### addressing.proxy

**Who listens** on this project's hostnames. Separate from whether the machine
runs Caddy.

| Value | Meaning |
| --- | --- |
| `none` (omit default) | Print URLs only. Do not open a listener |
| `machine` | This repo's Caddy listens on `{service}.{project}.{tld}` |
| `project` | The project (k3d Gateway, etc.) listens. Omitted from machine Caddy |
| `portless` | Host process wrapper. Not the source of truth for machine fallthrough |

Projects whose k3d already binds `:80` must set `project` **explicitly**. If
the default were `machine`, setup alone would steal that port.

### addressing.tld — one namespace for many domains

Pick **one** wildcard namespace on the machine; every project lives in it.
Three options, best first:

| Method | HTTPS | Setup | When |
| --- | --- | --- | --- |
| Owned real domain (`*.local.example.co.kr` → 127.0.0.1) | Real certs possible (DNS-01) | One DNS record | OAuth redirects, team-shared URLs |
| `*.localhost` | mkcert self-signed | None (OS loopback) | Personal machine, no external callbacks |
| dnsmasq custom TLD | mkcert | Install dnsmasq | No real domain and localhost does not fit |

The proxy is `portless` (`PORTLESS_TLD` is already a parameter), traefik, or
caddy — the project chooses. Either way **one domain namespace per machine** —
a new TLD per project multiplies certs and trust.

### runtime.profiles — how to pick a tier

```
1–2 services, no parallel agents   → planner (compose) only. omit developer
multi-service, parallel agents     → add developer. backend:
  ships to k8s                     → k3d (reuse manifests)
  otherwise                        → compose + proxy routing is enough
```

The moment you add developer(k3d) you owe a SHA image-build pipeline. Decide
if the project will pay that cost.

### ports.blocks

These are **app** ports — infra engines are machine-shared (this repo `infra/`,
standard ports) and do not belong in the project port plan. Layer blocks
(api/web) are convention; values are free. When several projects bind fixed
ports on one machine, assign non-overlapping 100-wide blocks. Proxy routing
makes ports an internal concern and lowers collision pressure.

### data.infra

Default is `machine`: engines come from this repo's shared infra; the project
declares only its databases and prefixes. `project` records a pre-migration
state where the project still runs its own infra — not a value for new
projects.

### project.namespace — shared name for isolation units

Every name that isolates this project on machine infra comes from here:
database (`<ns>`), redis key prefix (`<ns>:`), kafka topic/group prefix
(`<ns>.`), minio bucket, and if developer(k3d) is used, the app-layer k8s
namespace. Per-engine declarations override this default only when needed.

Engines have different character rules; the setup tool rewrites them:
database `-`→`_`, bucket/k8s `_`→`-`. To skip rewriting, start with
`[a-z][a-z0-9]*` so the name is identical everywhere.

### data.engines — the declaration is the setup input

`de-novo-skills setup <project-root>` reads this and starts only the engines
needed, then provisions databases idempotently. Value shapes:

| Engine                     | Value                                     | What setup does              |
| -------------------------- | ----------------------------------------- | ---------------------------- |
| `mysql` / `pg` (postgres)  | `true` (= slug) or `[db-name, …]`         | create database + dedicated account |
| `redis`                    | `true` or `{ prefix: "slug:" }`           | start only — prefix is an app convention |
| `kafka`                    | `true` or `{ topic_prefix: "slug." }`     | start only — prefix is an app convention |
| `mongo`                    | `true` or `[db-name, …]`                  | start only — DB created on first connect |
| `mail` / `minio`           | `true` (minio may use `{ bucket }`)       | start only                   |

Unknown engine names are rejected — add the engine to this repo's compose and
ENGINES table first, then declare it.

### services.*.health / reflect

**Measure, then write.** Health is a path that actually returned 200. Reflect
is how an edit lands, confirmed by making one change. A measured date in a
comment lets the next person doubt staleness.

## Verify

After writing or editing a profile:

1. `commands.status` actually runs and matches the service list.
2. Request every health path and get the expected response (checking 0 of 0
   is not a check — count how many of how many answered).
3. At least one hostname built from the address scheme actually routes.
4. The port registry (`ports.registry`) agrees with this file.

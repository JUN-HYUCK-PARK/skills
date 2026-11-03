# runtime-profile.yml — values the project owns

`.agents/runtime-profile.yml` at the project root. The skill states the
pattern; this file states this project's values. **Do not copy the skill
body here** — keep values, paths, and commands only. Allowed top-level keys:
`version` `project` `addressing` `runtime` `services` `overlay` `data`.
Unknown keys such as `qa` are rejected by `de-novo skills validate`.

## Full schema (comments are the spec)

```yaml
version: 1                      # omitted = 1; any other explicit version is rejected

project:
  slug: myproject               # identifier for hostnames and the machine registry
  # namespace: myproject_dev    # shared name for all isolation units. default = slug
  # host: myproject             # DNS label. default = slug with _ → -

addressing:
  # tld omitted — inherit this Ground checkout's infra/addressing.yml
  # (infra/addressing.local.yml overrides, gitignored). Pin a domain in
  # this project repo with tld: local.example.com, or
  # .agents/runtime-profile.local.yml for one clone. Not ~/.dev-infra.
  # tld: local.example.com
  # proxy: none                 # omitted = none. none|machine|project|portless
                                # machine is intent; portless needs explicit machine bootstrap
  scheme:
    shared: "{service}.{project}.{tld}"     # web.acme.local.example.com
    overlay: "{service}--{env}.{project}.{tld}"
    # exclusive project domain (OAuth already bound): "{service}.{tld}"
    # shared requires {service} + {tld}; overlay also requires {env}.
    # Templates and final rendered hostnames must be valid DNS names.
  ports:
    blocks: { api: 5000, web: 5100 }
    registry: README.md         # where the port registry lives. if this file disagrees, that file wins

runtime:
  default: development
  single_stack: true            # invariant — cannot be false
  writers: 1                    # invariant — cannot grow
  profiles:                    # names are project choices; apps require Kubernetes
    development:
      backend: kubernetes      # kubernetes | k8s | k3s | k3d
      context: dev-cluster     # required explicit target for validate and dev
      namespace: myproject    # required for named access
      overlay_namespace: "{namespace}-{env}"  # named overlays only
      # kubeconfig: /path/to/config  # optional; relative paths use the project root
  commands:                     # optional. init plants none. run only if present
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
    kubernetes: {service: my-api, port: http}   # optional named-access mapping
  my-web:
    kind: web
    port: 5101
    health: /
    reflect: source
    kubernetes: {service: my-web, port: 8080}
  auth-api:
    kind: api
    port: 5002
    health: /health
    reflect: rebuild

overlay:                        # single-service projects: `overlay: none`
  attachable: [my-web, my-api]
  shared_only: [auth-api]       # auth, schedulers, consumers — never attach
  image_tag: full-git-sha
  plan_first: true              # omitted = true
  # create_on: plan             # omitted = plan. attach = the first applied attach creates the env
  # stale_after: 1d             # optional; no default. s|m|h|d|w

data:
  infra: machine                # machine (omitted default) | project (project-chosen backend)
  engines:                      # machine: engines and isolation units on shared infra
    mysql: [myproject]          #   databases created by `de-novo skills setup`
    redis: { prefix: "myproject:" }
  migrate: pnpm run db:migrate:local
  fixtures: [ui, official-api, fixture-endpoint, seed-script]
  forbid_direct_db_writes: true # invariant
```

## Validation boundary

Unknown keys are rejected in project, runtime, commands, services, addressing,
ports, data, and overlay maps. Runtime profile entries preserve backend-specific
options; only the documented string fields are checked there. Backend tools
validate those additional options.

Present commands must be non-empty strings. `runtime.default` must name a
profile. Service ports and block bases must be integers from 1 to 65535; a
health path starts with a single slash and contains no whitespace; reflection
is `source`, `rebuild`, or `restart`. These checks do not execute the command,
resolve file paths, reserve ports, or measure that a health path responds.
Omitted optional fields remain valid for a newly initialized profile.

Runtime writer discovery and authorization are the operating procedure in
[SKILL.md](../SKILL.md#runtime-ownership). The profile's writer count is a
constraint on declarations, not runtime enforcement.

## How to pick values

### addressing.proxy

**Declared intent** for who would listen on this project's hostnames.
`urls` prints names only. An explicit Portless bootstrap can start the configured
named-access listener; omission never starts one.
Compose has no Caddy; the CLI has no `proxy up`.

| Value | Meaning |
| --- | --- |
| `none` (omit default) | Print URLs only |
| `machine` | Intent: a machine listener would own these names. Not built. `urls` still prints |
| `project` | The project (k3d Gateway, etc.) listens |
| `portless` | Implemented named Kubernetes access through the explicit shared Portless gateway; `dev` owns route/forward cleanup |

Projects whose k3d already binds `:80` must set `project` **explicitly**. If
the default were `machine`, a future listener would steal that port.

### Named access values

These fields opt a project entrypoint into `dev`; none changes the profile's
allowed top-level keys:

A complete named-entrypoint example is kept in
[named.runtime-profile.yml](../examples/named.runtime-profile.yml).


`services.*.kubernetes` accepts only `service` and `port`. The service is a DNS
label; the port is a valid port number or non-empty DNS-label port name. Existing
`services.*.port` remains the project port registry value and is not used to
allocate a host port. `dev` obtains an ephemeral port from kubectl automatically.
The safe health path must be explicit before Ground makes a request.

The selected runtime's `namespace` is required for named access. Its
`overlay_namespace` template must contain `{env}`, may use `{namespace}`, and
must render a different valid namespace. These backend fields describe the
namespace the project's deployment/overlay command actually creates. They do
not create Kubernetes resources themselves. `kubeconfig` paths are relative to
the project root unless absolute. Ground gives child commands a temporary
private, context-pinned config and removes it on normal exit.

The shared gateway is an explicit machine opt-in with its own repo-local values.
Its complete schema, commands, readiness and recovery are in
[named access](../../../infra/access/README.md). No port is bound by profile
parsing, name rendering, or a dev plan.

### Domain configuration

TLD is a **repo file**, not a home-directory setting. Precedence:

1. `.agents/runtime-profile.local.yml` `addressing.tld` (this clone, gitignored)
2. this profile `addressing.tld` (committed in the project)
3. Ground checkout `infra/addressing.local.yml` (gitignored)
4. Ground checkout `infra/addressing.yml` (default `ground.test`)

Default scheme is `{service}.{project}.{tld}`. With `tld: local.example.com`:

```
web.acme.local.example.com          *.*.local.example.com
web--w1.acme.local.example.com      overlay: still two labels (-- stays one label)
```

Do not write `*.local.example.com` as the tld value — wildcards belong to
DNS and to certificates, not the yaml, and the two follow different rules:

- **DNS** (RFC 4592 §§2.2.1, 3.3.1): a wildcard record `*.local.example.com`
  synthesizes an answer for any name below `local.example.com` that does
  not exist and has no existing name between it and the parent, at any
  depth. So it answers `web.acme.local.example.com` as long as
  `acme.local.example.com` has no record of its own; the moment a record
  for `acme.local.example.com` exists, names below it are no longer
  covered and need their own wildcard (`*.acme.local.example.com`). A
  resolver that matches a subtree (dnsmasq
  `address=/local.example.com/127.0.0.1`) answers every depth regardless.
- **TLS** (RFC 9525 §6.3): a certificate name `*.local.example.com`
  matches exactly one label: `acme.local.example.com`, never
  `web.acme.local.example.com`. Two labels need `*.acme.local.example.com`
  on the certificate, one per project. Let's Encrypt wildcards follow this
  rule.

A hostname printed by `urls` is a name and nothing more. The boundaries
between it and a working environment are observed one at a time and none
implies the next: the name resolves on this machine (DNS); something
listens on the port the proxy or the project chose; the route sends that
name to the right service; the certificate's names match under the TLS
rule; the revision running is the one expected (`overlay status` and the
project's own checks). `de-novo skills doctor --probe` measures the first
of these from this machine's resolver and names the rest as not measured;
`.localhost` in particular is answered by some resolvers and clients and
not others, so ask the one you use.

| Configuration | Example app name | Scope |
| --- | --- | --- |
| Inherit the catalog default | `web.acme.ground.test` | Each project has a zone under the shared test suffix |
| Set `tld: dev.example.com` in the catalog's local addressing file | `web.acme.dev.example.com` | All inheriting projects use an owned suffix |
| Set `addressing.tld: product.example.org` in a project profile | `web.acme.product.example.org` | Only that project changes suffix |
| Also choose shared scheme `{service}.{tld}` | `web.product.example.org` | That project exclusively owns the selected suffix |

A project may choose a different domain independently. Its clone-local file can
replace the committed choice without changing other projects. Domains use the
same precedence for URLs and DNS generation; there is no separate DNS domain list.
For exclusive domains with overlays, use overlay scheme `{service}--{env}.{tld}`
so baseline and overlay names remain inside the same zone.

`infra dns render` derives a zone after the service label, such as
`acme.ground.test`, and maps it to that project's explicit ingress IPv4 address.
It supports shared schemes beginning with `{service}.`; other layouts are
refused rather than widening a wildcard to unrelated projects. Equal zones
with different addresses are conflicts. More-specific nested zones retain their
own rules in dnsmasq. Each zone gets a domain-specific host resolver artifact.

A chosen owned domain changes local resolution only. It creates no public DNS
record, verifies no registration ownership, and issues no TLS certificate.
`localhost` can still be read in old profiles, but the DNS renderer rejects
`localhost` and multicast `.local` zones. New DNS setup uses the configured test
or owned suffix. Procedures and CLI: [local DNS](../../../infra/dns/README.md).

### Environment choice

Ground application workloads must run on Kubernetes. The selected profile needs
`backend: kubernetes`, `k8s`, `k3s`, or `k3d`, and a non-empty explicit `context`.
`runtime.default` selects that profile. `de-novo skills validate` refuses an
unsupported backend or missing target; it does not contact the cluster.
Structural parsing can still read old or incomplete profiles for migration, so
parsing alone is not approval to operate one. Initialization without `--context`
is a draft that must be completed before validation succeeds.

The person confirms which eligible cluster to use or create. Do not infer that
choice from the current context or installed software. OrbStack and other host
providers may host Kubernetes, but a provider name alone does not satisfy the
runtime requirement. Verify nodes, ingress, and Service DNS on the selected cluster.

App execution and data ownership remain distinct. `data.infra: machine` uses
this catalog's Compose engine set; `project` uses the project's own data backend.
Adopting Kubernetes does not migrate, stop, or recreate existing shared engines.
The dedicated `infra k3d` connector supports k3d-managed clusters only. Another
Kubernetes/k3s installation needs its own measured path to those engines.

Host app name resolution is required for named access. Portless handles active
names and certificates during explicit gateway setup; projects with external
ingress addresses may use [local DNS](../../../infra/dns/README.md). Choosing Kubernetes does
not enable overlays; immutable image requirements belong to the opt-in overlay contract.

### overlay lifecycle

`runtime.commands.overlay` must implement the Ground command/JSON contract:
[overlay-contract.md](overlay-contract.md). That file owns how the command is
invoked, what `--apply` and `plan_first` do, and how `stale_after` leases are
measured and cleaned. This file only fixes value syntax: `stale_after` is an
optional positive duration (`s` `m` `h` `d` `w`) with no default; `plan_first`
omitted is `true`; `image_tag` omitted is `full-git-sha` and no mutable tag mode
is supported; `create_on` is `plan` (omitted default) or `attach`, and the
contract says what each means.

### ports.blocks

These are **app** ports — infra engines are machine-shared (Ground CLI
`infra/`, standard ports) and do not belong in the project port plan. Layer blocks
(api/web) are convention; values are free. When several projects bind fixed
ports on one machine, assign non-overlapping 100-wide blocks. Hostnames are
the public surface; ports stay in the registry.

### data.infra

Confirm ownership independently of the app runtime and record it explicitly.
`machine` means engines from this CLI's Compose catalog; `project` means the
project's own data infrastructure and operating procedure. An app running on
Kubernetes can use either choice.

For compatibility, an existing profile that omits this field still means
`machine`, and `init` without `--infra` retains that legacy default. New adoption
must first confirm ownership and pass `init --infra machine|project`.
It is a supported ownership choice, not a mandatory migration stage. Catalog
`setup` applies only to `machine`; `validate`, `urls`, and overlay contracts
remain available for either choice.

### project.namespace — shared name for isolation units

Every name that isolates this project on machine infra comes from here:
database (`<ns>`), redis key prefix (`<ns>:`), kafka topic/group prefix
(`<ns>.`), minio bucket, and a project may reuse it for an app-layer Kubernetes namespace. Per-engine declarations override this default only when needed.

Engines have different character rules; the setup tool rewrites them:
database `-`→`_`, bucket/k8s `_`→`-`. To skip rewriting, start with
`[a-z][a-z0-9]*` so the name is identical everywhere.

### data.engines — the declaration is the setup input

For `data.infra: machine`, `de-novo skills setup <project-root>` reads these
declarations. Setup reconciles the declared engines and provisions SQL accounts,
including existing credentials. Authorization and rerun effects are defined in
the linked CLI checkout's `infra/README.md`, **Project onboarding** section.
Declaring engines does not authorize setup. Value shapes:

| Engine                     | Value                                     | What setup does              |
| -------------------------- | ----------------------------------------- | ---------------------------- |
| `mysql` / `pg` (postgres)  | `true` (= namespace) or `[db-name, …]`         | create database + dedicated account |
| `redis`                    | `true` or `{ prefix: "slug:" }`           | start only — prefix is an app convention |
| `kafka`                    | `true` or `{ topic_prefix: "slug." }`     | start only — prefix is an app convention |
| `mongo`                    | `true` or `[db-name, …]`                  | start only — DB created on first connect |
| `mail` / `minio`           | `true` (minio may use `{ bucket }`)       | start only                   |

Unknown engine names are rejected — they must exist as a compose profile in
the Ground CLI's `infra/docker-compose.yml` (the catalog checkout you
linked), not in the consuming project. Add the service there, then declare
it in the project. `setup` starts only `data.engines`. There is no second
enabled-engine list to maintain. `false`, scalar service declarations,
unknown engine-specific keys, and duplicate canonical/alias declarations are
errors rather than implicit defaults.

### services.*.health / reflect

**Measure, then write.** Health is a path that actually returned 200. Reflect
is how an edit lands, confirmed by making one change. A measured date in a
comment lets the next person doubt staleness.

## Verify

After writing or editing a profile:

1. `de-novo skills validate` counts configuration invariants. It does not
   acquire runtime ownership, run commands, probe health, or verify routing.
   After init there is no `commands.status` — do not invent it.
2. `de-novo skills urls` prints at least one hostname. Routing is the
   project's listener, not Ground.
3. When `runtime.commands.status` exists, run that project command yourself
   from the designated runtime location and match its output to the service
   list. `de-novo skills status` is the machine engine report, not this step.
   Request every health path and get the expected response (checking 0 of 0
   is not a check — count how many of how many answered).
4. The port registry (`ports.registry`) agrees with this file.

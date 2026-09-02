# Grove

A de-novo skill. Shared local ground for many projects and agents on one machine.

One soil (engines), n trees (projects), m branches (apps) per project. Grafts
(overlays) cover only the apps you changed. Developers and agents pick names,
never ports. Named URLs point at a stack. How you verify (browser, e2e) is out
of this skill.

Pattern: [SKILL.md](SKILL.md). Schema: [references/runtime-profile.md](references/runtime-profile.md).
Engines: this repo's [`infra/`](../../infra/README.md). Project values (domains,
ports, service lists) live in each project's `.agents/runtime-profile.yml`.

```
+----------------------------------------------------------------------------+
|                         one developer machine                              |
|                                                                            |
|  n projects  x  m apps each  x  1 shared infra                             |
|  pick hostnames, never ports                                               |
|                                                                            |
|    acme                      sideapp                    ... n              |
|    api.acme.localhost        web.sideapp.localhost            |            |
|    catalog.acme.localhost    api.sideapp.localhost            |            |
|    web.acme.localhost                |                        |            |
|    api--w1.acme.localhost  (overlay) |                        |            |
|             |                        |                        |            |
|             |                        |                        |            |
|             |                        |                        |            |
|       +-----+------------------------+------------------------+----+       |
|       | Caddy   127.0.0.1:80   one listener (opt-in)               |       |
|       +------------------------------------------------------------+       |
|       | route by hostname                                          |       |
|       | unattached overlay  ->  that project's baseline            |       |
|       +-----+------------------------+------------------------+----+       |
|             |                        |                        |            |
|             |                        |                        |            |
|  +----------+---------+   +----------+---------+   +----------+---------+  |
|  | PROJECT  acme      |   | PROJECT  sideapp   |   | PROJECT  n         |  |
|  +--------------------+   +--------------------+   +--------------------+  |
|  | baseline (1)       |   | baseline (1)       |   | .                  |  |
|  |  [api] [catalog]   |   |  [web] [api]       |   | .                  |  |
|  |  [web] [worker]    |   |                    |   | .                  |  |
|  |           m apps   |   |           m apps   |   |                    |  |
|  | overlay w1 [api]   |   | overlay: none      |   | (more projects)    |  |
|  |                    |   |                    |   |                    |  |
|  +----------+---------+   +----------+---------+   +----------+---------+  |
|             |                        |                        |            |
|             |                        |                        |            |
|             +------------------------+------------------------+            |
|                                      |                                     |
|                                      v                                     |
|       +------------------------------+-----------------------------+       |
|       | SHARED INFRA   (this repo, one set)                        |       |
|       +------------------------------------------------------------+       |
|       |                                                            |       |
|       |  +-------+   +-------+   +-------+   +-------+             |       |
|       |  | mysql |   |  pg   |   | redis |   | kafka |             |       |
|       |  | :3306 |   | :5432 |   | :6379 |   | :9092 |             |       |
|       |  +-------+   +-------+   +-------+   +-------+             |       |
|       |                                                            |       |
|       |  isolate by database / prefix, not port                    |       |
|       |    acme_      sideapp_      ..._                           |       |
|       +------------------------------------------------------------+       |
+----------------------------------------------------------------------------+
```

- One app baseline per project. Do not spin a full stack per agent.
- Overlay only the apps you changed. Unattached `{app}--{env}` hostnames fall through to that project's baseline.
- One engine set on the machine. Isolate by database and prefix (`acme_` / `sideapp_`), not by port.

```
  Grove / this repo                  consuming project
  -----------------                  -----------------
  engine compose                     .agents/runtime-profile.yml values
  machine TLD · Caddy (opt-in)       app compose / k8s  (m apps)
  overlay routing table              overlay workloads · image builds
  profile invariants                 runtime.commands.*
  skill source                       verification tools
```

## Apply to a project

CLI install: [root README](../../README.md).

1. `de-novo-skills init <project-root>` — writes a minimal `.agents/runtime-profile.yml`
   (`overlay: none`). Pass `--slug` `--engines` `--services` for values.
2. `de-novo-skills validate <project-root>` — counts invariants, no docker.
3. `de-novo-skills setup <project-root>` — starts declared engines and provisions
   databases. Idempotent.
4. Install the skill into the agent's skill dir (`~/.claude/skills/` and similar),
   or the tool's share channel. In a project, keep the canonical copy under
   `.agents/skills/` and put only symlinks in tool-specific dirs — do not copy
   the body.

Examples: [examples/](examples/). They show the shape of values, not a required backend.

Contributing to this skill's source: [root AGENTS.md](../../AGENTS.md).

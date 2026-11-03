# de-novo skills — working here

People and agents share this file. Do not split it by tool (Claude, Cursor,
Codex, Grok). Published skill bodies live under `skills/`. If this file and a
skill disagree on *how to work in this catalog*, this file wins. The skill
still owns its pattern.

This checkout is a **skill catalog**, not a consuming app. Do not plant
`.agents/runtime-profile.yml` here — that file belongs in projects that *use*
Ground. This catalog does not configure harnesses, agent tools, or workers.

Remote: `git@github.com:de-novo/skills.git`. CLI: `de-novo skills` (alias `de-novo-skills`).

## Where facts live

| Fact | Home |
| --- | --- |
| Terminology | `docs/glossary.md` |
| Published skill (pattern) | `skills/<name>/SKILL.md` |
| Human diagram / apply | `skills/<name>/README.md` |
| Ground profile schema | `skills/ground/references/runtime-profile.md` |
| Ground addressing (this checkout) | `infra/addressing.yml` (+ `addressing.local.yml`, gitignored) |
| Project addressing | that project's `.agents/runtime-profile.yml` (+ `.local.yml`) |
| Engine catalog | `infra/docker-compose.yml` (profile = engine id; ground.* labels) |
| Machine infra commands | `de-novo skills infra` (`infra/bin/cli.mjs`) |
| CLI | `infra/bin/cli.mjs` |
| Doctor and capabilities (read-only entry point) | `infra/lib/doctor.mjs` only |
| Profile parse + invariants | `infra/lib/profile.mjs` only |
| Named access startup + cleanup | `infra/lib/dev.mjs` |
| Explicit Portless gateway bootstrap + config | `infra/lib/gateway.mjs`; `infra/access/README.md` |
| DNS rendering and CLI | `infra/lib/dns.mjs` |
| DNS setup procedure | `infra/dns/README.md` |
| Hostname render | `infra/lib/addressing.mjs` |
| DNS and TLS wildcard rules (as their RFCs state them) | `infra/lib/wildcards.mjs` only |
| How to work in this catalog | this file |
| Agent skill load paths | `.agents/` (see `.agents/README.md`) |
| Repository documentation checks | `scripts/check-docs.mjs`, `scripts/lib/docs.mjs`, `scripts/docs.yml` |
| Plugin manifest (install as a Claude Code plugin) | `.claude-plugin/plugin.json`; CI diffs it against `skills/*/` |
| Skill invocation policy (user- vs model-invoked) | each `skills/<name>/SKILL.md` frontmatter + `agents/openai.yaml`; the rule is in the catalog skill |

Do not copy a fact into a second house. Point. Keep human pages short, put
reference details behind links, and use existing command help as the lookup.
Retired designs are dated records under `docs/archive/`, with replacement links.

## Layout

```
AGENTS.md        this file
CLAUDE.md        pointer here — do not duplicate
.agents/         load adapter + repo-only skills
skills/          published skill sources
  ground/         local infrastructure and development environments
scripts/         repository-only checks
infra/           machine-shared engines Ground's CLI drives
docs/            glossary.md (product names), then design notes (not the user-facing spec)
```

## Before you edit

1. Say which house you are changing: a published skill (pattern), `infra/`
   (this catalog's machine backend + CLI), or agent load paths.
2. Read that house. Ground pattern → `skills/ground/SKILL.md`. Schema →
   `references/runtime-profile.md`. CLI / engines → `infra/`.
3. Leave other people's uncommitted work alone.
4. Adding or renaming a published skill → load
   [`.agents/skills/catalog`](.agents/skills/catalog/SKILL.md).

## Invariants — not weakenable

Values may change. These may not.

- **Pattern vs values.** A skill has no domains, ports, service lists, or
  real commands. Those live in the consuming project's
  `.agents/runtime-profile.yml`.
- **English public surfaces.** README, SKILL, CLI help, error strings, example
  comments, and everything under `docs/` are English. This catalog is
  published; a reader who arrives from outside must be able to read all of it.
  Documents written before this rule are converted as they are next edited.
- **No `down`.** Do not add a down command. Do not `docker compose down` the
  shared stack unless a human explicitly asks to stop machine infra. Several
  projects live on it.
- **Stable engine names.** Docker network `dev-infra` and container names
  (`dev-mysql8`, `dev-pg16`, `dev-redis7`, …) stay. Renaming them recreates
  engines that are already running on machines.
- **Success is counted artifacts**, not exit 0. Print `engines n/n`,
  `invariants n/n`, `DB n/n`. The runner prints the number — do not pin it
  in a document.
- **Changed behavior is actually measured.** A change is not merge-ready until
  the path it changes has been executed at the closest real, safe boundary.
  Unit tests, mocks, config rendering, and exit zero are supporting evidence;
  none substitutes for executing the changed behavior. `notMeasured` may name
  an untouched boundary, never the behavior introduced or modified by the PR.
- **Profile whitelist.** Top-level keys are `version` `project` `addressing`
  `runtime` `services` `overlay` `data`. Unknown keys (including `qa`) are
  rejected in `infra/lib/profile.mjs`. Ground does not own browser QA or e2e.
- **Overlay is opt-in.** Default `overlay: none`. Run overlay verbs only when
  `runtime.commands.overlay` exists.
- **Proxy omit = `none`.** Do not default a listener onto `:80`. `urls`
  prints names; this repo does not start Caddy. Only explicit Portless gateway
  configuration plus bootstrap may bind its selected port. `proxy: machine` is intent.
- **Addressing lives in repo files.** Not `~/.dev-infra`. Clone TLD is
  `infra/addressing.local.yml` or the project's `.agents/runtime-profile.local.yml`.
- **Compose is the engine catalog.** Do not keep a second name list. Machine
  verbs are `de-novo skills infra`. `setup` provisions a project's isolation
  units on that set. `infra up` with no names starts nothing. k3d links with
  `infra k3d connect --cluster <name>` — never default to the existing `local`
  cluster.
- **Kubernetes apps are required.** Apps run on an explicitly selected Kubernetes
  context (including k3s/k3d). Compose remains the shared data-engine backend.
  DNS setup and verification are part of adoption; never infer the target context.

## Verify

```bash
npm test          # node --test 'infra/bin/*.test.mjs'
```

The runner prints how many tests ran. Docker is not required for profile and
init checks or the process-based overlay tests. Do not start or stop shared
engines to land a docs or parser change. Run `npm run check:docs` for repository
documentation checks; consumers do not install that checker.

Every PR must preserve its execution evidence in the PR description. Record
the candidate SHA and target, the exact commands that ran, the observed and
counted result, and any skipped boundary. "Tests pass" without the command and
result is not evidence. If the changed path needs shared-infra authority, get
the human gate and keep the PR not ready to merge until that execution has
been measured. Do not bypass the gate to manufacture evidence.

When you add a parser or CLI guard: revert the production change locally,
confirm the new test goes red, restore, then commit. Report how many tests
went red. A guard you have not seen fail is not a guard.

`validate` takes a project root or one profile file, not an examples directory.
After editing `infra/lib/profile.mjs` or examples, validate every example:

```bash
for profile in skills/ground/examples/*.runtime-profile.yml; do
  node infra/bin/cli.mjs validate "$profile" || exit 1
done
```

`npm test` also validates the complete profile block in the schema reference.
Obsolete designs belong in `docs/archive/` with their date and replacement
links. Active instructions must not use archived plans as operating authority.

## Shared infra

`infra/` is one engine set for the machine. Agents do not stop it, do not
rewrite container or network names, do not run shared migrations, and do not
write shared databases. Declare the need; a human decides.

There is no down command in `de-novo skills`. That is intentional.

## Paid-for in this catalog

Guesses stay out. Dated incidents only.

- **JS comments are `//`, not `#`.** A markdown leftover `#` in
  `infra/lib/engines.mjs` was a SyntaxError. Every test file that imported it
  failed to load (2026-09-03).
- **`gh` identity ≠ SSH remote.** Push uses `git@github.com:de-novo/skills.git`.
  `gh` may be a different GitHub user and 404 on org APIs. Use git for push;
  do not assume `gh` can edit `de-novo/skills`.
- **Catalog rename did not rename containers.** Package and CLI became
  `de-novo-skills`; compose network and `dev-*` container names stayed so
  existing engines were not torn down.
- **`setup` recreated running engines.** A throwaway project's `setup` ran
  `compose up -d --wait` while the compose file's config hash had drifted from
  the running `dev-pg16` and `dev-redis7`; both containers were recreated
  (data survived on named volumes). `setup` and `infra up` now pass
  `--no-recreate`; a config change reaches a running engine only by a human
  using Docker directly (2026-09-06).

## Do not

- Commit or push unless the task asks.
- Invent a target Kubernetes context, a `qa:` profile field, or a down command.
- Copy `skills/ground/SKILL.md` into a profile, this file, or a tool-specific
  skills directory.
- Add an `AGENTS.md` under `skills/` or `infra/` unless that tree truly has
  different rules — it does not today.

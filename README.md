# de-novo skills

Ground simplifies local development across projects on one machine: reuse
project commands, share infrastructure, and keep addresses and data ownership clear.

## Scope

[Ground](skills/ground/) is the published skill. It covers existing runtime
commands, service addresses and ports, shared engines, project data isolation,
and checking that a source change reached the running application.

Agent launchers, tool configuration, hooks, task allocation, worker reports,
and session dashboards are outside this catalog.

## Install

Install the skill through the catalog plugin or your existing skill loader.
The plugin metadata only distributes Ground; it does not configure a launcher.

```sh
claude plugin marketplace add de-novo/skills
claude plugin install de-novo-skills@de-novo
```

Hosts without a Skill tool can read `skills/ground/SKILL.md` from this checkout.
Use one source and links instead of maintaining copied skill bodies.

## Environment choice

Apps use Kubernetes, including k3s or k3d-managed k3s. Ground confirms the target
context and DNS zone before configuration. Compose remains available for shared
data engines. The [runtime contract](skills/ground/references/runtime-profile.md#environment-choice)
defines eligibility; [DNS setup](infra/dns/README.md) covers host app names and
cluster Service discovery. An OS/container provider alone is not an app runtime.

The default app suffix is defined in [addressing.yml](infra/addressing.yml).
A machine or project may substitute an owned domain. Project zones and domain
override rules: [addressing reference](skills/ground/references/runtime-profile.md#domain-configuration).

## Named development URLs

Install the CLI once in this catalog checkout:

```sh
npm install
npm link
```

Complete the explicit [machine gateway bootstrap](infra/access/README.md#one-time-machine-bootstrap)
and project Service mappings once. Then run an entrypoint:

```sh
de-novo skills dev web --project /path/to/project --apply
```

The foreground session deploys through the project's existing command, connects
the Kubernetes Service and prints its named URL only after DNS and HTTP(S)
readiness succeed. Portless supplies the proxy, HTTPS and host-name registration;
Ground does not ask the user to choose forwarding ports.

For an enabled overlay, add `--env` and an immutable `--image`. On normal exit,
Ground removes that session's connection and route, and destroys its newly
created overlay. The baseline, shared gateway and data engines remain running.
Full values, commands, privileges and recovery: [named access](infra/access/README.md).

Read-only entry points remain `doctor`, `validate` and `urls`. `urls` prints
names without starting anything. `infra up` and `setup` remain separately
authorized shared-engine operations. Backend details: [infra/README.md](infra/README.md).

`de-novo-skills` is an alias without the `skills` token. Without an npm link,
`node infra/bin/cli.mjs` runs the same CLI. There is no machine down command.

## Optional isolation

Overlays default to off. Existing projects that need concurrent service
instances can use the [overlay contract](skills/ground/references/overlay-contract.md).
Adopting Ground does not require an overlay adapter. Kubernetes and DNS preparation are required.

## Contributing

Working rules: [AGENTS.md](AGENTS.md). Source: `skills/ground/`;
machine backend and CLI: `infra/`; repository-only documentation checks: `scripts/`.

```sh
npm test
npm run check:docs
```

Current documentation: [docs/README.md](docs/README.md).

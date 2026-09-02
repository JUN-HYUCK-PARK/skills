# Machine-shared infra

Databases, caches, and brokers used by **every project** on this machine.
Projects do not start their own MySQL, Redis, or Postgres.

One rule: **one engine on the machine, isolate inside it.** Because there is
only one, ports stay standard — default tool config just works. Isolation is
an engine-internal unit, not a port:

| Engine   | Isolation unit                       | How to create                       |
| -------- | ------------------------------------ | ----------------------------------- |
| MySQL    | database + dedicated account         | `bin/provision mysql <slug>`        |
| Postgres | database + dedicated role            | `bin/provision pg <slug>`           |
| Redis    | key prefix `<slug>:` (default)       | convention — set the prefix in app config |
|          | or logical DB number (0–15)          | write the number in the registry below |
| Kafka    | topic and consumer-group prefix `<slug>.` | convention                     |
| Mongo    | database                             | created on first connect            |
| MinIO    | bucket `<slug>-*`                    | console or mc                       |

The shared name for those units is the project **namespace** — one
`project.namespace` (default = slug) produces database, prefix, and bucket
names, and k8s-using projects reuse it for the app-layer namespace. Engine
character rules (`-` / `_`) are rewritten by the setup tool.

The project boundary is GRANT: an account may only touch its own database.
root/postgres accounts are for provisioning, not app connections.

## Start

The CLI (`npm install && npm link`, then `de-novo-skills`) is the front;
compose is the floor:

```bash
de-novo-skills up              # default three (mysql pg redis)
de-novo-skills up kafka        # add an optional engine
de-novo-skills status          # per-engine status and ready count
# same work: docker compose -f infra/docker-compose.yml [--profile kafka] up -d --wait
```

`restart: unless-stopped`, so when the Docker engine (OrbStack / Docker
Desktop) comes up at login, infra follows. "Start it every time" ends here.

Success is artifacts, not exit code:

```bash
docker compose -f infra/docker-compose.yml ps   # count healthy
```

## Engines

All on 127.0.0.1, standard ports. Credentials are local-dev only.

| Engine      | Container   | Connect                     | Profile |
| ----------- | ----------- | --------------------------- | ------- |
| MySQL 8.4   | dev-mysql8  | localhost:3306 (root/root)  | default |
| Postgres 16 | dev-pg16    | localhost:5432 (postgres/…) | default |
| Redis 7     | dev-redis7  | localhost:6379              | default |
| Kafka 3.9   | dev-kafka   | localhost:9092              | kafka   |
| Mongo 7     | dev-mongo7  | localhost:27017             | mongo   |
| Mailpit     | dev-mailpit | SMTP 1025 · UI 8025         | mail    |
| MinIO       | dev-minio   | 9000 · console 9001         | minio   |

From a container in a project compose, use `host.docker.internal:<port>`, or
join the external network `dev-infra` and the container name (kafka:
`dev-kafka:19092`).

Need a new major version? Run it beside the existing service (that is when a
non-standard port appears) — other projects still live on the old version.

## Project onboarding and registry

Which engines a project uses is its `.agents/runtime-profile.yml`
(`data.engines`). Setup reads that yaml:

```bash
de-novo-skills setup <project-root>   # start declared engines + provision DBs, idempotent
```

`de-novo-skills provision (mysql|pg) <name>` is the low-level tool setup
uses — call it directly only when you need one DB in a hurry without a
profile.

Database and account names are the project slug; several per project use
`<slug>_<purpose>`.

Onboarding adds a line to a **local registry that is not in git** — which
projects live on this machine is machine state, not this repo:

```
infra/registry.local.md        (.gitignore — this machine's split registry)
```

Shape (fictional example):

| Project | Engines      | namespace | Notes                   |
| ------- | ------------ | --------- | ----------------------- |
| acme    | mysql, redis | acme      | db+account acme, prefix acme: |

## Rules (not weakenable)

- **Projects do not re-declare these engines in their own compose.** Two
  instances and "which DB am I looking at?" has no answer.
- **Neither projects nor agents stop or restart machine infra.** Other
  projects are running on it. A human decides if something is wrong.
- **Do not attach to another project's database or prefix.**
- Do not put real data or real secrets here.
- Data lives on named volumes. `docker compose down -v` wipes **every
  project's local data** — if you must delete, delete one volume.

## Migrating an existing project

Projects that still own infra inside their compose/k8s stack migrate
gradually. If the old stack used non-standard ports, it can run next to
machine infra (standard ports) without colliding. Steps: (1) `provision` a
database (2) point app config at machine infra (3) migrate data (4) remove
infra services from the project stack. While both exist, "which one am I
looking at?" is the app config — do not guess. Per-project migration state
goes in `registry.local.md`.

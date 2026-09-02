# de-novo skills

Research and publish agent skills for development environments and how we work.

The source of truth for each skill is `skills/<name>/SKILL.md`. Human docs sit next to it as README. Project-specific values do not belong in a skill.

Agents working in this catalog: [`AGENTS.md`](AGENTS.md). Skill load paths: [`.agents/`](.agents/).

## Skills

| Name | One line |
| --- | --- |
| [grove](skills/grove/) | Shared local ground: n projects, m apps each, one infra set |

## CLI

Grove's machine-engine and profile tool. Once per checkout:

```bash
npm install && npm link
```

Then `de-novo-skills init | validate | setup | up | status | provision`.
Without a link, `node infra/bin/cli.mjs …` works the same. There is no down command —
stopping machine infra is a human decision because several projects live on it.

Engine table and ports: [`infra/README.md`](infra/README.md).

## Layout

```
AGENTS.md        how agents work in this catalog
.agents/         skill load adapter (symlinks into skills/)
skills/          skill sources. add a skill as <name>/SKILL.md
  grove/         first skill
infra/           machine-shared engines Grove uses
docs/            design notes
```

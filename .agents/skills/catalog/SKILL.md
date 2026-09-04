---
name: catalog
description: >-
  Add, edit, rename, or review a published skill in the de-novo skills
  catalog (skills/<name>/). Use when creating a new skill, splitting
  SKILL.md vs README vs examples, wiring .agents load paths, updating the
  catalog README table, or when the user runs /catalog. Not for planting
  Grove on a consuming project — that is grove.
---

# Catalog

This skill is for **this repository**. How to work here in general:
[`AGENTS.md`](../../../AGENTS.md). Load adapter:
[`.agents/README.md`](../../README.md).

A published skill is a pattern other projects install. Project values do not
belong in it.

## Houses

| File | Owns |
| --- | --- |
| `skills/<name>/SKILL.md` | Pattern. Agent prompt. YAML frontmatter `name` + `description`. |
| `skills/<name>/README.md` | Human diagram and apply steps. Optional if the skill is tiny. |
| `skills/<name>/references/` | Schema or long facts the skill points at. |
| `skills/<name>/examples/` | Shape of values, not a required backend. |
| `.agents/skills/<name>` | Relative symlink to `../../skills/<name>`. |
| Root `README.md` Skills table | One-line index. |
| `infra/addressing.yml` | This checkout's TLD and hostname scheme. Clone override: `addressing.local.yml`. |

`name` in frontmatter equals the directory name. Description includes what
it does and when to use it (trigger phrases, `/name`).

## Add a skill

1. Create `skills/<name>/SKILL.md`. Pattern only — no domains, ports, service
   lists, or real commands. Those go in a consuming project's
   `.agents/runtime-profile.yml` (Grove) or the equivalent values file the
   skill names.
2. Write `README.md` next to it if a human needs a diagram or apply steps.
   Do not paste the SKILL body into the README; point.
3. `ln -s ../../skills/<name> .agents/skills/<name>`
4. Add one row to the root README Skills table.
5. Public surfaces are English.
6. If the skill has parser or CLI behavior in `infra/`, add tests under
   `infra/bin/` and revert the production change once to see the new test
   go red. Then `npm test`.

Tool dirs (`.claude/skills`, `.cursor/skills`, `.grok/skills`) already point
at `.agents/skills`. Do not copy the skill there.

Do not add the new skill's pattern to `AGENTS.md`. Point at `skills/<name>/`.

## Edit a skill

Change the house that owns the fact. If the same sentence exists in SKILL
and README, edit the owner and make the other a pointer.

Grove-specific: schema lives in `references/runtime-profile.md`; invariants
are judged in `infra/lib/profile.mjs`. Do not restate the schema in SKILL.md.

## Not this skill

- Planting Grove on another repo → `grove`
- Starting or stopping machine engines → `infra/` CLI, and only when asked
- Changing how agents work in this catalog (invariants, verify, no-down) →
  `AGENTS.md`

---
name: catalog
description: >-
  Add, edit, rename, or review a published skill in the de-novo skills
  catalog (skills/<name>/). Use when creating a new skill, splitting
  SKILL.md vs README vs examples, wiring .agents load paths, updating the
  catalog README table, or when the user runs /catalog. Not for planting
  Ground on a consuming project — that is ground.
metadata:
  internal: true    # repo-only: the skills CLI hides it unless INSTALL_INTERNAL_SKILLS=1
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
| `skills/<name>/README.md` | The human page, under about 400 words: a diagram if one helps, then **What it does** (with the one defining constraint), **When to reach for it** (invocation mode and the trigger boundary), **It's working if** (tells a reader can check without opening SKILL.md), **Where it fits**, **What it does to your machine** (writes, downloads, runs, undo, as a table; one line when it only reads), **Apply to a project**, **Pointers**. |
| `skills/<name>/references/` | The long facts: fields, registry, CLI tables, state machines. The README and SKILL point here; neither restates them. |
| `skills/<name>/examples/` | Shape of values, not a required backend. |
| `skills/<name>/agents/openai.yaml` | Codex picker metadata: `interface.display_name`, `interface.short_description`; for a user-invoked skill also `policy.allow_implicit_invocation: false`. |
| `.agents/skills/<name>` | Relative symlink to `../../skills/<name>`. |
| `.claude-plugin/plugin.json` | The plugin manifest: every published skill in `skills`, nothing else. CI diffs the two. |
| Root `README.md` | Published scope and onboarding entry point. |
| `infra/addressing.yml` | This checkout's TLD and hostname scheme. Clone override: `addressing.local.yml`. |

`name` in frontmatter equals the directory name.

## Scope and invocation

Ground is model-invoked and is the only published skill. Keep this catalog about
local infrastructure and development environments. Do not add harness setup,
agent configuration, task allocation, or session management.

A user-invoked skill, if explicitly requested in future, needs both
`disable-model-invocation: true` and `policy.allow_implicit_invocation: false`.

## Add a skill

1. Create `skills/<name>/SKILL.md`. Pattern only — no domains, ports, service
   lists, or real commands. Those go in a consuming project's
   `.agents/runtime-profile.yml` (Ground) or the equivalent values file the
   skill names.
2. Write `README.md` next to it in the seven-section shape above, and put
   every field or CLI table in `references/`. Do not paste the SKILL body
   into the README; point.
3. Decide the invocation (above) and write `agents/openai.yaml`.
4. `ln -s ../../skills/<name> .agents/skills/<name>`
5. Add the path to `.claude-plugin/plugin.json` `skills`, then
   `claude plugin validate . --strict`.
6. Update the root README only if the approved scope changes.
7. Public surfaces are English.
8. If the skill has parser or CLI behavior in `infra/`, add tests under
   `infra/bin/` and revert the production change once to see the new test
   go red. Then `npm test`.

Tool dirs (`.claude/skills`, `.cursor/skills`, `.grok/skills`) already point
at `.agents/skills`. Do not copy the skill there.

Do not add the new skill's pattern to `AGENTS.md`. Point at `skills/<name>/`.

## Edit a skill

Change the house that owns the fact. If the same sentence exists in SKILL
and README, edit the owner and make the other a pointer.

Ground-specific: schema lives in `references/runtime-profile.md`; invariants
are judged in `infra/lib/profile.mjs`. Do not restate the schema in SKILL.md.

## Not this skill

- Planting Ground on another repo → `ground`
- Starting or stopping machine engines → `infra/` CLI, and only when asked
- Changing how agents work in this catalog (invariants, verify, no-down) →
  `AGENTS.md`

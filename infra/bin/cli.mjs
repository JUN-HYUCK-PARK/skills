#!/usr/bin/env node
// de-novo-skills — Grove CLI. yaml is source of truth; the CLI paints it.
// There is no down command: several projects live on machine infra, so a
// human decides when to stop it.
import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { runInit } from '../lib/init.mjs';
import { formatValidateReport, parseProfile } from '../lib/profile.mjs';
import {
  ALIASES,
  COMPOSE_FILE,
  ENGINES,
  PROVISION,
  containerState,
  resolveProfilePath,
  run,
  runSetup,
} from './setup.mjs';

const CLI = 'de-novo-skills';
const DEFAULT_ENGINES = ['mysql', 'pg', 'redis'];

// Engine names → compose services and profiles. No args: default three.
export function resolveEngines(names) {
  const chosen = names.length > 0 ? names : DEFAULT_ENGINES;
  const services = [];
  const profiles = [];
  for (const name of chosen) {
    const spec = ENGINES[ALIASES[name] ?? name];
    if (!spec) {
      throw new Error(`unknown engine "${name}" — supported: ${Object.keys(ENGINES).join(', ')}`);
    }
    if (!services.includes(spec.service)) services.push(spec.service);
    if (spec.composeProfile && !profiles.includes(spec.composeProfile)) {
      profiles.push(spec.composeProfile);
    }
  }
  return { services, profiles };
}

function cmdUp(args) {
  const { services, profiles } = resolveEngines(args);
  const up = run(
    'docker',
    [
      'compose',
      '-f',
      COMPOSE_FILE,
      ...profiles.flatMap((p) => ['--profile', p]),
      'up',
      '-d',
      '--wait',
      ...services,
    ],
    { stdio: 'inherit', encoding: undefined }
  );
  if (up.status !== 0) {
    console.error(`up: docker compose failed (exit ${up.status}).`);
    return 1;
  }
  // Exit 0 is not the same as the engine existing — inspect container state.
  const states = services.map((service) => {
    const spec = Object.values(ENGINES).find((e) => e.service === service);
    return { service, ...containerState(spec.container) };
  });
  const ready = states.filter((s) => s.ready).length;
  console.log(`engines ${ready}/${services.length}: ${states.map((s) => `${s.service}(${s.label})`).join(' ')}`);
  return ready === services.length ? 0 : 1;
}

function cmdStatus() {
  let ready = 0;
  for (const [name, spec] of Object.entries(ENGINES)) {
    const state = containerState(spec.container);
    if (state.ready) ready += 1;
    const label =
      state.label === 'missing'
        ? `not running${spec.composeProfile ? ` (${CLI} up ${name})` : ''}`
        : `${state.label}${state.ready ? ' ✓' : ''}`;
    console.log(`  ${name.padEnd(6)} ${spec.service.padEnd(8)} ${label}`);
  }
  console.log(`ready ${ready} · not started ${Object.keys(ENGINES).length - ready}`);
  return 0;
}

function cmdProvision(args) {
  const result = spawnSync('bash', [PROVISION, ...args], { stdio: 'inherit' });
  return result.status ?? 1;
}

function printHelp() {
  console.log(`${CLI} — Grove CLI (yaml is source of truth; the CLI paints it)

usage:
  ${CLI} init [project-root] [--slug NAME]
                                 [--engines a,b] [--services a,b] [--force]
                                           minimal .agents/runtime-profile.yml (overlay: none)
  ${CLI} setup [project-root|profile]      read .agents/runtime-profile.yml,
                                           start declared engines + provision DBs (idempotent)
  ${CLI} validate [project-root|profile]   profile invariants (no docker)
  ${CLI} up [engine …]                     default (${DEFAULT_ENGINES.join(' ')}) or named engines
  ${CLI} status                            per-engine status and ready count
  ${CLI} provision (mysql|pg) <name>       low-level: one database + dedicated account

there is no down command — several projects live on machine infra, so a human
decides when to stop it with docker compose.`);
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case 'init':
      return runInit(rest);
    case 'setup':
      return runSetup(rest[0]);
    case 'validate': {
      const profilePath = resolveProfilePath(rest[0]);
      const profile = parseProfile(readFileSync(profilePath, 'utf8'), profilePath);
      console.log(formatValidateReport(profile));
      return 0;
    }
    case 'up':
      return cmdUp(rest);
    case 'status':
      return cmdStatus();
    case 'provision':
      return cmdProvision(rest);
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      return 0;
    default:
      console.error(`${CLI}: unknown command "${command}"\n`);
      printHelp();
      return 1;
  }
}

// Compare argv[1] via realpath. npm link bins are symlinks, so a string
// compare misses main and exits 0 — a quiet false pass.
function isMain() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isMain()) {
  try {
    process.exit(main());
  } catch (error) {
    console.error(`${CLI}: ${error.message}`);
    process.exit(1);
  }
}

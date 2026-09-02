import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveEngines } from './cli.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CLI = path.join(REPO_ROOT, 'infra/bin/cli.mjs');
const MINIMAL = path.join(
  REPO_ROOT,
  'skills/grove/examples/minimal.runtime-profile.yml'
);

test('no args → default three (mysql, pg, redis)', () => {
  const { services, profiles } = resolveEngines([]);
  assert.deepEqual(services, ['mysql8', 'pg16', 'redis7']);
  assert.deepEqual(profiles, []);
});

test('optional engines bring compose profiles', () => {
  const { services, profiles } = resolveEngines(['kafka', 'mail']);
  assert.deepEqual(services, ['kafka', 'mailpit']);
  assert.deepEqual(profiles, ['kafka', 'mail']);
});

test('aliases and duplicates are canonicalized', () => {
  const { services } = resolveEngines(['postgres', 'pg', 'mysql']);
  assert.deepEqual(services, ['pg16', 'mysql8']);
});

test('unknown engines are rejected by name', () => {
  assert.throws(() => resolveEngines(['oracle']), /oracle/);
});

test('validate counts invariants 5/5 on an example profile', () => {
  const result = spawnSync(process.execPath, [CLI, 'validate', MINIMAL], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /invariants {2}5\/5/);
  assert.match(result.stdout, /overlay: none/);
});

test('validate is non-zero when the profile is missing', () => {
  const result = spawnSync(
    process.execPath,
    [CLI, 'validate', '/no-such-dir'],
    { encoding: 'utf8' }
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /not found/);
});

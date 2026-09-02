import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseInitArgs,
  renderInitYaml,
  runInit,
  slugFromName,
} from '../lib/init.mjs';
import { parseProfile } from '../lib/profile.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CLI = path.join(REPO_ROOT, 'infra/bin/cli.mjs');

function tmpProject(name) {
  const root = mkdtempSync(path.join(tmpdir(), `${name}-`));
  return root;
}

test('slugFromName folds a directory name into [a-z][a-z0-9_-]*', () => {
  assert.equal(slugFromName('My App'), 'my-app');
  assert.equal(slugFromName('sideapp'), 'sideapp');
  assert.equal(slugFromName('123no'), 'no');
  assert.equal(slugFromName('123'), null);
});

test('renderInitYaml is overlay none and passes parseProfile', () => {
  const yaml = renderInitYaml({ slug: 'sideapp', engines: ['postgres'], services: ['api', 'web'] });
  const profile = parseProfile(yaml, 'init.yml');
  assert.equal(profile.overlay.mode, 'off');
  assert.equal(profile.overlay.explicitNone, true);
  assert.equal(profile.addressing.proxy, 'none');
  assert.equal(profile.addressing.scheme.shared, '{service}.{project}.{tld}');
  assert.deepEqual(Object.keys(profile.services), ['api', 'web']);
  assert.deepEqual(profile.engines.pg.databases, ['sideapp']);
  assert.equal(profile.engines.redis, undefined);
  assert.match(yaml, /^    pg: true$/m);
  assert.doesNotMatch(yaml, /postgres/);
  assert.doesNotMatch(yaml, /k3d|docker-compose/);
  assert.match(yaml, /overlay: none/);
});

test('parseInitArgs splits root and flags', () => {
  assert.deepEqual(parseInitArgs([]), {
    root: '.',
    slug: null,
    engines: [],
    services: [],
    force: false,
  });
  assert.deepEqual(parseInitArgs(['./app', '--slug', 'acme', '--engines', 'pg,redis', '--force']), {
    root: './app',
    slug: 'acme',
    engines: ['pg', 'redis'],
    services: [],
    force: true,
  });
});

test('render rejects unknown engines and service keys', () => {
  assert.throws(() => renderInitYaml({ slug: 'acme', engines: ['oracle'] }), /oracle/);
  assert.throws(() => renderInitYaml({ slug: 'acme', services: ['my_api'] }), /DNS/);
});

test('runInit writes a file and rejects a second call without --force', () => {
  const root = tmpProject('init-once');
  assert.equal(runInit(['--slug', 'acme'], root), 0);
  const file = path.join(root, '.agents', 'runtime-profile.yml');
  const first = readFileSync(file, 'utf8');
  assert.match(first, /slug: acme/);
  assert.throws(() => runInit(['--slug', 'acme'], root), /already exists/);
  assert.equal(runInit(['--slug', 'acme', '--engines', 'redis', '--force'], root), 0);
  const second = readFileSync(file, 'utf8');
  assert.match(second, /redis: true/);
  assert.notEqual(second, first);
});

test('a directory name that is a slug works without --slug', () => {
  const parent = tmpProject('init-dir');
  const root = path.join(parent, 'sideapp');
  mkdirSync(root);
  assert.equal(runInit([], root), 0);
  const profile = parseProfile(
    readFileSync(path.join(root, '.agents', 'runtime-profile.yml'), 'utf8')
  );
  assert.equal(profile.project.slug, 'sideapp');
});

test('de-novo-skills init then validate is 5/5', () => {
  const root = tmpProject('init-cli');
  const init = spawnSync(
    process.execPath,
    [CLI, 'init', root, '--slug', 'acme', '--services', 'api', '--engines', 'pg'],
    { encoding: 'utf8' }
  );
  assert.equal(init.status, 0, init.stderr);
  assert.match(init.stdout, /file {5}1\/1/);
  assert.match(init.stdout, /apps {5}1/);
  assert.match(init.stdout, /engines {2}1/);
  const validate = spawnSync(process.execPath, [CLI, 'validate', root], { encoding: 'utf8' });
  assert.equal(validate.status, 0, validate.stderr);
  assert.match(validate.stdout, /invariants {2}5\/5/);
});

test('an existing profile makes the CLI non-zero and leaves contents', () => {
  const root = tmpProject('init-keep');
  mkdirSync(path.join(root, '.agents'));
  const file = path.join(root, '.agents', 'runtime-profile.yml');
  writeFileSync(file, 'keep\n');
  const result = spawnSync(process.execPath, [CLI, 'init', root, '--slug', 'acme'], {
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /already exists/);
  assert.equal(readFileSync(file, 'utf8'), 'keep\n');
});

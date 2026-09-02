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

test('slugFromName 은 디렉터리 이름을 [a-z][a-z0-9_-]* 로 접는다', () => {
  assert.equal(slugFromName('My App'), 'my-app');
  assert.equal(slugFromName('sideapp'), 'sideapp');
  assert.equal(slugFromName('123no'), 'no');
  assert.equal(slugFromName('123'), null);
});

test('renderInitYaml 은 overlay none 이고 parseProfile 을 통과한다', () => {
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

test('parseInitArgs 는 루트와 플래그를 가른다', () => {
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

test('모르는 엔진·서비스 키는 render 가 거절한다', () => {
  assert.throws(() => renderInitYaml({ slug: 'acme', engines: ['oracle'] }), /oracle/);
  assert.throws(() => renderInitYaml({ slug: 'acme', services: ['my_api'] }), /DNS/);
});

test('runInit 는 파일을 쓰고 두 번째는 --force 없이 거절한다', () => {
  const root = tmpProject('init-once');
  assert.equal(runInit(['--slug', 'acme'], root), 0);
  const file = path.join(root, '.agents', 'runtime-profile.yml');
  const first = readFileSync(file, 'utf8');
  assert.match(first, /slug: acme/);
  assert.throws(() => runInit(['--slug', 'acme'], root), /이미 있다/);
  assert.equal(runInit(['--slug', 'acme', '--engines', 'redis', '--force'], root), 0);
  const second = readFileSync(file, 'utf8');
  assert.match(second, /redis: true/);
  assert.notEqual(second, first);
});

test('디렉터리 이름이 slug 가 되면 --slug 없이 된다', () => {
  const parent = tmpProject('init-dir');
  const root = path.join(parent, 'sideapp');
  mkdirSync(root);
  assert.equal(runInit([], root), 0);
  const profile = parseProfile(
    readFileSync(path.join(root, '.agents', 'runtime-profile.yml'), 'utf8')
  );
  assert.equal(profile.project.slug, 'sideapp');
});

test('devinfra init 후 validate 가 5/5 다', () => {
  const root = tmpProject('init-cli');
  const init = spawnSync(
    process.execPath,
    [CLI, 'init', root, '--slug', 'acme', '--services', 'api', '--engines', 'pg'],
    { encoding: 'utf8' }
  );
  assert.equal(init.status, 0, init.stderr);
  assert.match(init.stdout, /파일 {4}1\/1/);
  assert.match(init.stdout, /앱 {6}1/);
  assert.match(init.stdout, /엔진 {4}1/);
  const validate = spawnSync(process.execPath, [CLI, 'validate', root], { encoding: 'utf8' });
  assert.equal(validate.status, 0, validate.stderr);
  assert.match(validate.stdout, /불변식 {2}5\/5/);
});

test('있는 프로파일은 CLI 가 비0 이고 내용을 안 바꾼다', () => {
  const root = tmpProject('init-keep');
  mkdirSync(path.join(root, '.agents'));
  const file = path.join(root, '.agents', 'runtime-profile.yml');
  writeFileSync(file, 'keep\n');
  const result = spawnSync(process.execPath, [CLI, 'init', root, '--slug', 'acme'], {
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /이미 있다/);
  assert.equal(readFileSync(file, 'utf8'), 'keep\n');
});

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

test('인자가 없으면 기본 3종(mysql·pg·redis)', () => {
  const { services, profiles } = resolveEngines([]);
  assert.deepEqual(services, ['mysql8', 'pg16', 'redis7']);
  assert.deepEqual(profiles, []);
});

test('선택 엔진은 compose 프로필을 데려온다', () => {
  const { services, profiles } = resolveEngines(['kafka', 'mail']);
  assert.deepEqual(services, ['kafka', 'mailpit']);
  assert.deepEqual(profiles, ['kafka', 'mail']);
});

test('별칭과 중복이 정규화된다', () => {
  const { services } = resolveEngines(['postgres', 'pg', 'mysql']);
  assert.deepEqual(services, ['pg16', 'mysql8']);
});

test('모르는 엔진은 이름을 불러 거절한다', () => {
  assert.throws(() => resolveEngines(['oracle']), /oracle/);
});

test('validate 는 예시 프로파일에서 불변식 5/5 를 센다', () => {
  const result = spawnSync(process.execPath, [CLI, 'validate', MINIMAL], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /불변식 {2}5\/5/);
  assert.match(result.stdout, /overlay: none/);
});

test('validate 는 프로파일이 없으면 비0 이다', () => {
  const result = spawnSync(
    process.execPath,
    [CLI, 'validate', '/no-such-dir'],
    { encoding: 'utf8' }
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /not found/);
});

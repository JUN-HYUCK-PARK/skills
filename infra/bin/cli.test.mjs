import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveEngines } from './cli.mjs';

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

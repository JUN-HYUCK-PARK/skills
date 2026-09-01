import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ENGINES, readProfile, planSetup, resolveProfilePath } from './setup.mjs';

const FULL_PROFILE = `
version: 1
project: { slug: acme }
data:
  infra: machine
  engines:
    mysql: [acme, acme_audit]
    redis: { prefix: "acme:" }
    kafka: true
`;

test('멀티엔진 프로파일 → 서비스·프로필·프로비저닝 계획', () => {
  const plan = planSetup(readProfile(FULL_PROFILE));
  assert.deepEqual(plan.services, ['mysql8', 'redis7', 'kafka']);
  assert.deepEqual(plan.composeProfiles, ['kafka']);
  assert.deepEqual(plan.provisions, [
    { engine: 'mysql', name: 'acme' },
    { engine: 'mysql', name: 'acme_audit' },
  ]);
  assert.ok(plan.notes.some((n) => n.includes('"acme:"')));
  assert.ok(plan.notes.some((n) => n.includes('"acme."'))); // kafka: true 의 기본 프리픽스
});

test('true 축약형은 namespace(기본 = slug)를 database 이름으로 쓴다', () => {
  const { engines } = readProfile(`
project: { slug: sideapp }
data: { infra: machine, engines: { pg: true } }
`);
  assert.deepEqual(engines.pg.databases, ['sideapp']);
});

test('namespace 명시가 모든 기본값을 바꾼다', () => {
  const { engines, namespace } = readProfile(`
project: { slug: acme, namespace: acme_dev }
data: { infra: machine, engines: { mysql: true, redis: true, kafka: true } }
`);
  assert.equal(namespace, 'acme_dev');
  assert.deepEqual(engines.mysql.databases, ['acme_dev']);
  assert.equal(engines.redis.prefix, 'acme_dev:');
  assert.equal(engines.kafka.topicPrefix, 'acme_dev.');
});

test('엔진별 문자 제약은 도구가 변환한다 (database: -→_, bucket: _→-)', () => {
  const { engines } = readProfile(`
project: { slug: my-app }
data: { infra: machine, engines: { mysql: true, redis: true } }
`);
  assert.deepEqual(engines.mysql.databases, ['my_app']); // db 이름에 하이픈 불가
  assert.equal(engines.redis.prefix, 'my-app:'); // 프리픽스는 원형 유지

  const { engines: withMinio } = readProfile(`
project: { slug: acme, namespace: acme_dev }
data: { infra: machine, engines: { minio: true } }
`);
  assert.equal(withMinio.minio.bucket, 'acme-dev'); // bucket 에 밑줄 불가
});

test('postgres 별칭은 pg 로 정규화된다', () => {
  const plan = planSetup(
    readProfile(`
project: { slug: sideapp }
data: { infra: machine, engines: { postgres: [sideapp] } }
`)
  );
  assert.deepEqual(plan.services, ['pg16']);
  assert.deepEqual(plan.provisions, [{ engine: 'pg', name: 'sideapp' }]);
});

test('infra: project 는 셋팅 대상이 아니다 — 명확히 거절', () => {
  assert.throws(
    () =>
      readProfile(`
project: { slug: legacy }
data: { infra: project, engines: { mysql: true } }
`),
    /machine/
  );
});

test('모르는 엔진은 이름을 불러 거절한다', () => {
  assert.throws(
    () =>
      readProfile(`
project: { slug: acme }
data: { infra: machine, engines: { oracle: true } }
`),
    /oracle/
  );
});

test('database 이름 형식을 검증한다', () => {
  assert.throws(
    () =>
      readProfile(`
project: { slug: acme }
data: { infra: machine, engines: { mysql: ["DROP TABLE"] } }
`),
    /database 이름/
  );
});

test('엔진 선언이 없으면 빈 계획', () => {
  const plan = planSetup(readProfile(`
project: { slug: acme }
data: { infra: machine }
`));
  assert.equal(plan.services.length, 0);
  assert.equal(plan.provisions.length, 0);
});

test('ENGINES 표의 모든 엔진이 컨테이너 이름을 가진다', () => {
  for (const [name, spec] of Object.entries(ENGINES)) {
    assert.ok(spec.service, name);
    assert.match(spec.container, /^dev-/, name);
  }
});

test('resolveProfilePath: 디렉터리를 주면 .agents/runtime-profile.yml 을 찾는다', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'setup-test-'));
  mkdirSync(path.join(root, '.agents'));
  const file = path.join(root, '.agents', 'runtime-profile.yml');
  writeFileSync(file, 'version: 1\n');
  assert.equal(resolveProfilePath(root), file);
  assert.equal(resolveProfilePath(file), file);
  assert.throws(() => resolveProfilePath(path.join(root, 'no-such-dir')), /not found/);
});

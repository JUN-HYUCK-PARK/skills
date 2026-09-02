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

test('multi-engine profile → service, compose-profile, provision plan', () => {
  const plan = planSetup(readProfile(FULL_PROFILE));
  assert.deepEqual(plan.services, ['mysql8', 'redis7', 'kafka']);
  assert.deepEqual(plan.composeProfiles, ['kafka']);
  assert.deepEqual(plan.provisions, [
    { engine: 'mysql', name: 'acme' },
    { engine: 'mysql', name: 'acme_audit' },
  ]);
  assert.ok(plan.notes.some((n) => n.includes('"acme:"')));
  assert.ok(plan.notes.some((n) => n.includes('"acme."'))); // default prefix for kafka: true
});

test('true shorthand uses namespace (default = slug) as the database name', () => {
  const { engines } = readProfile(`
project: { slug: sideapp }
data: { infra: machine, engines: { pg: true } }
`);
  assert.deepEqual(engines.pg.databases, ['sideapp']);
});

test('an explicit namespace changes every default', () => {
  const { engines, namespace } = readProfile(`
project: { slug: acme, namespace: acme_dev }
data: { infra: machine, engines: { mysql: true, redis: true, kafka: true } }
`);
  assert.equal(namespace, 'acme_dev');
  assert.deepEqual(engines.mysql.databases, ['acme_dev']);
  assert.equal(engines.redis.prefix, 'acme_dev:');
  assert.equal(engines.kafka.topicPrefix, 'acme_dev.');
});

test('per-engine character rules are rewritten (database: -→_, bucket: _→-)', () => {
  const { engines } = readProfile(`
project: { slug: my-app }
data: { infra: machine, engines: { mysql: true, redis: true } }
`);
  assert.deepEqual(engines.mysql.databases, ['my_app']); // db names cannot contain hyphens
  assert.equal(engines.redis.prefix, 'my-app:'); // prefix keeps the original form

  const { engines: withMinio } = readProfile(`
project: { slug: acme, namespace: acme_dev }
data: { infra: machine, engines: { minio: true } }
`);
  assert.equal(withMinio.minio.bucket, 'acme-dev'); // buckets cannot contain underscores
});

test('postgres alias canonicalizes to pg', () => {
  const plan = planSetup(
    readProfile(`
project: { slug: sideapp }
data: { infra: machine, engines: { postgres: [sideapp] } }
`)
  );
  assert.deepEqual(plan.services, ['pg16']);
  assert.deepEqual(plan.provisions, [{ engine: 'pg', name: 'sideapp' }]);
});

test('infra: project is not a setup target — rejected clearly', () => {
  assert.throws(
    () =>
      readProfile(`
project: { slug: legacy }
data: { infra: project, engines: { mysql: true } }
`),
    /machine/
  );
});

test('unknown engines are rejected by name', () => {
  assert.throws(
    () =>
      readProfile(`
project: { slug: acme }
data: { infra: machine, engines: { oracle: true } }
`),
    /oracle/
  );
});

test('database names are validated', () => {
  assert.throws(
    () =>
      readProfile(`
project: { slug: acme }
data: { infra: machine, engines: { mysql: ["DROP TABLE"] } }
`),
    /database name/
  );
});

test('no engine declaration yields an empty plan', () => {
  const plan = planSetup(readProfile(`
project: { slug: acme }
data: { infra: machine }
`));
  assert.equal(plan.services.length, 0);
  assert.equal(plan.provisions.length, 0);
});

test('every ENGINES row has a container name', () => {
  for (const [name, spec] of Object.entries(ENGINES)) {
    assert.ok(spec.service, name);
    assert.match(spec.container, /^dev-/, name);
  }
});

test('resolveProfilePath: a directory finds .agents/runtime-profile.yml', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'setup-test-'));
  mkdirSync(path.join(root, '.agents'));
  const file = path.join(root, '.agents', 'runtime-profile.yml');
  writeFileSync(file, 'version: 1\n');
  assert.equal(resolveProfilePath(root), file);
  assert.equal(resolveProfilePath(file), file);
  assert.throws(() => resolveProfilePath(path.join(root, 'no-such-dir')), /de-novo-skills init/);
});

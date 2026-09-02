import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatValidateReport, parseProfile, projectHostOf } from '../lib/profile.mjs';
import { readProfile } from './setup.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EXAMPLES = path.join(REPO_ROOT, 'skills/grove/examples');

function parse(text, source = 't.yml') {
  return parseProfile(text, source);
}

test('예시 YAML 전부가 parseProfile 을 통과한다', () => {
  const files = readdirSync(EXAMPLES).filter((f) => f.endsWith('.yml'));
  assert.ok(files.length >= 2, `예시 파일 ${files.length}개`);
  let passed = 0;
  for (const file of files) {
    const full = path.join(EXAMPLES, file);
    parseProfile(readFileSync(full, 'utf8'), full);
    passed += 1;
  }
  assert.equal(passed, files.length);
});

test('minimal 예시는 overlay none, proxy 생략=none', () => {
  const full = path.join(EXAMPLES, 'minimal.runtime-profile.yml');
  const p = parseProfile(readFileSync(full, 'utf8'), full);
  assert.equal(p.overlay.mode, 'off');
  assert.equal(p.overlay.explicitNone, true);
  assert.equal(p.addressing.proxy, 'none');
  assert.equal(p.project.host, 'sideapp');
  const report = formatValidateReport(p);
  assert.match(report, /불변식 {2}5\/5/);
  assert.match(report, /overlay 비활성 \(overlay: none\)/);
  assert.match(report, /proxy none/);
});

test('multi-service 예시는 overlay 활성, proxy project', () => {
  const full = path.join(EXAMPLES, 'multi-service.runtime-profile.yml');
  const p = parseProfile(readFileSync(full, 'utf8'), full);
  assert.equal(p.overlay.mode, 'on');
  assert.equal(p.overlay.attachable.length, 5);
  assert.equal(p.overlay.sharedOnly.length, 2);
  assert.ok(p.overlay.command);
  assert.equal(p.addressing.proxy, 'project');
  const report = formatValidateReport(p);
  assert.match(report, /overlay 활성 \(attachable 5, shared_only 2, command 있음\)/);
});

test('엔진만 있는 프로파일은 overlay 생략으로 통과한다', () => {
  const p = parse(`
project: { slug: acme }
data: { infra: machine, engines: { mysql: true } }
`);
  assert.equal(p.overlay.mode, 'off');
  assert.equal(p.overlay.explicitNone, false);
  assert.equal(p.addressing, null);
  assert.equal(p.runtime.writers, 1);
  assert.equal(p.runtime.singleStack, true);
  assert.equal(p.data.forbidDirectDbWrites, true);
  assert.deepEqual(p.engines.mysql.databases, ['acme']);
});

test('slug 밑줄은 host 에서 하이픈이 된다', () => {
  const p = parse(`
project: { slug: my_app }
data: { infra: machine }
`);
  assert.equal(p.project.host, 'my-app');
  assert.equal(projectHostOf('my_app'), 'my-app');
});

test('infra: project 는 parse 되고 setup readProfile 만 거절한다', () => {
  const yaml = `
project: { slug: legacy }
data: { infra: project, engines: { mysql: true } }
`;
  const p = parse(yaml);
  assert.equal(p.data.infra, 'project');
  assert.throws(() => readProfile(yaml), /machine/);
});

test('writers: 2 는 거절한다', () => {
  assert.throws(
    () =>
      parse(`
project: { slug: acme }
runtime: { writers: 2 }
data: { infra: machine }
`),
    /writers/
  );
});

test('single_stack: false 는 거절한다', () => {
  assert.throws(
    () =>
      parse(`
project: { slug: acme }
runtime: { single_stack: false }
data: { infra: machine }
`),
    /single_stack/
  );
});

test('forbid_direct_db_writes: false 는 거절한다', () => {
  assert.throws(
    () =>
      parse(`
project: { slug: acme }
data: { infra: machine, forbid_direct_db_writes: false }
`),
    /forbid_direct_db_writes/
  );
});

test('qa 최상위 키는 거절한다', () => {
  assert.throws(
    () =>
      parse(`
project: { slug: acme }
data: { infra: machine }
qa: { auth_file: e2e-auth.yml }
`),
    /모르는 최상위 키 "qa"/
  );
});

test('overlay: none 인데 overlay 명령이 있으면 거절한다', () => {
  assert.throws(
    () =>
      parse(`
project: { slug: acme }
runtime: { commands: { overlay: node tools/dev-overlay.mjs } }
overlay: none
data: { infra: machine }
`),
    /overlay: none/
  );
});

test('overlay 명령이 있는데 overlay 블록 생략이면 거절한다', () => {
  assert.throws(
    () =>
      parse(`
project: { slug: acme }
runtime: { commands: { overlay: node tools/dev-overlay.mjs } }
data: { infra: machine }
`),
    /overlay 블록/
  );
});

test('overlay.attachable 에 없는 서비스는 거절한다', () => {
  assert.throws(
    () =>
      parse(`
project: { slug: acme }
services:
  api: { kind: api }
overlay:
  attachable: [ghost]
data: { infra: machine }
`),
    /attachable/
  );
});

test('shared_only 와 attachable 이 겹치면 거절한다', () => {
  assert.throws(
    () =>
      parse(`
project: { slug: acme }
addressing:
  scheme:
    shared: "{service}.{tld}"
    overlay: "{service}--{env}.{tld}"
services:
  api: { kind: api }
overlay:
  attachable: [api]
  shared_only: [api]
data: { infra: machine }
`),
    /겹친다/
  );
});

test('overlay 객체인데 scheme.overlay 가 없으면 거절한다', () => {
  assert.throws(
    () =>
      parse(`
project: { slug: acme }
addressing:
  scheme:
    shared: "{service}.{tld}"
services:
  api: { kind: api }
overlay:
  attachable: [api]
data: { infra: machine }
`),
    /scheme.overlay/
  );
});

test('모르는 스킴 토큰은 거절한다', () => {
  assert.throws(
    () =>
      parse(`
project: { slug: acme }
addressing:
  scheme:
    shared: "{service}.{foo}.{tld}"
data: { infra: machine }
`),
    /\{foo\}/
  );
});

test('project.host 에 밑줄이 있으면 거절한다', () => {
  assert.throws(
    () =>
      parse(`
project: { slug: acme, host: my_app }
data: { infra: machine }
`),
    /project.host/
  );
});

test('services 키에 밑줄이 있으면 거절한다', () => {
  assert.throws(
    () =>
      parse(`
project: { slug: acme }
services:
  my_api: { kind: api }
data: { infra: machine }
`),
    /services 키/
  );
});

test('addressing.proxy 가 목록 밖이면 거절한다', () => {
  assert.throws(
    () =>
      parse(`
project: { slug: acme }
addressing: { proxy: caddy }
data: { infra: machine }
`),
    /addressing.proxy/
  );
});

test('모르는 엔진은 이름을 불러 거절한다', () => {
  assert.throws(
    () =>
      parse(`
project: { slug: acme }
data: { infra: machine, engines: { oracle: true } }
`),
    /oracle/
  );
});

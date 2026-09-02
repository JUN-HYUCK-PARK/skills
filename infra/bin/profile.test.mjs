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

test('every example yaml passes parseProfile', () => {
  const files = readdirSync(EXAMPLES).filter((f) => f.endsWith('.yml'));
  assert.ok(files.length >= 2, `${files.length} example files`);
  let passed = 0;
  for (const file of files) {
    const full = path.join(EXAMPLES, file);
    parseProfile(readFileSync(full, 'utf8'), full);
    passed += 1;
  }
  assert.equal(passed, files.length);
});

test('minimal example is overlay none, omitted proxy = none', () => {
  const full = path.join(EXAMPLES, 'minimal.runtime-profile.yml');
  const p = parseProfile(readFileSync(full, 'utf8'), full);
  assert.equal(p.overlay.mode, 'off');
  assert.equal(p.overlay.explicitNone, true);
  assert.equal(p.addressing.proxy, 'none');
  assert.equal(p.project.host, 'sideapp');
  const report = formatValidateReport(p);
  assert.match(report, /invariants {2}5\/5/);
  assert.match(report, /overlay inactive \(overlay: none\)/);
  assert.match(report, /proxy none/);
});

test('multi-service example is overlay active, proxy project', () => {
  const full = path.join(EXAMPLES, 'multi-service.runtime-profile.yml');
  const p = parseProfile(readFileSync(full, 'utf8'), full);
  assert.equal(p.overlay.mode, 'on');
  assert.equal(p.overlay.attachable.length, 5);
  assert.equal(p.overlay.sharedOnly.length, 2);
  assert.ok(p.overlay.command);
  assert.equal(p.addressing.proxy, 'project');
  const report = formatValidateReport(p);
  assert.match(report, /overlay active \(attachable 5, shared_only 2, command present\)/);
});

test('an engines-only profile passes with overlay omitted', () => {
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

test('underscores in slug become hyphens in host', () => {
  const p = parse(`
project: { slug: my_app }
data: { infra: machine }
`);
  assert.equal(p.project.host, 'my-app');
  assert.equal(projectHostOf('my_app'), 'my-app');
});

test('infra: project parses; setup readProfile rejects it', () => {
  const yaml = `
project: { slug: legacy }
data: { infra: project, engines: { mysql: true } }
`;
  const p = parse(yaml);
  assert.equal(p.data.infra, 'project');
  assert.throws(() => readProfile(yaml), /machine/);
});

test('writers: 2 is rejected', () => {
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

test('single_stack: false is rejected', () => {
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

test('forbid_direct_db_writes: false is rejected', () => {
  assert.throws(
    () =>
      parse(`
project: { slug: acme }
data: { infra: machine, forbid_direct_db_writes: false }
`),
    /forbid_direct_db_writes/
  );
});

test('qa as a top-level key is rejected', () => {
  assert.throws(
    () =>
      parse(`
project: { slug: acme }
data: { infra: machine }
qa: { auth_file: e2e-auth.yml }
`),
    /unknown top-level key "qa"/
  );
});

test('overlay: none plus an overlay command is rejected', () => {
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

test('an overlay command without an overlay block is rejected', () => {
  assert.throws(
    () =>
      parse(`
project: { slug: acme }
runtime: { commands: { overlay: node tools/dev-overlay.mjs } }
data: { infra: machine }
`),
    /overlay block/
  );
});

test('overlay.attachable naming a missing service is rejected', () => {
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

test('shared_only overlapping attachable is rejected', () => {
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
    /overlaps/
  );
});

test('overlay object without scheme.overlay is rejected', () => {
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

test('unknown scheme tokens are rejected', () => {
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

test('underscores in project.host are rejected', () => {
  assert.throws(
    () =>
      parse(`
project: { slug: acme, host: my_app }
data: { infra: machine }
`),
    /project.host/
  );
});

test('underscores in a services key are rejected', () => {
  assert.throws(
    () =>
      parse(`
project: { slug: acme }
services:
  my_api: { kind: api }
data: { infra: machine }
`),
    /services key/
  );
});

test('addressing.proxy outside the allowed set is rejected', () => {
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

test('unknown engines are rejected by name', () => {
  assert.throws(
    () =>
      parse(`
project: { slug: acme }
data: { infra: machine, engines: { oracle: true } }
`),
    /oracle/
  );
});

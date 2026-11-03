import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('./cli.mjs', import.meta.url));
const run = (args) => spawnSync(process.execPath, [CLI, 'infra', 'dns', ...args], { encoding: 'utf8' });
function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'ground-dns-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  function project(slug, addressing = '') {
    const dir = path.join(root, slug); mkdirSync(path.join(dir, '.agents'), { recursive: true });
    writeFileSync(path.join(dir, '.agents/runtime-profile.yml'), `project: {slug: ${slug}}\nservices: {web: {}, api: {}}\n${addressing}\n`);
    return dir;
  }
  return { root, project };
}

test('DNS render uses ground.test by default, with a separate project zone', (t) => {
  const f = fixture(t); const project = f.project('acme');
  const result = run(['render', '--project', project, '--address', '127.0.0.2', '--json']);
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.deepEqual(plan.zones.map(({ domain, address }) => ({ domain, address })), [{ domain: 'acme.ground.test', address: '127.0.0.2' }]);
  assert.match(plan.dnsmasq, /address=\/acme.ground.test\/127.0.0.2/);
  assert.equal(plan.host_modified, false);
});

test('owned domains, exclusive project domains and clone overrides combine in one DNS instance', (t) => {
  const f = fixture(t);
  const a = f.project('a', 'addressing: {tld: dev.example.com}');
  const b = f.project('b', 'addressing: {tld: product.example.org, scheme: {shared: "{service}.{tld}"}}');
  writeFileSync(path.join(a, '.agents/runtime-profile.local.yml'), 'addressing: {tld: private.example.net}\n');
  const result = run(['render', '--project', a, '--address', '127.0.0.2', '--project', b, '--address', '127.0.0.3', '--json']);
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.deepEqual(plan.zones.map((zone) => zone.domain), ['a.private.example.net', 'product.example.org']);
  assert.equal(plan.resolvers.length, 2);
  assert.match(plan.dnsmasq, /no-resolv/);
  assert.match(plan.dnsmasq, /local=\/product.example.org\//);
});

test('DNS artifacts are written only by explicit apply to a new directory', (t) => {
  const f = fixture(t); const project = f.project('acme'); const output = path.join(f.root, 'output');
  const args = ['render', '--project', project, '--address', '127.0.0.2', '--output', output];
  assert.equal(run(args).status, 0); assert.equal(existsSync(output), false);
  const written = run([...args, '--apply']); assert.equal(written.status, 0, written.stderr);
  assert.match(readFileSync(path.join(output, 'resolvers/acme.ground.test'), 'utf8'), /nameserver 127.0.0.1/);
  const before = readFileSync(path.join(output, 'dnsmasq.conf'), 'utf8');
  assert.equal(run([...args, '--apply']).status, 1);
  assert.equal(readFileSync(path.join(output, 'dnsmasq.conf'), 'utf8'), before);
});

test('a DNS zone cannot silently route to two different ingress addresses', (t) => {
  const f = fixture(t);
  const a = f.project('a', 'addressing: {tld: same.example.com, scheme: {shared: "{service}.{tld}"}}');
  const b = f.project('b', 'addressing: {tld: same.example.com, scheme: {shared: "{service}.{tld}"}}');
  const result = run(['render', '--project', a, '--address', '127.0.0.2', '--project', b, '--address', '127.0.0.3']);
  assert.equal(result.status, 1); assert.match(result.stderr, /conflicting.*same.example.com/);
});

test('DNS rendering rejects missing targets, injected addresses, reserved suffixes and unsafe wildcard layouts', (t) => {
  const f = fixture(t); const project = f.project('a');
  for (const args of [[], ['--project', project], ['--project', project, '--address', '127.0.0.1\nserver=8.8.8.8'], ['--project', project, '--address', '127.0.0.1', '--port', '0'], ['--project', project, '--address', '127.0.0.1', '--apply']]) {
    const result = run(['render', ...args]);
    assert.equal(result.status, 1, JSON.stringify(args));
    assert.match(result.stderr, /dns:/);
  }
  for (const addressing of ['addressing: {tld: local}', 'addressing: {tld: localhost}', 'addressing: {scheme: {shared: "{project}-{service}.{tld}"}}']) {
    writeFileSync(path.join(project, '.agents/runtime-profile.yml'), `project: {slug: a}\n${addressing}\n`);
    assert.equal(run(['render', '--project', project, '--address', '127.0.0.1']).status, 1);
  }
});

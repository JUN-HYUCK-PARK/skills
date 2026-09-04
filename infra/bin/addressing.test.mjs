import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import {
  assertTld,
  loadGroveAddressing,
  parseUrlsArgs,
  renderHost,
  renderProjectUrls,
  resolveAddressing,
} from '../lib/addressing.mjs';
import { parseProfile } from '../lib/profile.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CLI = path.join(REPO_ROOT, 'infra/bin/cli.mjs');
const MINIMAL = path.join(REPO_ROOT, 'skills/grove/examples/minimal.runtime-profile.yml');

const TWO_LABEL = `
project: { slug: acme }
addressing:
  tld: local.example.com
  scheme:
    shared: "{service}.{project}.{tld}"
    overlay: "{service}--{env}.{project}.{tld}"
services:
  web: { kind: web }
  api: { kind: api }
overlay:
  attachable: [web]
data: { infra: machine }
`;

function groveDir(files) {
  const dir = mkdtempSync(path.join(tmpdir(), 'grove-addr-'));
  for (const [name, body] of Object.entries(files)) {
    writeFileSync(path.join(dir, name), body);
  }
  return dir;
}

test('assertTld accepts localhost and local.example.com, rejects wildcards', () => {
  assert.equal(assertTld('localhost', 't'), 'localhost');
  assert.equal(assertTld('local.example.com', 't'), 'local.example.com');
  assert.throws(() => assertTld('*.local.example.com', 't'), /wildcard/);
  assert.throws(() => assertTld('Local.Example.com', 't'), /tld/);
});

test('*.*.local.{domain} is {service}.{project}.local.example.com', () => {
  const profile = parseProfile(TWO_LABEL, 'two.yml');
  const addressing = resolveAddressing(profile, { infraDir: groveDir({}) });
  const urls = renderProjectUrls(profile, addressing);
  const hosts = urls.shared.map((row) => row.host).sort();
  assert.deepEqual(hosts, ['api.acme.local.example.com', 'web.acme.local.example.com']);
  const overlay = renderProjectUrls(profile, addressing, { env: 'w1' });
  assert.equal(
    overlay.overlay.find((row) => row.service === 'web').host,
    'web--w1.acme.local.example.com'
  );
  assert.equal(
    overlay.overlay.find((row) => row.service === 'api').host,
    'api--w1.acme.local.example.com'
  );
});

test('omitted profile tld inherits grove addressing.yml', () => {
  const infraDir = groveDir({
    'addressing.yml': 'tld: local.you.dev\nscheme:\n  shared: "{service}.{project}.{tld}"\n',
  });
  const profile = parseProfile(
    `
project: { slug: side }
addressing:
  scheme:
    shared: "{service}.{project}.{tld}"
services:
  web: {}
data: { infra: machine }
`,
    'p.yml'
  );
  const addressing = resolveAddressing(profile, { infraDir });
  assert.equal(addressing.tld, 'local.you.dev');
  assert.equal(addressing.tldSource, 'grove');
  assert.equal(
    renderProjectUrls(profile, addressing).shared[0].host,
    'web.side.local.you.dev'
  );
});

test('grove addressing.local.yml overrides addressing.yml', () => {
  const infraDir = groveDir({
    'addressing.yml': 'tld: localhost\n',
    'addressing.local.yml': 'tld: local.you.dev\n',
  });
  const grove = loadGroveAddressing(infraDir);
  assert.equal(grove.tld, 'localhost');
  assert.equal(grove.localTld, 'local.you.dev');
  const profile = parseProfile('project: { slug: acme }\ndata: { infra: machine }\n', 'p.yml');
  const addressing = resolveAddressing(profile, { infraDir });
  assert.equal(addressing.tld, 'local.you.dev');
  assert.equal(addressing.tldSource, 'grove.local');
});

test('grove addressing scheme must be a map', () => {
  const infraDir = groveDir({ 'addressing.yml': 'tld: localhost\nscheme: invalid\n' });
  assert.throws(() => loadGroveAddressing(infraDir), /scheme.*map/);
});

test('grove addressing scheme rejects unknown keys', () => {
  const infraDir = groveDir({
    'addressing.yml': 'tld: localhost\nscheme:\n  shared: "{service}.{tld}"\n  typo: nope\n',
  });
  assert.throws(() => loadGroveAddressing(infraDir), /scheme.*typo/);
});

test('project runtime-profile.local.yml wins over grove and committed tld', () => {
  const infraDir = groveDir({ 'addressing.yml': 'tld: localhost\n' });
  const projectDir = mkdtempSync(path.join(tmpdir(), 'proj-addr-'));
  const profilePath = path.join(projectDir, 'runtime-profile.yml');
  writeFileSync(
    profilePath,
    `
project: { slug: acme }
addressing:
  tld: local.example.com
services:
  web: {}
data: { infra: machine }
`
  );
  writeFileSync(
    path.join(projectDir, 'runtime-profile.local.yml'),
    'addressing:\n  tld: local.me.dev\n'
  );
  const profile = parseProfile(readFileSync(profilePath, 'utf8'), profilePath);
  const addressing = resolveAddressing(profile, { profilePath, infraDir });
  assert.equal(addressing.tld, 'local.me.dev');
  assert.equal(addressing.tldSource, 'project.local');
  assert.equal(
    renderProjectUrls(profile, addressing).shared[0].host,
    'web.acme.local.me.dev'
  );
});

test('committed profile tld wins over grove', () => {
  const infraDir = groveDir({ 'addressing.yml': 'tld: localhost\n' });
  const profile = parseProfile(TWO_LABEL, 'two.yml');
  const addressing = resolveAddressing(profile, { infraDir });
  assert.equal(addressing.tld, 'local.example.com');
  assert.equal(addressing.tldSource, 'profile');
});

test('renderHost rejects unknown tokens and missing values', () => {
  assert.throws(() => renderHost('{service}.{foo}.{tld}', { service: 'web', tld: 'localhost' }), /foo/);
  assert.throws(() => renderHost('{service}.{project}.{tld}', { service: 'web', tld: 'localhost' }), /project/);
});

test('renderHost normalizes namespace tokens and validates the final hostname', () => {
  assert.equal(
    renderHost('{service}.{namespace}.{tld}', {
      service: 'api',
      namespace: 'acme_dev',
      tld: 'localhost',
    }),
    'api.acme-dev.localhost'
  );
  assert.throws(
    () => renderHost('bad_{service}.{tld}', { service: 'api', tld: 'localhost' }),
    /hostname/
  );
});

test('parseUrlsArgs reads --env', () => {
  assert.deepEqual(parseUrlsArgs([]), { root: undefined, env: null });
  assert.deepEqual(parseUrlsArgs(['./app', '--env', 'w1']), { root: './app', env: 'w1' });
  assert.throws(() => parseUrlsArgs(['--env']), /--env needs/);
});

test('de-novo skills urls prints counted hosts for the minimal example', () => {
  const result = spawnSync(process.execPath, [CLI, 'urls', MINIMAL], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /shared {3}2\/2/);
  assert.match(result.stdout, /api\.sideapp\.localhost/);
  assert.match(result.stdout, /web\.sideapp\.localhost/);
  assert.match(result.stdout, /tld {6}localhost/);
});

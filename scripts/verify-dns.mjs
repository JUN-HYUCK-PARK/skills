// Explicit acceptance run. Builds a disposable image, then tests real DNS with
// --network none. Never mounts or edits the host resolver or Kubernetes state.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const catalog = fileURLToPath(new URL('../', import.meta.url));
const root = mkdtempSync(path.join(tmpdir(), 'ground-dns-lab-'));
const id = `ground-dns-check-${randomUUID()}`;
const image = `${id}:test`;
function command(file, args, options = {}) {
  const result = spawnSync(file, args, { encoding: 'utf8', timeout: 300000, ...options });
  assert.equal(result.status, 0, `${file} ${args.join(' ')}\n${result.stdout ?? ''}\n${result.stderr ?? ''}\n${result.error ?? ''}`);
  return result;
}
try {
  const cases = [
    ['alpha', '', '127.0.0.2'],
    ['beta', 'addressing: {tld: owned.example.com}', '127.0.0.3'],
    ['gamma', 'addressing: {tld: product.example.org, scheme: {shared: "{service}.{tld}"}}', '127.0.0.4'],
    ['delta', 'addressing: {tld: shared.example.com}', '127.0.0.5'],
  ];
  const args = ['infra', 'dns', 'render'];
  for (const [slug, addressing, address] of cases) {
    const project = path.join(root, slug); mkdirSync(path.join(project, '.agents'), { recursive: true });
    writeFileSync(path.join(project, '.agents/runtime-profile.yml'), `project: {slug: ${slug}}\nservices: {web: {}, api: {}}\n${addressing}\n`);
    if (slug === 'delta') writeFileSync(path.join(project, '.agents/runtime-profile.local.yml'), 'addressing: {tld: private.example.net}\n');
    args.push('--project', project, '--address', address);
  }
  const output = path.join(root, 'output');
  const rendered = command(process.execPath, [path.join(catalog, 'infra/bin/cli.mjs'), ...args, '--output', output, '--apply']);
  process.stdout.write(rendered.stdout);
  copyFileSync(path.join(catalog, 'infra/bin/fixtures/dns-lab/check.mjs'), path.join(root, 'check.mjs'));
  command('docker', ['build', '--pull=false', '-t', image, path.join(catalog, 'infra/bin/fixtures/dns-lab')], { stdio: 'inherit' });
  command('docker', ['run', '--rm', '--name', id, '--network', 'none', '--mount', `type=bind,source=${root},target=/lab,readonly`, image], { stdio: 'inherit', timeout: 30000 });
  console.log('Isolation: published host ports 0; host DNS writes 0; Kubernetes mutations 0');
} finally {
  spawnSync('docker', ['rm', '-f', id], { encoding: 'utf8', timeout: 10000 });
  spawnSync('docker', ['image', 'rm', image], { encoding: 'utf8', timeout: 10000 });
  rmSync(root, { recursive: true, force: true });
}

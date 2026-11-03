import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('./cli.mjs', import.meta.url));
function validate(t, runtime) {
  const root = mkdtempSync(path.join(tmpdir(), 'ground-kubernetes-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, '.agents'));
  writeFileSync(path.join(root, '.agents/runtime-profile.yml'), `project: {slug: policy}\nruntime: ${runtime}\ndata: {infra: project}\n`);
  return spawnSync(process.execPath, [CLI, 'validate', root], { encoding: 'utf8' });
}

test('validate refuses a non-Kubernetes application backend', (t) => {
  const result = validate(t, '{default: dev, profiles: {dev: {backend: docker-compose, context: example}}}');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Kubernetes/);
});

test('validate refuses an unspecified Kubernetes context', (t) => {
  const result = validate(t, '{default: dev, profiles: {dev: {backend: k3s}}}');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /context/);
});

test('validate refuses an unselected application runtime', (t) => {
  const result = validate(t, '{}');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /runtime.default/);
});

for (const backend of ['kubernetes', 'k8s', 'k3s', 'k3d']) {
  test(`validate accepts an explicit ${backend} target without contacting the cluster`, (t) => {
    const result = validate(t, `{default: dev, profiles: {dev: {backend: ${backend}, context: example}}}`);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /runtime\s+1\/1.*example/);
  });
}

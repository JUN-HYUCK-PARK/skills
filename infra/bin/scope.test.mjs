import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('./cli.mjs', import.meta.url));
const run = (args, options = {}) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', ...options });

test('capabilities exposes Ground without worker tools, budgets, or terminal dependencies', () => {
  const result = run(['capabilities', '--json']);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.skills, [{ name: 'ground', invocation: 'model' }]);
  assert.deepEqual(report.verbs, ['doctor', 'capabilities', 'init', 'validate', 'urls', 'setup', 'infra', 'overlay', 'dev']);
  assert.deepEqual(Object.keys(report.executables), ['git', 'docker', 'k3d']);
  assert.equal('machine_cap' in report || 'optional' in report, false);
});

test('retired worker commands are unknown and absent from help', () => {
  const help = run(['help']);
  assert.equal(help.status, 0, help.stderr);
  for (const command of ['seat', 'plan', 'facts', 'understory', 'herbarium', 'canopy', 'playground']) {
    const result = run([command, '--help']);
    assert.equal(result.status, 1, command);
    assert.match(result.stderr, new RegExp(`unknown command "${command}"`));
    assert.doesNotMatch(help.stdout, new RegExp(`\\b${command}\\b`, 'i'));
  }
});

test('doctor uses the runtime profile alone and ignores retired files and seat environment', (t) => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'ground-scope-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, '.agents'));
  writeFileSync(path.join(root, '.agents/runtime-profile.yml'), 'project: {slug: scoped}\ndata: {infra: project}\noverlay: none\n');
  for (const name of ['seat-profile', 'plan', 'plan.local', 'facts', 'herbarium']) {
    writeFileSync(path.join(root, `.agents/${name}.yml`), 'invalid: [');
  }
  const result = run(['doctor', '--json'], { cwd: root, env: { ...process.env, SEAT_PROJECT: path.join(root, 'nonexistent') } });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.project.root, root);
  assert.deepEqual(Object.keys(report.project).sort(), ['ground', 'root', 'skills']);
  assert.equal(report.next.length, 0);
});

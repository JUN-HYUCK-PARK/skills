import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, stringify } from 'yaml';

import {
  parseDuration,
  splitOverlayCommand,
  staleOverlayEnvironments,
} from '../lib/overlay.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CLI = path.join(REPO_ROOT, 'infra/bin/cli.mjs');
const STUB = path.join(REPO_ROOT, 'infra/bin/overlay-stub.mjs');
const FULL_IMAGE = `acme/api:${'a'.repeat(40)}`;

test('overlay command tokenization preserves quoted arguments without a shell', () => {
  assert.deepEqual(
    splitOverlayCommand('node "tools/path with spaces/dev-overlay.mjs" --mode \'local qa\''),
    ['node', 'tools/path with spaces/dev-overlay.mjs', '--mode', 'local qa']
  );
  assert.throws(() => splitOverlayCommand('node "unfinished'), /unfinished quote/);
});

test('stale lease boundary is exact and duration units are counted', () => {
  assert.equal(parseDuration('1h'), 3_600_000);
  assert.equal(parseDuration('2d'), 172_800_000);
  assert.throws(() => parseDuration('0h'), /positive duration/);
  const state = {
    envs: {
      stale: { last_used_at: '2026-09-04T00:00:00.000Z' },
      active: { last_used_at: '2026-09-04T00:00:00.001Z' },
    },
  };
  assert.deepEqual(
    staleOverlayEnvironments(state, 3_600_000, Date.parse('2026-09-04T01:00:00.000Z'))
      .map(({ env }) => env),
    ['stale']
  );
});

function projectFixture(t, { planFirst = true, staleAfter = '1h' } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'grove-overlay-'));
  const stateDir = path.join(root, 'state');
  const log = path.join(root, 'overlay-calls.jsonl');
  mkdirSync(path.join(root, '.agents'), { recursive: true });
  const staleLine = staleAfter == null ? '' : `  stale_after: ${staleAfter}\n`;
  writeFileSync(
    path.join(root, '.agents', 'runtime-profile.yml'),
    `version: 1
project: { slug: lifecycle-test }
addressing:
  proxy: project
  scheme:
    shared: "{service}.{project}.{tld}"
    overlay: "{service}--{env}.{project}.{tld}"
runtime:
  single_stack: true
  writers: 1
  commands:
    overlay: ${JSON.stringify(`${process.execPath} ${STUB}`)}
services:
  api: { kind: api }
  worker: { kind: worker }
overlay:
  attachable: [api]
  shared_only: [worker]
  image_tag: full-git-sha
  plan_first: ${planFirst}
${staleLine}data:
  infra: machine
  forbid_direct_db_writes: true
`,
    'utf8'
  );
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return {
    root,
    stateDir,
    log,
    planFirst,
    stateFile: path.join(stateDir, 'lifecycle-test.yml'),
  };
}

function run(fixture, args, extraEnv = {}) {
  const separator = args.indexOf('--');
  const cliArgs = separator === -1
    ? [...args, '--project', fixture.root]
    : [
        ...args.slice(0, separator),
        '--project',
        fixture.root,
        ...args.slice(separator),
      ];
  return spawnSync(
    process.execPath,
    [CLI, 'overlay', ...cliArgs],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        GROVE_STATE_DIR: fixture.stateDir,
        GROVE_OVERLAY_STUB_LOG: fixture.log,
        GROVE_OVERLAY_STUB_PLAN_FIRST: String(fixture.planFirst),
        ...extraEnv,
      },
    }
  );
}

function readState(fixture) {
  return parse(readFileSync(fixture.stateFile, 'utf8'));
}

function calls(fixture) {
  if (!existsSync(fixture.log)) return [];
  return readFileSync(fixture.log, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
}

test('overlay lifecycle creates, attaches, touches, detaches, and destroys counted state', (t) => {
  const fixture = projectFixture(t);

  const created = run(fixture, ['create', 'w1', '--apply']);
  assert.equal(created.status, 0, created.stderr);
  assert.match(created.stdout, /overlay create 1\/1/);
  assert.equal(readState(fixture).envs.w1.services.api, undefined);
  assert.equal(statSync(fixture.stateFile).mode & 0o777, 0o600);
  assert.equal(calls(fixture)[0].cwd, realpathSync(fixture.root));

  const attached = run(fixture, ['attach', 'w1', 'api', '--image', FULL_IMAGE, '--apply']);
  assert.equal(attached.status, 0, attached.stderr);
  assert.match(attached.stdout, /overlay attach 1\/1/);
  assert.equal(readState(fixture).envs.w1.services.api.image, FULL_IMAGE);

  const touched = run(fixture, ['touch', 'w1']);
  assert.equal(touched.status, 0, touched.stderr);
  assert.match(touched.stdout, /overlay touch 1\/1/);

  const detached = run(fixture, ['detach', 'w1', 'api', '--apply']);
  assert.equal(detached.status, 0, detached.stderr);
  assert.match(detached.stdout, /overlay detach 1\/1/);
  assert.deepEqual(readState(fixture).envs.w1.services, {});

  const destroyed = run(fixture, ['destroy', 'w1', '--apply']);
  assert.equal(destroyed.status, 0, destroyed.stderr);
  assert.match(destroyed.stdout, /overlay destroy 1\/1/);
  assert.equal(existsSync(fixture.stateFile), false);
});

test('overlay mutations are plans until --apply and do not write lifecycle state', (t) => {
  const fixture = projectFixture(t);
  const result = run(fixture, ['create', 'w1']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /overlay create plan 0\/1/);
  assert.equal(existsSync(fixture.stateFile), false);
  assert.equal(calls(fixture).length, 1);
  assert.equal(calls(fixture)[0].apply, false);
});

test('project passthrough cannot smuggle the central --apply gate', (t) => {
  const fixture = projectFixture(t);
  const result = run(fixture, ['create', 'w1', '--', '--apply=true']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must be a Grove option/);
  assert.equal(calls(fixture).length, 0);
  assert.equal(existsSync(fixture.stateFile), false);
});

test('project-specific arguments require the explicit -- boundary', (t) => {
  const fixture = projectFixture(t);
  const result = run(fixture, ['create', 'w1', '--custom-flag']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must follow --/);
  assert.equal(calls(fixture).length, 0);
});

test('overlay rejects non-SHA images and non-attachable services before dispatch', (t) => {
  const fixture = projectFixture(t);
  assert.equal(run(fixture, ['create', 'w1', '--apply']).status, 0);
  const before = calls(fixture).length;

  const latest = run(fixture, ['attach', 'w1', 'api', '--image', 'acme/api:latest', '--apply']);
  assert.notEqual(latest.status, 0);
  assert.match(latest.stderr, /full git SHA|sha256 digest/);

  const shared = run(fixture, ['attach', 'w1', 'worker', '--image', FULL_IMAGE, '--apply']);
  assert.notEqual(shared.status, 0);
  assert.match(shared.stderr, /not attachable/);
  assert.equal(calls(fixture).length, before);
});

test('status exposes stale leases and prune destroys only stale environments on apply', (t) => {
  const fixture = projectFixture(t);
  assert.equal(run(fixture, ['create', 'old', '--apply']).status, 0);
  assert.equal(run(fixture, ['attach', 'old', 'api', '--image', FULL_IMAGE, '--apply']).status, 0);
  assert.equal(run(fixture, ['create', 'fresh', '--apply']).status, 0);
  const state = readState(fixture);
  state.envs.old.last_used_at = '2000-01-01T00:00:00.000Z';
  writeFileSync(fixture.stateFile, stringify(state), 'utf8');
  const inventory = JSON.stringify([
    { env: 'old', services: ['api'] },
    { env: 'fresh', services: [] },
  ]);

  const status = run(fixture, ['status'], { GROVE_OVERLAY_STUB_INVENTORY: inventory });
  assert.notEqual(status.status, 0);
  assert.match(status.stdout, /environments {2}2/);
  assert.match(status.stdout, /stale {9}1/);
  assert.match(status.stdout, /drift {9}0/);

  const beforePlan = calls(fixture).length;
  const plan = run(fixture, ['prune']);
  assert.equal(plan.status, 0, plan.stderr);
  assert.match(plan.stdout, /overlay prune plan: stale 1\/2, destroyed 0\/1/);
  assert.equal(calls(fixture).length, beforePlan);
  assert.equal(existsSync(fixture.stateFile), true);

  const applied = run(fixture, ['prune', '--apply']);
  assert.equal(applied.status, 0, applied.stderr);
  assert.match(applied.stdout, /overlay prune 1\/1/);
  assert.deepEqual(Object.keys(readState(fixture).envs), ['fresh']);
  assert.equal(calls(fixture).at(-1).verb, 'destroy');
  assert.equal(calls(fixture).at(-1).args[0], 'old');
});

test('prune requires an explicit stale policy when the profile omits one', (t) => {
  const fixture = projectFixture(t, { staleAfter: null });
  const missing = run(fixture, ['prune']);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /stale_after|--stale-after/);

  const explicit = run(fixture, ['prune', '--stale-after', '12h']);
  assert.equal(explicit.status, 0, explicit.stderr);
  assert.match(explicit.stdout, /stale 0\/0/);
});

test('failed or malformed project receipts never mutate the registry', (t) => {
  const fixture = projectFixture(t);
  const failed = run(fixture, ['create', 'bad', '--apply', '--', '--fail']);
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /ok: true/);
  assert.equal(existsSync(fixture.stateFile), false);

  const malformed = run(fixture, ['create', 'bad', '--apply', '--', '--malformed']);
  assert.notEqual(malformed.status, 0);
  assert.match(malformed.stderr, /JSON/);
  assert.equal(existsSync(fixture.stateFile), false);
});

test('plan_first false refuses implicit execution and strips central --apply on dispatch', (t) => {
  const fixture = projectFixture(t, { planFirst: false });
  const plan = run(fixture, ['create', 'w1']);
  assert.notEqual(plan.status, 0);
  assert.match(plan.stderr, /requires --apply/);
  assert.equal(calls(fixture).length, 0);

  const applied = run(fixture, ['create', 'w1', '--apply']);
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(calls(fixture).length, 1);
  assert.equal(calls(fixture)[0].apply, false);
});

test('an apply request rejects a project receipt that is still only a plan', (t) => {
  const fixture = projectFixture(t, { planFirst: false });
  const result = run(fixture, ['create', 'w1', '--apply'], {
    GROVE_OVERLAY_STUB_PLAN_FIRST: 'true',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /returned a plan during --apply/);
  assert.equal(existsSync(fixture.stateFile), false);
});

test('prune keeps failed environments tracked and counts partial cleanup', (t) => {
  const fixture = projectFixture(t);
  assert.equal(run(fixture, ['create', 'keep', '--apply']).status, 0);
  assert.equal(run(fixture, ['create', 'remove', '--apply']).status, 0);
  const state = readState(fixture);
  state.envs.keep.last_used_at = '2000-01-01T00:00:00.000Z';
  state.envs.remove.last_used_at = '2000-01-01T00:00:00.000Z';
  writeFileSync(fixture.stateFile, stringify(state), 'utf8');

  const result = run(fixture, ['prune', '--apply'], {
    GROVE_OVERLAY_STUB_FAIL_ENV: 'keep',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /overlay prune 1\/2/);
  assert.match(result.stderr, /retained keep/);
  assert.deepEqual(Object.keys(readState(fixture).envs), ['keep']);
});

test('overlay status reports untracked runtime environments as drift', (t) => {
  const fixture = projectFixture(t);
  const inventory = JSON.stringify([{ env: 'orphan', services: ['api'] }]);
  const result = run(fixture, ['status'], { GROVE_OVERLAY_STUB_INVENTORY: inventory });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /drift {9}1/);
  assert.match(result.stdout, /orphan.*untracked/);
});

test('status keeps reporting known leases when the project runtime check fails', (t) => {
  const fixture = projectFixture(t);
  assert.equal(run(fixture, ['create', 'w1', '--apply']).status, 0);
  const result = run(fixture, ['status', '--', '--fail']);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /environments {2}1/);
  assert.match(result.stdout, /project-status {2}0\/1/);
  assert.match(result.stdout, /drift {9}notMeasured/);
  assert.match(result.stderr, /ok: true/);
});

test('status treats malformed runtime inventory as not measured without hiding leases', (t) => {
  const fixture = projectFixture(t);
  assert.equal(run(fixture, ['create', 'w1', '--apply']).status, 0);
  const result = run(fixture, ['status'], {
    GROVE_OVERLAY_STUB_INVENTORY: JSON.stringify('not-a-list'),
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /environments {2}1/);
  assert.match(result.stdout, /project-status {2}0\/1/);
  assert.match(result.stdout, /drift {9}notMeasured/);
  assert.match(result.stderr, /environments must be a list/);
});

test('an untracked runtime environment can be explicitly destroyed but is never aged', (t) => {
  const fixture = projectFixture(t);
  const result = run(fixture, ['destroy', 'orphan', '--apply']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /overlay destroy 1\/1/);
  assert.equal(calls(fixture).at(-1).verb, 'destroy');
  assert.equal(existsSync(fixture.stateFile), false);
});

test('a live registry lock blocks mutation and a dead same-machine lock is recovered', (t) => {
  const fixture = projectFixture(t);
  assert.equal(run(fixture, ['create', 'w1', '--apply']).status, 0);
  const lock = `${fixture.stateFile}.lock`;
  writeFileSync(lock, JSON.stringify({ pid: process.pid, host: hostname() }), 'utf8');
  const blocked = run(fixture, ['touch', 'w1']);
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, /registry is locked/);

  writeFileSync(lock, JSON.stringify({ pid: 2_147_483_647, host: hostname() }), 'utf8');
  const recovered = run(fixture, ['touch', 'w1']);
  assert.equal(recovered.status, 0, recovered.stderr);
  assert.equal(existsSync(lock), false);
});

test('main help advertises overlay lifecycle commands', () => {
  const result = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /overlay (create|<verb>)/);
  assert.match(result.stdout, /prune/);
  assert.match(result.stdout, /touch/);
});

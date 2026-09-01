#!/usr/bin/env node
// devinfra — 머신 공유 개발 인프라 CLI. yml(runtime-profile)이 정본이고 CLI는
// 그것을 그린다. 내리는 명령은 일부러 없다: 머신 인프라 위에 여러 프로젝트가
// 살고 있어서, 중지는 사람이 docker compose 로 직접 결정한다.
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  ALIASES,
  COMPOSE_FILE,
  ENGINES,
  PROVISION,
  containerState,
  run,
  runSetup,
} from './setup.mjs';

const DEFAULT_ENGINES = ['mysql', 'pg', 'redis'];

// 엔진 이름 목록 → compose 서비스·프로필. 인자가 없으면 기본 3종.
export function resolveEngines(names) {
  const chosen = names.length > 0 ? names : DEFAULT_ENGINES;
  const services = [];
  const profiles = [];
  for (const name of chosen) {
    const spec = ENGINES[ALIASES[name] ?? name];
    if (!spec) {
      throw new Error(`모르는 엔진 "${name}" — 지원: ${Object.keys(ENGINES).join(', ')}`);
    }
    if (!services.includes(spec.service)) services.push(spec.service);
    if (spec.composeProfile && !profiles.includes(spec.composeProfile)) {
      profiles.push(spec.composeProfile);
    }
  }
  return { services, profiles };
}

function cmdUp(args) {
  const { services, profiles } = resolveEngines(args);
  const up = run(
    'docker',
    [
      'compose',
      '-f',
      COMPOSE_FILE,
      ...profiles.flatMap((p) => ['--profile', p]),
      'up',
      '-d',
      '--wait',
      ...services,
    ],
    { stdio: 'inherit', encoding: undefined }
  );
  if (up.status !== 0) {
    console.error(`up: docker compose 가 실패했다 (exit ${up.status}).`);
    return 1;
  }
  // 명령이 0으로 끝난 것과 엔진이 있는 것은 다르다 — 컨테이너 상태를 직접 센다.
  const states = services.map((service) => {
    const spec = Object.values(ENGINES).find((e) => e.service === service);
    return { service, ...containerState(spec.container) };
  });
  const ready = states.filter((s) => s.ready).length;
  console.log(`엔진 ${ready}/${services.length}: ${states.map((s) => `${s.service}(${s.label})`).join(' ')}`);
  return ready === services.length ? 0 : 1;
}

function cmdStatus() {
  let ready = 0;
  for (const [name, spec] of Object.entries(ENGINES)) {
    const state = containerState(spec.container);
    if (state.ready) ready += 1;
    const label =
      state.label === 'missing'
        ? `안 떠 있음${spec.composeProfile ? ` (devinfra up ${name})` : ''}`
        : `${state.label}${state.ready ? ' ✓' : ''}`;
    console.log(`  ${name.padEnd(6)} ${spec.service.padEnd(8)} ${label}`);
  }
  console.log(`준비 ${ready} · 미기동 ${Object.keys(ENGINES).length - ready}`);
  return 0;
}

function cmdProvision(args) {
  const result = spawnSync('bash', [PROVISION, ...args], { stdio: 'inherit' });
  return result.status ?? 1;
}

function printHelp() {
  console.log(`devinfra — 머신 공유 개발 인프라 CLI (yml이 정본, CLI는 그린다)

사용법:
  devinfra setup [프로젝트루트|프로파일]   .agents/runtime-profile.yml 을 읽어
                                           선언된 엔진 기동 + DB 프로비저닝 (멱등)
  devinfra up [엔진 …]                     기본(${DEFAULT_ENGINES.join(' ')}) 또는 지정 엔진 기동
  devinfra status                          엔진별 상태와 준비 수
  devinfra provision (mysql|pg) <이름>     저수준: database + 전용 계정 하나

내리는 명령은 없다 — 머신 인프라 위에 여러 프로젝트가 살고 있어 중지는
사람이 docker compose 로 직접 결정한다.`);
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case 'setup':
      return runSetup(rest[0]);
    case 'up':
      return cmdUp(rest);
    case 'status':
      return cmdStatus();
    case 'provision':
      return cmdProvision(rest);
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      return 0;
    default:
      console.error(`devinfra: 모르는 명령 "${command}"\n`);
      printHelp();
      return 1;
  }
}

// argv[1]은 realpath 로 비교한다. npm link 가 만드는 bin 은 symlink 라서
// 경로 문자열 비교로는 불일치 → main 이 안 돌고 exit 0 — 조용한 거짓 통과가 된다.
function isMain() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isMain()) {
  try {
    process.exit(main());
  } catch (error) {
    console.error(`devinfra: ${error.message}`);
    process.exit(1);
  }
}

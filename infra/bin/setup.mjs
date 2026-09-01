#!/usr/bin/env node
// 프로젝트의 .agents/runtime-profile.yml(data.engines)을 읽어, 그 프로젝트가
// 선언한 엔진만 머신 공유 인프라에서 준비한다:
//   필요한 엔진 기동(--wait) → database 프로비저닝(멱등) → 수를 붙인 요약.
// yml이 정본이고 이 스크립트는 그것을 그린다 — 엔진을 손으로 고르지 않는다.
//
//   node infra/bin/setup.mjs <프로젝트 루트 | 프로파일 파일>
//   (인자 없으면 현재 디렉터리를 프로젝트 루트로 본다)
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const INFRA_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const COMPOSE_FILE = path.join(INFRA_DIR, 'docker-compose.yml');
export const PROVISION = path.join(INFRA_DIR, 'bin', 'provision');
const PROFILE_RELPATH = path.join('.agents', 'runtime-profile.yml');
const NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

// 엔진 이름 → compose 서비스·컨테이너·프로비저닝 방법. 이 표가 setup이 아는
// 전부이며, compose 파일에 새 엔진을 더하면 여기도 같이 늘린다.
export const ENGINES = {
  mysql: { service: 'mysql8', container: 'dev-mysql8', composeProfile: null, provision: 'mysql' },
  pg: { service: 'pg16', container: 'dev-pg16', composeProfile: null, provision: 'pg' },
  redis: { service: 'redis7', container: 'dev-redis7', composeProfile: null },
  kafka: { service: 'kafka', container: 'dev-kafka', composeProfile: 'kafka' },
  mongo: { service: 'mongo7', container: 'dev-mongo7', composeProfile: 'mongo' },
  mail: { service: 'mailpit', container: 'dev-mailpit', composeProfile: 'mail' },
  minio: { service: 'minio', container: 'dev-minio', composeProfile: 'minio' },
};
export const ALIASES = { postgres: 'pg', postgresql: 'pg', mailpit: 'mail', s3: 'minio' };

export function resolveProfilePath(arg, cwd = process.cwd()) {
  const target = path.resolve(cwd, arg ?? '.');
  if (existsSync(target) && statSync(target).isFile()) return target;
  const nested = path.join(target, PROFILE_RELPATH);
  if (existsSync(nested)) return nested;
  throw new Error(
    `runtime profile not found: ${nested}\n` +
      `프로젝트 루트에 ${PROFILE_RELPATH} 를 먼저 작성한다 — ` +
      `스키마는 skills/shared-local-runtime/references/runtime-profile.md.`
  );
}

function databasesOf(value, slug, engine, source) {
  const names = value === true ? [slug] : Array.isArray(value) ? value : null;
  if (!names) {
    throw new Error(`${source}: data.engines.${engine} 는 true 또는 database 이름 목록이어야 한다.`);
  }
  for (const name of names) {
    if (typeof name !== 'string' || !NAME_PATTERN.test(name)) {
      throw new Error(`${source}: database 이름은 [a-z][a-z0-9_]* — ${JSON.stringify(name)}`);
    }
  }
  return names;
}

const NS_PATTERN = /^[a-z][a-z0-9_-]*$/;

// yml 본문 → { slug, namespace, engines }. 머신 인프라를 쓰지 않는 프로파일은
// 여기서 거른다. 모든 분리 단위의 기본값은 namespace(기본 = slug) 한 이름에서
// 나온다 — 엔진별 문자 제약은 여기서 변환한다(database: -→_, bucket: _→-).
export function readProfile(yamlText, source = 'runtime-profile.yml') {
  const doc = parse(yamlText);
  const slug = doc?.project?.slug;
  if (typeof slug !== 'string' || !NS_PATTERN.test(slug)) {
    throw new Error(`${source}: project.slug 가 없거나 형식이 아니다.`);
  }
  const namespace = doc?.project?.namespace ?? slug;
  if (typeof namespace !== 'string' || !NS_PATTERN.test(namespace)) {
    throw new Error(`${source}: project.namespace 형식은 [a-z][a-z0-9_-]* 다.`);
  }
  const dbNamespace = namespace.replaceAll('-', '_');
  const infra = doc?.data?.infra;
  if (infra !== 'machine') {
    throw new Error(
      `${source}: data.infra 가 "machine" 이 아니다 (현재: ${JSON.stringify(infra ?? null)}). ` +
        `이 도구는 머신 공유 인프라를 쓰는 프로젝트만 셋팅한다 — ` +
        `"project" 는 프로젝트 자신의 스택이 정본이다.`
    );
  }
  const raw = doc?.data?.engines ?? {};
  const engines = {};
  for (const [key, value] of Object.entries(raw)) {
    const canon = ALIASES[key] ?? key;
    if (!(canon in ENGINES)) {
      throw new Error(
        `${source}: 모르는 엔진 "${key}" — 지원: ${Object.keys(ENGINES).join(', ')}`
      );
    }
    switch (canon) {
      case 'mysql':
      case 'pg':
      case 'mongo':
        engines[canon] = { databases: databasesOf(value, dbNamespace, key, source) };
        break;
      case 'redis':
        engines.redis = { prefix: (value === true ? null : value?.prefix) ?? `${namespace}:` };
        break;
      case 'kafka':
        engines.kafka = {
          topicPrefix: (value === true ? null : value?.topic_prefix) ?? `${namespace}.`,
        };
        break;
      case 'minio':
        engines.minio = {
          bucket: (value === true ? null : value?.bucket) ?? namespace.replaceAll('_', '-'),
        };
        break;
      default:
        engines[canon] = {};
    }
  }
  return { slug, namespace, engines };
}

// { slug, namespace, engines } → 실행 계획. 순수 함수라서 docker 없이 검증할 수 있다.
export function planSetup({ slug, namespace, engines }) {
  const services = [];
  const composeProfiles = [];
  const provisions = [];
  const notes = [];
  for (const [name, spec] of Object.entries(ENGINES)) {
    const decl = engines[name];
    if (!decl) continue;
    services.push(spec.service);
    if (spec.composeProfile) composeProfiles.push(spec.composeProfile);
    if (spec.provision) {
      for (const db of decl.databases) provisions.push({ engine: spec.provision, name: db });
    }
  }
  if (engines.redis) notes.push(`redis 키 프리픽스 "${engines.redis.prefix}" 는 앱 설정이 지킨다`);
  if (engines.kafka) notes.push(`kafka 토픽·그룹 프리픽스 "${engines.kafka.topicPrefix}" 는 앱 설정이 지킨다`);
  if (engines.mongo) notes.push(`mongo database(${engines.mongo.databases.join(', ')})는 첫 접속 시 생성된다`);
  if (engines.minio) notes.push(`minio bucket "${engines.minio.bucket}" 은 콘솔(9001)이나 mc 로 만든다`);
  return { slug, namespace: namespace ?? slug, services, composeProfiles, provisions, notes };
}

export function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: 'utf8', ...options });
}

export function containerState(container) {
  const result = run('docker', [
    'inspect',
    '-f',
    '{{.State.Running}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}',
    container,
  ]);
  if (result.status !== 0) return { ready: false, label: 'missing' };
  const [running, health] = result.stdout.trim().split('|');
  const ready = running === 'true' && (health === '' || health === 'healthy');
  return { ready, label: health || (running === 'true' ? 'running' : 'stopped') };
}

// CLI(devinfra)와 직접 실행이 공유하는 본체. 종료코드를 반환한다.
export function runSetup(pathArg) {
  const profilePath = resolveProfilePath(pathArg);
  const profile = readProfile(readFileSync(profilePath, 'utf8'), profilePath);
  const plan = planSetup(profile);

  if (plan.services.length === 0) {
    console.log(`${profile.slug}: data.engines 가 비어 있다 — 준비할 인프라 없음.`);
    return 0;
  }

  const upArgs = [
    'compose',
    '-f',
    COMPOSE_FILE,
    ...plan.composeProfiles.flatMap((p) => ['--profile', p]),
    'up',
    '-d',
    '--wait',
    ...plan.services,
  ];
  const up = run('docker', upArgs, { stdio: 'inherit', encoding: undefined });
  if (up.status !== 0) {
    console.error(`setup: docker compose up 이 실패했다 (exit ${up.status}).`);
    return 1;
  }

  // 명령이 0으로 끝난 것과 엔진이 있는 것은 다르다 — 컨테이너 상태를 직접 센다.
  const states = plan.services.map((service) => {
    const spec = Object.values(ENGINES).find((e) => e.service === service);
    return { service, ...containerState(spec.container) };
  });
  const readyCount = states.filter((s) => s.ready).length;
  const engineLine = states.map((s) => `${s.service}(${s.label})`).join(' ');

  const urls = [];
  let provisioned = 0;
  for (const { engine, name } of plan.provisions) {
    const result = run('bash', [PROVISION, engine, name]);
    if (result.status === 0) {
      provisioned += 1;
      urls.push(result.stdout.trim().split('\n').at(-1));
    } else {
      console.error(`provision ${engine} ${name} 실패:\n${result.stderr}`);
    }
  }

  const nsSuffix = plan.namespace !== plan.slug ? ` (namespace: ${plan.namespace})` : '';
  console.log(`\n■ ${plan.slug}${nsSuffix} — 머신 공유 인프라 준비`);
  console.log(`  엔진  ${readyCount}/${plan.services.length}: ${engineLine}`);
  if (plan.provisions.length > 0) {
    console.log(`  DB    ${provisioned}/${plan.provisions.length}${urls.length ? ':' : ''}`);
    for (const url of urls) console.log(`        ${url}`);
  }
  for (const note of plan.notes) console.log(`  규약  ${note}`);

  return readyCount === plan.services.length && provisioned === plan.provisions.length ? 0 : 1;
}

// symlink 로 불려도 잡히게 realpath 로 비교한다 (cli.mjs 의 isMain 과 같은 이유).
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
    process.exit(runSetup(process.argv[2]));
  } catch (error) {
    console.error(`setup: ${error.message}`);
    process.exit(1);
  }
}

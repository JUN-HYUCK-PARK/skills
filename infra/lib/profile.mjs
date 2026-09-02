// runtime-profile.yml 전체 문서. 불변식은 여기 한 곳에서만 판정한다.
// data.infra: project 도 파싱한다 — setup 이 machine 만 받는 것과 별개다.
import { parse } from 'yaml';

import { ALIASES, ENGINES } from './engines.mjs';

export const TOP_LEVEL_KEYS = Object.freeze([
  'version',
  'project',
  'addressing',
  'runtime',
  'services',
  'overlay',
  'data',
]);

const NS_PATTERN = /^[a-z][a-z0-9_-]*$/;
const DB_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const SCHEME_TOKEN = /\{([a-z]+)\}/g;
const SCHEME_TOKENS = new Set(['service', 'env', 'project', 'tld', 'namespace']);
const PROXY_VALUES = new Set(['none', 'machine', 'project', 'portless']);

function fail(source, message) {
  throw new Error(`${source}: ${message}`);
}

function databasesOf(value, dbNamespace, engine, source) {
  const names = value === true ? [dbNamespace] : Array.isArray(value) ? value : null;
  if (!names) {
    fail(source, `data.engines.${engine} 는 true 또는 database 이름 목록이어야 한다.`);
  }
  for (const name of names) {
    if (typeof name !== 'string' || !DB_NAME_PATTERN.test(name)) {
      fail(source, `database 이름은 [a-z][a-z0-9_]* — ${JSON.stringify(name)}`);
    }
  }
  return names;
}

function parseEngines(raw, namespace, source) {
  const dbNamespace = namespace.replaceAll('-', '_');
  const engines = {};
  if (raw == null) return engines;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    fail(source, 'data.engines 는 맵이어야 한다.');
  }
  for (const [key, value] of Object.entries(raw)) {
    const canon = ALIASES[key] ?? key;
    if (!(canon in ENGINES)) {
      fail(source, `모르는 엔진 "${key}" — 지원: ${Object.keys(ENGINES).join(', ')}`);
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
  return engines;
}

function assertDnsLabel(value, source, field) {
  if (typeof value !== 'string' || !DNS_LABEL.test(value)) {
    fail(source, `${field} 는 DNS 라벨 [a-z0-9]([a-z0-9-]{0,61}[a-z0-9])? — ${JSON.stringify(value)}`);
  }
}

function assertScheme(value, field, source) {
  if (typeof value !== 'string') {
    fail(source, `addressing.scheme.${field} 는 문자열이어야 한다.`);
  }
  for (const match of value.matchAll(SCHEME_TOKEN)) {
    if (!SCHEME_TOKENS.has(match[1])) {
      fail(source, `addressing.scheme.${field} 의 모르는 토큰 {${match[1]}}`);
    }
  }
}

function parseOverlay(doc, serviceNames, source) {
  const command =
    typeof doc?.runtime?.commands?.overlay === 'string' ? doc.runtime.commands.overlay : null;
  const raw = doc?.overlay;
  if (raw == null) {
    if (command) fail(source, 'runtime.commands.overlay 가 있으면 overlay 블록이 필요하다.');
    return { mode: 'off', explicitNone: false, attachable: [], sharedOnly: [], command: null, planFirst: true };
  }
  if (raw === 'none') {
    if (command) fail(source, 'overlay: none 인데 runtime.commands.overlay 가 있다.');
    return { mode: 'off', explicitNone: true, attachable: [], sharedOnly: [], command: null, planFirst: true };
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    fail(source, 'overlay 는 none 또는 객체여야 한다.');
  }
  const attachable = raw.attachable;
  if (!Array.isArray(attachable) || attachable.length === 0) {
    fail(source, 'overlay.attachable 은 비어 있지 않은 리스트여야 한다.');
  }
  for (const name of attachable) {
    if (typeof name !== 'string' || !serviceNames.has(name)) {
      fail(source, `overlay.attachable 에 없는 서비스 ${JSON.stringify(name)}`);
    }
  }
  const sharedOnly = Array.isArray(raw.shared_only) ? raw.shared_only : [];
  for (const name of sharedOnly) {
    if (typeof name !== 'string') fail(source, 'overlay.shared_only 항목은 문자열이어야 한다.');
    if (attachable.includes(name)) {
      fail(source, `overlay.shared_only 와 attachable 이 겹친다: ${name}`);
    }
  }
  let planFirst = true;
  if (raw.plan_first != null) {
    if (raw.plan_first !== true && raw.plan_first !== false) {
      fail(source, 'overlay.plan_first 는 true 또는 false 다.');
    }
    planFirst = raw.plan_first;
  }
  return {
    mode: 'on',
    explicitNone: false,
    attachable: [...attachable],
    sharedOnly,
    command,
    planFirst,
    imageTag: raw.image_tag ?? null,
  };
}

function parseAddressing(raw, overlayOn, source) {
  if (raw == null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    fail(source, 'addressing 은 맵이어야 한다.');
  }
  let proxy = 'none';
  if (raw.proxy != null) {
    if (!PROXY_VALUES.has(raw.proxy)) {
      fail(source, `addressing.proxy 는 none|machine|project|portless — ${JSON.stringify(raw.proxy)}`);
    }
    proxy = raw.proxy;
  }
  const scheme = raw.scheme ?? null;
  if (scheme != null) {
    if (typeof scheme !== 'object' || Array.isArray(scheme)) {
      fail(source, 'addressing.scheme 은 맵이어야 한다.');
    }
    if (scheme.shared != null) assertScheme(scheme.shared, 'shared', source);
    if (scheme.overlay != null) assertScheme(scheme.overlay, 'overlay', source);
  }
  if (overlayOn && !scheme?.overlay) {
    fail(source, 'overlay 가 객체인데 addressing.scheme.overlay 가 없다.');
  }
  return {
    tld: typeof raw.tld === 'string' ? raw.tld : null,
    scheme,
    proxy,
    ports: raw.ports ?? null,
  };
}

function parseServices(raw, source) {
  if (raw == null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    fail(source, 'services 는 맵이어야 한다.');
  }
  const services = {};
  for (const [name, spec] of Object.entries(raw)) {
    assertDnsLabel(name, source, 'services 키');
    services[name] = spec != null && typeof spec === 'object' && !Array.isArray(spec) ? spec : {};
  }
  return services;
}

function parseInvariantBool(value, omitDefault, field, source) {
  if (value == null) return omitDefault;
  if (value !== true) fail(source, `${field} 는 true 만 허용한다 (현재: ${JSON.stringify(value)}).`);
  return true;
}

function parseWriters(value, source) {
  if (value == null) return 1;
  if (value !== 1) fail(source, `runtime.writers 는 1 만 허용한다 (현재: ${JSON.stringify(value)}).`);
  return 1;
}

export function projectHostOf(slug, explicit) {
  return explicit ?? slug.replaceAll('_', '-');
}

export function parseProfile(yamlText, source = 'runtime-profile.yml') {
  const doc = parse(yamlText);
  if (doc == null || typeof doc !== 'object' || Array.isArray(doc)) {
    fail(source, '프로파일이 객체가 아니다.');
  }
  for (const key of Object.keys(doc)) {
    if (!TOP_LEVEL_KEYS.includes(key)) {
      fail(source, `모르는 최상위 키 "${key}"`);
    }
  }

  const slug = doc.project?.slug;
  if (typeof slug !== 'string' || !NS_PATTERN.test(slug)) {
    fail(source, 'project.slug 가 없거나 형식이 아니다.');
  }
  const namespace = doc.project?.namespace ?? slug;
  if (typeof namespace !== 'string' || !NS_PATTERN.test(namespace)) {
    fail(source, 'project.namespace 형식은 [a-z][a-z0-9_-]* 다.');
  }
  const host = projectHostOf(slug, doc.project?.host);
  assertDnsLabel(host, source, 'project.host');

  const singleStack = parseInvariantBool(
    doc.runtime?.single_stack,
    true,
    'runtime.single_stack',
    source
  );
  const writers = parseWriters(doc.runtime?.writers, source);
  const forbidDirectDbWrites = parseInvariantBool(
    doc.data?.forbid_direct_db_writes,
    true,
    'data.forbid_direct_db_writes',
    source
  );

  const services = parseServices(doc.services, source);
  const overlay = parseOverlay(doc, new Set(Object.keys(services)), source);
  const addressing = parseAddressing(doc.addressing, overlay.mode === 'on', source);
  const engines = parseEngines(doc.data?.engines, namespace, source);

  return {
    version: doc.version ?? null,
    project: { slug, namespace, host },
    addressing,
    runtime: {
      default: doc.runtime?.default ?? null,
      singleStack,
      writers,
      profiles: doc.runtime?.profiles ?? null,
      commands: doc.runtime?.commands ?? null,
    },
    services,
    overlay,
    data: {
      infra: doc.data?.infra ?? null,
      enginesRaw: doc.data?.engines ?? null,
      migrate: doc.data?.migrate ?? null,
      fixtures: doc.data?.fixtures ?? null,
      forbidDirectDbWrites,
    },
    engines,
  };
}

export function formatValidateReport(profile) {
  const { overlay, addressing, project } = profile;
  let overlayLine;
  if (overlay.mode === 'off') {
    overlayLine = overlay.explicitNone ? '비활성 (overlay: none)' : '비활성 (생략)';
  } else {
    const cmd = overlay.command ? 'command 있음' : 'command 없음';
    overlayLine = `활성 (attachable ${overlay.attachable.length}, shared_only ${overlay.sharedOnly.length}, ${cmd})`;
  }
  let addrLine = '생략';
  if (addressing) {
    const tld = addressing.tld ?? '(머신 기본)';
    const scheme = addressing.scheme ? 'scheme ok' : 'scheme 생략';
    addrLine = `${scheme}, tld ${tld}, proxy ${addressing.proxy}`;
  }
  return [
    `■ ${project.slug} — 프로파일`,
    `  불변식  5/5: single_stack writers forbid_direct_db_writes engines keys`,
    `  overlay ${overlayLine}`,
    `  주소    ${addrLine}`,
  ].join('\n');
}

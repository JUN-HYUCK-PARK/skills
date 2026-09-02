// Full runtime-profile.yml document. Invariants are judged here only.
// data.infra: project is parsed too — separate from setup requiring machine.
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
    fail(source, `data.engines.${engine} must be true or a list of database names.`);
  }
  for (const name of names) {
    if (typeof name !== 'string' || !DB_NAME_PATTERN.test(name)) {
      fail(source, `database name must match [a-z][a-z0-9_]* — ${JSON.stringify(name)}`);
    }
  }
  return names;
}

function parseEngines(raw, namespace, source) {
  const dbNamespace = namespace.replaceAll('-', '_');
  const engines = {};
  if (raw == null) return engines;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    fail(source, 'data.engines must be a map.');
  }
  for (const [key, value] of Object.entries(raw)) {
    const canon = ALIASES[key] ?? key;
    if (!(canon in ENGINES)) {
      fail(source, `unknown engine "${key}" — supported: ${Object.keys(ENGINES).join(', ')}`);
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
    fail(
      source,
      `${field} must be a DNS label [a-z0-9]([a-z0-9-]{0,61}[a-z0-9])? — ${JSON.stringify(value)}`
    );
  }
}

function assertScheme(value, field, source) {
  if (typeof value !== 'string') {
    fail(source, `addressing.scheme.${field} must be a string.`);
  }
  for (const match of value.matchAll(SCHEME_TOKEN)) {
    if (!SCHEME_TOKENS.has(match[1])) {
      fail(source, `addressing.scheme.${field} has unknown token {${match[1]}}`);
    }
  }
}

function parseOverlay(doc, serviceNames, source) {
  const command =
    typeof doc?.runtime?.commands?.overlay === 'string' ? doc.runtime.commands.overlay : null;
  const raw = doc?.overlay;
  if (raw == null) {
    if (command) fail(source, 'runtime.commands.overlay requires an overlay block.');
    return { mode: 'off', explicitNone: false, attachable: [], sharedOnly: [], command: null, planFirst: true };
  }
  if (raw === 'none') {
    if (command) fail(source, 'overlay: none but runtime.commands.overlay is set.');
    return { mode: 'off', explicitNone: true, attachable: [], sharedOnly: [], command: null, planFirst: true };
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    fail(source, 'overlay must be none or an object.');
  }
  const attachable = raw.attachable;
  if (!Array.isArray(attachable) || attachable.length === 0) {
    fail(source, 'overlay.attachable must be a non-empty list.');
  }
  for (const name of attachable) {
    if (typeof name !== 'string' || !serviceNames.has(name)) {
      fail(source, `overlay.attachable names a missing service ${JSON.stringify(name)}`);
    }
  }
  const sharedOnly = Array.isArray(raw.shared_only) ? raw.shared_only : [];
  for (const name of sharedOnly) {
    if (typeof name !== 'string') fail(source, 'overlay.shared_only entries must be strings.');
    if (attachable.includes(name)) {
      fail(source, `overlay.shared_only overlaps attachable: ${name}`);
    }
  }
  let planFirst = true;
  if (raw.plan_first != null) {
    if (raw.plan_first !== true && raw.plan_first !== false) {
      fail(source, 'overlay.plan_first must be true or false.');
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
    fail(source, 'addressing must be a map.');
  }
  let proxy = 'none';
  if (raw.proxy != null) {
    if (!PROXY_VALUES.has(raw.proxy)) {
      fail(source, `addressing.proxy must be none|machine|project|portless — ${JSON.stringify(raw.proxy)}`);
    }
    proxy = raw.proxy;
  }
  const scheme = raw.scheme ?? null;
  if (scheme != null) {
    if (typeof scheme !== 'object' || Array.isArray(scheme)) {
      fail(source, 'addressing.scheme must be a map.');
    }
    if (scheme.shared != null) assertScheme(scheme.shared, 'shared', source);
    if (scheme.overlay != null) assertScheme(scheme.overlay, 'overlay', source);
  }
  if (overlayOn && !scheme?.overlay) {
    fail(source, 'overlay is an object but addressing.scheme.overlay is missing.');
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
    fail(source, 'services must be a map.');
  }
  const services = {};
  for (const [name, spec] of Object.entries(raw)) {
    assertDnsLabel(name, source, 'services key');
    services[name] = spec != null && typeof spec === 'object' && !Array.isArray(spec) ? spec : {};
  }
  return services;
}

function parseInvariantBool(value, omitDefault, field, source) {
  if (value == null) return omitDefault;
  if (value !== true) fail(source, `${field} must be true (got ${JSON.stringify(value)}).`);
  return true;
}

function parseWriters(value, source) {
  if (value == null) return 1;
  if (value !== 1) fail(source, `runtime.writers must be 1 (got ${JSON.stringify(value)}).`);
  return 1;
}

export function projectHostOf(slug, explicit) {
  return explicit ?? slug.replaceAll('_', '-');
}

export function parseProfile(yamlText, source = 'runtime-profile.yml') {
  const doc = parse(yamlText);
  if (doc == null || typeof doc !== 'object' || Array.isArray(doc)) {
    fail(source, 'profile is not an object.');
  }
  for (const key of Object.keys(doc)) {
    if (!TOP_LEVEL_KEYS.includes(key)) {
      fail(source, `unknown top-level key "${key}"`);
    }
  }

  const slug = doc.project?.slug;
  if (typeof slug !== 'string' || !NS_PATTERN.test(slug)) {
    fail(source, 'project.slug is missing or malformed.');
  }
  const namespace = doc.project?.namespace ?? slug;
  if (typeof namespace !== 'string' || !NS_PATTERN.test(namespace)) {
    fail(source, 'project.namespace must match [a-z][a-z0-9_-]*.');
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
    overlayLine = overlay.explicitNone ? 'inactive (overlay: none)' : 'inactive (omitted)';
  } else {
    const cmd = overlay.command ? 'command present' : 'command absent';
    overlayLine = `active (attachable ${overlay.attachable.length}, shared_only ${overlay.sharedOnly.length}, ${cmd})`;
  }
  let addrLine = 'omitted';
  if (addressing) {
    const tld = addressing.tld ?? '(machine default)';
    const scheme = addressing.scheme ? 'scheme ok' : 'scheme omitted';
    addrLine = `${scheme}, tld ${tld}, proxy ${addressing.proxy}`;
  }
  return [
    `■ ${project.slug} — profile`,
    `  invariants  5/5: single_stack writers forbid_direct_db_writes engines keys`,
    `  overlay ${overlayLine}`,
    `  address   ${addrLine}`,
  ].join('\n');
}

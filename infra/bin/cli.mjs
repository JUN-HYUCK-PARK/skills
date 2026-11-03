#!/usr/bin/env node
// de-novo skills — Ground CLI. yaml is source of truth; the CLI paints it.
// Invoke as `de-novo skills …`. de-novo-skills is an alias without the
// skills namespace. There is no machine down command: several projects live on
// machine infra, so a human decides when to stop it.
import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  formatUrlsJson,
  formatUrlsReport,
  loadGroundAddressing,
  parseUrlsArgs,
  renderProjectUrls,
  resolveAddressing,
} from '../lib/addressing.mjs';
import { runDev } from '../lib/dev.mjs';
import { runGateway } from '../lib/gateway.mjs';
import { runDns } from '../lib/dns.mjs';
import { runInit } from '../lib/init.mjs';
import { formatValidateReport, parseProfile, requireKubernetesRuntime } from '../lib/profile.mjs';
import { COMPOSE_NETWORK, ENGINES, canonicalizeEngine } from '../lib/engines.mjs';
import {
  JOIN_LABEL,
  compareK3dJoin,
  compareK3dLinks,
  formatK3dJoinReport,
  formatK3dLinkReport,
  k3dServerContainer,
  memberLabel,
  parseK3dArgs,
  renderK3dLinkManifests,
  writeTemporaryKubeconfig,
} from '../lib/k3d-link.mjs';
import {
  overlayHelp,
  parseOverlayCliArgs,
  runOverlayLifecycle,
} from '../lib/overlay.mjs';
import { doctorHelp, runDoctor } from '../lib/doctor.mjs';
import {
  COMPOSE_FILE,
  COMPOSE_UP_FLAGS,
  PROVISION,
  containerState,
  resolveProfilePath,
  run,
  runSetup,
} from './setup.mjs';

export const CLI = 'de-novo skills';

export function invokedName(argv1 = process.argv[1]) {
  if (!argv1) return 'cli';
  return path.basename(argv1).replace(/\.(mjs|js)$/, '');
}

// `de-novo skills infra status` — the org bin requires the skills namespace.
// `de-novo-skills` and `node cli.mjs` skip that token.
export function resolveInvocation(args, invoked = invokedName()) {
  if (invoked !== 'de-novo') return { args, error: null };
  const head = args[0];
  if (head == null || head === 'help' || head === '--help' || head === '-h') {
    return { args: ['help'], error: null };
  }
  if (head !== 'skills') {
    return { args: null, error: 'usage: de-novo skills <command>\nnamespaces: skills' };
  }
  return { args: args.slice(1), error: null };
}

// Engine names → compose services and profiles. Catalog is docker-compose.yml.
// No args: start nothing — pass names or run setup <project>.
export function resolveEngines(names) {
  const chosen = names.map((n) => canonicalizeEngine(n, 'up'));
  const services = [];
  const profiles = [];
  for (const canon of chosen) {
    const spec = ENGINES[canon];
    if (!services.includes(spec.service)) services.push(spec.service);
    if (spec.composeProfile && !profiles.includes(spec.composeProfile)) {
      profiles.push(spec.composeProfile);
    }
  }
  return { services, profiles };
}

function optionalPathArg(args, command) {
  if (args.length > 1) {
    throw new Error(`${command}: unexpected argument ${JSON.stringify(args[1])}`);
  }
  if (args[0]?.startsWith('--')) {
    throw new Error(`${command}: unknown option ${JSON.stringify(args[0])}`);
  }
  return args[0];
}

function requireNoArgs(args, command) {
  if (args.length > 0) {
    throw new Error(`${command}: unexpected argument ${JSON.stringify(args[0])}`);
  }
}

function cmdUp(args) {
  const { services, profiles } = resolveEngines(args);
  if (services.length === 0) {
    console.log(`engines 0/0: pass names (${CLI} infra up mysql) or ${CLI} setup <project>`);
    return 0;
  }
  const up = run(
    'docker',
    [
      'compose',
      '-f',
      COMPOSE_FILE,
      ...profiles.flatMap((p) => ['--profile', p]),
      'up',
      ...COMPOSE_UP_FLAGS,
      ...services,
    ],
    { stdio: 'inherit', encoding: undefined }
  );
  if (up.status !== 0) {
    console.error(`up: docker compose failed (exit ${up.status}).`);
    return 1;
  }
  // Exit 0 is not the same as the engine existing — inspect container state.
  const states = services.map((service) => {
    const spec = Object.values(ENGINES).find((e) => e.service === service);
    return { service, ...containerState(spec.container) };
  });
  const ready = states.filter((s) => s.ready).length;
  console.log(`engines ${ready}/${services.length}: ${states.map((s) => `${s.service}(${s.label})`).join(' ')}`);
  return ready === services.length ? 0 : 1;
}

export function formatInfraStatus() {
  const ground = loadGroundAddressing();
  const tld = ground.localTld ?? ground.tld ?? 'localhost';
  const tldSource = ground.localTld ? 'ground.local' : ground.tld ? 'ground' : 'default';
  const names = Object.keys(ENGINES);
  const lines = [
    '■ ground — machine infra',
    `  tld      ${tld}  (${tldSource})`,
    `  catalog  ${names.join(' ')}`,
  ];
  let ready = 0;
  for (const name of names) {
    const spec = ENGINES[name];
    const state = containerState(spec.container);
    if (state.ready) ready += 1;
    const label =
      state.label === 'missing'
        ? `not running (${CLI} infra up ${name})`
        : `${state.label}${state.ready ? ' ✓' : ''}`;
    lines.push(`  ${name.padEnd(6)} ${spec.service.padEnd(8)} ${label}`);
  }
  lines.push(`  ready    ${ready}/${names.length}`);
  return lines.join('\n');
}

function cmdStatus(args = []) {
  requireNoArgs(args, 'infra status');
  console.log(formatInfraStatus());
  return 0;
}

function cmdInfra(args) {
  const [sub, ...rest] = args;
  switch (sub) {
    case undefined:
      return cmdStatus();
    case 'status':
      return cmdStatus(rest);
    case 'up':
      return cmdUp(rest);
    case 'provision':
      return cmdProvision(rest);
    case 'k3d':
      return cmdInfraK3d(rest);
    case 'dns':
      return runDns(rest);
    case 'gateway':
      return runGateway(rest);
    case 'help':
    case '--help':
    case '-h':
      printInfraHelp();
      return 0;
    default:
      console.error(`${CLI} infra: unknown command "${sub}"\n`);
      printInfraHelp();
      return 1;
  }
}

function printInfraHelp() {
  console.log(`machine infra for Ground. Catalog: infra/docker-compose.yml.
TLD: infra/addressing.yml. Projects declare isolation units, not engines.

usage:
  ${CLI} infra gateway start --config FILE [--apply]
                                      explicit one-time Portless bootstrap
  ${CLI} infra dns render --project ROOT --address IPv4 [--output DIR --apply]
                                      DNS artifacts only; no host changes
  ${CLI} infra status                 compose catalog, tld, ready n/n
  ${CLI} infra up [engine …]          start those compose engines
  ${CLI} infra provision (mysql|pg) <name>
                                      one database + dedicated account
  ${CLI} infra k3d connect --cluster NAME
                                      link a k3d-managed cluster to the compose network
  ${CLI} infra k3d join --cluster NAME
                                      mark this computer on that cluster and count nodes and engines
  ${CLI} infra k3d status --cluster NAME

there is no down command.`);
}

function cmdProvision(args) {
  const result = spawnSync('bash', [PROVISION, ...args], { stdio: 'inherit' });
  return result.status ?? 1;
}

function cmdOverlay(args) {
  const options = parseOverlayCliArgs(args);
  if (options.help) {
    console.log(overlayHelp(CLI));
    return 0;
  }
  const profilePath = resolveProfilePath(options.project);
  const profile = parseProfile(readFileSync(profilePath, 'utf8'), profilePath);
  return runOverlayLifecycle({ options, profile, profilePath });
}

function dockerNetworks(container) {
  const result = run('docker', [
    'inspect',
    '-f',
    '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}',
    container,
  ]);
  if (result.status !== 0) return null;
  return result.stdout.trim().split(/\s+/).filter(Boolean);
}

function dockerNetworkIp(container, network) {
  const result = run('docker', [
    'inspect',
    '-f',
    `{{(index .NetworkSettings.Networks "${network}").IPAddress}}`,
    container,
  ]);
  if (result.status !== 0) return null;
  const ip = result.stdout.trim();
  return ip.length > 0 ? ip : null;
}

function writeK3dKubeconfig(cluster) {
  const result = run('k3d', ['kubeconfig', 'get', cluster]);
  if (result.status !== 0) {
    throw new Error(`k3d kubeconfig get ${cluster} failed: ${result.stderr.trim()}`);
  }
  return writeTemporaryKubeconfig(cluster, result.stdout);
}

function readKubernetesResources(kubeconfig, namespace) {
  const readList = (resource) => {
    const result = run('kubectl', [
      '--kubeconfig',
      kubeconfig,
      '-n',
      namespace,
      'get',
      resource,
      '-l',
      'app.kubernetes.io/managed-by=ground',
      '-o',
      'json',
    ]);
    if (result.status !== 0) {
      throw new Error(`kubectl get ${resource} failed: ${result.stderr.trim()}`);
    }
    let body;
    try {
      body = JSON.parse(result.stdout);
    } catch {
      throw new Error(`kubectl get ${resource} returned malformed JSON.`);
    }
    if (!Array.isArray(body.items)) {
      throw new Error(`kubectl get ${resource} did not return a List.`);
    }
    return body.items;
  };
  return {
    services: readList('services'),
    endpointSlices: readList('endpointslices.discovery.k8s.io'),
  };
}

function kubectlJson(kubeconfig, args, { emptyOnNotFound = false } = {}) {
  const result = run('kubectl', ['--kubeconfig', kubeconfig, ...args, '-o', 'json']);
  if (result.status !== 0) {
    const detail = `${result.stderr || ''}\n${result.stdout || ''}`;
    if (emptyOnNotFound && /NotFound/.test(detail)) return { items: [] };
    throw new Error(`kubectl ${args.join(' ')} failed: ${detail.trim()}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`kubectl ${args.join(' ')} returned malformed JSON.`);
  }
}

function runningEngineNames() {
  const names = [];
  for (const [name, spec] of Object.entries(ENGINES)) {
    if (containerState(spec.container).ready) names.push(name);
  }
  return names;
}

// This computer joins a cluster a person already created. It labels the
// server node and counts. It does not create a cluster or another node.
function joinK3dMember({ opts, node }) {
  const host = memberLabel(hostname());
  const temporary = opts.kubeconfig == null ? writeK3dKubeconfig(opts.cluster) : null;
  const kubeconfig = opts.kubeconfig ?? temporary.file;
  try {
    const before = kubectlJson(kubeconfig, ['get', 'nodes']);
    const server = (before.items ?? []).find((item) => item?.metadata?.name === node);
    if (server == null) throw new Error(`node ${node} is not in cluster ${opts.cluster}.`);
    const marked = server.metadata?.labels?.[JOIN_LABEL];
    if (marked != null && marked !== host) {
      throw new Error(`node ${node} is already joined by ${marked}.`);
    }
    if (marked !== host) {
      const label = run('kubectl', ['--kubeconfig', kubeconfig, 'label', 'node', node, `${JOIN_LABEL}=${host}`]);
      if (label.status !== 0) {
        throw new Error(`kubectl label node ${node} failed: ${(label.stderr || '').trim()}`);
      }
    }
    const nodes = kubectlJson(kubeconfig, ['get', 'nodes']);
    const services = kubectlJson(kubeconfig, ['get', 'services', '-n', opts.namespace, '-l', 'app.kubernetes.io/managed-by=ground'], { emptyOnNotFound: true });
    const compared = compareK3dJoin({
      nodes: nodes.items,
      services: services.items,
      engines: runningEngineNames(),
      host,
    });
    console.log(formatK3dJoinReport({ cluster: opts.cluster, host, compared }));
    const nodesOk = compared.nodesTotal > 0 && compared.nodesReady === compared.nodesTotal && compared.member > 0;
    const enginesOk = compared.enginesReady === compared.enginesTotal && compared.missing.length === 0;
    return nodesOk && enginesOk ? 0 : 1;
  } finally {
    temporary?.cleanup();
  }
}

function cmdInfraK3d(args) {
  const opts = parseK3dArgs(args);
  const node = k3dServerContainer(opts.cluster);
  const network = COMPOSE_NETWORK;
  if (opts.cluster === 'local') {
    console.error(
      `${CLI} infra k3d: --cluster local is the existing machine cluster; not a sandbox.`
    );
  }
  const nets = dockerNetworks(node);
  if (nets == null) {
    throw new Error(
      `k3d node ${node} not found — create a separate cluster on ${network} (do not reuse local).`
    );
  }
  if (opts.verb === 'join') return joinK3dMember({ opts, node });
  let nodeOnNetwork = nets.includes(network);
  if (opts.verb === 'connect' && !opts.dryRun && !nodeOnNetwork) {
    const connect = run('docker', ['network', 'connect', network, node]);
    if (connect.status !== 0) {
      throw new Error(`docker network connect ${network} ${node} failed: ${connect.stderr.trim()}`);
    }
    nodeOnNetwork = true;
  }
  const links = [];
  const skipped = [];
  for (const [name, spec] of Object.entries(ENGINES)) {
    const state = containerState(spec.container);
    if (!state.ready) {
      skipped.push({ name, reason: 'not running' });
      continue;
    }
    const ip = dockerNetworkIp(spec.container, network);
    if (!ip) {
      skipped.push({ name, reason: `no IP on ${network}` });
      continue;
    }
    links.push({ name, ip, port: spec.port });
  }
  if (opts.verb === 'connect') {
    if (links.length === 0) {
      throw new Error('no running engines on the compose network to link.');
    }
    const yaml = renderK3dLinkManifests({ namespace: opts.namespace, links });
    if (opts.dryRun) {
      console.log(yaml);
      console.error(
        formatK3dLinkReport({
          cluster: opts.cluster,
          network,
          node,
          nodeOnNetwork,
          links,
          skipped,
          dryRun: true,
        })
      );
      return 0;
    }
  }

  const temporary = opts.kubeconfig == null ? writeK3dKubeconfig(opts.cluster) : null;
  const kubeconfig = opts.kubeconfig ?? temporary.file;
  try {
    if (opts.verb === 'connect') {
      const yaml = renderK3dLinkManifests({ namespace: opts.namespace, links });
      const apply = run('kubectl', ['--kubeconfig', kubeconfig, 'apply', '-f', '-'], {
        input: yaml,
      });
      if (apply.status !== 0) {
        throw new Error(`kubectl apply failed: ${apply.stderr.trim()}`);
      }
    }
    const actual = readKubernetesResources(kubeconfig, opts.namespace);
    const resources = compareK3dLinks({ links, ...actual });
    console.log(
      formatK3dLinkReport({
        cluster: opts.cluster,
        network,
        node,
        nodeOnNetwork,
        links,
        skipped,
        dryRun: false,
        resources,
      })
    );
    return nodeOnNetwork && resources.ready === resources.total && resources.drift.length === 0
      ? 0
      : 1;
  } finally {
    temporary?.cleanup();
  }
}

function printHelp() {
  console.log(`${CLI} — Ground CLI (yaml is source of truth; the CLI paints it)

Reuse existing project commands; share local engines and record project values.

machine (Ground — compose + addressing.yml):
  ${CLI} infra dns --help              generate project-scoped DNS artifacts
  ${CLI} infra status                  catalog, tld, ready n/n
  ${CLI} infra up [engine …]           start those compose engines
  ${CLI} infra provision (mysql|pg) <name>
  ${CLI} infra k3d connect --cluster NAME
                                       link a k3d-managed cluster to compose engines
  ${CLI} infra k3d join --cluster NAME  mark this computer on that cluster; count nodes and engines

first:
  ${CLI} doctor [--project ROOT] [--probe] [--json]   what this machine and project have; read-only, exit 1 on an invalid values file
  ${CLI} capabilities [--json]              the verbs, Ground, backend executables

project:
  ${CLI} dev SERVICE [--env ENV --image REF] [--apply]   run and verify a named URL
  ${CLI} init [project-root] [--slug NAME]
                                 [--context NAME] [--engines a,b] [--services a,b] [--infra machine|project] [--force]
  ${CLI} validate [project-root|profile]
  ${CLI} urls [project-root|profile] [--env NAME] [--json]
                                 print hostnames (no listener)
  ${CLI} setup [project-root|profile]  owner-authorized engines + DB/account provisioning
  ${CLI} overlay <verb> ...            create/attach/detach/destroy/status/touch/prune
  ${CLI} overlay verify [--image REF]   drive this project's adapter through the contract
up, status, provision are aliases of infra up|status|provision.
there is no machine down command — several projects live on machine infra.`);
}

function main(argv) {
  const parsed = resolveInvocation(argv);
  if (parsed.error) {
    console.error(parsed.error);
    return 1;
  }
  const [command, ...rest] = parsed.args;
  switch (command) {
    case 'doctor':
    case 'capabilities':
      if (rest[0] === 'help' || rest[0] === '--help' || rest[0] === '-h') {
        console.log(doctorHelp(CLI));
        return 0;
      }
      return runDoctor({ verb: command, args: rest });
    case 'dev':
      return runDev(rest);
    case 'init':
      return runInit(rest);
    case 'setup':
      return runSetup(optionalPathArg(rest, 'setup'));
    case 'validate': {
      const profilePath = resolveProfilePath(optionalPathArg(rest, 'validate'));
      const profile = parseProfile(readFileSync(profilePath, 'utf8'), profilePath);
      const runtime = requireKubernetesRuntime(profile, profilePath);
      const addressing = resolveAddressing(profile, { profilePath });
      console.log(formatValidateReport(profile, addressing));
      console.log(`  runtime   1/1: ${runtime.backend}, context ${runtime.context} (configuration only)`);
      return 0;
    }
    case 'urls': {
      const { root, env, json } = parseUrlsArgs(rest);
      const profilePath = resolveProfilePath(root);
      const profile = parseProfile(readFileSync(profilePath, 'utf8'), profilePath);
      const addressing = resolveAddressing(profile, { profilePath });
      const urls = renderProjectUrls(profile, addressing, { env });
      console.log(json ? formatUrlsJson(addressing, urls) : formatUrlsReport(profile, addressing, urls));
      return 0;
    }
    case 'overlay':
      return cmdOverlay(rest);
    case 'infra':
      return cmdInfra(rest);
    case 'up':
      return cmdUp(rest);
    case 'status':
      return cmdStatus(rest);
    case 'provision':
      return cmdProvision(rest);
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      return 0;
    default:
      console.error(`${CLI}: unknown command "${command}"\n`);
      printHelp();
      return 1;
  }
}

// Compare argv[1] via realpath. npm link bins are symlinks, so a string
// compare misses main and exits 0 — a quiet false pass.
function isMain() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isMain()) {
  const argv = process.argv.slice(2);
  let code;
  try {
    code = await main(argv);
  } catch (error) {
    console.error(`${CLI}: ${error.message}`);
    code = 1;
  }
  process.exitCode = code;
}

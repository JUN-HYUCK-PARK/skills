import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const CLI = fileURLToPath(new URL('./cli.mjs', import.meta.url));
function fixture(t, { proxy = 'portless', context = 'explicit', port = 443 } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'ground-dev-'));t.after(() => rmSync(root,{recursive:true,force:true}));
  mkdirSync(path.join(root,'.agents'));
  writeFileSync(path.join(root,'.agents/runtime-profile.yml'), `project: {slug: acme}\naddressing: {proxy: ${proxy}, scheme: {overlay: "{service}--{env}.{project}.{tld}"}}\nruntime:\n  default: dev\n  profiles: {dev: {backend: k3s, context: ${JSON.stringify(context)}, namespace: acme, overlay_namespace: "acme-{env}"}}\n  commands: {up: "node deploy.mjs", overlay: "node overlay.mjs"}\nservices: {web: {health: /health, kubernetes: {service: frontend, port: 8080}}}\noverlay: {attachable: [web]}\n`);
  const gateway = path.join(root,'gateway.local.yml');
  writeFileSync(gateway, `port: ${port}\nhttps: true\ntlds: [ground.test, product.example.com]\nstate_dir: ./edge\n`);
  const run = (args) => spawnSync(process.execPath,[CLI,...args,'--project',root,'--gateway',gateway],{encoding:'utf8'});
  return {root, gateway, run};
}

test('dev plans one named URL and explicit Kubernetes Service without mutations', (t) => {
  const f=fixture(t);const result=f.run(['dev','web','--json']);
  assert.equal(result.status,0,result.stderr);const plan=JSON.parse(result.stdout);
  assert.equal(plan.url,'https://web.acme.ground.test');assert.equal(plan.namespace,'acme');
  assert.equal(plan.context,'explicit');assert.equal(plan.kubernetes_service,'frontend');assert.equal(plan.port,8080);
  assert.equal(plan.apply,false);
});

test('dev overlays keep independent URLs and explicit namespaces', (t) => {
  const f=fixture(t);const result=f.run(['dev','web','--env','feature-a','--image',`repo/web:${'a'.repeat(40)}`,'--json']);
  assert.equal(result.status,0,result.stderr);const plan=JSON.parse(result.stdout);
  assert.equal(plan.url,'https://web--feature-a.acme.ground.test');assert.equal(plan.namespace,'acme-feature-a');
});

test('dev refuses implicit proxy ownership, missing context and incomplete overlay requests', (t) => {
  for(const options of [{proxy:'none'},{context:''}]) {
    const f=fixture(t,options);const r=f.run(['dev','web']);assert.equal(r.status,1);assert.match(r.stderr,/dev:|context/);
  }
  const f=fixture(t);
  for(const args of [['dev','unknown'],['dev','web','--env','feature'],['dev','web','--image','repo:latest'],['dev','web','--env','bad/env','--image',`repo:${'a'.repeat(40)}`]]) {
    const r=f.run(args);assert.equal(r.status,1);assert.match(r.stderr,/dev:|overlay:/);
  }
});

test('gateway start requires an explicit valid listener and is a plan by default', (t) => {
  const f=fixture(t);
  let r=spawnSync(process.execPath,[CLI,'infra','gateway','start','--config',f.gateway,'--json'],{encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).apply,false);
  writeFileSync(f.gateway,'tlds: [ground.test]\nstate_dir: ./edge\n');
  r=spawnSync(process.execPath,[CLI,'infra','gateway','start','--config',f.gateway],{encoding:'utf8'});
  assert.equal(r.status,1);assert.match(r.stderr,/port/);
});

test('Kubernetes Service mapping is validated by the profile parser', (t) => {
  for(const replacement of ['kubernetes: {service: "bad/name", port: 8080}', 'kubernetes: {service: frontend, port: 0}', 'kubernetes: {service: frontend, port: 8080, typo: 1}']) {
    const f=fixture(t),file=path.join(f.root,'.agents/runtime-profile.yml');
    const original='kubernetes: {service: frontend, port: 8080}';
    const profile=readFileSync(file,'utf8');writeFileSync(file,profile.replace(original,replacement));
    const r=f.run(['dev','web']);assert.equal(r.status,1);assert.match(r.stderr,/kubernetes/);
  }
});

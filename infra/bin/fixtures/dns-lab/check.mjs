// Real DNS and HTTP checks run only inside the disposable --network none container.
import assert from 'node:assert/strict';
import { Resolver } from 'node:dns/promises';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer, get } from 'node:http';
import { once } from 'node:events';

const plan = JSON.parse(readFileSync('/lab/output/manifest.json', 'utf8'));
const dns = new Resolver({ timeout: 1000, tries: 1 }); dns.setServers([`127.0.0.1:${plan.port}`]);
const syntax = spawnSync('dnsmasq', ['--test', '--conf-file=/lab/output/dnsmasq.conf'], { encoding: 'utf8' });
assert.equal(syntax.status, 0, syntax.stderr);
const child = spawn('dnsmasq', ['--keep-in-foreground', '--user=root', '--pid-file=/tmp/ground-dns.pid', '--conf-file=/lab/output/dnsmasq.conf'], { stdio: ['ignore', 'pipe', 'pipe'] });
let logs = ''; child.stdout.on('data', (b) => { logs += b; }); child.stderr.on('data', (b) => { logs += b; });
const servers = []; let udp = 0, tcp = 0, aaaa = 0, http = 0;
try {
  const first = `web.${plan.zones[0].domain}`;
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { await dns.resolve4(first); ready = true; break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(ready, `dnsmasq did not become ready: ${logs}`);
  for (const { domain, address } of plan.zones) {
    for (const prefix of ['web', 'api', 'web--worktree', 'new-service']) {
      assert.deepEqual(await dns.resolve4(`${prefix}.${domain}`), [address]); udp++;
    }
    await assert.rejects(dns.resolve6(`web.${domain}`), { code: 'ENODATA' }); aaaa++;
    const result = spawnSync('dig', ['+tcp', '+short', '+time=2', '+tries=1', '@127.0.0.1', '-p', String(plan.port), `web.${domain}`, 'A'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout.trim(), address); tcp++;
    const server = createServer((req, res) => { res.end(`${domain}|${req.headers.host}`); });
    server.listen(0, address); await once(server, 'listening'); servers.push(server);
    const host = `web.${domain}`;
    const body = await new Promise((resolve, reject) => {
      const request = get({ hostname: host, port: server.address().port, family: 4,
        lookup: (name, options, callback) => { dns.resolve4(name).then((addresses) => callback(null, addresses[0], 4), callback); }
      }, (res) => { let value = ''; res.on('data', (chunk) => { value += chunk; }); res.on('end', () => resolve(value)); });
      request.on('error', reject); request.setTimeout(2000, () => request.destroy(new Error('HTTP timed out')));
    });
    assert.equal(body, `${domain}|${host}:${server.address().port}`); http++;
  }
  await assert.rejects(dns.resolve4('unrelated.invalid'), { code: 'EREFUSED' });
  const namespace = readFileSync('/proc/net/route', 'utf8').trim().split('\n');
  assert.equal(namespace.length, 1, 'the test container must have no external routes');
  console.log(`DNS UDP ${udp}/${plan.zones.length * 4}; TCP ${tcp}/${plan.zones.length}; AAAA no-data ${aaaa}/${plan.zones.length}; unrelated refused 1/1; HTTP identity ${http}/${plan.zones.length}; external routes 0`);
} finally {
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
  if (child.exitCode == null) {
    const exited = once(child, 'exit'); child.kill('SIGTERM');
    const timeout = setTimeout(() => child.kill('SIGKILL'), 2000);
    await exited; clearTimeout(timeout);
  }
}

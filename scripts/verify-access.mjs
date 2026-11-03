// Explicit disposable k3s acceptance lab. No host kubeconfig, hosts file or CA
// store is mounted. Only the runner's uniquely named cluster/images are removed.
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),id=randomBytes(4).toString('hex');
const runner=`ground-access-check-${id}`,image=`${runner}:test`,cluster=`ground-test-access-${id}`;
function run(args,timeout=600000) {const result=spawnSync('docker',args,{cwd:root,stdio:'inherit',timeout});if(result.status!==0)throw new Error(`docker ${args.slice(0,3).join(' ')} failed (${result.status}): ${result.error?.message??''}`);}
try {
 run(['build','--pull=false','-f','infra/bin/fixtures/access-lab/Dockerfile','-t',image,'.']);
 run(['run','--rm','--name',runner,'--mount','type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock','-e',`GROUND_ACCESS_RUN=${id}`,'-e',`GROUND_ACCESS_RUNNER=${runner}`,image],600000);
 console.log('Isolation: host DNS writes 0; host CA writes 0; host kubeconfig writes 0; shared engine mutations 0');
} finally {
 // Remove only this runner, then recover that exact cluster even if its
 // process was killed before its own finally block could execute.
 spawnSync('docker',['rm','-f',runner],{encoding:'utf8',timeout:10000});
 const cleanup=spawnSync('docker',['run','--rm','--network','none','--mount','type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock','--entrypoint','/usr/local/bin/k3d',image,'cluster','delete',cluster],{encoding:'utf8',timeout:120000});
 if(cleanup.status!==0) {process.stderr.write(cleanup.stderr??'cluster cleanup failed');process.exitCode=1;}
 for(const revision of ['a','b','c']) spawnSync('docker',['image','rm',`docker.io/ground-access-${id}/app:${revision.repeat(40)}`],{encoding:'utf8',timeout:10000});
 spawnSync('docker',['image','rm',image],{encoding:'utf8',timeout:10000});
 const resources=spawnSync('docker',['ps','-a','--format','{{.Names}}'],{encoding:'utf8',timeout:10000});
 const left=(resources.stdout??'').split('\n').filter(name=>name===runner||name.startsWith(`k3d-${cluster}-`));
 console.log(`Owned acceptance containers remaining ${left.length}`);
 if(resources.status!==0 || left.length) process.exitCode=1;
}

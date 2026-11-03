import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync,mkdirSync,readFileSync,readdirSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { RouteStore } from 'portless';
import { stringify,parse } from 'yaml';
const runId=process.env.GROUND_ACCESS_RUN,runner=process.env.GROUND_ACCESS_RUNNER;
if(!/^[a-f0-9]{8}$/.test(runId??'') || runner!==`ground-access-check-${runId}`) throw new Error('isolated runner identity required');
const cluster=`ground-test-access-${runId}`,context=`k3d-${cluster}`,network=`k3d-${cluster}`;
const root=mkdtempSync(path.join(tmpdir(),'ground-access-')),kubeconfig=path.join(root,'kubeconfig');
const CLI='/catalog/infra/bin/cli.mjs',adapter='/catalog/infra/bin/fixtures/access-lab/backend.mjs';
const images=[`docker.io/ground-access-${runId}/app:${'a'.repeat(40)}`,`docker.io/ground-access-${runId}/app:${'b'.repeat(40)}`,`docker.io/ground-access-${runId}/app:${'c'.repeat(40)}`];
const children=[];let gateway,connected=false;
function cmd(file,args,{input,timeout=180000,inherit=false}={}) {
 const r=spawnSync(file,args,{encoding:'utf8',timeout,input:input?JSON.stringify(input):undefined,stdio:inherit?'inherit':'pipe'});
 assert.equal(r.status,0,`${file} ${args.slice(0,8).join(' ')}\n${r.stdout??''}\n${r.stderr??''}\n${r.error??''}`);return r.stdout;
}
function kube(args,input) {return cmd('kubectl',['--kubeconfig',kubeconfig,'--context',context,'--request-timeout=20s',...args],{input});}
async function stop(child) {if(!child || child.exitCode!=null || child.signalCode!=null)return;await new Promise(resolve=>{const timer=setTimeout(()=>child.kill('SIGKILL'),30000);child.once('exit',()=>{clearTimeout(timer);resolve();});child.kill('SIGTERM');});}
async function waitUntil(fn,timeout=15000) {let last;const end=Date.now()+timeout;while(Date.now()<end){try{const value=await fn();if(value)return value;}catch(e){if(e.terminal)throw e;last=e;}await new Promise(resolve=>setTimeout(resolve,150));}throw last??new Error('condition timed out');}
function launch(args,env) {
 const child=spawn(process.execPath,[CLI,...args],{env,stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='';child.stdout.on('data',chunk=>{stdout+=chunk;});child.stderr.on('data',chunk=>{stderr+=chunk;});
 const session={child,stdout:()=>stdout,stderr:()=>stderr,ready:()=>waitUntil(()=>{if(child.exitCode!=null)throw Object.assign(new Error(`session exited ${child.exitCode}: ${stdout}\n${stderr}`),{terminal:true});return stdout.split('\n').filter(Boolean).map(line=>{try{return JSON.parse(line);}catch{return {};}}).find(value=>value.event==='ready');},150000)};
 children.push(session);return session;
}
let config;
function request(url,upgrade=false) {
 return new Promise((resolve,reject)=>{
  const req=https.get(url,{ca:readFileSync(path.join(root,'edge/ca.pem')),headers:upgrade?{Connection:'Upgrade',Upgrade:'websocket','Sec-WebSocket-Key':'dGhlIHNhbXBsZSBub25jZQ==','Sec-WebSocket-Version':'13'}:{}},res=>{let body='';res.on('data',b=>body+=b);res.on('end',()=>resolve({status:res.statusCode,body}));});
  req.once('upgrade',(res,socket)=>{socket.destroy();resolve({status:res.statusCode});});req.on('error',reject);req.setTimeout(4000,()=>req.destroy(new Error('request timed out')));
 });
}
try {
 console.log('Creating an isolated k3s cluster; no existing context or engine is selected.');
 cmd('k3d',['cluster','create',cluster,'--image','rancher/k3s:v1.34.5-k3s1','--servers','1','--agents','0','--no-lb','--api-port','127.0.0.1:0','--k3s-arg','--disable=traefik,servicelb,metrics-server,local-storage@server:0','--kubeconfig-update-default=false','--kubeconfig-switch-context=false','--wait','--timeout','120s'],{inherit:true});
 cmd('docker',['network','connect',network,runner]);connected=true;
 const node=JSON.parse(cmd('docker',['inspect',`k3d-${cluster}-server-0`]))[0];
 const address=node.NetworkSettings.Networks[network].IPAddress;
 const document=parse(cmd('k3d',['kubeconfig','get',cluster]));document.clusters[0].cluster.server=`https://${address}:6443`;
 document.contexts.push({name:'unselected-trap',context:{cluster:document.clusters[0].name,user:document.users[0].name}});document['current-context']='unselected-trap';
 writeFileSync(kubeconfig,stringify(document));
 kube(['wait','node','--all','--for=condition=Ready','--timeout=120s']);
 for(let i=0;i<images.length;i++) cmd('docker',['build','--pull=false','--build-arg',`REVISION=${['base','overlay-one','overlay-two'][i]}`,'-t',images[i],'/catalog/infra/bin/fixtures/access-lab/app'],{inherit:true});
 cmd('k3d',['image','import',...images,'--cluster',cluster],{inherit:true});
 kube(['apply','-f','-'],{apiVersion:'v1',kind:'Namespace',metadata:{name:'ground-access-base',labels:{'ground.test/run':cluster}}});
 const labFile=path.join(root,'lab.json');config={cluster,context,kubeconfig,images};writeFileSync(labFile,JSON.stringify(config));
 const project=path.join(root,'project');mkdirSync(path.join(project,'.agents'),{recursive:true});
 const profile={project:{slug:'acme'},addressing:{proxy:'portless',scheme:{overlay:'{service}--{env}.{project}.{tld}'}},runtime:{default:'dev',profiles:{dev:{backend:'k3s',context,kubeconfig,namespace:'ground-access-base',overlay_namespace:'ground-access-{env}'}},commands:{up:`node ${adapter} up`,overlay:`node ${adapter}`}},services:{web:{health:'/health',kubernetes:{service:'web',port:8080}}},overlay:{attachable:['web']},data:{infra:'project'}};
 writeFileSync(path.join(project,'.agents/runtime-profile.yml'),stringify(profile));
 const gatewayFile=path.join(root,'gateway.local.yml');writeFileSync(gatewayFile,stringify({port:443,https:true,tlds:['ground.test','dev.example.com'],state_dir:'./edge'}));
 const env={...process.env,GROUND_ACCESS_LAB:labFile,GROUND_STATE_DIR:path.join(root,'state'),CI:'1'};
 gateway=launch(['infra','gateway','start','--config',gatewayFile,'--apply'],env);
 await waitUntil(()=>readFileSync(path.join(root,'edge/proxy.port'),'utf8').trim()==='443',30000);
 const common=['--project',project,'--gateway',gatewayFile,'--timeout','120000','--apply','--json'];
 const observations=[],verifiedHosts=new Set(),removedNamespaces=[];
 async function expectApp(url,revision,environment,phase) {
  const response=await request(url+'/health');assert.equal(response.status,200);
  const body=JSON.parse(response.body);assert.equal(body.revision,revision);assert.equal(body.environment,environment);
  verifiedHosts.add(new URL(url).hostname);observations.push({phase,url,revision:body.revision,environment:body.environment});
  console.log(JSON.stringify({observed:phase,url,revision:body.revision,environment:body.environment}));
 }
 function expectNamespaceGone(name) {
  assert.equal(kube(['get','namespace',name,'--ignore-not-found','-o','json']).trim(),'');removedNamespaces.push(name);
 }
 const base=launch(['dev','web',...common],env);const baseline=await base.ready();assert.equal(baseline.url,'https://web.acme.ground.test');
 await expectApp(baseline.url,'base','base','baseline ready');
 const overlay=launch(['dev','web','--env','w1','--image',images[1],...common],env);const changed=await overlay.ready();
 assert.equal(changed.url,'https://web--w1.acme.ground.test');
 const second=launch(['dev','web','--env','w2','--image',images[2],...common],env);const changedTwo=await second.ready();
 assert.equal(changedTwo.url,'https://web--w2.acme.ground.test');
 await expectApp(changed.url,'overlay-one','w1','first overlay while both run');
 await expectApp(changedTwo.url,'overlay-two','w2','second overlay while both run');
 await expectApp(baseline.url,'base','base','baseline while both overlays run');
 const liveImages=['ground-access-base','ground-access-w1','ground-access-w2'].map(namespace=>{
  const pods=JSON.parse(kube(['-n',namespace,'get','pods','-l','app=web','-o','json'])).items.filter(pod=>!pod.metadata.deletionTimestamp);
  assert.equal(pods.length,1);const container=pods[0].status.containerStatuses[0];assert.equal(container.ready,true);assert.ok(container.imageID);
  return {namespace,image:container.image,imageID:container.imageID};
 });
 assert.equal(new Set(liveImages.map(row=>row.imageID)).size,liveImages.length);
 console.log(JSON.stringify({observed:'distinct running image identities',images:liveImages}));
 assert.equal((await request(changed.url+'/socket',true)).status,101);
 const duplicate=spawnSync(process.execPath,[CLI,'dev','web',...common],{env,encoding:'utf8',timeout:5000});assert.equal(duplicate.status,1);assert.match(duplicate.stderr,/already registered/);
 // A second hostname cannot take ownership of an existing overlay environment.
 const contender=path.join(root,'contender');mkdirSync(path.join(contender,'.agents'),{recursive:true});
 const contenderProfile=structuredClone(profile);contenderProfile.addressing.tld='dev.example.com';
 writeFileSync(path.join(contender,'.agents/runtime-profile.yml'),stringify(contenderProfile));
 const attempted=spawnSync(process.execPath,[CLI,'dev','web','--env','w1','--image',images[1],'--project',contender,'--gateway',gatewayFile,'--apply','--json'],{env,encoding:'utf8',timeout:5000});
 assert.equal(attempted.status,1);assert.match(attempted.stderr,/session lock exists/);
 await expectApp(changed.url,'overlay-one','w1','first overlay after ownership refusal');
 await stop(overlay.child);assert.equal(overlay.child.exitCode,0,overlay.stderr());
 assert.ok(!new RouteStore(path.join(root,'edge')).loadRoutes().some(route=>route.hostname===new URL(changed.url).hostname));
 expectNamespaceGone('ground-access-w1');
 await waitUntil(async()=>{try{return (await request(changed.url+'/health')).status===404;}catch(error){if(error.code==='ENOTFOUND')return true;throw error;}});
 await expectApp(changedTwo.url,'overlay-two','w2','second overlay after first is removed');
 await expectApp(baseline.url,'base','base','baseline after first overlay is removed');
 // A failed public readiness check must remove its new overlay without
 // disturbing the other environment that is still serving requests.
 const brokenOverlay=path.join(root,'broken-overlay');mkdirSync(path.join(brokenOverlay,'.agents'),{recursive:true});
 const failedOverlayProfile=structuredClone(profile);failedOverlayProfile.project.slug='broken-overlay';failedOverlayProfile.services.web.health='/bad';failedOverlayProfile.addressing.tld='dev.example.com';
 writeFileSync(path.join(brokenOverlay,'.agents/runtime-profile.yml'),stringify(failedOverlayProfile));
 const failedOverlay=launch(['dev','web','--env','w1','--image',images[1],'--project',brokenOverlay,'--gateway',gatewayFile,'--timeout','60000','--apply','--json'],env);
 await waitUntil(()=>failedOverlay.child.exitCode!=null,150000);assert.equal(failedOverlay.child.exitCode,1,failedOverlay.stderr());
 assert.ok(failedOverlay.stderr().includes('named URL did not become ready'),failedOverlay.stderr());
 assert.ok(!failedOverlay.stdout().includes('"event":"ready"'));
 assert.ok(failedOverlay.stdout().includes('"overlay":"removed"'),failedOverlay.stdout());
 expectNamespaceGone('ground-access-w1');
 assert.ok(!new RouteStore(path.join(root,'edge')).loadRoutes().some(route=>route.hostname==='web--w1.broken-overlay.dev.example.com'));
 await expectApp(changedTwo.url,'overlay-two','w2','second overlay after failed overlay cleanup');
 await expectApp(baseline.url,'base','base','baseline after failed overlay cleanup');
 // A refused destroy must report both failures and preserve recoverable state.
 const refusedCleanup=launch(['dev','web','--env','w1','--image',images[1],'--project',brokenOverlay,'--gateway',gatewayFile,'--timeout','60000','--apply','--json'],{...env,GROUND_ACCESS_REFUSE_DESTROY:'1'});
 await waitUntil(()=>refusedCleanup.child.exitCode!=null,150000);assert.equal(refusedCleanup.child.exitCode,1,refusedCleanup.stderr());
 assert.match(refusedCleanup.stderr(),/named URL did not become ready/);
 assert.match(refusedCleanup.stderr(),/overlay cleanup remains pending/);
 assert.ok(refusedCleanup.stdout().includes('"overlay":"pending"'));
 assert.ok(!new RouteStore(path.join(root,'edge')).loadRoutes().some(route=>route.hostname==='web--w1.broken-overlay.dev.example.com'));
 assert.ok(kube(['get','namespace','ground-access-w1','-o','name']).includes('ground-access-w1'));
 const recoveryConfig=path.join(root,'recovery.kubeconfig');writeFileSync(recoveryConfig,stringify({...document,'current-context':context}));
 const recovered=spawnSync(process.execPath,[CLI,'overlay','destroy','w1','--project',brokenOverlay,'--apply'],{env:{...env,KUBECONFIG:recoveryConfig},encoding:'utf8',timeout:120000});
 assert.equal(recovered.status,0,recovered.stderr);expectNamespaceGone('ground-access-w1');rmSync(recoveryConfig);
 await expectApp(changedTwo.url,'overlay-two','w2','second overlay after pending cleanup recovery');
 await expectApp(baseline.url,'base','base','baseline after pending cleanup recovery');
 const secondPod=JSON.parse(kube(['-n','ground-access-w2','get','pods','-l','app=web','-o','json'])).items[0];
 const dependency=JSON.parse(kube(['-n','ground-access-w2','exec',secondPod.metadata.name,'--','node','-e',"require('node:http').get('http://web.ground-access-base.svc.cluster.local:8080/health',r=>{let b='';r.on('data',c=>b+=c);r.on('end',()=>console.log(b))}).on('error',e=>{console.error(e);process.exit(1)})"]));
 assert.equal(dependency.revision,'base');assert.equal(dependency.environment,'base');
 console.log(JSON.stringify({observed:'overlay-to-baseline Service DNS and HTTP',from:'ground-access-w2',dependency}));
 await stop(second.child);assert.equal(second.child.exitCode,0,second.stderr());expectNamespaceGone('ground-access-w2');
 await expectApp(baseline.url,'base','base','baseline after both overlays are removed');
 // A project-specific owned suffix is registered by the same edge and CA.
 writeFileSync(path.join(project,'.agents/runtime-profile.local.yml'),'addressing: {tld: dev.example.com}\n');
 const owned=launch(['dev','web',...common],env);const custom=await owned.ready();assert.equal(custom.url,'https://web.acme.dev.example.com');
 await expectApp(custom.url,'base','base','owned project domain');
 const broken=path.join(root,'broken');mkdirSync(path.join(broken,'.agents'),{recursive:true});
 const badProfile=structuredClone(profile);badProfile.project.slug='broken';badProfile.services.web.health='/bad';badProfile.addressing.tld='dev.example.com';
 writeFileSync(path.join(broken,'.agents/runtime-profile.yml'),stringify(badProfile));
 const bad=launch(['dev','web','--project',broken,'--gateway',gatewayFile,'--timeout','5000','--apply','--json'],env);
 await waitUntil(()=>bad.child.exitCode!=null,20000);assert.equal(bad.child.exitCode,1,bad.stderr());
 assert.ok(!new RouteStore(path.join(root,'edge')).loadRoutes().some(route=>route.hostname==='web.broken.dev.example.com'));
 assert.ok(!bad.stdout().includes('"event":"ready"'));
 await stop(owned.child);await stop(base.child);
 await waitUntil(()=>new RouteStore(path.join(root,'edge')).loadRoutes().length===0);
 await waitUntil(()=>!readFileSync('/etc/hosts','utf8').includes('.acme.') && !readFileSync('/etc/hosts','utf8').includes('.broken'));
 assert.deepEqual(readdirSync(path.join(root,'edge/ground-dev-locks')),[],'all owned locks and private kubeconfigs must be removed');
 const processes=cmd('ps',['-eo','args']).split('\n').filter(line=>/\bkubectl\b.*\bport-forward\b/.test(line));assert.deepEqual(processes,[],'owned forwarding processes must exit');
 assert.ok(kube(['get','namespace','ground-access-base','-o','name']).includes('ground-access-base'));
 const report={named_https_hosts:verifiedHosts.size,identity_observations:observations.length,concurrent_overlays:2,distinct_running_images:liveImages.length,websocket_upgrades:1,duplicate_refusals:2,overlay_removal_observations:removedNamespaces.length,failed_readiness_cleanups:2,pending_cleanup_recoveries:1,cross_namespace_service_requests:1,remaining_routes:0,remaining_managed_names:0,remaining_locks_and_kubeconfigs:0,remaining_forwarders:processes.length,baseline_preserved:true};
 console.log(JSON.stringify({result:'acceptance',...report}));

} catch(error) {
 for(const item of children) console.error(item.stderr?.(),item.stdout?.());throw error;
} finally {
 for(const item of children.toReversed()) await stop(item.child);
 // Only this uniquely named cluster is eligible for deletion.
 if(connected) spawnSync('docker',['network','disconnect',network,runner],{encoding:'utf8',timeout:10000});
 spawnSync('k3d',['cluster','delete',cluster],{stdio:'inherit',timeout:120000});
 for(const image of images) spawnSync('docker',['image','rm',image],{encoding:'utf8',timeout:10000});
 rmSync(root,{recursive:true,force:true});
}

// Connect a project deployment/overlay and a real Kubernetes Service to Portless.
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RouteStore, formatUrl } from 'portless';
import { parse as parseYaml, stringify } from 'yaml';
import { parseProfile, requireKubernetesRuntime } from './profile.mjs';
import { resolveAddressing, renderProjectUrls } from './addressing.mjs';
import { assertOverlayEnv, assertOverlayImage, splitOverlayCommand } from './overlay.mjs';
import { resolveProfilePath } from '../bin/setup.mjs';
import { loadGateway, gatewayListening } from './gateway.mjs';
const CLI=fileURLToPath(new URL('../bin/cli.mjs',import.meta.url));
const fail=(message)=>{throw new Error(`dev: ${message}`);};
const label=(value)=>typeof value==='string' && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value);
export function parseDevArgs(args) {
  if(!args.length || ['--help','help','-h'].includes(args[0])) return {help:true};
  const options={service:args[0],project:'.',gateway:undefined,env:null,image:null,apply:false,json:false,timeout:30000};
  const seen=new Set();
  for(let i=1;i<args.length;i++) {
    const arg=args[i];if(seen.has(arg)) fail(`duplicate ${arg}.`);seen.add(arg);
    if(arg==='--apply' || arg==='--json') {options[arg.slice(2)]=true;continue;}
    if(!['--project','--gateway','--env','--image','--timeout'].includes(arg) || !args[i+1] || args[i+1].startsWith('--')) fail(`unknown or incomplete option ${arg}.`);
    const value=args[++i];options[arg.slice(2)]=arg==='--timeout'?Number(value):value;
  }
  if(!Number.isInteger(options.timeout)||options.timeout<1) fail('--timeout must be positive milliseconds.');
  if(options.env) assertOverlayEnv(options.env);
  if(Boolean(options.env)!==Boolean(options.image)) fail('--env and --image must be supplied together.');
  if(options.image) assertOverlayImage(options.image);
  return options;
}
export function buildDevPlan(options) {
  const profilePath=resolveProfilePath(options.project),profile=parseProfile(readFileSync(profilePath,'utf8'),profilePath);
  const runtime=requireKubernetesRuntime(profile,profilePath),selected=profile.runtime.profiles[runtime.name];
  const service=profile.services[options.service];if(!service) fail(`unknown service ${options.service}.`);
  if(profile.addressing.proxy!=='portless') fail('named access requires an explicit addressing.proxy: portless opt-in.');
  const mapping=service.kubernetes;if(!mapping) fail(`services.${options.service}.kubernetes must name its Service and port.`);
  if(!service.health) fail(`services.${options.service}.health must name a measured safe readiness path.`);
  if(!label(selected.namespace)) fail('the selected runtime profile must explicitly name a Kubernetes namespace.');
  if(options.env && (profile.overlay.mode!=='on' || !profile.overlay.command || !profile.overlay.attachable.includes(options.service))) fail('this service is not enabled for overlays.');
  let namespace=selected.namespace;
  if(options.env) {
    const template=selected.overlay_namespace;
    if(typeof template!=='string' || !template.includes('{env}')) fail('overlay_namespace must explicitly contain {env}.');
    namespace=template.replaceAll('{env}',options.env).replaceAll('{namespace}',selected.namespace);
    if(!label(namespace)||namespace===selected.namespace) fail('overlay namespace must be a distinct valid DNS label.');
  } else if(!profile.runtime.commands?.up) fail('runtime.commands.up must provide the existing baseline deployment command.');
  const gateway=loadGateway(options.gateway),addressing=resolveAddressing(profile,{profilePath});
  if(!gateway.tlds.includes(addressing.tld)) fail(`gateway has not approved suffix ${addressing.tld}; add it during explicit machine bootstrap.`);
  const urls=renderProjectUrls(profile,addressing,{env:options.env??undefined});
  const host=(options.env?urls.overlay:urls.shared).find(row=>row.service===options.service).host;
  const root=path.dirname(path.dirname(profilePath));
  return {options,profile,profilePath,root,gateway,service,selected,public:{apply:options.apply,project:profile.project.slug,service:options.service,env:options.env,context:runtime.context,namespace,kubernetes_service:mapping.service,port:mapping.port,url:formatUrl(host,gateway.port,gateway.https),host}};
}
function execute(file,args,{env,cwd,timeout,quiet=false}={}) {
  const result=spawnSync(file,args,{env,cwd,timeout,encoding:'utf8',maxBuffer:4*1024*1024});
  if(result.status!==0) fail(`${path.basename(file)} failed: ${result.error?.message??result.stderr?.trim()??result.stdout?.trim()}`);
  if(!quiet && result.stdout) process.stderr.write(result.stdout);
  return result.stdout;
}
async function stopChild(child) {
  if(!child || child.exitCode!=null || child.signalCode!=null) return;
  await new Promise(resolve=>{const timer=setTimeout(()=>child.kill('SIGKILL'),2000);child.once('exit',()=>{clearTimeout(timer);resolve();});child.kill('SIGTERM');});
}
async function forward(plan,env,signal) {
  const args=[...(plan.selected.kubeconfig?['--kubeconfig',path.resolve(plan.root,plan.selected.kubeconfig)]:[]),'--context',plan.public.context,'--namespace',plan.public.namespace,'port-forward',`service/${plan.public.kubernetes_service}`,`:${plan.public.port}`,'--address','127.0.0.1'];
  const child=spawn('kubectl',args,{env,cwd:plan.root,stdio:['ignore','pipe','pipe']});
  let log='';
  const ready=new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error(`dev: port-forward readiness timed out: ${log}`)),plan.options.timeout);
    const abort=()=>reject(new Error('dev: interrupted during startup.'));
    signal.addEventListener('abort',abort,{once:true});
    const finish=(fn,value)=>{clearTimeout(timer);signal.removeEventListener('abort',abort);fn(value);};
    child.once('error',error=>finish(reject,error));child.once('exit',()=>finish(reject,new Error(`dev: port-forward exited: ${log}`)));
    const read=chunk=>{log=(log+chunk).slice(-8000);const match=log.match(/Forwarding from 127\.0\.0\.1:(\d+) ->/);if(match) finish(resolve,Number(match[1]));};
    child.stdout.on('data',read);child.stderr.on('data',read);
  });
  return {child,ready};
}
async function checkPublic(plan) {
  const addresses=await lookup(plan.public.host,{all:true});
  if(!addresses.length || addresses.some(({address})=>address!=='::1' && !address.startsWith('127.'))) fail('the public hostname must resolve only to loopback; check Portless hosts sync.');
  const url=new URL(plan.service.health,plan.public.url);
  const ca=plan.gateway.https?readFileSync(plan.gateway.ca_file):undefined;
  return new Promise((resolve,reject)=>{
    const request=(plan.gateway.https?https:http).get(url,{ca},response=>{
      response.resume();response.once('end',()=>{
        if(response.headers['x-portless']!=='1' || response.statusCode<200 || response.statusCode>=300) reject(new Error(`dev: named readiness returned HTTP ${response.statusCode} without a healthy Portless route.`));else resolve();
      });
    });request.on('error',reject);request.setTimeout(1500,()=>request.destroy(new Error('named readiness timed out')));
  });
}
export async function runDev(args) {
  const options=parseDevArgs(args);
  if(options.help) {console.log('usage: de-novo skills dev SERVICE [--project ROOT] [--gateway FILE] [--env ENV --image IMMUTABLE_IMAGE] [--timeout MS] [--apply] [--json]\nWithout --apply, print the plan. Applied sessions run in the foreground and print a verified named URL. Ctrl-C removes this route/forward and its newly created overlay; baseline workloads and the shared gateway stay.');return 0;}
  const plan=buildDevPlan(options);
  if(!options.apply) {console.log(JSON.stringify(plan.public,null,2));return 0;}
  if(!await gatewayListening(plan.gateway.port)) fail('the configured gateway is not listening; perform the explicit Portless machine bootstrap first.');
  const store=new RouteStore(plan.gateway.state);
  if(store.loadRoutes().some(route=>route.hostname===plan.public.host)) fail(`hostname already registered: ${plan.public.host}; no takeover is permitted.`);
  // An overlay owns its entire environment, so two services cannot both own teardown.
  const lockKey=options.env?`${plan.public.context}/${plan.public.namespace}`:plan.public.host;
  const lockDir=path.join(plan.gateway.state,'ground-dev-locks');mkdirSync(lockDir,{recursive:true});
  const lock=path.join(lockDir,createHash('sha256').update(lockKey).digest('hex')+'.json'),token=randomUUID();
  try {writeFileSync(lock,JSON.stringify({pid:process.pid,token,target:plan.public}),{flag:'wx',mode:0o600});}catch(error){fail(`session lock exists or cannot be acquired: ${lock}; inspect its owner before recovery (${error.code}).`);}
  const controller=new AbortController();const stop=()=>controller.abort();process.on('SIGINT',stop);process.on('SIGTERM',stop);
  const env={...process.env,GROUND_KUBE_CONTEXT:plan.public.context,GROUND_KUBE_NAMESPACE:plan.public.namespace,GROUND_CALLER_CWD:process.cwd(),...(plan.selected.kubeconfig?{KUBECONFIG:path.resolve(plan.root,plan.selected.kubeconfig)}:{})};
  const common={env,cwd:plan.root,timeout:options.timeout};
  const overlay=(verb,extra=[],quiet=false)=>execute(process.execPath,[CLI,'overlay',verb,options.env,'--project',plan.root,...extra],{...common,quiet});
  const emit=(event,data)=>console.log(options.json?JSON.stringify({event,...data}):`${event}: ${Object.entries(data).map(([key,value])=>`${key} ${value}`).join(' · ')}`);
  const pinnedConfig=path.join(lockDir,`session-${token}.kubeconfig`);
  let child,registered=false,created=false,removed=false,renew;
  let failure;
  try {
    // Give project commands a private kubeconfig with the selected context as
    // current, so even a bare kubectl cannot inherit a different current target.
    const source=execute('kubectl',[...(plan.selected.kubeconfig?['--kubeconfig',path.resolve(plan.root,plan.selected.kubeconfig)]:[]),'config','view','--flatten','--raw'],{...common,quiet:true});
    const kube=parseYaml(source),context=kube.contexts?.find(item=>item.name===plan.public.context);
    const cluster=kube.clusters?.find(item=>item.name===context?.context.cluster);
    const user=kube.users?.find(item=>item.name===context?.context.user);
    if(!context || !cluster) fail('the explicit context is absent from the selected kubeconfig.');
    writeFileSync(pinnedConfig,stringify({apiVersion:'v1',kind:'Config','current-context':context.name,contexts:[context],clusters:[cluster],users:user?[user]:[]}),{mode:0o600,flag:'wx'});
    env.KUBECONFIG=pinnedConfig;
    if(options.env) {
      const before=JSON.parse(overlay('status',['--json'],true));
      if(before.counts.environments!==0) fail('the overlay already exists; choose a fresh environment rather than adopting it.');
      overlay('create',['--apply']);created=true;
      overlay('attach',[options.service,'--image',options.image,'--apply']);
      renew=setInterval(()=>{try{overlay('touch',[],true);}catch(error){failure=error;controller.abort();}},30000);renew.unref();
    } else {
      const writer=path.join(lockDir,'deployment-'+createHash('sha256').update(`${plan.public.context}/${plan.public.namespace}`).digest('hex')+'.json');
      try {writeFileSync(writer,JSON.stringify({pid:process.pid,token}),{flag:'wx',mode:0o600});}catch(error){fail(`baseline deployment writer is already held: ${writer} (${error.code}).`);}
      try {const [command,...argv]=splitOverlayCommand(plan.profile.runtime.commands.up);execute(command,argv,common);}
      finally {if(JSON.parse(readFileSync(writer,'utf8')).token===token) unlinkSync(writer);}
    }
    if(controller.signal.aborted) fail('interrupted during deployment.');
    const forwarding=await forward(plan,env,controller.signal);child=forwarding.child;const port=await forwarding.ready;
    if(controller.signal.aborted) fail('interrupted during service connection.');
    store.addRoute(plan.public.host,port,process.pid);registered=true;
    const deadline=Date.now()+options.timeout;let ready=false,last;
    while(!controller.signal.aborted && Date.now()<deadline) {
      if(child.exitCode!=null || child.signalCode!=null) fail('Kubernetes service connection exited before readiness.');
      try{await checkPublic(plan);ready=true;break;}catch(error){last=error;}
      await new Promise(resolve=>setTimeout(resolve,150));
    }
    if(!ready) fail(`named URL did not become ready: ${last?.message??'interrupted'}`);
    emit('ready',{url:plan.public.url,context:plan.public.context,namespace:plan.public.namespace,service:plan.public.kubernetes_service,checks:'1/1'});
    await new Promise(resolve=>{
      if(controller.signal.aborted) return resolve();
      controller.signal.addEventListener('abort',resolve,{once:true});
      child.once('exit',()=>{if(!controller.signal.aborted) failure=new Error('dev: Kubernetes connection exited; restart this session.');resolve();});
    });
  } catch(error) {failure=error;}
  finally {
    clearInterval(renew);
    try {if(registered) store.removeRoute(plan.public.host,process.pid);}catch(error){failure??=error;}
    await stopChild(child);
    if(created) {try{overlay('destroy',['--apply']);removed=true;}catch(error){
      const cleanup=new Error(`dev: overlay cleanup remains pending: ${error.message}`);
      failure=failure?new AggregateError([failure,cleanup],`${failure.message}\n${cleanup.message}`):cleanup;
    }}
    try {unlinkSync(pinnedConfig);}catch(error){if(error.code!=='ENOENT') failure??=error;}
    try {if(JSON.parse(readFileSync(lock,'utf8')).token===token) unlinkSync(lock);}catch(error){failure??=error;}
    process.off('SIGINT',stop);process.off('SIGTERM',stop);
    emit('cleanup',{routes:store.loadRoutes().filter(route=>route.hostname===plan.public.host && route.pid===process.pid).length,overlay:created?(removed?'removed':'pending'):'baseline-kept'});
  }
  if(failure) throw failure;
  return 0;
}

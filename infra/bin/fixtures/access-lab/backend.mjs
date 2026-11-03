// Isolated acceptance adapter. It cannot target a cluster or namespace without
// this runner's ownership marker; it is not installed in consuming projects.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const file=process.env.GROUND_ACCESS_LAB;if(!file) throw new Error('private lab file required');
const config=JSON.parse(readFileSync(file,'utf8'));
if(!/^ground-test-access-[a-f0-9]{8}$/.test(config.cluster)||config.context!==`k3d-${config.cluster}`) throw new Error('non-lab target refused');
const active=spawnSync('kubectl',['config','current-context'],{encoding:'utf8'});
if(active.status!==0 || active.stdout.trim()!==config.context) throw new Error('project command inherited an unselected current context');
const [verb,env,service,...rest]=process.argv.slice(2),apply=process.argv.includes('--apply');
if(env && !['w1','w2'].includes(env)) throw new Error('non-lab environment refused');
function kube(args,input) {
 const result=spawnSync('kubectl',['--kubeconfig',config.kubeconfig,'--context',config.context,'--request-timeout=20s',...args],{input:input?JSON.stringify(input):undefined,encoding:'utf8',timeout:120000});
 if(result.status!==0) throw new Error(result.stderr||result.error?.message);return result.stdout;
}
const json=args=>JSON.parse(kube([...args,'-o','json']));
const base=json(['get','namespace','ground-access-base']);
if(base.metadata.labels?.['ground.test/run']!==config.cluster) throw new Error('namespace ownership marker mismatch');
const namespace=env?`ground-access-${env}`:'ground-access-base';
const ensureNamespace=()=>kube(['apply','-f','-'],{apiVersion:'v1',kind:'Namespace',metadata:{name:namespace,labels:{'ground.test/run':config.cluster,'ground.test/env':env}}});
function deploy(image,environment) {
 if(!config.images.includes(image)) throw new Error('non-lab image refused');
 const labels={app:'web','ground.test/run':config.cluster};
 kube(['apply','-f','-'],{apiVersion:'v1',kind:'List',items:[
  {apiVersion:'apps/v1',kind:'Deployment',metadata:{name:'web',namespace},spec:{replicas:1,selector:{matchLabels:{app:'web'}},template:{metadata:{labels},spec:{terminationGracePeriodSeconds:1,containers:[{name:'app',image,imagePullPolicy:'Never',env:[{name:'ENVIRONMENT',value:environment}],ports:[{containerPort:8080}],readinessProbe:{httpGet:{path:'/health',port:8080},periodSeconds:1}}]}}}},
  {apiVersion:'v1',kind:'Service',metadata:{name:'web',namespace},spec:{selector:{app:'web'},ports:[{port:8080,targetPort:8080}]}}
 ]});
 kube(['-n',namespace,'rollout','status','deployment/web','--timeout=90s']);
}
if(verb==='up') {deploy(config.images[0],'base');process.exit(0);}
if(verb==='status') {
 const namespaces=json(['get','namespaces','-l',`ground.test/run=${config.cluster}`]).items.filter(ns=>ns.metadata.labels['ground.test/env']);
 const environments=namespaces.filter(ns=>!env || ns.metadata.labels['ground.test/env']===env).map(ns=>{
  const pods=json(['-n',ns.metadata.name,'get','pods','-l','app=web']).items.filter(pod=>!pod.metadata.deletionTimestamp);
  const containers=pods.flatMap(pod=>pod.status.containerStatuses??[]);
  const ready=pods.length===1 && containers.length===1 && containers[0].ready && Boolean(containers[0].imageID);
  return {env:ns.metadata.labels['ground.test/env'],services:containers.length?[{service:'web',image:containers[0].image,ready:Boolean(ready)}]:[]};
 });
 console.log(JSON.stringify({ok:true,verb,environments}));process.exit(0);
}
if(!['create','attach','detach','destroy'].includes(verb)) throw new Error('unknown operation');
if(service && service!=='web' && ['attach','detach'].includes(verb)) throw new Error('unknown service');
const image=rest.includes('--image')?rest[rest.indexOf('--image')+1]:undefined;
if(apply) {
 if(verb==='destroy' && process.env.GROUND_ACCESS_REFUSE_DESTROY==='1') {
  console.log(JSON.stringify({ok:false,mutated:false,reason:'acceptance cleanup refusal'}));process.exit(1);
 }
 if(verb==='create') ensureNamespace();
 if(verb==='attach') deploy(image,env);
 if(verb==='detach') kube(['-n',namespace,'delete','deployment/web','service/web','--ignore-not-found','--timeout=30s']);
 if(verb==='destroy') kube(['delete','namespace',namespace,'--ignore-not-found','--timeout=30s']);
}
console.log(JSON.stringify({ok:true,verb,env,service,image,plan:!apply}));

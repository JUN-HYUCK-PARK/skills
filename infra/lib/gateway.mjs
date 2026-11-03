// One explicitly configured Portless edge, shared by foreground Ground dev sessions.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { parse } from 'yaml';
import { assertTld } from './addressing.mjs';
export const GATEWAY_CONFIG = fileURLToPath(new URL('../gateway.local.yml', import.meta.url));
export const PORTLESS_CLI = fileURLToPath(new URL('./cli.js', import.meta.resolve('portless')));
const fail = (message) => { throw new Error(`gateway: ${message}`); };
export function loadGateway(file = GATEWAY_CONFIG) {
  file = path.resolve(file);
  let raw; try { raw = parse(readFileSync(file, 'utf8')); } catch(error) { fail(`cannot read ${file}: ${error.message}`); }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('config must be a map.');
  for(const key of Object.keys(raw)) if(!['port','https','tlds','state_dir','ca_file'].includes(key)) fail(`unknown key ${key}.`);
  if(!Number.isInteger(raw.port) || raw.port<1 || raw.port>65535) fail('port must explicitly select an integer from 1 to 65535.');
  if(raw.https!=null && typeof raw.https!=='boolean') fail('https must be boolean.');
  if(!Array.isArray(raw.tlds) || !raw.tlds.length) fail('tlds must name the approved local suffixes.');
  for(const tld of raw.tlds) assertTld(tld,file);
  if(typeof raw.state_dir!=='string' || !raw.state_dir.trim()) fail('state_dir must explicitly name the Portless state directory.');
  if(raw.ca_file!=null && (typeof raw.ca_file!=='string' || !raw.ca_file.trim())) fail('ca_file must be a path.');
  const state = path.resolve(path.dirname(file),raw.state_dir);
  return {file,port:raw.port,https:raw.https!==false,tlds:[...new Set(raw.tlds)],state,ca_file:raw.ca_file ? path.resolve(path.dirname(file),raw.ca_file) : path.join(state,'ca.pem')};
}
export function gatewayEnvironment(config, environment=process.env) {
  return {...environment, PORTLESS_STATE_DIR:config.state,PORTLESS_PORT:String(config.port),PORTLESS_TLD:config.tlds.join(','),PORTLESS_HTTPS:config.https?'1':'0',PORTLESS_SYNC_HOSTS:'1',PORTLESS_LAN:'0',PORTLESS_UNPRIVILEGED:'0',PORTLESS_WILDCARD:'0'};
}
export function gatewayListening(port) {
  return new Promise((resolve)=>{
    const socket=createConnection({host:'127.0.0.1',port});
    const end=(result)=>{socket.destroy();resolve(result);};
    socket.once('connect',()=>end(true));socket.once('error',()=>end(false));socket.setTimeout(1000,()=>end(false));
  });
}
export async function runGateway(args) {
  if(!args.length || ['--help','help','-h'].includes(args[0])) {console.log('usage: de-novo skills infra gateway start --config FILE [--apply] [--json]\nExplicit one-time Portless bootstrap. Foreground; may install CA trust and update its hosts block. No listener is selected implicitly.');return 0;}
  if(args[0]!=='start') fail('expected start.');
  let file=GATEWAY_CONFIG,apply=false,json=false;const seen=new Set();
  for(let i=1;i<args.length;i++) {
    const arg=args[i];if(seen.has(arg)) fail(`duplicate ${arg}.`);seen.add(arg);
    if(arg==='--apply') apply=true;else if(arg==='--json') json=true;
    else if(arg==='--config' && args[i+1] && !args[i+1].startsWith('--')) file=args[++i];else fail(`unknown or incomplete option ${arg}.`);
  }
  const config=loadGateway(file);
  const argv=['proxy','start','--foreground','--port',String(config.port),...(config.https?[]:['--no-tls']),...config.tlds.flatMap(tld=>['--tld',tld])];
  if(!apply) {console.log(JSON.stringify({apply:false,config:config.file,port:config.port,https:config.https,tlds:config.tlds,state_dir:config.state,command:[process.execPath,PORTLESS_CLI,...argv]},null,2));return 0;}
  if(json) fail('--json is available for the bootstrap plan only.');
  if(await gatewayListening(config.port)) fail(`port ${config.port} is already in use; leave its owner running and use the configured gateway, or resolve the conflict explicitly.`);
  const child=spawn(process.execPath,[PORTLESS_CLI,...argv],{stdio:'inherit',env:gatewayEnvironment(config)});
  const stop=()=>child.kill('SIGTERM');process.on('SIGTERM',stop);process.on('SIGINT',stop);
  try {return await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve(signal ? 0 : code??1));});}
  finally {process.off('SIGTERM',stop);process.off('SIGINT',stop);}
}

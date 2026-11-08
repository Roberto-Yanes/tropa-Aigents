import {nativeCommand} from './native-command.mjs';
import {spawn} from 'node:child_process';
import {query} from '@anthropic-ai/claude-agent-sdk';
const cache=new Map();
const cleanEnv=()=>Object.fromEntries(Object.entries(process.env).filter(([k])=>!/API_KEY|AUTH_TOKEN|ACCESS_TOKEN|BEARER_TOKEN|^ANTHROPIC_BASE_URL$|^OPENAI_BASE_URL$|^CLAUDECODE$/.test(k)));
function codexUsage(){return new Promise((resolve,reject)=>{
 const native=nativeCommand('codex',['app-server','--stdio'],cleanEnv());const child=spawn(native.command,native.args,{env:cleanEnv(),stdio:['pipe','pipe','pipe']});let buffer='',finished=false;
 const finish=(err,value)=>{if(finished)return;finished=true;clearTimeout(timer);child.kill();err?reject(err):resolve(value);};
 const timer=setTimeout(()=>finish(Error('Tiempo de consulta agotado')),20000);
 const send=value=>child.stdin.write(JSON.stringify(value)+'\n');
 child.on('error',()=>finish(Error('Codex no disponible')));child.on('exit',()=>{if(!finished)finish(Error('Codex cerró la consulta'));});child.stdin.on('error',()=>{});child.stderr.resume();
 child.stdout.on('data',chunk=>{buffer+=chunk;let at;while((at=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,at);buffer=buffer.slice(at+1);let m;try{m=JSON.parse(line);}catch{continue;}
 if(m.error)return finish(Error('No se pudo consultar la cuota'));
 if(m.id===1){send({method:'initialized'});send({id:2,method:'account/rateLimits/read',params:{}});}
 if(m.id===2){const r=m.result?.rateLimits;finish(null,{windows:[r?.primary,r?.secondary].filter(Boolean).map(w=>({usedPercent:w.usedPercent,minutes:w.windowDurationMins,resetsAt:w.resetsAt?new Date(w.resetsAt*1000).toISOString():null}))});}
 }});
 send({id:1,method:'initialize',params:{clientInfo:{name:'community_agents',version:'0.1.0'},capabilities:{experimentalApi:true}}});
});}
async function claudeUsage(){
 let release;const hold=new Promise(r=>release=r);
 async function* input(){await hold;}
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),20000);
 const q=query({prompt:input(),options:{pathToClaudeCodeExecutable:'claude',env:cleanEnv(),abortController:controller,tools:[],strictMcpConfig:true,settingSources:[],persistSession:false,permissionMode:'dontAsk'}});
 try{const method=q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET;if(!method)throw Error('Consulta no disponible en esta versión');
 const data=await method.call(q,{skipBehaviors:true});if(!data.rate_limits_available)throw Error('El proveedor no devolvió límites');
 return {windows:[['five_hour',300],['seven_day',10080]].flatMap(([key,minutes])=>{const w=data.rate_limits?.[key];return w&&Number.isFinite(w.utilization)?[{minutes,usedPercent:w.utilization,resetsAt:w.resets_at||null}]:[];})};
 }finally{clearTimeout(timer);release();q.close();}
}
export async function readUsage(id){
 const entry=cache.get(id);if(entry&&Date.now()<entry.next)return entry.promise;
 const promise=(async()=>{try{const value=await(id==='codex'?codexUsage():claudeUsage());return {...value,checkedAt:new Date().toISOString()};}catch{return {windows:[],error:'Uso no disponible temporalmente',checkedAt:new Date().toISOString()};}})();
 cache.set(id,{promise,next:Date.now()+300000});return promise;
}

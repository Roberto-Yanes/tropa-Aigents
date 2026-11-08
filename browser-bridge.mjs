import {randomBytes,randomUUID} from 'node:crypto';
import {assertSite,siteOrigin} from './site-policy.mjs';
export class BrowserBridge {
 constructor(){this.pending=new Map();this.revoke();}
 revoke(){for(const p of this.pending.values())p.finish(Error('Conexión del navegador revocada.'));this.token=null;this.extension=null;this.tabs=[];this.lastSeen=0;this.pair=null;}
 pairing(){this.pair={code:randomBytes(16).toString('hex'),expires:Date.now()+300000};return this.pair;}
 connect(code,origin){if(!this.pair||this.pair.expires<Date.now()||code!==this.pair.code)throw Error('Código inválido o vencido.');this.revoke();this.extension=origin;this.token=randomBytes(32).toString('hex');this.lastSeen=Date.now();return {token:this.token};}
 authorized(token,origin){return !!this.token&&token===this.token&&origin===this.extension;}
 status(){return {connected:!!this.token&&Date.now()-this.lastSeen<15000,tabs:this.tabs.map(t=>({id:t.id,origin:t.origin})),extension:this.extension};}
 poll(tabs){this.lastSeen=Date.now();this.tabs=(Array.isArray(tabs)?tabs:[]).slice(0,30).filter(t=>Number.isInteger(t.id)&&typeof t.origin==='string').flatMap(t=>{try{return [{id:t.id,origin:siteOrigin(t.origin)}];}catch{return [];}});const p=[...this.pending.values()].find(p=>!p.claimed);if(!p)return null;p.claimed=true;return p.command;}
 finish(id,result,error){const p=this.pending.get(id);if(!p||!p.claimed)throw Error('Acción vencida o desconocida.');p.finish(error?Error(String(error).slice(0,1000)):null,result);}
 request(runId,action,args,sites,signal){
  if(!this.status().connected)throw Error('Conectá la extensión en Conexiones y compartí una pestaña.');
  if(args.url)assertSite(args.url,sites);
  if(signal.aborted)return Promise.reject(Error('Ejecución cancelada.'));
  return new Promise((resolve,reject)=>{const id=randomUUID();const abort=()=>finish(Error('Ejecución cancelada. No se repetirá la acción.'));const timer=setTimeout(()=>finish(Error('El navegador no respondió. Revisá la extensión; no se repetirá la acción.')),45000);const finish=(err,result)=>{clearTimeout(timer);signal.removeEventListener('abort',abort);this.pending.delete(id);err?reject(err):resolve(result);};this.pending.set(id,{command:{id,runId,action,args,sites,expires:Date.now()+45000},claimed:false,finish});signal.addEventListener('abort',abort,{once:true});});
 }
 active(id){return this.pending.has(id);}
}

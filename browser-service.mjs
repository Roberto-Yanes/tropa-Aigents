import {mkdirSync} from 'node:fs';
import { BrowserBridge } from './browser-bridge.mjs';
import { assertSite } from './site-policy.mjs';
import { chromium } from 'playwright';
import { randomUUID, randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { EventEmitter } from 'node:events';

export function publicIP(ip) {
 if(ip.includes(':'))return !/^(::|fc|fd|fe8|fe9|fea|feb|ff)/i.test(ip);
 const [a,b]=ip.split('.').map(Number);
 return !(a===0||a===10||a===127||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&b===168||a===100&&b>=64&&b<=127||a>=224);
}
export class VisualBrowser extends EventEmitter {
 constructor(origin,profileDir,{approvalTimeout=300000}={}){super();this.approvalTimeout=approvalTimeout;this.profileDir=profileDir;this.personal=null;this.personalStarting=null;this.manualBusy=false;this.bridge=new BrowserBridge();this.origin=origin;this.sessions=new Map();this.keys=new Map();this.busyRuns=new Set();this.browser=null;this.starting=null;this.timer=setInterval(()=>{for(const [id,s] of this.sessions)if(!s.pending&&Date.now()-s.touched>1200000)this.close(id);},60000);this.timer.unref();}
 safeEmit(name,value){for(const listener of this.rawListeners(name)){try{const result=listener.call(this,value);if(result&&typeof result.then==='function')result.catch(()=>{});}catch{}}}
 bind(runId,agent,signal,policy={mode:"isolated",sites:[]}){const key=randomBytes(32).toString('hex');const controller=new AbortController();const abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();this.keys.set(key,{runId,agent,policy,signal:controller.signal});return {key,release:()=>{controller.abort();signal.removeEventListener('abort',abort);this.keys.delete(key);}};}
 isDemo(url){try{const u=new URL(url);return u.origin===this.origin()&&['/browser-demo','/browser-demo/result'].includes(u.pathname);}catch{return false;}}
 async allowed(url){
  if(this.isDemo(url))return true;
  const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password)throw Error('Solo páginas HTTPS públicas o el formulario de prueba local.');
  const host=u.hostname.replace(/^\[|\]$/g,'');const ips=isIP(host)?[{address:host}]:await lookup(host,{all:true});if(!ips.length||ips.some(x=>!publicIP(x.address)))throw Error('Dirección de red privada no permitida.');return true;
 }
 async internal(){
  if(!this.profileDir)throw Error('Perfil interno no configurado.');
  if(this.personal)return this.personal;
  if(!this.personalStarting)this.personalStarting=(async()=>{
   mkdirSync(this.profileDir,{recursive:true,mode:0o700});
   const context=await chromium.launchPersistentContext(this.profileDir,{channel:process.env.COMMUNITY_BROWSER_CHANNEL||'chrome',headless:true,chromiumSandbox:true,viewport:{width:1180,height:760},acceptDownloads:false,serviceWorkers:'block'});
   const s={context,page:context.pages()[0]||await context.newPage(),refs:new Map(),history:[],pending:null,touched:Date.now(),image:null,url:'about:blank',agent:'Vos',owner:null,sites:[]};
   await context.route('**/*',async route=>{try{await this.allowed(route.request().url());if(s.owner&&route.request().isNavigationRequest())assertSite(route.request().url(),s.sites);await route.continue();}catch{await route.abort();}});
   s.page.setDefaultTimeout(15000);s.page.on('dialog',d=>d.dismiss().catch(()=>{}));s.page.on('popup',p=>p.close().catch(()=>{}));
   // Do not restore arbitrary previous pages into the shared viewport.
   for(const p of context.pages())if(p!==s.page)await p.close();
   this.personal=s;context.on('close',()=>{this.personal=null;this.personalStarting=null;});return s;
  })().catch(e=>{this.personalStarting=null;throw e;});
  return this.personalStarting;
 }
 releaseInternal(id){if(this.personal?.owner===id){this.personal.owner=null;this.personal.sites=[];}}
 async manual(action,args={}){
  if(this.manualBusy)throw Error('Esperá la acción anterior.');this.manualBusy=true;
  try{
   const s=await this.internal();if(s.owner)throw Error('Un equipo está usando el navegador. Detenelo antes de tomar el control.');
   if(action==='open'){await this.allowed(args.url);await s.page.goto(args.url,{waitUntil:'domcontentloaded',timeout:30000});}
   else if(action==='click'){if(!Number.isFinite(args.x)||!Number.isFinite(args.y)||args.x<0||args.x>1180||args.y<0||args.y>760)throw Error('Posición inválida.');await s.page.mouse.click(args.x,args.y);}
   else if(action==='type'){if(typeof args.text!=='string'||args.text.length>10000)throw Error('Texto inválido.');await s.page.keyboard.insertText(args.text);}
   else if(action==='key'){if(!['Tab','Enter','Escape','Backspace','Control+A','ArrowDown','ArrowUp'].includes(args.key))throw Error('Tecla inválida.');await s.page.keyboard.press(args.key);}
   else if(action==='scroll')await s.page.mouse.wheel(0,args.direction==='up'?-550:550);
   else if(action!=='inspect')throw Error('Acción no disponible.');
   // Human interactions are never added to agent logs or sent to an AI.
   return {...await this.observe(s),owner:s.owner};
  }finally{this.manualBusy=false;}
 }
 async session(id,policy){
  // A flow can hand the run to a team with another browser mode: never reuse a session of a different kind.
  if(this.sessions.get(id)?.closed)this.sessions.delete(id);
  const current=this.sessions.get(id),kind=s=>s.internal?'internal':s.external?'existing':'isolated';
  if(current&&kind(current)!==(policy?.mode||'isolated'))await this.close(id);
  if(policy?.mode==='internal'){
   if(this.manualBusy)throw Error('La persona está usando el navegador. Esperá antes de continuar.');
   const internal=await this.internal();if(internal.owner&&internal.owner!==id)throw Error('Otro equipo está usando el navegador interno.');
   internal.owner=id;internal.sites=policy.sites;
   if(this.sessions.has(id))return this.sessions.get(id);
   const s={...internal,internal:true,refs:new Map(),history:[],pending:null,actionCount:0};this.sessions.set(id,s);return s;
  }
  if(this.sessions.has(id))return this.sessions.get(id);
  if(!this.starting)this.starting=chromium.launch({channel:process.env.COMMUNITY_BROWSER_CHANNEL||'chrome',headless:true,chromiumSandbox:true}).then(b=>this.browser=b).catch(e=>{this.starting=null;throw e;});
  await this.starting;
  const context=await this.browser.newContext({viewport:{width:1180,height:760},acceptDownloads:false,serviceWorkers:'block'});
  await context.route('**/*',async route=>{try{await this.allowed(route.request().url());await route.continue();}catch{await route.abort();}});
  const page=await context.newPage();page.setDefaultTimeout(15000);page.on('dialog',d=>d.dismiss().catch(()=>{}));page.on('popup',p=>p.close().catch(()=>{}));
  const s={context,page,refs:new Map(),history:[],pending:null,touched:Date.now(),image:null,url:'about:blank',text:'',agent:''};this.sessions.set(id,s);return s;
 }
 log(s,text,counts=true){if(counts)s.actionCount=(s.actionCount||0)+1;s.history.push({at:new Date().toISOString(),agent:s.agent,text});s.history=s.history.slice(-40);s.touched=Date.now();}
 async observe(s){
  await Promise.allSettled([...s.refs.values()].map(handle=>handle.dispose()));s.refs.clear();s.url=s.page.url();
  const elements=[];let index=0;
  for(const handle of await s.page.locator('a,button,input,textarea,select,[role="button"],[role="checkbox"],[contenteditable="true"]').elementHandles()){
   if(index>=80)break;if(!await handle.isVisible()){await handle.dispose();continue;}
   const info=await handle.evaluate(el=>({tag:el.tagName.toLowerCase(),type:el.getAttribute('type')||'',label:el.getAttribute('aria-label')||el.labels?.[0]?.innerText||el.innerText||el.getAttribute('placeholder')||el.getAttribute('name')||'',value:el.type==='password'?'[oculto]':el.value||'',options:el.tagName==='SELECT'?[...el.options].map(o=>({value:o.value,label:o.text})):undefined}));
   const ref='e'+(++index);s.refs.set(ref,handle);elements.push({ref,...info,label:info.label.slice(0,250),value:info.value.slice(0,200)});
  }
  s.text=(await s.page.locator('body').innerText()).slice(0,12000);s.image=(await s.page.screenshot({type:'jpeg',quality:65})).toString('base64');s.touched=Date.now();
  return {url:s.url,title:await s.page.title(),text:s.text,elements,screenshot:s.image};
 }
 state(id){const s=this.sessions.get(id);return s?{url:s.url,image:s.image,agent:s.agent,pending:s.pending?{id:s.pending.id,action:s.pending.action,url:s.pending.url}:null,history:s.history,actionCount:s.actionCount||0,open:!s.closed}:{open:false,history:[],actionCount:0};}
 async approval(s,action,signal){
  if(signal.aborted)throw Error('Ejecución cancelada.');
  if(s.pending)throw Error('Ya hay una acción pendiente.');
  await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>finish(Error('No se recibió autorización en cinco minutos.')),this.approvalTimeout);
   const abort=()=>finish(Error('Ejecución cancelada.'));
   let finished=false;const runId=[...this.sessions].find(([,session])=>session===s)?.[0],pendingId=randomUUID();
   const finish=err=>{if(finished)return;finished=true;clearTimeout(timer);signal.removeEventListener('abort',abort);s.pending=null;this.safeEmit('approval:closed',{runId,pendingId,result:err?'rejected':'approved'});err?reject(err):resolve();};
   s.pending={id:pendingId,action,url:s.page.url(),finish};signal.addEventListener('abort',abort,{once:true});this.safeEmit('approval:pending',{runId,pendingId,action,url:s.pending.url});
  });
 }
 decide(id,pendingId,allow){const s=this.sessions.get(id);if(!s?.pending||s.pending.id!==pendingId)throw Error('La solicitud ya no está pendiente.');const p=s.pending;this.log(s,allow?'Acción autorizada por la persona':'Acción rechazada por la persona',false);if(s.page.url()!==p.url){p.finish(Error('La página cambió. Inspeccioná y solicitá autorización otra vez.'));return 'page_changed';}p.finish(allow?null:Error('La persona rechazó la acción. No la repitas.'));return allow?'approved':'rejected';}
 async call(key,name,args={}){
  const binding=this.keys.get(key);if(!binding||binding.signal.aborted)throw Error('Sesión de herramientas no válida.');
  if(this.busyRuns.has(binding.runId))throw Error('Hay otra acción en curso. Esperá su resultado.');this.busyRuns.add(binding.runId);
  try{return await this.execute(key,name,args);}catch(e){const s=this.sessions.get(binding.runId);if(s)this.log(s,"Acción no realizada: "+e.message,false);throw e;}finally{this.busyRuns.delete(binding.runId);}
 }
 async execute(key,name,args={}){
  const binding=this.keys.get(key);if(!binding||binding.signal.aborted)throw Error('Sesión de herramientas no válida.');
  if(binding.policy.mode==='existing')return this.executeExisting(binding,name,args);
  const s=await this.session(binding.runId,binding.policy);s.agent=binding.agent;s.touched=Date.now();
  const action=name.replace('browser_','');
  const scoped=binding.policy.mode==='internal';
  if(scoped&&action!=='open')assertSite(s.page.url(),binding.policy.sites);
  if(action==='inspect'){const snapshot=await this.observe(s);this.log(s,'Página observada');return snapshot;}
  if(action==='open'){
   if(typeof args.url!=='string'||args.url.length>4000)throw Error('URL inválida.');if(scoped)assertSite(args.url,binding.policy.sites);await this.allowed(args.url);
   if(!this.isDemo(args.url))await this.approval(s,{type:'Abrir página',url:args.url},binding.signal);
   binding.signal.throwIfAborted();await s.page.goto(args.url,{waitUntil:'domcontentloaded',timeout:30000});this.log(s,'Abrió '+s.page.url());
  }else if(action==='scroll'){
   await s.page.mouse.wheel(0,args.direction==='up'?-550:550);this.log(s,'Desplazó la página');
  }else if(['click','fill','select','press'].includes(action)){
   const handle=s.refs.get(args.ref);if(!handle)throw Error('Referencia vencida. Usá browser_inspect.');
   const desc=await handle.evaluate(el=>({label:el.getAttribute('aria-label')||el.labels?.[0]?.innerText||el.innerText||el.getAttribute('name')||el.tagName,type:el.getAttribute('type'),destination:el.href||el.form?.action||null}));
   if(scoped&&desc.destination)assertSite(desc.destination,binding.policy.sites);
   if(desc.type==='password')throw Error('Los campos de contraseña requieren intervención directa; no están habilitados en este MVP.');
   if(['fill','select'].includes(action)&&(typeof args.value!=='string'||args.value.length>10000))throw Error('Valor inválido.');
   if(action==='press'&&!['Enter','Tab','Escape','ArrowDown','ArrowUp'].includes(args.key))throw Error('Tecla no permitida.');
   if(!this.isDemo(s.page.url()))await this.approval(s,{type:{click:'Hacer clic',fill:'Completar campo',select:'Seleccionar opción',press:'Pulsar tecla'}[action],target:desc.label.slice(0,250),destination:desc.destination,value:args.value??args.key},binding.signal);
   binding.signal.throwIfAborted();
   if(action==='click')await handle.click();if(action==='fill')await handle.fill(args.value);if(action==='select')await handle.selectOption(args.value);if(action==='press')await handle.press(args.key);
   this.log(s,`${action}: ${desc.label.slice(0,150)}`);
  }else throw Error('Herramienta desconocida.');
  if(scoped)assertSite(s.page.url(),binding.policy.sites);
  return await this.observe(s);
 }
 async executeExisting(binding,name,args){
  const {runId,policy,signal}=binding;
  if(!this.bridge.status().connected)throw Error('La extensión no está conectada. Abrí Conexiones y vinculá tu navegador.');
  let s=this.sessions.get(runId);
  if(s&&!s.external){await this.close(runId);s=null;}
  if(!s){s={external:true,history:[],pending:null,touched:Date.now(),url:'about:blank',image:null,agent:binding.agent,refs:new Map()};s.page={url:()=>s.url};this.sessions.set(runId,s);}
  s.agent=binding.agent;s.touched=Date.now();const action=name.replace('browser_','');
  if(!['open','inspect','click','fill','select','press','scroll'].includes(action))throw Error('Herramienta desconocida.');
  if(action==='open'){
    assertSite(args.url,policy.sites);await this.allowed(args.url);
    await this.approval(s,{type:'Abrir con tu sesión personal',url:args.url},signal);
  }else {
    if(s.url==='about:blank')throw Error('Primero usá browser_open con un sitio autorizado.');
    assertSite(s.url,policy.sites);
    if(['click','fill','select','press'].includes(action)){
      const el=s.refs.get(args.ref);if(!el)throw Error('Referencia vencida. Inspeccioná la página.');
      if(el.type==='password'||el.type==='file')throw Error('Contraseñas y archivos requieren intervención directa.');
      if(['fill','select'].includes(action)&&(typeof args.value!=='string'||args.value.length>10000))throw Error('Valor inválido.');
      if(action==='press'&&!['Enter','Tab','Escape','ArrowDown','ArrowUp'].includes(args.key))throw Error('Tecla no permitida.');
      if(el.destination)assertSite(el.destination,policy.sites);
      await this.approval(s,{type:action,target:el.label,destination:el.destination||s.url,value:args.value??args.key,session:'Tu navegador personal'},signal);
    }
  }
  signal.throwIfAborted();
  const snapshot=await this.bridge.request(runId,action,{...args,expectedUrl:action==='open'?undefined:s.url},policy.sites,signal);
  assertSite(snapshot.url,policy.sites);
  s.url=snapshot.url;s.image=snapshot.screenshot;s.refs=new Map((snapshot.elements||[]).map(e=>[e.ref,e]));
  this.log(s,action+': '+snapshot.url);return snapshot;
 }
 // After a run ends, its own Chromium context is closed but the last capture and log stay visible.
 async retire(id){const s=this.sessions.get(id);if(!s||s.internal||s.external||s.closed||s.pending)return;s.closed=true;s.refs=new Map();await s.context.close().catch(()=>{});}
 async close(id){const s=this.sessions.get(id);if(!s)return;s.pending?.finish(Error('Navegador cerrado.'));this.sessions.delete(id);if(s.closed)return;if(s.internal){this.releaseInternal(id);}else if(s.external){if(this.bridge.status().connected)await this.bridge.request(id,"release",{},[],new AbortController().signal).catch(()=>{});}else await s.context.close();}
 async closeAll(){clearInterval(this.timer);this.bridge.revoke();for(const id of [...this.sessions.keys()])await this.close(id);this.bridge.revoke();await this.browser?.close();await this.personal?.context.close();}
}

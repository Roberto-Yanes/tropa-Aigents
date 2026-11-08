import { randomInt } from 'node:crypto';
import { finalText } from '../engine.mjs';
import { listFiles,readArtifact } from '../files.mjs';

const terminal=new Set(['completed','failed','cancelled','interrupted']);
const answer=text=>text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase();
export function splitText(input,limit=3500){
 const text=String(input).split(/(```[\s\S]*?```)/g).map((part,i)=>i%2?part:part.replace(/^#{1,6}\s+(.+)$/gm,'*$1*').replace(/\*\*([^*]+)\*\*/g,'*$1*')).join('');
 if(text.length<=limit)return [text];
 const parts=[];let rest=text;
 while(rest.length){if(rest.length<=limit-20){parts.push(rest);break;}let cut=rest.lastIndexOf('\n',limit-20);if(cut<1)cut=limit-20;parts.push(rest.slice(0,cut));rest=rest.slice(cut).replace(/^\n/,'');}
 return parts.map((p,i)=>`(${i+1}/${parts.length}) ${p}`);
}
export class WhatsAppChannel {
 constructor({engine,browser,transport,now=()=>Date.now(),sendDelay=1000}){
  this.engine=engine;this.browser=browser;this.transport=transport;this.now=now;this.sendDelay=sendDelay;this.outbound=Promise.resolve();this.sentAt=[];this.approvals=new Map();this.approvalTimes=new Map();this.confirmation=null;this.ownerCode=null;this.sending=new Set();this.progressAt=new Map();this.progressStep=new Map();this.queue=Promise.resolve();
  this.runListener=e=>{this.notify(e.id).catch(()=>{});this.progress(e).catch(()=>{});};
  this.pendingListener=e=>{this.pending(e).catch(()=>{});};
  this.closedListener=e=>{for(const [code,p] of this.approvals)if(p.runId===e.runId&&p.pendingId===e.pendingId)this.approvals.delete(code);};
  engine.on('run',this.runListener);browser?.on('approval:pending',this.pendingListener);browser?.on('approval:closed',this.closedListener);
 }
 row(id){return this.engine.db.prepare('SELECT * FROM channel_messages WHERE channel=? AND message_id=?').get('whatsapp',id);}
 set(id,state,runId=null){this.engine.db.prepare('UPDATE channel_messages SET state=?,run_id=COALESCE(?,run_id) WHERE channel=? AND message_id=?').run(state,runId,'whatsapp',id);}
 insert(id,state='received'){return this.engine.db.prepare('INSERT OR IGNORE INTO channel_messages(channel,message_id,received_at,state) VALUES(?,?,?,?)').run('whatsapp',id,new Date(this.now()).toISOString(),state).changes===1;}
 async dispatch(jid,payload){const work=this.outbound.then(async()=>{const now=this.now();this.sentAt=this.sentAt.filter(t=>now-t<60000);const wait=Math.max(0,this.sentAt.length?this.sentAt.at(-1)+this.sendDelay-now:0,this.sentAt.length>=20?this.sentAt[0]+60000-now:0);if(wait)await new Promise(resolve=>setTimeout(resolve,wait));const id=await this.transport.send(jid,payload);this.sentAt.push(this.now());if(id)this.insert(id,'ignored');});this.outbound=work.catch(()=>{});return work;}
 async send(jid,text){for(const part of splitText(text))await this.dispatch(jid,{text:part});}
 enqueue(message){this.queue=this.queue.then(()=>this.receive(message)).catch(()=>{});return this.queue;}
 generateOwnerCode(){if(this.engine.getSetting('whatsapp:mode')!=='dedicated'||this.engine.getSetting('whatsapp:owner'))throw Error('El registro de dueño no está disponible.');this.ownerCode={code:String(randomInt(100000,1000000)),expiresAt:this.now()+600000};return {...this.ownerCode};}
 async receive(m){
  if(!m||!m.id||!m.jid||m.isGroup||m.jid==='status@broadcast'||m.jid.endsWith('@broadcast'))return;
  let owner=this.engine.getSetting('whatsapp:owner');const mode=this.engine.getSetting('whatsapp:mode');
  if(!owner&&mode==='dedicated'&&!m.fromMe&&this.ownerCode&&this.ownerCode.expiresAt>this.now()&&m.text?.trim()===this.ownerCode.code){this.ownerCode=null;this.engine.setSetting('whatsapp:owner',m.jid);this.insert(m.id,'ignored');await this.send(m.jid,'Este teléfono quedó autorizado para darle órdenes a Tropa.');return;}
  if(!owner||m.jid!==owner||(mode==='own'&&(!m.fromMe||m.jid!==this.transport.ownJid()))||(mode==='dedicated'&&m.fromMe))return;
  if(mode==='own')await this.outbound;
  if(!this.insert(m.id))return;
  if(typeof m.text!=='string'||!m.text.trim()){this.set(m.id,'ignored');await this.send(owner,'Por ahora solo leo texto');return;}
  const text=m.text.trim(), normalized=answer(text);
  if(/^\/(estado|cancelar|reanudar|ayuda)$/i.test(text)){this.set(m.id,'ignored');await this.command(owner,text.toLowerCase());return;}
  const decision=normalized.match(/^(SI|NO)(?:\s+(\d{4}))?$/);
  if(decision){this.set(m.id,'ignored');await this.decide(owner,decision[1]==='SI',decision[2]);return;}
  if((this.now()-Number(m.timestamp)*1000)>15*60*1000){this.confirmation={kind:'old',id:m.id,text,expires:this.now()+1800000};await this.send(owner,'Recibí este mensaje hace más de 15 minutos. ¿Lo ejecuto? Respondé SI o NO.');return;}
  await this.startRun(owner,m.id,text);
 }
 async startRun(owner,id,text){
  const team=this.engine.mainTeamId();if(!team){this.set(id,'rejected');await this.send(owner,'Creá primero el agente principal en Tropa.');return;}
  let run;try{run=this.engine.chat(team,0,text,{channel:'whatsapp',messageId:id});}
  catch(e){this.set(id,'rejected');await this.send(owner,({ENGINE_BUSY:'Tropa está ocupada. Intentá más tarde.',CHAT_PENDING:'Esperá a que termine la respuesta anterior.',MESSAGE_INVALID:'El mensaje debe tener entre 1 y 4.000 caracteres.',AGENT_NOT_FOUND:'Creá primero el agente principal en Tropa.'})[e.code]||'No se pudo iniciar el trabajo.');return;}
  this.set(id,'accepted',run.id);try{await this.transport.react(owner,{id},'⏳');}catch{}await this.notify(run.id);
 }
 async notify(id){
  const row=this.engine.db.prepare("SELECT * FROM channel_messages WHERE channel='whatsapp' AND run_id=? AND state='accepted'").get(id);if(!row||this.sending.has(id))return;
  const run=this.engine.get(id);if(!terminal.has(run.status))return;const owner=this.engine.getSetting('whatsapp:owner');if(!owner)return;
  this.sending.add(id);try{await this.send(owner,run.status==='interrupted'?'Tu pedido quedó interrumpido. /reanudar para retomarlo':finalText(run)||'El trabajo terminó sin respuesta.');if(run.status==='completed'){const files=listFiles(this.engine.dir,id).filter(f=>f.size<=2000000);for(const f of files.slice(0,5)){const document=readArtifact(this.engine.dir,id,f.name);await this.dispatch(owner,{document,fileName:f.name.split('/').at(-1),mimetype:'application/octet-stream'});}if(files.length>5)await this.send(owner,'Otros archivos disponibles en Tropa: '+files.slice(5).map(f=>f.name).join(', '));}this.engine.db.prepare("UPDATE channel_messages SET state='notified',notified_at=? WHERE channel='whatsapp' AND message_id=? AND state='accepted'").run(new Date(this.now()).toISOString(),row.message_id);}finally{this.sending.delete(id);}
 }
 async recover(){const pending=this.engine.db.prepare("SELECT message_id FROM channel_messages WHERE channel='whatsapp' AND state='received' AND run_id IS NULL").all();if(pending.length){const runs=this.engine.db.prepare('SELECT body FROM runs').all().map(row=>JSON.parse(row.body));for(const item of pending){const run=runs.find(r=>r.source?.channel==='whatsapp'&&r.source?.channelMessageId===item.message_id);if(run)this.set(item.message_id,'accepted',run.id);}}const rows=this.engine.db.prepare("SELECT DISTINCT run_id FROM channel_messages WHERE channel='whatsapp' AND run_id IS NOT NULL AND state='accepted'").all();for(const row of rows)await this.notify(row.run_id);}
 async progress(event){if(!this.engine.getSetting('whatsapp:progress'))return;const row=this.engine.db.prepare("SELECT message_id FROM channel_messages WHERE channel='whatsapp' AND run_id=? AND state='accepted'").get(event.id);if(!row)return;const run=this.engine.get(event.id),step=run.steps.at(-1);if(!step||step.kind!=='delegation'||(this.progressStep.get(event.id)||0)>=run.steps.length)return;this.progressStep.set(event.id,run.steps.length);const last=this.progressAt.get(event.id)||0;if(this.now()-last<30000)return;this.progressAt.set(event.id,this.now());const owner=this.engine.getSetting('whatsapp:owner');if(owner)await this.send(owner,`${step.agent} consultó a ${step.target}.`);}
 latest(){const row=this.engine.db.prepare("SELECT run_id FROM channel_messages WHERE channel='whatsapp' AND run_id IS NOT NULL ORDER BY received_at DESC LIMIT 1").get();if(!row)return null;try{return this.engine.get(row.run_id);}catch{return null;}}
 async command(owner,cmd){const r=this.latest();if(cmd==='/ayuda')return this.send(owner,'Comandos: /estado, /cancelar, /reanudar y /ayuda. Máximo 4.000 caracteres.');if(cmd==='/estado')return this.send(owner,r?`Estado: ${r.status}. Agente: ${r.currentAgent||'—'}. Tiempo transcurrido: ${Math.max(0,Math.floor((this.now()-Date.parse(r.createdAt))/60000))} min.`:'Todavía no hay trabajos de WhatsApp.');if(cmd==='/cancelar'){if(!r||!this.engine.active.has(r.id))return this.send(owner,'No hay un trabajo activo.');this.engine.cancel(r.id);return this.send(owner,'Solicité detener el trabajo.');}if(cmd==='/reanudar'){if(!r||!['failed','cancelled','interrupted'].includes(r.status))return this.send(owner,'No hay un trabajo pendiente para reanudar.');this.confirmation={kind:'resume',runId:r.id,expires:this.now()+1800000};return this.send(owner,'Reanudar puede repetir acciones externas. Respondé SI para continuar o NO para cancelar.');}}
 async decide(owner,yes,code){
  if(code||this.approvals.size){if(!code&&this.approvals.size>1)return this.send(owner,'Hay varias autorizaciones; indicá SI o NO y el código.');const key=code||this.approvals.keys().next().value,p=this.approvals.get(key);if(!p)return this.send(owner,'Esa autorización ya no está vigente.');try{this.browser.decide(p.runId,p.pendingId,yes);await this.send(owner,yes?'Acción autorizada.':'Acción rechazada.');}catch{this.approvals.delete(key);await this.send(owner,'Esa autorización ya no está vigente.');}return;}
  const c=this.confirmation;this.confirmation=null;if(!c||c.expires<this.now())return this.send(owner,'No hay una confirmación vigente.');if(!yes){if(c.id)this.set(c.id,'rejected');return this.send(owner,'De acuerdo, no lo ejecutaré.');}if(c.kind==='old')return this.startRun(owner,c.id,c.text);try{this.engine.resume(c.runId);const row=this.engine.db.prepare("SELECT message_id FROM channel_messages WHERE channel='whatsapp' AND run_id=? ORDER BY received_at DESC LIMIT 1").get(c.runId);if(row)this.set(row.message_id,'accepted');await this.send(owner,'Continuando el trabajo.');await this.notify(c.runId);}catch{await this.send(owner,'No se pudo reanudar el trabajo.');}
 }
 async pending(e){const row=this.engine.db.prepare("SELECT message_id FROM channel_messages WHERE channel='whatsapp' AND run_id=? AND state='accepted'").get(e.runId);if(!row)return;let code;do{code=String(randomInt(1000,10000));}while(this.approvals.has(code));this.approvals.set(code,{runId:e.runId,pendingId:e.pendingId});const owner=this.engine.getSetting('whatsapp:owner');if(owner){const a=e.action||{},recent=(this.approvalTimes.get(e.runId)||[]).filter(t=>this.now()-t<300000);recent.push(this.now());this.approvalTimes.set(e.runId,recent);if(recent.length===11)await this.send(owner,'Esta tarea pide muchas autorizaciones; conviene seguirla desde el desktop.');const agent=this.browser.state(e.runId).agent||'';await this.send(owner,`Autorización pendiente (código ${code})\nAgente: ${String(agent).slice(0,120)}\nAcción: ${String(a.type||'').slice(0,120)}\nElemento: ${String(a.target||'').slice(0,120)}\nDestino: ${String(a.destination||a.url||e.url||'').slice(0,120)}\nValor: ${String(a.value||'').slice(0,40)}\nRespondé SI ${code} o NO ${code}. Vence en 5 min.`);}}
 async stop(){this.engine.off('run',this.runListener);this.browser?.off('approval:pending',this.pendingListener);this.browser?.off('approval:closed',this.closedListener);await this.transport.stop?.();}
}

import { randomInt } from 'node:crypto';
import { finalText } from '../engine.mjs';
import { listFiles,readArtifact } from '../files.mjs';

const terminal=new Set(['completed','failed','cancelled','interrupted']);
const answer=text=>text.normalize('NFD').replace(/[̀-ͯ]/g,'').trim().toUpperCase();
const OLD_AFTER=15*60*1000, CONFIRM_FOR=30*60*1000, MAX_OWNER_ATTEMPTS=5;
export function splitText(input,limit=3500){
 const text=String(input).split(/(```[\s\S]*?```)/g).map((part,i)=>i%2?part:part.replace(/^#{1,6}\s+(.+)$/gm,'*$1*').replace(/\*\*([^*]+)\*\*/g,'*$1*')).join('');
 if(text.length<=limit)return [text];
 const parts=[];let rest=text;
 while(rest.length){
  if(rest.length<=limit-20){parts.push(rest);break;}
  let cut=rest.lastIndexOf('\n',limit-20);if(cut<1)cut=limit-20;
  parts.push(rest.slice(0,cut));rest=rest.slice(cut).replace(/^\n/,'');
 }
 return parts.map((p,i)=>`(${i+1}/${parts.length}) ${p}`);
}
export class WhatsAppChannel{
 constructor({engine,browser,transport,now=()=>Date.now(),sendDelay=1000,batchDelay=2500}){
  this.engine=engine;this.browser=browser;this.transport=transport;this.now=now;this.sendDelay=sendDelay;this.batchDelay=batchDelay;
  this.outbound=Promise.resolve();this.sentAt=[];this.approvals=new Map();this.approvalTimes=new Map();
  this.resumeConfirmation=null;this.oldBatch=null;this.ownerCode=null;this.ownerAttempts=0;
  this.sending=new Set();this.progressAt=new Map();this.progressStep=new Map();this.queue=Promise.resolve();
  this.runListener=e=>{this.notify(e.id).catch(()=>{});this.progress(e).catch(()=>{});};
  this.pendingListener=e=>{this.pending(e).catch(()=>{});};
  this.closedListener=e=>{for(const [code,p] of this.approvals)if(p.runId===e.runId&&p.pendingId===e.pendingId)this.approvals.delete(code);};
  engine.on('run',this.runListener);browser?.on('approval:pending',this.pendingListener);browser?.on('approval:closed',this.closedListener);
 }
 row(id){return this.engine.db.prepare('SELECT * FROM channel_messages WHERE channel=? AND message_id=?').get('whatsapp',id);}
 set(id,state,runId=null){this.engine.db.prepare('UPDATE channel_messages SET state=?,run_id=COALESCE(?,run_id) WHERE channel=? AND message_id=?').run(state,runId,'whatsapp',id);}
 insert(id,state='received'){return this.engine.db.prepare('INSERT OR IGNORE INTO channel_messages(channel,message_id,received_at,state) VALUES(?,?,?,?)').run('whatsapp',id,new Date(this.now()).toISOString(),state).changes===1;}
 // The run's active message row: 'text_sent' means the answer went out and only files may be pending.
 runRow(runId,states=['accepted','text_sent']){return this.engine.db.prepare(`SELECT * FROM channel_messages WHERE channel='whatsapp' AND run_id=? AND state IN (${states.map(()=>'?').join(',')}) ORDER BY received_at DESC LIMIT 1`).get(runId,...states);}
 async dispatch(jid,payload){
  const work=this.outbound.then(async()=>{
   const now=this.now();this.sentAt=this.sentAt.filter(t=>now-t<60000);
   const wait=Math.max(0,this.sentAt.length?this.sentAt.at(-1)+this.sendDelay-now:0,this.sentAt.length>=20?this.sentAt[0]+60000-now:0);
   if(wait)await new Promise(resolve=>setTimeout(resolve,wait));
   const id=await this.transport.send(jid,payload);this.sentAt.push(this.now());if(id)this.insert(id,'ignored');
  });
  this.outbound=work.catch(()=>{});return work;
 }
 async send(jid,text){for(const part of splitText(text))await this.dispatch(jid,{text:part});}
 enqueue(message){this.queue=this.queue.then(()=>this.receive(message)).catch(()=>{});return this.queue;}
 generateOwnerCode(){
  if(this.engine.getSetting('whatsapp:mode')!=='dedicated'||this.engine.getSetting('whatsapp:owner'))throw Error('El registro de dueño no está disponible.');
  this.ownerCode={code:String(randomInt(100000,1000000)),expiresAt:this.now()+600000};this.ownerAttempts=0;return {...this.ownerCode};
 }
 // Baileys can address the same person by phone JID or by LID; accept either form we know for the owner.
 ownerIds(){
  const ids=new Set([this.engine.getSetting('whatsapp:owner'),this.engine.getSetting('whatsapp:ownerAlt')].filter(Boolean));
  if(this.engine.getSetting('whatsapp:mode')==='own')for(const id of this.transport.ownJids?.()||[this.transport.ownJid?.()])if(id)ids.add(id);
  return ids;
 }
 isOwner(m){const ids=this.ownerIds();return ids.has(m.jid)||(!!m.alt&&ids.has(m.alt));}
 async receive(m){
  if(!m||!m.id||!m.jid||m.isGroup||m.jid==='status@broadcast'||m.jid.endsWith('@broadcast'))return;
  const owner=this.engine.getSetting('whatsapp:owner'),mode=this.engine.getSetting('whatsapp:mode');
  if(!owner&&mode==='dedicated'&&!m.fromMe&&this.ownerCode&&this.ownerCode.expiresAt>this.now()&&/^\d{6}$/.test(m.text?.trim()||'')){
   if(m.text.trim()!==this.ownerCode.code){
    // A guessed code burns the registration window: the person generates a new one in Tropa.
    if(++this.ownerAttempts>=MAX_OWNER_ATTEMPTS)this.ownerCode=null;
    return;
   }
   this.ownerCode=null;this.engine.setSetting('whatsapp:owner',m.jid);if(m.alt)this.engine.setSetting('whatsapp:ownerAlt',m.alt);
   this.insert(m.id,'ignored');await this.send(m.jid,'Este teléfono quedó autorizado para darle órdenes a Tropa.');return;
  }
  if(!owner||!this.isOwner(m)||(mode==='own'&&!m.fromMe)||(mode==='dedicated'&&m.fromMe))return;
  if(m.alt&&m.alt!==owner&&!this.engine.getSetting('whatsapp:ownerAlt')&&mode==='dedicated')this.engine.setSetting('whatsapp:ownerAlt',m.jid===owner?m.alt:m.jid);
  if(mode==='own')await this.outbound;
  // Reactions, edits, receipts and other protocol messages are never orders and never get a reply.
  if(m.kind&&!['text','media'].includes(m.kind)){this.insert(m.id,'ignored');return;}
  if(!this.insert(m.id))return;
  if(typeof m.text!=='string'||!m.text.trim()){this.set(m.id,'ignored');if(m.kind==='media')await this.send(owner,'Por ahora solo leo texto.');return;}
  const text=m.text.trim(),normalized=answer(text);
  if(/^\/(estado|cancelar|reanudar|ayuda)$/i.test(text)){this.set(m.id,'ignored');await this.command(owner,text.toLowerCase());return;}
  const decision=normalized.match(/^(SI|NO)(?:\s+(\d{4}))?$/);
  // A bare yes/no is an answer only when Tropa asked something; otherwise it is a normal message for the agent.
  if(decision&&(decision[2]||this.approvals.size||this.openConfirmation())){this.set(m.id,'ignored');await this.decide(owner,decision[1]==='SI',decision[2]);return;}
  if(this.now()-Number(m.timestamp)*1000>OLD_AFTER){await this.queueOld(owner,m.id,text,Number(m.timestamp));return;}
  await this.startRun(owner,m.id,text);
 }
 openConfirmation(){
  if(this.resumeConfirmation&&this.resumeConfirmation.expires>=this.now())return this.resumeConfirmation;
  if(this.oldBatch?.asked&&this.oldBatch.expires>=this.now())return this.oldBatch;
  return null;
 }
 // Messages written while Tropa was off arrive together: ask once for the whole batch.
 async queueOld(owner,id,text,timestamp){
  if(!this.oldBatch||this.oldBatch.expires<this.now())this.oldBatch={items:[],asked:false,expires:this.now()+CONFIRM_FOR};
  const batch=this.oldBatch;batch.items.push({id,text,timestamp});batch.expires=this.now()+CONFIRM_FOR;
  if(batch.asked){await this.send(owner,`También recibí este mensaje antiguo: «${text.slice(0,120)}». Lo sumé al lote; respondé SI para ejecutar los ${batch.items.length} o NO para descartarlos.`);return;}
  if(this.batchDelay<=0)return this.askOld(owner,batch);
  clearTimeout(batch.timer);batch.timer=setTimeout(()=>{this.queue=this.queue.then(()=>this.askOld(owner,batch)).catch(()=>{});},this.batchDelay);batch.timer.unref?.();
 }
 async askOld(owner,batch){
  if(batch!==this.oldBatch||batch.asked)return;
  batch.asked=true;
  const list=batch.items.map((x,i)=>`${i+1}. «${x.text.slice(0,160)}${x.text.length>160?'…':''}»`).join('\n');
  await this.send(owner,batch.items.length===1
   ?`Recibí este mensaje hace más de 15 minutos:\n${list}\n¿Lo ejecuto? Respondé SI o NO.`
   :`Recibí ${batch.items.length} mensajes de cuando Tropa no estaba disponible:\n${list}\n¿Los ejecuto todos juntos? Respondé SI o NO.`);
 }
 async startRun(owner,id,text,mergedIds=[]){
  const team=this.engine.mainTeamId(),reject=async message=>{for(const x of [id,...mergedIds])this.set(x,'rejected');await this.send(owner,message);};
  if(!team)return reject('Creá primero el agente principal en Tropa.');
  let run;
  try{run=this.engine.chat(team,0,text,{channel:'whatsapp',messageId:id});}
  catch(e){return reject({ENGINE_BUSY:'Tropa está ocupada. Intentá más tarde.',CHAT_PENDING:'Esperá a que termine la respuesta anterior.',MESSAGE_INVALID:'El mensaje debe tener entre 1 y 4.000 caracteres.',AGENT_NOT_FOUND:'Creá primero el agente principal en Tropa.'}[e.code]||'No se pudo iniciar el trabajo.');}
  this.set(id,'accepted',run.id);for(const x of mergedIds)this.set(x,'merged',run.id);
  try{await this.transport.react(owner,{id},'⏳');}catch{}
  await this.notify(run.id);
 }
 async notify(id){
  const row=this.runRow(id);if(!row||this.sending.has(id))return;
  const run=this.engine.get(id);if(!terminal.has(run.status))return;
  const owner=this.engine.getSetting('whatsapp:owner');if(!owner)return;
  this.sending.add(id);
  try{
   if(row.state==='accepted'){
    await this.send(owner,run.status==='interrupted'?'Tu pedido quedó interrumpido. /reanudar para retomarlo':finalText(run)||'El trabajo terminó sin respuesta.');
    // Record the answer before files: a later failure retries files only, never the text.
    this.engine.db.prepare("UPDATE channel_messages SET state='text_sent' WHERE channel='whatsapp' AND message_id=? AND state='accepted'").run(row.message_id);
   }
   if(run.status==='completed'){
    const files=listFiles(this.engine.dir,id).filter(f=>f.size<=2000000);
    for(const f of files.slice(0,5)){
     let document;try{document=readArtifact(this.engine.dir,id,f.name);}catch{continue;}
     await this.dispatch(owner,{document,fileName:f.name.split('/').at(-1),mimetype:'application/octet-stream'});
    }
    if(files.length>5)await this.send(owner,'Otros archivos disponibles en Tropa: '+files.slice(5).map(f=>f.name).join(', '));
   }
   this.engine.db.prepare("UPDATE channel_messages SET state='notified',notified_at=? WHERE channel='whatsapp' AND message_id=? AND state IN ('accepted','text_sent')").run(new Date(this.now()).toISOString(),row.message_id);
  }finally{this.sending.delete(id);}
 }
 async recover(){
  const pending=this.engine.db.prepare("SELECT message_id FROM channel_messages WHERE channel='whatsapp' AND state='received' AND run_id IS NULL").all();
  if(pending.length){
   const runs=this.engine.db.prepare('SELECT body FROM runs').all().map(row=>JSON.parse(row.body));
   for(const item of pending){const run=runs.find(r=>r.source?.channel==='whatsapp'&&r.source?.channelMessageId===item.message_id);if(run)this.set(item.message_id,'accepted',run.id);}
  }
  const rows=this.engine.db.prepare("SELECT DISTINCT run_id FROM channel_messages WHERE channel='whatsapp' AND run_id IS NOT NULL AND state IN ('accepted','text_sent')").all();
  for(const row of rows)await this.notify(row.run_id);
 }
 async progress(event){
  if(!this.engine.getSetting('whatsapp:progress'))return;
  if(!this.runRow(event.id,['accepted']))return;
  const run=this.engine.get(event.id),step=run.steps.at(-1);
  if(!step||step.kind!=='delegation'||(this.progressStep.get(event.id)||0)>=run.steps.length)return;
  this.progressStep.set(event.id,run.steps.length);
  const last=this.progressAt.get(event.id)||0;if(this.now()-last<30000)return;
  this.progressAt.set(event.id,this.now());
  const owner=this.engine.getSetting('whatsapp:owner');if(owner)await this.send(owner,`${step.agent} consultó a ${step.target}.`);
 }
 latest(){
  const row=this.engine.db.prepare("SELECT run_id FROM channel_messages WHERE channel='whatsapp' AND run_id IS NOT NULL AND state<>'merged' ORDER BY received_at DESC LIMIT 1").get();
  if(!row)return null;try{return this.engine.get(row.run_id);}catch{return null;}
 }
 async command(owner,cmd){
  const r=this.latest();
  if(cmd==='/ayuda')return this.send(owner,'Comandos: /estado, /cancelar, /reanudar y /ayuda. Máximo 4.000 caracteres.');
  if(cmd==='/estado')return this.send(owner,r?`Estado: ${r.status}. Agente: ${r.currentAgent||'—'}. Tiempo transcurrido: ${Math.max(0,Math.floor((this.now()-Date.parse(r.createdAt))/60000))} min.`:'Todavía no hay trabajos de WhatsApp.');
  if(cmd==='/cancelar'){if(!r||!this.engine.active.has(r.id))return this.send(owner,'No hay un trabajo activo.');this.engine.cancel(r.id);return this.send(owner,'Solicité detener el trabajo.');}
  if(cmd==='/reanudar'){
   if(!r||!['failed','cancelled','interrupted'].includes(r.status))return this.send(owner,'No hay un trabajo pendiente para reanudar.');
   this.resumeConfirmation={runId:r.id,expires:this.now()+CONFIRM_FOR};
   return this.send(owner,'Reanudar puede repetir acciones externas. Respondé SI para continuar o NO para cancelar.');
  }
 }
 async decide(owner,yes,code){
  if(code||this.approvals.size){
   if(!code&&this.approvals.size>1)return this.send(owner,'Hay varias autorizaciones; indicá SI o NO y el código.');
   const key=code||this.approvals.keys().next().value,p=this.approvals.get(key);
   if(!p)return this.send(owner,'Esa autorización ya no está vigente.');
   let result;
   try{result=this.browser.decide(p.runId,p.pendingId,yes);}catch{this.approvals.delete(key);return this.send(owner,'Esa autorización ya no está vigente.');}
   this.approvals.delete(key);
   return this.send(owner,result==='page_changed'?'La página cambió antes de tu respuesta, así que la acción no se realizó. El agente pedirá autorización de nuevo.':yes?'Acción autorizada.':'Acción rechazada.');
  }
  const c=this.openConfirmation();
  if(!c)return this.send(owner,'No hay una confirmación vigente.');
  if(c===this.resumeConfirmation){
   this.resumeConfirmation=null;
   if(!yes)return this.send(owner,'De acuerdo, no lo reanudaré.');
   try{
    this.engine.resume(c.runId);
    const row=this.engine.db.prepare("SELECT message_id FROM channel_messages WHERE channel='whatsapp' AND run_id=? AND state<>'merged' ORDER BY received_at DESC LIMIT 1").get(c.runId);
    if(row)this.set(row.message_id,'accepted');
    await this.send(owner,'Continuando el trabajo.');await this.notify(c.runId);
   }catch{await this.send(owner,'No se pudo reanudar el trabajo.');}
   return;
  }
  const batch=c;this.oldBatch=null;clearTimeout(batch.timer);
  if(!yes){for(const x of batch.items)this.set(x.id,'rejected');return this.send(owner,batch.items.length===1?'De acuerdo, no lo ejecutaré.':'De acuerdo, no ejecutaré esos mensajes.');}
  const [first,...rest]=batch.items;
  const text=batch.items.length===1?first.text:`Mensajes que te envié mientras no estabas disponible, en orden:\n${batch.items.map((x,i)=>`${i+1}. ${x.text}`).join('\n')}`;
  return this.startRun(owner,first.id,text,rest.map(x=>x.id));
 }
 async pending(e){
  if(!this.runRow(e.runId,['accepted']))return;
  let code;do{code=String(randomInt(1000,10000));}while(this.approvals.has(code));
  this.approvals.set(code,{runId:e.runId,pendingId:e.pendingId});
  const owner=this.engine.getSetting('whatsapp:owner');
  if(owner){
   const a=e.action||{},recent=(this.approvalTimes.get(e.runId)||[]).filter(t=>this.now()-t<300000);recent.push(this.now());this.approvalTimes.set(e.runId,recent);
   if(recent.length===11)await this.send(owner,'Esta tarea pide muchas autorizaciones; conviene seguirla desde el desktop.');
   const agent=this.browser.state(e.runId).agent||'';
   await this.send(owner,`Autorización pendiente (código ${code})\nAgente: ${String(agent).slice(0,120)}\nAcción: ${String(a.type||'').slice(0,120)}\nElemento: ${String(a.target||'').slice(0,120)}\nDestino: ${String(a.destination||a.url||e.url||'').slice(0,120)}\nValor: ${String(a.value||'').slice(0,40)}\nRespondé SI ${code} o NO ${code}. Vence en 5 min.`);
  }
 }
 async stop(){
  clearTimeout(this.oldBatch?.timer);
  this.engine.off('run',this.runListener);this.browser?.off('approval:pending',this.pendingListener);this.browser?.off('approval:closed',this.closedListener);
  await this.transport.stop?.();
 }
}

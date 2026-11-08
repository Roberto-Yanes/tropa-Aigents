import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {Engine} from '../engine.mjs';import {WhatsAppChannel,splitText} from '../channels/whatsapp.mjs';
test('owner messages are deduplicated and completed runs return the real result',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'wa-channel-')),e=new Engine(dir,async()=>JSON.stringify({accion:'finalizar',mensaje:'Respuesta real de prueba'}));const sent=[];const transport={send:async(jid,payload)=>{sent.push({jid,...payload});return 'out-'+sent.length;},react:async()=>{},ownJid:()=>'',stop:async()=>{}};const channel=new WhatsAppChannel({sendDelay:0,engine:e,transport});
 try{e.createMain({name:'Atlas',provider:'codex'});e.setSetting('whatsapp:owner','owner@s.whatsapp.net');e.setSetting('whatsapp:mode','dedicated');const m={id:'in-1',jid:'owner@s.whatsapp.net',timestamp:Date.now()/1000,text:'Hola',fromMe:false};await channel.enqueue(m);const row=channel.row(m.id);await e.active.get(row.run_id)?.done;await channel.notify(row.run_id);await channel.enqueue(m);await channel.enqueue({...m,id:'other',jid:'other@s.whatsapp.net'});assert.equal(e.get(row.run_id).source.channel,'whatsapp');assert.equal(e.runs().length,1);assert.equal(sent.filter(x=>x.text==='Respuesta real de prueba').length,1);assert.equal(channel.row('in-1').state,'notified');assert.equal(channel.row('other'),undefined);assert.ok(splitText('x'.repeat(8000)).every(s=>s.length<=3500));}finally{await channel.stop();await e.close();rmSync(dir,{recursive:true,force:true});}
});
test('old messages require confirmation and resume requires explicit consent',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'wa-old-')),e=new Engine(dir,async()=>JSON.stringify({accion:'finalizar',mensaje:'listo'}));const sent=[];const transport={send:async(_j,p)=>{sent.push(p.text);return 'sent-'+sent.length},react:async()=>{},ownJid:()=>'',stop:async()=>{}};const c=new WhatsAppChannel({sendDelay:0,batchDelay:0,engine:e,transport});
 try{e.createMain({name:'Atlas',provider:'codex'});e.setSetting('whatsapp:owner','owner@s.whatsapp.net');e.setSetting('whatsapp:mode','dedicated');const m={jid:'owner@s.whatsapp.net',timestamp:Date.now()/1000-1000,fromMe:false};await c.enqueue({...m,id:'old',text:'Una tarea'});assert.equal(e.runs().length,0);assert.match(sent[0],/Respondé SI o NO/);await c.enqueue({...m,id:'no',timestamp:Date.now()/1000,text:'NO'});assert.equal(e.runs().length,0);assert.equal(c.row('old').state,'rejected');await c.enqueue({...m,id:'old2',text:'Otra tarea'});await c.enqueue({...m,id:'yes',timestamp:Date.now()/1000,text:'sí'});const row=c.row('old2');await e.active.get(row.run_id)?.done;await c.notify(row.run_id);assert.equal(e.runs().length,1);await c.enqueue({...m,id:'resume',timestamp:Date.now()/1000,text:'/reanudar'});assert.match(sent.at(-1),/No hay un trabajo/);}finally{await c.stop();await e.close();rmSync(dir,{recursive:true,force:true});}
});
test('browser approvals reach only WhatsApp runs and decisions are single use',async()=>{
 const {VisualBrowser}=await import('../browser-service.mjs');const dir=mkdtempSync(join(tmpdir(),'wa-approval-')),e=new Engine(dir,async()=>new Promise(()=>{}));const sent=[];const transport={send:async(_j,p)=>{sent.push(p.text);return 'sent-'+sent.length},react:async()=>{},stop:async()=>{}};const browser=new VisualBrowser(()=> 'http://127.0.0.1:4318');const c=new WhatsAppChannel({sendDelay:0,engine:e,browser,transport});
 try{e.setSetting('whatsapp:owner','owner@s.whatsapp.net');e.setSetting('whatsapp:mode','dedicated');e.db.prepare("INSERT INTO channel_messages VALUES('whatsapp','x',?,'run-1','accepted',NULL)").run(new Date().toISOString());const ctrl=new AbortController();const s={page:{url:()=> 'https://example.org'},history:[],agent:'Ana',pending:null};browser.sessions.set('run-1',s);const p=browser.approval(s,{type:'Completar campo',value:'dato privado'},ctrl.signal);await new Promise(r=>setImmediate(r));const code=[...c.approvals.keys()][0];assert.ok(code);await c.enqueue({id:'decision',jid:'owner@s.whatsapp.net',timestamp:Date.now()/1000,text:'SI '+code});await p;assert.equal(c.approvals.size,0);await c.enqueue({id:'repeat',jid:'owner@s.whatsapp.net',timestamp:Date.now()/1000,text:'SI '+code});assert.match(sent.at(-1),/ya no está vigente/);browser.sessions.clear();}finally{await c.stop();await browser.closeAll();await e.close();rmSync(dir,{recursive:true,force:true});}
});
test('own-number mode ignores sent ids, groups and outsiders',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'wa-own-')),e=new Engine(dir,async()=>JSON.stringify({accion:'finalizar',mensaje:'ok'}));const sent=[];const transport={send:async(_j,p)=>{sent.push(p.text);return 'from-bot'},react:async()=>{},ownJid:()=> 'me@s.whatsapp.net',stop:async()=>{}};const c=new WhatsAppChannel({sendDelay:0,engine:e,transport});
 try{e.createMain({name:'Atlas',provider:'codex'});e.setSetting('whatsapp:owner','me@s.whatsapp.net');e.setSetting('whatsapp:mode','own');const base={jid:'me@s.whatsapp.net',timestamp:Date.now()/1000,fromMe:true,text:'hola'};await c.enqueue({...base,id:'start'});const r=c.row('start');await e.active.get(r.run_id)?.done;await c.notify(r.run_id);await c.enqueue({...base,id:'from-bot'});await c.enqueue({...base,id:'outside',jid:'other@s.whatsapp.net'});await c.enqueue({...base,id:'group',isGroup:true});assert.equal(e.runs().length,1);assert.equal(c.row('from-bot').state,'ignored');assert.equal(c.row('outside'),undefined);assert.equal(c.row('group'),undefined);}finally{await c.stop();await e.close();rmSync(dir,{recursive:true,force:true});}
});
test('dedicated owner registration is single-use and rejects expired codes',async()=>{
 let now=1000000;const dir=mkdtempSync(join(tmpdir(),'wa-register-')),e=new Engine(dir),sent=[];const transport={send:async(j,p)=>{sent.push({j,...p});return 'sent'},stop:async()=>{}};const c=new WhatsAppChannel({sendDelay:0,engine:e,transport,now:()=>now});
 try{e.setSetting('whatsapp:mode','dedicated');const old=c.generateOwnerCode();now+=600001;await c.enqueue({id:'old',jid:'a@s.whatsapp.net',text:old.code});assert.equal(e.getSetting('whatsapp:owner'),null);const current=c.generateOwnerCode();await c.enqueue({id:'register',jid:'a@s.whatsapp.net',text:current.code});assert.equal(e.getSetting('whatsapp:owner'),'a@s.whatsapp.net');assert.equal(sent.length,1);assert.throws(()=>c.generateOwnerCode());}finally{await c.stop();await e.close();rmSync(dir,{recursive:true,force:true});}
});
test('failed runs report error and resume requires confirmation',async()=>{
 let fail=true;const dir=mkdtempSync(join(tmpdir(),'wa-resume-')),e=new Engine(dir,async()=>{if(fail)throw Error('Sin cuota');return JSON.stringify({accion:'finalizar',mensaje:'Retomado'});});const sent=[];const t={send:async(_j,p)=>{sent.push(p.text);return 's'+sent.length},react:async()=>{},stop:async()=>{}};const c=new WhatsAppChannel({sendDelay:0,engine:e,transport:t});
 try{e.createMain({name:'Atlas',provider:'codex'});e.setSetting('whatsapp:owner','owner@s.whatsapp.net');e.setSetting('whatsapp:mode','dedicated');const m={jid:'owner@s.whatsapp.net',timestamp:Date.now()/1000};await c.enqueue({...m,id:'one',text:'Trabajá'});const id=c.row('one').run_id;await e.active.get(id)?.done;await c.notify(id);assert.ok(sent.includes('Sin cuota'));fail=false;await c.enqueue({...m,id:'resume',text:'/reanudar'});assert.equal(e.get(id).status,'failed');await c.enqueue({...m,id:'yes',text:'SI'});await e.active.get(id)?.done;await c.notify(id);assert.equal(e.get(id).status,'completed');assert.ok(sent.includes('Retomado'));}finally{await c.stop();await e.close();rmSync(dir,{recursive:true,force:true});}
});
test('busy and oversized messages are rejected without another run',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'wa-reject-')),e=new Engine(dir,async()=>new Promise(()=>{}));const sent=[];const t={send:async(_j,p)=>{sent.push(p.text);return 's'+sent.length},react:async()=>{},stop:async()=>{}};const c=new WhatsAppChannel({sendDelay:0,engine:e,transport:t});
 try{e.createMain({name:'Atlas',provider:'codex'});e.setSetting('whatsapp:owner','o@s.whatsapp.net');e.setSetting('whatsapp:mode','dedicated');const m={jid:'o@s.whatsapp.net',timestamp:Date.now()/1000};await c.enqueue({...m,id:'long',text:'x'.repeat(4001)});assert.equal(c.row('long').state,'rejected');assert.match(sent.at(-1),/4.000/);e.active.set('a',{});e.active.set('b',{});await c.enqueue({...m,id:'busy',text:'hola'});assert.equal(c.row('busy').state,'rejected');assert.match(sent.at(-1),/ocupada/);e.active.clear();assert.equal(e.runs().length,0);}finally{await c.stop();await e.close();rmSync(dir,{recursive:true,force:true});}
});
test('a second message to Atlas waits for the pending chat',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'wa-pending-')),e=new Engine(dir,async(_a,_p,_c,signal)=>new Promise((_resolve,reject)=>{signal.addEventListener('abort',()=>reject(Error('cancelada')),{once:true});}));const sent=[];const t={send:async(_j,p)=>{sent.push(p.text);return 's'+sent.length},react:async()=>{},stop:async()=>{}};const c=new WhatsAppChannel({sendDelay:0,engine:e,transport:t});
 try{e.createMain({name:'Atlas',provider:'codex'});e.setSetting('whatsapp:owner','o@s.whatsapp.net');e.setSetting('whatsapp:mode','dedicated');const m={jid:'o@s.whatsapp.net',timestamp:Date.now()/1000};await c.enqueue({...m,id:'first',text:'hola'});await c.enqueue({...m,id:'second',text:'otra'});assert.equal(c.row('second').state,'rejected');assert.match(sent.at(-1),/Esperá/);assert.equal(e.runs().length,1);e.cancel(c.row('first').run_id);await e.active.get(c.row('first').run_id)?.done;}finally{await c.stop();await e.close();rmSync(dir,{recursive:true,force:true});}
});
test('recovery notifies an interrupted accepted run only once',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'wa-recover-')),e=new Engine(dir);const sent=[];const t={send:async(_j,p)=>{sent.push(p.text);return 's'+sent.length},stop:async()=>{}};const c=new WhatsAppChannel({sendDelay:0,engine:e,transport:t});
 try{e.setSetting('whatsapp:owner','o@s.whatsapp.net');e.save({id:'r',status:'interrupted',steps:[],createdAt:new Date().toISOString(),error:'interrumpido'});e.db.prepare("INSERT INTO channel_messages VALUES('whatsapp','incoming',?,'r','accepted',NULL)").run(new Date().toISOString());await c.recover();await c.recover();assert.equal(sent.length,1);assert.match(sent[0],/\/reanudar/);assert.equal(c.row('incoming').state,'notified');}finally{await c.stop();await e.close();rmSync(dir,{recursive:true,force:true});}
});
test('long output is numbered and UI approvals are not forwarded',async()=>{
 const {EventEmitter}=await import('node:events');const dir=mkdtempSync(join(tmpdir(),'wa-output-')),e=new Engine(dir);const sent=[];const browser=new EventEmitter();browser.state=()=>({agent:'Atlas'});const t={send:async(_j,p)=>{sent.push(p.text);return 's'+sent.length},stop:async()=>{}};const c=new WhatsAppChannel({engine:e,browser,transport:t,sendDelay:0});
 try{e.setSetting('whatsapp:owner','o@s.whatsapp.net');e.save({id:'r',status:'completed',steps:[{output:'x'.repeat(8000)}],createdAt:new Date().toISOString()});e.db.prepare("INSERT INTO channel_messages VALUES('whatsapp','i',?,'r','accepted',NULL)").run(new Date().toISOString());browser.emit('approval:pending',{runId:'ui-run',pendingId:'x',action:{value:'secreto'}});await c.notify('r');await c.notify('r');assert.equal(sent.length,3);assert.match(sent[0],/^\(1\/3\)/);assert.match(sent[2],/^\(3\/3\)/);assert.ok(sent.every(x=>x.length<=3500));assert.equal(c.approvals.size,0);}finally{await c.stop();await e.close();rmSync(dir,{recursive:true,force:true});}
});
test('completed runs send up to five bounded generated files',async()=>{
 const {mkdirSync,writeFileSync}=await import('node:fs');const dir=mkdtempSync(join(tmpdir(),'wa-files-')),e=new Engine(dir);const sent=[];const t={send:async(_j,p)=>{sent.push(p);return 's'+sent.length},stop:async()=>{}};const c=new WhatsAppChannel({engine:e,transport:t,sendDelay:0});
 try{e.setSetting('whatsapp:owner','o@s.whatsapp.net');e.save({id:'r',status:'completed',steps:[{output:'Terminado'}],createdAt:new Date().toISOString()});e.db.prepare("INSERT INTO channel_messages VALUES('whatsapp','i',?,'r','accepted',NULL)").run(new Date().toISOString());const root=join(dir,'runs','r','workspace');mkdirSync(root,{recursive:true});for(let i=0;i<6;i++)writeFileSync(join(root,`${i}.txt`),'archivo');await c.notify('r');assert.equal(sent.filter(x=>x.document).length,5);assert.ok(sent.some(x=>x.text?.includes('Otros archivos')));assert.equal(c.row('i').state,'notified');}finally{await c.stop();await e.close();rmSync(dir,{recursive:true,force:true});}
});
test('approval resolved in the UI invalidates the WhatsApp code',async()=>{
 const {VisualBrowser}=await import('../browser-service.mjs');const dir=mkdtempSync(join(tmpdir(),'wa-ui-')),e=new Engine(dir);const sent=[];const t={send:async(_j,p)=>{sent.push(p.text);return 's'+sent.length},stop:async()=>{}};const b=new VisualBrowser(()=> 'http://127.0.0.1:4318'),c=new WhatsAppChannel({engine:e,browser:b,transport:t,sendDelay:0});
 try{e.setSetting('whatsapp:owner','o@s.whatsapp.net');e.setSetting('whatsapp:mode','dedicated');e.db.prepare("INSERT INTO channel_messages VALUES('whatsapp','i',?,'r','accepted',NULL)").run(new Date().toISOString());const s={page:{url:()=> 'https://example.org'},history:[],agent:'Ana',pending:null};b.sessions.set('r',s);const p=b.approval(s,{type:'Hacer clic'},new AbortController().signal);await new Promise(r=>setImmediate(r));const code=[...c.approvals.keys()][0];b.decide('r',s.pending.id,true);await p;assert.equal(c.approvals.size,0);await c.enqueue({id:'decision',jid:'o@s.whatsapp.net',timestamp:Date.now()/1000,text:'SI '+code});assert.match(sent.at(-1),/ya no está vigente/);b.sessions.clear();}finally{await c.stop();await b.closeAll();await e.close();rmSync(dir,{recursive:true,force:true});}
});
test('a delivery failure preserves an accepted run for recovery',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'wa-network-')),e=new Engine(dir),sent=[];let online=false;const t={send:async(_j,p)=>{if(!online)throw Error('offline');sent.push(p.text);return 'sent'},stop:async()=>{}};const c=new WhatsAppChannel({engine:e,transport:t,sendDelay:0});
 try{e.setSetting('whatsapp:owner','o@s.whatsapp.net');e.save({id:'r',status:'completed',steps:[{output:'resultado'}],createdAt:new Date().toISOString()});e.db.prepare("INSERT INTO channel_messages VALUES('whatsapp','i',?,'r','accepted',NULL)").run(new Date().toISOString());await assert.rejects(c.notify('r'),/offline/);assert.equal(c.row('i').state,'accepted');online=true;await c.recover();assert.deepEqual(sent,['resultado']);assert.equal(c.row('i').state,'notified');}finally{await c.stop();await e.close();rmSync(dir,{recursive:true,force:true});}
});
test('own-number echo arriving during send cannot cause a loop',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'wa-echo-')),e=new Engine(dir);let c;const t={send:async(_j,p)=>{c.enqueue({id:'echo',jid:'me@s.whatsapp.net',fromMe:true,text:p.text,timestamp:Date.now()/1000});await new Promise(r=>setTimeout(r,5));return 'echo';},ownJid:()=> 'me@s.whatsapp.net',stop:async()=>{}};c=new WhatsAppChannel({engine:e,transport:t,sendDelay:0});
 try{e.setSetting('whatsapp:owner','me@s.whatsapp.net');e.setSetting('whatsapp:mode','own');await c.send('me@s.whatsapp.net','respuesta');await c.queue;assert.equal(c.row('echo').state,'ignored');assert.equal(e.runs().length,0);}finally{await c.stop();await e.close();rmSync(dir,{recursive:true,force:true});}
});
test('recovery reconnects a run saved before its message association',async()=>{const dir=mkdtempSync(join(tmpdir(),'wa-assoc-')),e=new Engine(dir),sent=[];const c=new WhatsAppChannel({engine:e,transport:{send:async(_j,p)=>{sent.push(p.text);return 'out'},stop:async()=>{}},sendDelay:0});try{e.setSetting('whatsapp:owner','o@s.whatsapp.net');e.save({id:'r',status:'interrupted',source:{channel:'whatsapp',channelMessageId:'in'},steps:[],createdAt:new Date().toISOString()});e.db.prepare("INSERT INTO channel_messages(channel,message_id,received_at,state) VALUES('whatsapp','in',?,'received')").run(new Date().toISOString());await c.recover();assert.equal(c.row('in').run_id,'r');assert.equal(c.row('in').state,'notified');assert.match(sent[0],/interrumpido/);}finally{await c.stop();await e.close();rmSync(dir,{recursive:true,force:true});}});

function waSetup(t,opts={},invoke=async()=>JSON.stringify({accion:'finalizar',mensaje:'listo'})){
 const dir=mkdtempSync(join(tmpdir(),'wa-fix-')),e=new Engine(dir,invoke),sent=[];
 const transport={send:async(_j,p)=>{sent.push(p.text??`[archivo ${p.fileName}]`);return 'out-'+sent.length;},react:async()=>{},ownJid:()=>'me@s.whatsapp.net',ownJids:()=>['me@s.whatsapp.net','123@lid'],stop:async()=>{}};
 const c=new WhatsAppChannel({sendDelay:0,batchDelay:0,engine:e,transport,...opts});
 e.createMain({name:'Atlas',provider:'codex'});e.setSetting('whatsapp:owner','owner@s.whatsapp.net');e.setSetting('whatsapp:mode','dedicated');
 t.after(async()=>{await c.stop();await e.close();rmSync(dir,{recursive:true,force:true});});
 return {e,c,sent};
}
const msg=(id,text,extra={})=>({id,jid:'owner@s.whatsapp.net',timestamp:Date.now()/1000,text,fromMe:false,kind:'text',...extra});

test('a plain yes or no goes to the agent when nothing is pending',async t=>{
 const prompts=[];const {e,c,sent}=waSetup(t,{},async(_a,p)=>{prompts.push(p);return JSON.stringify({accion:'finalizar',mensaje:'Perfecto, lo envío'});});
 await c.enqueue(msg('m1','Sí'));const row=c.row('m1');assert.equal(row.state,'accepted');await e.active.get(row.run_id)?.done;await c.notify(row.run_id);
 assert.match(prompts[0],/Sí/);assert.ok(sent.includes('Perfecto, lo envío'));assert.ok(!sent.some(x=>/confirmación vigente/.test(x)));
});

test('messages written while Tropa was off are confirmed and run together',async t=>{
 const prompts=[];const {e,c,sent}=waSetup(t,{},async(_a,p)=>{prompts.push(p);return JSON.stringify({accion:'finalizar',mensaje:'hecho'});});
 const old=Date.now()/1000-3600;
 await c.enqueue(msg('o1','Primera tarea',{timestamp:old}));
 await c.enqueue(msg('o2','Segunda tarea',{timestamp:old+5}));
 await c.enqueue(msg('o3','Tercera tarea',{timestamp:old+9}));
 assert.equal(e.runs().length,0);assert.match(sent[0],/Primera tarea/);assert.match(sent.at(-1),/ejecutar los 3/);
 await c.enqueue(msg('yes','si'));
 const row=c.row('o1');await e.active.get(row.run_id)?.done;
 assert.equal(e.runs().length,1);assert.match(prompts[0],/1\. Primera tarea\\n2\. Segunda tarea\\n3\. Tercera tarea/);
 assert.equal(c.row('o2').state,'merged');assert.equal(c.row('o3').run_id,row.run_id);
 await c.notify(row.run_id);assert.equal(sent.filter(x=>x==='hecho').length,1);
});

test('a short burst of old messages produces a single question',async t=>{
 const {e,c,sent}=waSetup(t,{batchDelay:30});const old=Date.now()/1000-3600;
 await c.enqueue(msg('a','Uno',{timestamp:old}));await c.enqueue(msg('b','Dos',{timestamp:old}));
 await new Promise(r=>setTimeout(r,60));await c.queue;
 assert.equal(sent.length,1);assert.match(sent[0],/2 mensajes/);assert.equal(e.runs().length,0);
});

test('reactions and protocol messages never get a reply; media gets one notice',async t=>{
 const {e,c,sent}=waSetup(t);
 await c.enqueue(msg('r1',undefined,{kind:'reaction'}));await c.enqueue(msg('p1',undefined,{kind:'protocol'}));
 assert.equal(sent.length,0);assert.equal(e.runs().length,0);
 await c.enqueue(msg('i1',undefined,{kind:'media'}));assert.equal(sent.length,1);assert.match(sent[0],/solo leo texto/);
});

test('own number mode ignores the echo of its own reaction',async t=>{
 const {c,sent,e}=waSetup(t);e.setSetting('whatsapp:mode','own');e.setSetting('whatsapp:owner','me@s.whatsapp.net');
 await c.enqueue({id:'echo',jid:'me@s.whatsapp.net',fromMe:true,timestamp:Date.now()/1000,kind:'reaction'});
 await c.enqueue({id:'lidself',jid:'123@lid',fromMe:true,timestamp:Date.now()/1000,text:'Hola desde mi chat',kind:'text'});
 assert.equal(c.row('echo').state,'ignored');assert.ok(!sent.some(x=>/solo leo texto/.test(x)));assert.notEqual(c.row('lidself').run_id,null,'the self chat may arrive with the LID form');
});

test('the owner is recognised by the alternate JID form',async t=>{
 const {c}=waSetup(t);
 await c.enqueue(msg('lid1','Hola',{jid:'999@lid',alt:'owner@s.whatsapp.net'}));
 assert.equal(c.row('lid1').state,'accepted');
});

test('wrong owner codes burn the registration window',async t=>{
 const {c,e}=waSetup(t);e.setSetting('whatsapp:owner',null);
 const {code}=c.generateOwnerCode();const wrong=code==='111111'?'222222':'111111';
 for(let i=0;i<5;i++)await c.enqueue({id:'w'+i,jid:'stranger@s.whatsapp.net',fromMe:false,timestamp:Date.now()/1000,text:wrong,kind:'text'});
 await c.enqueue({id:'late',jid:'stranger@s.whatsapp.net',fromMe:false,timestamp:Date.now()/1000,text:code,kind:'text'});
 assert.equal(e.getSetting('whatsapp:owner'),null);
});

test('an approval whose page changed is reported as not done',async t=>{
 const browser={on(){},off(){},state:()=>({agent:'Ana'}),decide:()=>'page_changed'};
 const {c,sent}=waSetup(t,{browser});c.approvals.set('4821',{runId:'r',pendingId:'p'});
 await c.enqueue(msg('d','SI 4821'));assert.match(sent.at(-1),/la acción no se realizó/);
});

test('a failed file after the answer never resends the answer',async t=>{
 const {writeFileSync}=await import('node:fs');
 const {e,c,sent}=waSetup(t,{},async(_a,_p,cwd)=>{writeFileSync(join(cwd,'informe.md'),'x');return JSON.stringify({accion:'finalizar',mensaje:'listo'});});let fail=true;
 const send=c.transport.send;c.transport.send=async(j,p)=>{if(p.document&&fail){fail=false;throw Error('caída');}return send(j,p);};
 await c.enqueue(msg('f1','Hacelo'));const row=c.row('f1');await e.active.get(row.run_id)?.done;
 await c.notify(row.run_id).catch(()=>{});await c.outbound;assert.equal(c.row('f1').state,'text_sent');
 await new Promise(r=>setTimeout(r,20));await c.recover();assert.equal(sent.filter(x=>x==='listo').length,1);assert.ok(sent.includes('[archivo informe.md]'));assert.equal(c.row('f1').state,'notified');
});

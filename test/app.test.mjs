import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine, validateTeam } from '../engine.mjs';
import { nativeEnv, processCall } from '../providers.mjs';
import { createApp } from '../server.mjs';
import http from 'node:http';
const agents=[{name:'Analista',instructions:'Analizá',provider:'demo'},{name:'Revisor',instructions:'Revisá',provider:'demo'}];
async function temporary(t){const dir=await mkdtemp(join(tmpdir(),'agents-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
async function done(engine,id){await engine.active.get(id)?.done;return engine.get(id);}
test('handoff uses actual previous result; runs preserve team snapshots',async t=>{
 const prompts=[]; const e=new Engine(await temporary(t),async(a,p)=>{prompts.push(p);return `Resultado de ${a.name}`;});t.after(()=>e.close());
 const team=e.addTeam({name:'Equipo',agents});const run=await done(e,e.start(team.id,'Comparar propuestas').id);
 assert.equal(run.status,'completed');assert.equal(run.steps.length,2);assert.match(prompts[1],/Resultado de Analista/);assert.equal(run.team.name,'Equipo');
});
test('resume does not rerun completed stage',async t=>{
 let fail=true,calls=[];const e=new Engine(await temporary(t),async a=>{calls.push(a.name);if(a.name==='Revisor'&&fail)throw new Error('Sin cuota');return 'OK';});t.after(()=>e.close());
 const team=e.addTeam({name:'Equipo',agents});const id=e.start(team.id,'Tarea').id;assert.equal((await done(e,id)).status,'failed');fail=false;e.resume(id);assert.equal((await done(e,id)).status,'completed');assert.deepEqual(calls,['Analista','Revisor','Revisor']);
});
test('crash recovery marks uncertain runs interrupted without replay',async t=>{
 const dir=await temporary(t);const e=new Engine(dir);const r={id:'test',status:'running',steps:[],team:{name:'E',agents},objective:'X'};e.save(r);await e.close();const reopened=new Engine(dir);t.after(()=>reopened.close());assert.equal(reopened.get('test').status,'interrupted');assert.equal(reopened.active.size,0);
});
test('cancellation cannot save a late provider response',async t=>{
 let release;const e=new Engine(await temporary(t),()=>new Promise(r=>release=r));t.after(()=>e.close());const team=e.addTeam({name:'E',agents});const id=e.start(team.id,'X').id;e.cancel(id);release('late');const run=await done(e,id);assert.equal(run.status,'cancelled');assert.equal(run.steps.length,0);
});
test('validation blocks oversized team and invalid provider',()=>{
 assert.throws(()=>validateTeam({name:'E',agents:Array(9).fill(agents[0])}));assert.throws(()=>validateTeam({name:'E',agents:[{...agents[0],provider:'bash'}]}));
});
test('subprocess is cancellable and does not forward API credentials',async()=>{
 assert.deepEqual(nativeEnv({PATH:'/bin',ANTHROPIC_API_KEY:'secret',OPENAI_API_KEY:'secret',CLAUDECODE:'1'}),{PATH:'/bin'});
 await assert.rejects(processCall(process.execPath,['-e','setTimeout(()=>{},10000)'],{timeout:30}),/tiempo máximo/);
});
test('local API requires own cookie and rejects foreign origin/host',async t=>{
 const app=createApp({dir:await temporary(t),inspect:async()=>[]});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>app.server.close(r));await app.engine.close();});
 const base=`http://127.0.0.1:${app.server.address().port}`;
 assert.equal((await fetch(base+'/api/state')).status,401);
 const home=await fetch(base);assert.equal(home.status,200);const cookie=home.headers.get('set-cookie').split(';')[0];
 assert.equal((await fetch(base+'/api/state',{headers:{cookie}})).status,200);
 assert.equal((await fetch(base+'/api/state',{headers:{cookie,origin:'https://evil.example'}})).status,403);
 const badHost = await new Promise((resolve,reject)=>{const req=http.get(base+'/api/state',{headers:{cookie,host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);});
 assert.equal(badHost,403);
 const r=await fetch(base+'/api/teams',{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify({name:'Test',agents})});assert.equal(r.status,201);
});

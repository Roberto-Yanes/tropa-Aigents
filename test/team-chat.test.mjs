import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Engine} from '../engine.mjs';
test('coordinator delegates, receives a reply, consults another agent, and finishes',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'team-chat-'));let calls=[];
 const engine=new Engine(dir,async(a,p)=>{calls.push([a.name,p]);if(a.name==='A'){const n=calls.filter(x=>x[0]==='A').length;return JSON.stringify(n===1?{accion:'delegar',destinatario:1,mensaje:'Revisá el cálculo'}:{accion:'finalizar',mensaje:'Resultado verificado: 4'});}return JSON.stringify({accion:'finalizar',mensaje:'Confirmado: 4'});});
 try{engine.createMain({name:'Main',provider:'codex'});const t=engine.addTeam({name:'Equipo',agents:[{name:'A',provider:'codex',instructions:'Calculá'},{name:'B',provider:'claude',instructions:'Revisá'}]});const r=engine.teamChat(t.id,'Resolvé');await engine.active.get(r.id).done;const result=engine.get(r.id);assert.equal(result.status,'completed');assert.deepEqual(result.steps.map(s=>s.kind),['delegation','reply','final']);assert.match(calls[2][1],/Confirmado: 4/);assert.ok(calls.every(x=>x[0]!=='Main'));assert.equal(engine.teamChatRuns(t.id).length,1);}finally{await engine.close();rmSync(dir,{recursive:true,force:true});}
});

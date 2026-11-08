import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Engine} from '../engine.mjs';

test('direct chat persists turns and gives the next invocation the previous answer',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'agent-chat-'));const prompts=[];
 const engine=new Engine(dir,async (_agent,prompt)=>{prompts.push(prompt);return JSON.stringify({accion:'finalizar',mensaje:`respuesta ${prompts.length}`});});
 try{
  const team=engine.addTeam({name:'Equipo',agents:[{name:'Ana',provider:'codex',instructions:'Ayudá'}]});
  const first=engine.chat(team.id,0,'Hola');await engine.active.get(first.id).done;
  const second=engine.chat(team.id,0,'Continuá');await engine.active.get(second.id).done;
  assert.match(prompts[1],/Hola/);assert.match(prompts[1],/respuesta 1/);
  assert.deepEqual(engine.chatRuns(team.id,0).map(r=>r.source.message),['Hola','Continuá']);
  assert.throws(()=>engine.chat(team.id,2,'Hola'),/Agente no encontrado/);
 }finally{await engine.close();rmSync(dir,{recursive:true,force:true});}
});

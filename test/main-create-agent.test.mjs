import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine, partialFinalText } from '../engine.mjs';

test('Atlas crea un agente solicitado y registra el resultado real', async () => {
 const dir=mkdtempSync(join(tmpdir(),'tropa-create-'));
 const engine=new Engine(dir,async()=>JSON.stringify({accion:'crear_agente',mensaje:'Listo',equipo:'Investigación',agente:{name:'Lupa',instructions:'Investigar',provider:'codex'}}));
 try {
  const main=engine.createMain({name:'Atlas',provider:'codex'});
  const r=engine.chat(main.id,0,'Crea un agente investigador llamado Lupa');
  await engine.active.get(r.id).done;
  assert.equal(engine.get(r.id).status,'completed');
  assert.equal(engine.teams().find(t=>t.name==='Investigación')?.agents[0].name,'Lupa');
  assert.match(engine.get(r.id).steps.at(-1).output,/Creé a Lupa/);
 } finally { await engine.close(); rmSync(dir,{recursive:true,force:true}); }
});
test('el texto parcial solo se muestra para una respuesta final', async () => {
 assert.equal(partialFinalText('{"accion":"delegar","mensaje":"privado'), '');
 assert.equal(partialFinalText('{"accion":"crear_agente","mensaje":"prematuro'), '');
 assert.equal(partialFinalText('{"accion":"finalizar","mensaje":"Hola\\nmun'), 'Hola\nmun');
});
test('la respuesta parcial llega al historial mientras el proveedor sigue trabajando', async () => {
 const dir=mkdtempSync(join(tmpdir(),'tropa-stream-'));let release,started;
 const ready=new Promise(resolve=>{started=resolve});
 const engine=new Engine(dir,async(_a,_p,_c,_s,ctx)=>{ctx.onDelta('{"accion":"finalizar","mensaje":"Hola');started();await new Promise(resolve=>{release=resolve});return '{"accion":"finalizar","mensaje":"Hola mundo"}';});
 try{
  const main=engine.createMain({name:'Atlas',provider:'claude'});const r=engine.chat(main.id,0,'Hola');
  await ready;assert.equal(engine.get(r.id).partial.output,'Hola');
  release();await engine.active.get(r.id).done;
  assert.equal(engine.get(r.id).partial,undefined);assert.equal(engine.get(r.id).steps.at(-1).output,'Hola mundo');
 }finally{await engine.close();rmSync(dir,{recursive:true,force:true});}
});
test('no se crea un agente cuando no fue solicitado explícitamente', async () => {
 const dir=mkdtempSync(join(tmpdir(),'tropa-create-'));
 const engine=new Engine(dir,async()=>JSON.stringify({accion:'crear_agente',mensaje:'Listo',agente:{name:'Lupa',instructions:'Investigar',provider:'codex'}}));
 try {
  const main=engine.createMain({name:'Atlas',provider:'codex'});
  const r=engine.chat(main.id,0,'Hola');
  await engine.active.get(r.id).done;
  assert.equal(engine.get(r.id).status,'failed');
  assert.equal(engine.teams().length,1);
 } finally { await engine.close(); rmSync(dir,{recursive:true,force:true}); }
});

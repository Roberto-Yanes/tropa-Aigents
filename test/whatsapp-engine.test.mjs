import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {Engine,finalText} from '../engine.mjs';

test('migration keeps existing data and listener failures cannot break a chat',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'tropa-whatsapp-'));const db=new DatabaseSync(join(dir,'state.sqlite'));
 db.exec("CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL); INSERT INTO settings VALUES('example','preserved');");db.close();
 const e=new Engine(dir,async()=>JSON.stringify({accion:'finalizar',mensaje:'resultado'}));
 try{
  assert.ok(existsSync(join(dir,'state.sqlite.pre-whatsapp-v1')));
  assert.equal(e.db.prepare('PRAGMA user_version').get().user_version,1);
  assert.equal(e.db.prepare("SELECT value FROM settings WHERE key='example'").get().value,'preserved');
  e.setSetting('whatsapp:progress',true);assert.equal(e.getSetting('whatsapp:progress'),true);
  const t=e.addTeam({name:'Equipo',agents:[{name:'Agente',provider:'codex',instructions:'Ayudar'}]});
  let observed=false;e.on('run',()=>{throw Error('listener')});e.on('run',()=>{observed=true;});
  const run=e.chat(t.id,0,'Hola',{channel:'whatsapp'});await e.active.get(run.id).done;
  const done=e.get(run.id);assert.equal(done.source.channel,'whatsapp');assert.equal(done.status,'completed');assert.equal(finalText(done),'resultado');assert.ok(observed);
  assert.throws(()=>e.chat(t.id,0,' '.repeat(3)),{code:'MESSAGE_INVALID'});
  assert.throws(()=>e.chat(null,0,'Hola'),{code:'AGENT_NOT_FOUND'});
 }finally{await e.close();rmSync(dir,{recursive:true,force:true});}
});

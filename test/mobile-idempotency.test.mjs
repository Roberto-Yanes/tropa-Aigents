import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {MobileStore} from '../mobile/store.mjs';

test('solicitudes simultáneas con el mismo identificador ejecutan una sola acción',async()=>{
 const db=new DatabaseSync(':memory:'),store=new MobileStore(db);let executions=0,release;
 const gate=new Promise(resolve=>release=resolve);
 const fn=async()=>{executions++;await gate;return {id:'run-1'};};
 const first=store.idempotent('phone','request-123','flows.run',{id:'f'},fn);
 const second=store.idempotent('phone','request-123','flows.run',{id:'f'},fn);
 await assert.rejects(store.idempotent('phone','request-123','flows.run',{id:'different'},fn),{code:'CONFLICT'});
 release();assert.deepEqual(await Promise.all([first,second]),[{id:'run-1'},{id:'run-1'}]);assert.equal(executions,1);
 assert.deepEqual(await store.idempotent('phone','request-123','flows.run',{id:'f'},fn),{id:'run-1'});assert.equal(executions,1);db.close();
});
test('tras un cierre inesperado no vuelve a ejecutar una solicitud de resultado incierto',async()=>{
 const db=new DatabaseSync(':memory:'),store=new MobileStore(db);let release,executions=0;
 const running=store.idempotent('phone','request-456','flows.run',{},async()=>{executions++;await new Promise(resolve=>release=resolve);return 'ok';});
 await Promise.resolve();const restarted=new MobileStore(db);
 await assert.rejects(restarted.idempotent('phone','request-456','flows.run',{},()=>{executions++;}),{code:'UNKNOWN_OUTCOME'});
 assert.equal(executions,1);release();await running;db.close();
});
test('las respuestas anteriores siguen disponibles y los errores no repiten la acción',async()=>{
 const db=new DatabaseSync(':memory:'),store=new MobileStore(db);let executions=0;
 const fail=()=>{executions++;throw Object.assign(Error('No disponible'),{code:'FAILED'});};
 await assert.rejects(store.idempotent('phone','request-789','flows.run',{},fail),/No disponible/);
 await assert.rejects(store.idempotent('phone','request-789','flows.run',{},fail),/No disponible/);
 assert.equal(executions,1);db.close();
});

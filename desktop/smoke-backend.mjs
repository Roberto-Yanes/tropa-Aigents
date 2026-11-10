import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {once} from 'node:events';
import assert from 'node:assert/strict';
const resources=resolve(process.argv[2]);const dir=mkdtempSync(join(tmpdir(),'agentes-native-smoke-'));
assert.ok(existsSync(join(resources,'backend','node_modules','playwright','package.json')),'Faltan dependencias empaquetadas');
const child=spawn(join(resources,'runtime','bin','node'),[join(resources,'backend','desktop-entry.mjs')],{env:{...process.env,COMMUNITY_DATA_DIR:dir,COMMUNITY_PORT:'0'},stdio:['ignore','pipe','pipe','ipc']});
let stderr='';child.stderr.on('data',b=>stderr+=b);
const timeout=setTimeout(()=>child.kill(),20000);
try{
 const ready=await Promise.race([once(child,'message').then(([m])=>m),once(child,'exit').then(()=>{throw Error(stderr||'Motor terminó antes de iniciar');})]);
 assert.equal(ready.type,'ready');const page=await fetch(ready.url);assert.equal(page.status,200);assert.match(await page.text(),/Navegador interno/);
 const cookie=page.headers.get('set-cookie').split(';')[0];
 const state=await fetch(ready.url+'/api/state',{headers:{cookie}}).then(r=>r.json());assert.deepEqual(state.teams,[]);assert.deepEqual(state.runs,[]);
 const mobile=await fetch(ready.url+'/api/mobile/status',{headers:{cookie}});
 assert.equal(mobile.status,200);const mobileStatus=await mobile.json();
 assert.equal(mobileStatus.relayUrl,'wss://tropa.galateasoftware.com.ar/relay');
 assert.ok(Array.isArray(mobileStatus.devices));
 const refused=await fetch(ready.url+'/api/state');assert.equal(refused.status,401);
 child.send({type:'shutdown'});const [code]=await once(child,'exit');assert.equal(code,0);
 console.log('Motor empaquetado: inicio IPC, interfaz, almacenamiento limpio, autenticación local y cierre correctos.');
}finally{clearTimeout(timeout);if(child.exitCode===null)child.kill();rmSync(dir,{recursive:true,force:true});}

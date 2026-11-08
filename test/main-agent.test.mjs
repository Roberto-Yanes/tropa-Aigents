import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Engine} from '../engine.mjs';
test('main coordinator is persistent and cannot be duplicated during setup',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'main-agent-'));let e=new Engine(dir);
 try{assert.equal(e.mainTeamId(),null);assert.throws(()=>e.createMain({name:'C',provider:'demo'}),/real/);const t=e.createMain({name:'Atlas',provider:'codex'});assert.equal(e.createMain({name:'Otro',provider:'claude'}).id,t.id);await e.close();e=new Engine(dir);assert.equal(e.mainTeamId(),t.id);assert.equal(e.teams()[0].agents[0].name,'Atlas');}finally{await e.close();rmSync(dir,{recursive:true,force:true});}
});

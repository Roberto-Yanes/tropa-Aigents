import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {addInputs,workspace,listFiles,readArtifact} from '../files.mjs';
import {Engine} from '../engine.mjs';
test('inputs and artifact reads reject traversal, symlinks and oversized inputs',()=>{
 const dir=mkdtempSync(join(tmpdir(),'files-'));
 try{assert.throws(()=>addInputs(dir,'a',[{name:'../secret.txt',content:'x'}]));assert.throws(()=>addInputs(dir,'a',[{name:'big.txt',content:'x'.repeat(50001)}]));
 addInputs(dir,'a',[{name:'input.csv',content:'item,value\na,1'}]);assert.equal(readArtifact(dir,'a','input.csv').toString(),'item,value\na,1');
 symlinkSync('/etc/passwd',join(workspace(dir,'a'),'escape.txt'));assert.throws(()=>readArtifact(dir,'a','escape.txt'));assert.throws(()=>readArtifact(dir,'a','../input.csv'));assert.equal(listFiles(dir,'a').length,1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('team agents share the workspace and preserve tool choices',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'shared-'));let seen, run;
 const e=new Engine(dir,async(a,p,cwd)=>{if(!seen){seen=cwd;writeFileSync(join(cwd,'handoff.md'),'evidence');}else{assert.equal(cwd,seen);assert.equal(readArtifact(dir,run.id,'handoff.md').toString(),'evidence');}return 'done';});
 try{const t=e.addTeam({name:'Test',agents:[{name:'First',instructions:'write',provider:'codex',tools:true},{name:'Second',instructions:'read',provider:'claude',tools:true}]});run=e.start(t.id,'test');await e.active.get(run.id).done;assert.equal(e.get(run.id).status,'completed');assert.equal(e.get(run.id).team.agents[0].tools,true);}finally{await e.close();rmSync(dir,{recursive:true,force:true});}
});

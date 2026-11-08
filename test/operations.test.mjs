import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../engine.mjs';
import { Operations } from '../operations.mjs';
test('workflow snapshots steps and scheduler claims once across reopening',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'agents-ops-'));let engine=new Engine(dir,async()=> 'Resultado');
 try{
  let ops=new Operations(engine);
  const a=engine.addTeam({name:'Equipo',agents:[{name:'Analista',provider:'demo',instructions:'Analizar'}]});
  const flow=ops.save('workflows',{name:'Flujo',objective:'Revisar',teamIds:[a.id,a.id]});
  const run=ops.run('workflows',flow.id);assert.equal(run.team.agents.length,2);assert.equal(run.source.id,flow.id);
  await engine.active.get(run.id).done;assert.equal(engine.get(run.id).steps.length,2);
  assert.throws(()=>ops.save('workflows',{name:'Mal',objective:'Revisar',teamIds:['missing']}));
  const routine=ops.save('routines',{name:'Rutina',objective:'Resumen',teamId:a.id});
  const schedule=ops.save('schedules',{name:'Una vez',routineId:routine.id,nextAt:new Date(Date.now()+60000).toISOString()});
  ops.tick(Date.now()+61000);ops.tick(Date.now()+62000);
  assert.equal(engine.runs().length,2);assert.equal(ops.get('schedules',schedule.id).enabled,false);
  await engine.close();engine=new Engine(dir,async()=> 'Resultado');ops=new Operations(engine);ops.tick(Date.now()+63000);assert.equal(engine.runs().length,2);
 }finally{await engine.close();rmSync(dir,{recursive:true,force:true});}
});

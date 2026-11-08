import { randomUUID } from 'node:crypto';
import { cleanFlowNodes, legacyNodes } from './flows.mjs';
const text = (v, max=12000) => { if(typeof v!=='string'||!v.trim()||v.length>max) throw Error('Completá los campos requeridos.'); return v.trim(); };
const kinds = ['routines','workflows','schedules'];
export class Operations {
  constructor(engine) { this.engine=engine; this.db=engine.db; this.db.exec('CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY, kind TEXT, body TEXT)'); }
  // Flows saved before steps had types are shown and run as one agent step per agent, as they behaved before.
  normalize(kind, item) {
    if(kind==='workflows'&&!Array.isArray(item.nodes)) return {...item,nodes:legacyNodes(item.teamIds,this.engine.teams()),legacy:true};
    if(kind==='schedules'&&!item.targetKind) return {...item,targetKind:'routines',targetId:item.routineId};
    return item;
  }
  list(kind) { return this.db.prepare('SELECT body FROM operations WHERE kind=? ORDER BY rowid DESC').all(kind).map(x=>this.normalize(kind,JSON.parse(x.body))); }
  put(kind, item) { this.db.prepare('INSERT OR REPLACE INTO operations VALUES(?,?,?)').run(item.id,kind,JSON.stringify(item)); return item; }
  get(kind,id) { const item=this.list(kind).find(x=>x.id===id); if(!item)throw Error('Elemento no encontrado.'); return item; }
  save(kind,b) {
    if(!kinds.includes(kind))throw Error('Tipo inválido.');
    const old=b.id?this.get(kind,b.id):null;
    const item={id:old?.id||randomUUID(),name:text(b.name,80)};
    if(kind==='schedules') {
      const targetKind=b.targetKind==='workflows'?'workflows':'routines', targetId=b.targetId||b.routineId;
      this.get(targetKind,targetId); Object.assign(item,{targetKind,targetId});
      if(targetKind==='routines')item.routineId=targetId;
      const date=new Date(b.nextAt); if(!Number.isFinite(date.getTime())||date.getTime()<=Date.now())throw Error('Elegí una fecha futura.');
      const interval=Number(b.intervalMinutes||0); if(!Number.isInteger(interval)||interval<0||interval>525600||(interval>0&&interval<5))throw Error('Intervalo mínimo: 5 minutos.');
      Object.assign(item,{nextAt:date.toISOString(),intervalMinutes:interval,enabled:true,lastRunId:old?.lastRunId||null});
    } else if(kind==='workflows') {
      item.objective=text(b.objective);
      const nodes=Array.isArray(b.nodes)?b.nodes:legacyNodes(b.teamIds,this.engine.teams());
      item.nodes=cleanFlowNodes(nodes,this.engine.teams());
    } else {
      item.objective=text(b.objective);
      const t=this.engine.teams().find(t=>t.id===b.teamId); if(!t)throw Error('Equipo no encontrado.');
      item.teamIds=[t.id];
    }
    return this.put(kind,item);
  }
  run(kind,id) {
    const item=this.get(kind,id);
    if(kind==='workflows') return this.engine.startFlow(item,{kind,id});
    if(kind!=='routines')throw Error('Elemento no ejecutable.');
    // A routine is the team itself: keep its id so its Google and navegador permissions apply.
    const team=this.engine.teams().find(t=>t.id===item.teamIds?.[0]); if(!team)throw Error('Equipo no encontrado.');
    return this.engine.startSnapshot(team,item.objective,{kind,id});
  }
  remove(kind,id) {
    if(!kinds.includes(kind))throw Error('Tipo inválido.');
    this.get(kind,id);
    if(kind!=='schedules'&&this.list('schedules').some(s=>s.targetKind===kind&&s.targetId===id))throw Error('Tiene programaciones. Borralas primero.');
    this.db.prepare('DELETE FROM operations WHERE kind=? AND id=?').run(kind,id);
    return {ok:true};
  }
  duplicate(kind,id) {
    if(!['routines','workflows'].includes(kind))throw Error('Solo se pueden duplicar rutinas y flujos.');
    const item=this.get(kind,id), copy=structuredClone(item); delete copy.legacy;
    copy.id=randomUUID(); copy.name=(item.name.slice(0,72)+' (copia)');
    return this.put(kind,copy);
  }
  // Keeps flow steps pointing at the same agent after a team edit; removed agents become an explicit error.
  remapAgents(teamId,map) {
    for(const item of this.db.prepare("SELECT body FROM operations WHERE kind='workflows'").all().map(x=>JSON.parse(x.body))) {
      if(!Array.isArray(item.nodes))continue;
      let changed=false;
      for(const n of item.nodes)if(n.teamId===teamId&&Number.isInteger(n.index)){const next=n.index in map?map[n.index]:-1;if(next!==n.index){n.index=next;changed=true;}}
      if(changed)this.put('workflows',item);
    }
  }
  teamUsers(teamId) {
    return [...this.list('routines').filter(r=>r.teamIds?.includes(teamId)).map(r=>`rutina «${r.name}»`),
      ...this.list('workflows').filter(w=>w.nodes.some(n=>n.teamId===teamId)).map(w=>`flujo «${w.name}»`)];
  }
  toggle(id) { const s=this.get('schedules',id);s.enabled=!s.enabled;if(s.enabled)s.error='';return this.put('schedules',s); }
  tick(now=Date.now()) {
    for(const s of this.list('schedules')) {
      if(!s.enabled||Date.parse(s.nextAt)>now)continue;
      if(s.lastRunId&&this.engine.active.has(s.lastRunId))continue;
      if(this.engine.active.size>=2)continue;
      if(s.lastRunId){let last;try{last=this.engine.get(s.lastRunId);}catch{}
        if(last?.status==='waiting'){if(!s.error){s.error='La ejecución anterior espera tu aprobación.';this.put('schedules',s);}continue;}}
      // Claim before launching: a crash may miss this occurrence, never duplicate it.
      const before={enabled:s.enabled,nextAt:s.nextAt};
      s.enabled=s.intervalMinutes>0;
      if(s.enabled)s.nextAt=new Date(now+s.intervalMinutes*60000).toISOString();
      s.lastAttemptAt=new Date(now).toISOString();this.put('schedules',s);
      try{s.lastRunId=this.run(s.targetKind,s.targetId).id;s.error='';}
      catch(e){
        // Busy is temporary: keep the occurrence for the next tick instead of disabling the schedule.
        if(e.code==='ENGINE_BUSY')Object.assign(s,before);
        else{s.error=e.message;s.enabled=false;}
      }
      this.put('schedules',s);
    }
  }
}

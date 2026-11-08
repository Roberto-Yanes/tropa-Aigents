import { randomUUID } from 'node:crypto';
const text = (v, max=12000) => { if(typeof v!=='string'||!v.trim()||v.length>max) throw Error('Completá los campos requeridos.'); return v.trim(); };
export class Operations {
  constructor(engine) { this.engine=engine; this.db=engine.db; this.db.exec('CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY, kind TEXT, body TEXT)'); }
  list(kind) { return this.db.prepare('SELECT body FROM operations WHERE kind=? ORDER BY rowid DESC').all(kind).map(x=>JSON.parse(x.body)); }
  put(kind, item) { this.db.prepare('INSERT OR REPLACE INTO operations VALUES(?,?,?)').run(item.id,kind,JSON.stringify(item)); return item; }
  get(kind,id) { const item=this.list(kind).find(x=>x.id===id); if(!item)throw Error('Elemento no encontrado.'); return item; }
  save(kind,b) {
    if(!['routines','workflows','schedules'].includes(kind))throw Error('Tipo inválido.');
    const old=b.id?this.get(kind,b.id):null;
    const item={id:old?.id||randomUUID(),name:text(b.name,80)};
    if(kind==='schedules') {
      this.get('routines',b.routineId); item.routineId=b.routineId;
      const date=new Date(b.nextAt); if(!Number.isFinite(date.getTime())||date.getTime()<=Date.now())throw Error('Elegí una fecha futura.');
      const interval=Number(b.intervalMinutes||0); if(!Number.isInteger(interval)||interval<0||interval>525600||(interval>0&&interval<5))throw Error('Intervalo mínimo: 5 minutos.');
      Object.assign(item,{nextAt:date.toISOString(),intervalMinutes:interval,enabled:true,lastRunId:old?.lastRunId||null});
    } else {
      item.objective=text(b.objective);
      item.teamIds=kind==='routines'?[b.teamId]:b.teamIds;
      if(!Array.isArray(item.teamIds)||!item.teamIds.length||item.teamIds.length>8)throw Error('Agregá entre 1 y 8 pasos.');
      const agents=item.teamIds.flatMap(id=>{const t=this.engine.teams().find(t=>t.id===id);if(!t)throw Error('Equipo no encontrado.');return t.agents;});
      if(agents.length>8)throw Error('Máximo total: 8 agentes por flujo.');
    }
    return this.put(kind,item);
  }
  run(kind,id) {
    const item=this.get(kind,id);
    if(!['routines','workflows'].includes(kind))throw Error('Elemento no ejecutable.');
    const teams=item.teamIds.map(id=>{const t=this.engine.teams().find(t=>t.id===id);if(!t)throw Error('Equipo no encontrado.');return t;});
    if(teams.some(t=>['existing','internal'].includes(t.browserAccess?.mode)))throw Error('Las sesiones personales se ejecutan desde Asignar trabajo del equipo; todavía no en flujos o programaciones.');
    const agents=teams.flatMap(t=>t.agents);
    return this.engine.startSnapshot({id:item.id,name:item.name,agents},item.objective,{kind,id});
  }
  toggle(id) { const s=this.get('schedules',id);s.enabled=!s.enabled;return this.put('schedules',s); }
  tick(now=Date.now()) {
    for(const s of this.list('schedules')) {
      if(!s.enabled||Date.parse(s.nextAt)>now)continue;
      if(s.lastRunId&&this.engine.active.has(s.lastRunId))continue;
      if(this.engine.active.size>=2)continue;
      // Claim before launching: a crash may miss this occurrence, never duplicate it.
      s.enabled=s.intervalMinutes>0;
      if(s.enabled)s.nextAt=new Date(now+s.intervalMinutes*60000).toISOString();
      s.lastAttemptAt=new Date(now).toISOString();this.put('schedules',s);
      try{s.lastRunId=this.run('routines',s.routineId).id;s.error='';}catch(e){s.error=e.message;s.enabled=false;}
      this.put('schedules',s);
    }
  }
}

import { createHash } from 'node:crypto';

const KEEP_MS = 7 * 24 * 3600 * 1000, KEEP_EVENTS = 5000;
const coded = (message, code) => Object.assign(Error(message), { code });

export class MobileStore {
  constructor(db, { now = () => Date.now() } = {}) {
    this.db = db; this.now = now; this.pendingRequests = new Map();
    db.exec(`CREATE TABLE IF NOT EXISTS mobile_devices (id TEXT PRIMARY KEY, name TEXT NOT NULL, platform TEXT NOT NULL, sign_pk TEXT NOT NULL, box_pk TEXT NOT NULL, created_at TEXT NOT NULL, last_seen TEXT, revoked_at TEXT);
      CREATE TABLE IF NOT EXISTS mobile_events (seq INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS mobile_requests (device_id TEXT NOT NULL, client_id TEXT NOT NULL, method TEXT NOT NULL, hash TEXT NOT NULL, result TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (device_id, client_id));`);
    if (db.prepare('PRAGMA user_version').get().user_version < 2) db.exec('PRAGMA user_version=2');
  }
  iso() { return new Date(this.now()).toISOString(); }
  devices({ includeRevoked = false } = {}) {
    return this.db.prepare(`SELECT * FROM mobile_devices ${includeRevoked ? '' : 'WHERE revoked_at IS NULL'} ORDER BY created_at`).all()
      .map(d => ({ id: d.id, name: d.name, platform: d.platform, signPk: d.sign_pk, boxPk: d.box_pk, createdAt: d.created_at, lastSeen: d.last_seen, revokedAt: d.revoked_at }));
  }
  device(id) { return this.devices().find(d => d.id === id) || null; }
  addDevice({ id, name, platform, signPk, boxPk }) {
    if (this.devices().length >= 20) throw coded('Máximo: 20 teléfonos vinculados.', 'LIMIT');
    this.db.prepare('INSERT OR REPLACE INTO mobile_devices VALUES (?,?,?,?,?,?,NULL,NULL)').run(id, name, platform, signPk, boxPk, this.iso());
    return this.device(id);
  }
  seen(id) { this.db.prepare('UPDATE mobile_devices SET last_seen=? WHERE id=? AND revoked_at IS NULL').run(this.iso(), id); }
  revoke(id) {
    const r = this.db.prepare('UPDATE mobile_devices SET revoked_at=? WHERE id=? AND revoked_at IS NULL').run(this.iso(), id);
    if (!r.changes) throw coded('Ese teléfono no está vinculado.', 'NOT_FOUND');
    this.db.prepare('DELETE FROM mobile_requests WHERE device_id=?').run(id);
  }
  addEvent(kind, data) {
    const r = this.db.prepare('INSERT INTO mobile_events (at, kind, data) VALUES (?,?,?)').run(this.iso(), kind, JSON.stringify(data));
    const seq = Number(r.lastInsertRowid);
    if (seq % 100 === 0) this.prune();
    return { ...data, seq, at: this.iso(), kind };
  }
  prune() {
    this.db.prepare('DELETE FROM mobile_events WHERE at < ?').run(new Date(this.now() - KEEP_MS).toISOString());
    this.db.prepare('DELETE FROM mobile_events WHERE seq <= (SELECT MAX(seq) FROM mobile_events) - ?').run(KEEP_EVENTS);
    this.db.prepare('DELETE FROM mobile_requests WHERE at < ?').run(new Date(this.now() - KEEP_MS).toISOString());
  }
  lastSeq() { return this.db.prepare('SELECT MAX(seq) AS s FROM mobile_events').get().s || 0; }
  // A cursor older than the kept window means the phone must reload state instead of trusting a partial log.
  eventsSince(cursor = 0, limit = 200) {
    const first = this.db.prepare('SELECT MIN(seq) AS s FROM mobile_events').get().s;
    const rows = this.db.prepare('SELECT * FROM mobile_events WHERE seq > ? ORDER BY seq LIMIT ?').all(Number(cursor) || 0, Math.min(limit, 500));
    return {
      events: rows.map(r => ({ ...JSON.parse(r.data), seq: r.seq, at: r.at, kind: r.kind })),
      cursor: rows.length ? rows.at(-1).seq : Math.max(Number(cursor) || 0, 0),
      reset: !!(first && cursor && cursor < first - 1),
      more: rows.length === Math.min(limit, 500),
    };
  }
  // Same clientId + same call returns the stored answer; a different call with that id is a conflict.
  async idempotent(deviceId, clientId, method, params, fn) {
    if (typeof clientId !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(clientId)) throw coded('Falta un identificador de operación válido.', 'INVALID');
    const hash = createHash('sha256').update(JSON.stringify([method, params])).digest('hex');
    const key=JSON.stringify([deviceId,clientId]), pending=this.pendingRequests.get(key);
    if(pending){if(pending.hash!==hash||pending.method!==method)throw coded('Ese identificador ya se usó para otra operación.', 'CONFLICT');return pending.promise;}
    const row = this.db.prepare('SELECT * FROM mobile_requests WHERE device_id=? AND client_id=?').get(deviceId, clientId);
    if (row) {
      if (row.hash !== hash || row.method !== method) throw coded('Ese identificador ya se usó para otra operación.', 'CONFLICT');
      if(row.result==='@pending')throw coded('El resultado de esta operación es incierto. Revisá la tarea antes de volver a intentarlo.', 'UNKNOWN_OUTCOME');
      if(row.result.startsWith('@error:')){const e=JSON.parse(row.result.slice(7));throw Object.assign(Error(e.message),{code:e.code,retryable:false});}
      return JSON.parse(row.result);
    }
    // Reserve the ID durably before invoking the action. If the process dies, a
    // subsequent retry reports an uncertain outcome instead of repeating it.
    this.db.prepare('INSERT INTO mobile_requests VALUES (?,?,?,?,?,?)').run(deviceId, clientId, method, hash, '@pending', this.iso());
    const promise=Promise.resolve().then(fn).then(result=>{
      this.db.prepare('UPDATE mobile_requests SET result=? WHERE device_id=? AND client_id=?').run(JSON.stringify(result ?? null),deviceId,clientId);return result;
    },error=>{
      const safe={message:String(error?.message||'No se pudo completar la operación.'),code:error?.code||'FAILED'};
      this.db.prepare('UPDATE mobile_requests SET result=? WHERE device_id=? AND client_id=?').run('@error:'+JSON.stringify(safe),deviceId,clientId);throw error;
    }).finally(()=>this.pendingRequests.delete(key));
    this.pendingRequests.set(key,{hash,method,promise});return promise;
  }
}

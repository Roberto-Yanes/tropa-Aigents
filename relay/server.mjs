// Tropa relay: forwards sealed envelopes between a desktop and its paired phones. It never sees content.
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { PROTOCOL_VERSION, idFromSignPk, randomToken, verifyNonce, tokenHash } from '../protocol/crypto.mjs';

const MAX_FRAME = 512 * 1024, MAX_DEVICES = 20, RATE = 30;
const PUSH_TEXT = { approval: 'Tropa necesita tu aprobación', done: 'Tu tarea terminó' };

export async function expoPush(token, kind, accessToken) {
  const r = await fetch('https://exp.host/--/api/v2/push/send', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
    body: JSON.stringify({ to: token, title: 'Tropa', body: PUSH_TEXT[kind] || 'Novedades en Tropa', data: { kind }, sound: 'default', priority: 'high' }) });
  if (!r.ok) throw Error(`Expo Push ${r.status}`);
}

export function createRelay({ dataDir = process.env.DATA_DIR || './data', push = (token, kind) => expoPush(token, kind, process.env.EXPO_ACCESS_TOKEN), now = () => Date.now(), log = () => {} } = {}) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = join(dataDir, 'rooms.json');
  // Persisted per room: which devices may connect and their push tokens. Nothing else.
  const rooms = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  let saveTimer = null;
  const persist = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => { writeFileSync(file + '.tmp', JSON.stringify(rooms), { mode: 0o600 }); renameSync(file + '.tmp', file); }, 200); saveTimer.unref?.(); };
  const room = id => rooms[id] ||= { allowed: [], tokens: {} };
  const live = new Map(); // room -> { desktop, devices: Map(id, ws), pairs: Map(connId, ws), invite }
  const liveRoom = id => live.get(id) || live.set(id, { desktop: null, devices: new Map(), pairs: new Map(), invite: null }).get(id);
  const out = (ws, frame) => { if (ws?.readyState === 1) ws.send(JSON.stringify(frame)); };
  const fail = (ws, code, message) => { out(ws, { t: 'error', code, message }); ws.close(4000, code); };

  const http = createServer((req, res) => {
    if (req.url === '/health') {
      let conns = 0; for (const r of live.values()) conns += (r.desktop ? 1 : 0) + r.devices.size + r.pairs.size;
      res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: true, rooms: live.size, connections: conns }));
    }
    res.writeHead(404); res.end();
  });
  const wss = new WebSocketServer({ server: http, maxPayload: MAX_FRAME });

  wss.on('connection', ws => {
    const nonce = randomToken(32); let who = null, window = now(), count = 0;
    out(ws, { t: 'challenge', nonce });
    const hello = setTimeout(() => { if (!who) fail(ws, 'TIMEOUT', 'Sin saludo.'); }, 10000); hello.unref?.();
    ws.on('message', raw => {
      if (now() - window > 1000) { window = now(); count = 0; }
      if (++count > RATE) return fail(ws, 'RATE', 'Demasiados mensajes.');
      let f; try { f = JSON.parse(raw.toString()); } catch { return fail(ws, 'BAD_FRAME', 'Trama inválida.'); }
      if (!who) return greet(ws, f, nonce, w => { who = w; clearTimeout(hello); });
      handle(ws, who, f);
    });
    ws.on('close', () => { clearTimeout(hello); if (who) leave(ws, who); });
    ws.on('error', () => {});
  });

  function greet(ws, f, nonce, done) {
    if (f.t !== 'hello' || f.v !== PROTOCOL_VERSION || typeof f.room !== 'string') return fail(ws, 'BAD_HELLO', 'Saludo inválido.');
    const r = liveRoom(f.room);
    if (f.role === 'desktop') {
      if (typeof f.signPk !== 'string' || idFromSignPk(f.signPk) !== f.room || !verifyNonce(nonce, f.sig, f.signPk)) return fail(ws, 'AUTH', 'Firma inválida.');
      if (r.desktop) r.desktop.close(4001, 'REPLACED');
      r.desktop = ws; done({ role: 'desktop', room: f.room }); out(ws, { t: 'ready' });
      for (const id of r.devices.keys()) out(ws, { t: 'presence', device: id, online: true });
      for (const d of r.devices.values()) out(d, { t: 'presence', desktop: true });
      return;
    }
    if (f.role === 'device') {
      if (typeof f.signPk !== 'string' || idFromSignPk(f.signPk) !== f.device || !verifyNonce(nonce, f.sig, f.signPk)) return fail(ws, 'AUTH', 'Firma inválida.');
      if (!room(f.room).allowed.includes(f.device)) return fail(ws, 'REVOKED', 'Este teléfono no está vinculado.');
      r.devices.get(f.device)?.close(4001, 'REPLACED');
      r.devices.set(f.device, ws); done({ role: 'device', room: f.room, device: f.device });
      out(ws, { t: 'ready' }); out(ws, { t: 'presence', desktop: !!r.desktop }); out(r.desktop, { t: 'presence', device: f.device, online: true });
      return;
    }
    if (f.role === 'pair') {
      const inv = r.invite;
      if (!inv || inv.expires < now() || inv.uses >= 3 || typeof f.token !== 'string' || tokenHash(f.token) !== inv.tokenHash) return fail(ws, 'INVITE', 'Invitación vencida o inválida.');
      inv.uses++; const conn = 'pair:' + randomUUID();
      r.pairs.set(conn, ws); done({ role: 'pair', room: f.room, conn, sent: 0 });
      out(ws, { t: 'ready' }); out(ws, { t: 'presence', desktop: !!r.desktop });
      return;
    }
    fail(ws, 'BAD_HELLO', 'Rol inválido.');
  }

  function handle(ws, who, f) {
    const r = liveRoom(who.room), stored = room(who.room);
    if (who.role === 'desktop') {
      if (f.t === 'allow' && Array.isArray(f.devices)) {
        stored.allowed = f.devices.filter(d => typeof d === 'string').slice(0, MAX_DEVICES);
        for (const id of Object.keys(stored.tokens)) if (!stored.allowed.includes(id)) delete stored.tokens[id];
        for (const [id, d] of r.devices) if (!stored.allowed.includes(id)) d.close(4003, 'REVOKED');
        return persist();
      }
      if (f.t === 'invite') { r.invite = typeof f.tokenHash === 'string' ? { tokenHash: f.tokenHash, expires: Math.min(Number(f.expires) || 0, now() + 15 * 60000), uses: 0 } : null; return; }
      if (f.t === 'revoke' && typeof f.device === 'string') { stored.allowed = stored.allowed.filter(id => id !== f.device); delete stored.tokens[f.device]; r.devices.get(f.device)?.close(4003, 'REVOKED'); return persist(); }
      if (f.t === 'msg' && typeof f.to === 'string' && typeof f.data === 'string') {
        const target = f.to.startsWith('pair:') ? r.pairs.get(f.to) : r.devices.get(f.to);
        if (!target) return out(ws, { t: 'offline', to: f.to });
        return out(target, { t: 'msg', from: 'desktop', data: f.data });
      }
      if (f.t === 'push' && typeof f.device === 'string') {
        const token = stored.tokens[f.device];
        if (token && stored.allowed.includes(f.device)) Promise.resolve(push(token, f.kind)).catch(e => log('push', e.message));
        return;
      }
      return;
    }
    if (f.t === 'msg' && typeof f.data === 'string') {
      if (who.role === 'pair' && (++who.sent > 3 || typeof f.pk !== 'string')) return fail(ws, 'RATE', 'Demasiados intentos.');
      if (!r.desktop) return out(ws, { t: 'offline', to: 'desktop' });
      return out(r.desktop, { t: 'msg', from: who.role === 'pair' ? who.conn : who.device, ...(who.role === 'pair' ? { pk: f.pk } : {}), data: f.data });
    }
    if (who.role === 'device' && f.t === 'pushToken') {
      if (typeof f.token === 'string' && /^ExponentPushToken\[[\w-]+\]$/.test(f.token)) { stored.tokens[who.device] = f.token; persist(); }
      else if (f.token === null) { delete stored.tokens[who.device]; persist(); }
    }
  }

  function leave(ws, who) {
    const r = live.get(who.room); if (!r) return;
    if (who.role === 'desktop' && r.desktop === ws) { r.desktop = null; r.invite = null; for (const d of r.devices.values()) out(d, { t: 'presence', desktop: false }); }
    if (who.role === 'device' && r.devices.get(who.device) === ws) { r.devices.delete(who.device); out(r.desktop, { t: 'presence', device: who.device, online: false }); }
    if (who.role === 'pair') r.pairs.delete(who.conn);
    if (!r.desktop && !r.devices.size && !r.pairs.size) live.delete(who.room);
  }

  return { http, wss, rooms, listen: (port, host) => new Promise(res => http.listen(port, host, () => res(http.address().port))), close: () => new Promise(res => { clearTimeout(saveTimer); for (const c of wss.clients) c.terminate(); wss.close(); http.close(() => res()); }) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const relay = createRelay({ log: (...a) => console.log(new Date().toISOString(), ...a) });
  const port = await relay.listen(Number(process.env.PORT || 8787), '0.0.0.0');
  console.log(`Relay de Tropa escuchando en el puerto ${port}`);
  const stop = () => relay.close().then(() => process.exit(0));
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}

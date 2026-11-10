import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { PROTOCOL_VERSION, newIdentity, idFromSignPk, randomToken, signNonce, seal, open, relayToken, tokenHash, pairingProof, shortCode, sameBytes, encodeInvite, envelope, ReplayGuard } from '../protocol/crypto.mjs';
import { MobileStore } from './store.mjs';
import { MobileApi, approvalView } from './api.mjs';

const terminal = new Set(['completed', 'failed', 'cancelled', 'interrupted']);
const coded = (message, code) => Object.assign(Error(message), { code });
const INVITE_MS = 10 * 60 * 1000;
// Galatea's relay. It only forwards sealed envelopes; a person can point Tropa at another relay in Teléfonos.
export const DEFAULT_RELAY = 'wss://tropa.galateasoftware.com.ar/relay';

export class MobileGateway extends EventEmitter {
  constructor({ engine, operations, browser, dir, WebSocketImpl = globalThis.WebSocket, now = () => Date.now(), relayUrl = process.env.TROPA_RELAY_URL ?? DEFAULT_RELAY }) {
    super();
    Object.assign(this, { engine, operations, browser, WebSocketImpl, now, defaultRelay: relayUrl });
    const home = join(dir, 'mobile'); mkdirSync(home, { recursive: true, mode: 0o700 });
    const file = join(home, 'identity.json');
    if (!existsSync(file)) { writeFileSync(file, JSON.stringify(newIdentity()), { mode: 0o600 }); }
    chmodSync(file, 0o600);
    this.identity = JSON.parse(readFileSync(file, 'utf8'));
    this.room = idFromSignPk(this.identity.signPk);
    this.store = new MobileStore(engine.db, { now });
    this.api = new MobileApi({ engine, operations, browser, store: this.store });
    this.guards = new Map(); this.online = new Set(); this.lastRun = new Map();
    this.ws = null; this.connected = false; this.retry = 0; this.timer = null; this.stopped = false; this.invite = null;
    this.onRun = e => this.recordRun(e);
    this.onPending = e => { const { kind: approvalKind, ...view } = approvalView(e); this.record('approval', { state: 'pending', approvalKind, ...view }, { push: 'approval' }); };
    this.onClosed = e => this.record('approval', { state: 'closed', runId: e.runId, pendingId: e.pendingId, result: e.result });
    engine.on('run', this.onRun); browser?.on?.('approval:pending', this.onPending); browser?.on?.('approval:closed', this.onClosed);
  }
  relayUrl() { return this.engine.getSetting('mobile:relayUrl') || this.defaultRelay || ''; }
  setRelayUrl(url) {
    if (url && !/^wss:\/\/[a-z0-9.-]+(:\d+)?(\/[\w./-]*)?$/i.test(url) && !/^ws:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/[\w./-]*)?$/.test(url)) throw coded('La dirección del relay debe empezar con wss://', 'INVALID');
    this.engine.setSetting('mobile:relayUrl', url || null); this.reconnect();
  }
  start() { if (this.relayUrl() && (this.store.devices().length || this.invite)) this.connect(); }
  status() {
    const inv = this.invite && this.invite.expires > this.now() ? this.invite : null;
    return { relayUrl: this.relayUrl(), connected: this.connected, room: this.room,
      devices: this.store.devices().map(d => ({ id: d.id, name: d.name, platform: d.platform, createdAt: d.createdAt, lastSeen: d.lastSeen, online: this.online.has(d.id) })),
      invite: inv ? { expiresAt: new Date(inv.expires).toISOString(), pending: inv.pending ? { name: inv.pending.device.name, platform: inv.pending.device.platform, code: inv.pending.code } : null } : null };
  }

  // ---- relay connection
  connect() {
    if (this.stopped || this.ws || !this.relayUrl() || !this.WebSocketImpl) return;
    clearTimeout(this.timer);
    let ws;
    try { ws = new this.WebSocketImpl(this.relayUrl()); } catch { return this.schedule(); }
    this.ws = ws;
    ws.onmessage = e => { try { this.frame(JSON.parse(typeof e.data === 'string' ? e.data : e.data.toString())); } catch {} };
    ws.onclose = () => { if (this.ws !== ws) return; this.ws = null; this.connected = false; this.online.clear(); this.emit('status'); this.schedule(); };
    ws.onerror = () => {};
  }
  schedule() { if (this.stopped) return; const wait = Math.min(60000, 1000 * 2 ** this.retry++); this.timer = setTimeout(() => this.connect(), wait); this.timer.unref?.(); }
  reconnect() { const ws = this.ws; this.ws = null; this.connected = false; try { ws?.close(); } catch {} this.retry = 0; this.start(); }
  send(frame) { if (!this.ws || this.ws.readyState !== 1) return false; this.ws.send(JSON.stringify(frame)); return true; }
  sendAllow() { this.send({ t: 'allow', devices: this.store.devices().map(d => d.id) }); }
  sendTo(deviceId, type, body) { const d = this.store.device(deviceId); if (!d) return false; return this.send({ t: 'msg', to: deviceId, data: seal(envelope(type, body), d.boxPk, this.identity.boxSk) }); }
  frame(f) {
    if (f.t === 'challenge') return this.send({ t: 'hello', v: PROTOCOL_VERSION, role: 'desktop', room: this.room, signPk: this.identity.signPk, sig: signNonce(f.nonce, this.identity.signSk) });
    if (f.t === 'ready') {
      this.connected = true; this.retry = 0; this.sendAllow();
      if (this.invite && this.invite.expires > this.now()) this.send({ t: 'invite', tokenHash: tokenHash(this.invite.token), expires: this.invite.expires });
      this.emit('status'); return;
    }
    if (f.t === 'presence' && typeof f.device === 'string') { f.online ? this.online.add(f.device) : this.online.delete(f.device); if (f.online) this.store.seen(f.device); this.emit('status'); return; }
    if (f.t === 'msg' && typeof f.from === 'string') return f.from.startsWith('pair:') ? this.pairMessage(f) : this.deviceMessage(f.from, f.data);
  }

  // ---- pairing
  createInvite() {
    const relay = this.relayUrl();
    if (!relay) throw coded('Configurá primero la dirección del relay.', 'NOT_CONFIGURED');
    const secret = randomToken(32);
    this.invite = { secret, token: relayToken(secret), expires: this.now() + INVITE_MS, pending: null, used: false };
    if (this.connected) this.send({ t: 'invite', tokenHash: tokenHash(this.invite.token), expires: this.invite.expires }); else this.connect();
    this.emit('status');
    return { link: encodeInvite({ v: PROTOCOL_VERSION, relay, room: this.room, signPk: this.identity.signPk, boxPk: this.identity.boxPk, secret, expires: this.invite.expires }), expiresAt: new Date(this.invite.expires).toISOString() };
  }
  pairMessage(f) {
    const inv = this.invite;
    if (!inv || inv.used || inv.pending || inv.expires <= this.now() || typeof f.pk !== 'string') return;
    let env; try { env = new ReplayGuard({ now: this.now }).check(open(f.data, f.pk, this.identity.boxSk)); } catch { return; }
    const b = env.body || {};
    if (env.type !== 'pair.request' || typeof b.signPk !== 'string' || b.boxPk !== f.pk || !sameBytes(b.proof, pairingProof(inv.secret, b.signPk, b.boxPk))) return;
    const device = { id: idFromSignPk(b.signPk), name: String(b.name || 'Teléfono').slice(0, 60), platform: ['ios', 'android'].includes(b.platform) ? b.platform : 'other', signPk: b.signPk, boxPk: b.boxPk };
    inv.pending = { conn: f.from, device, code: shortCode(this.identity.boxPk, b.boxPk, inv.secret) };
    this.emit('status');
  }
  confirmPairing(accept) {
    const inv = this.invite;
    if (!inv?.pending || inv.expires <= this.now()) throw coded('No hay un teléfono esperando confirmación.', 'NOT_FOUND');
    const { conn, device } = inv.pending; inv.used = true;
    const reply = (type, body) => this.send({ t: 'msg', to: conn, data: seal(envelope(type, body), device.boxPk, this.identity.boxSk) });
    if (!accept) { reply('pair.rejected', {}); this.invite = null; this.emit('status'); return { ok: true }; }
    this.store.addDevice(device); this.sendAllow();
    reply('pair.ok', { deviceId: device.id, room: this.room });
    this.invite = null; this.emit('status');
    return { ok: true, device: { id: device.id, name: device.name, platform: device.platform } };
  }
  revoke(deviceId) {
    this.store.revoke(deviceId); this.guards.delete(deviceId); this.online.delete(deviceId);
    this.send({ t: 'revoke', device: deviceId }); this.sendAllow(); this.emit('status');
    return { ok: true };
  }

  // ---- encrypted calls from paired phones
  async deviceMessage(deviceId, data) {
    const device = this.store.device(deviceId); if (!device) return;
    let env;
    try {
      const guard = this.guards.get(deviceId) || this.guards.set(deviceId, new ReplayGuard({ now: this.now })).get(deviceId);
      env = guard.check(open(data, device.boxPk, this.identity.boxSk));
    } catch { return; }
    this.store.seen(deviceId);
    if (env.type !== 'rpc' || !env.body || typeof env.body.id !== 'string') return;
    const { id, method, params } = env.body;
    if (method === 'device.unpair') { this.sendTo(deviceId, 'rpc.result', { id, ok: true, result: { ok: true } }); this.revoke(deviceId); return; }
    try { this.sendTo(deviceId, 'rpc.result', { id, ok: true, result: await this.api.call(deviceId, method, params || {}) }); }
    catch (e) { this.sendTo(deviceId, 'rpc.result', { id, ok: false, error: { code: e.code || 'FAILED', message: e.message, retryable: !!e.retryable } }); }
  }

  // ---- events: recorded first, then pushed live; phones catch up with events.since
  recordRun(e) {
    const prev = this.lastRun.get(e.id);
    if (prev && prev.status === e.status && prev.steps === e.steps) return;
    this.lastRun.set(e.id, { status: e.status, steps: e.steps });
    if (this.lastRun.size > 500) this.lastRun.delete(this.lastRun.keys().next().value);
    let run; try { run = this.engine.get(e.id); } catch { return; }
    const push = e.status === 'waiting' && prev?.status !== 'waiting' ? 'approval'
      : terminal.has(e.status) && !terminal.has(prev?.status) && run.source?.channel === 'mobile' ? { kind: 'done', device: run.source.deviceId } : null;
    this.record('run', { runId: e.id, status: e.status, steps: e.steps, title: run.team?.name || '', currentAgent: run.currentAgent || '', teamId:run.source?.teamId??run.team?.id??null, chatKind:run.source?.kind||null, index:run.source?.index??null }, { push });
  }
  record(kind, data, { push } = {}) {
    if (!this.store.devices().length) return null;
    const event = this.store.addEvent(kind, data);
    for (const id of this.online) this.sendTo(id, 'event', event);
    if (push) {
      const kindName = typeof push === 'string' ? push : push.kind;
      const targets = typeof push === 'string' ? this.store.devices().map(d => d.id) : push.device ? [push.device] : [];
      for (const id of targets) if (!this.online.has(id)) this.send({ t: 'push', device: id, kind: kindName });
    }
    return event;
  }
  async stop() {
    this.stopped = true; clearTimeout(this.timer);
    this.engine.off('run', this.onRun); this.browser?.off?.('approval:pending', this.onPending); this.browser?.off?.('approval:closed', this.onClosed);
    const ws = this.ws; this.ws = null; try { ws?.close(); } catch {}
  }
}

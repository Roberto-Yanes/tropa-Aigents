// Phone side of the protocol. Runs in React Native and in Node tests (any WebSocket implementation).
import { PROTOCOL_VERSION, newIdentity, idFromSignPk, randomToken, signNonce, seal, open, relayToken, pairingProof, shortCode, decodeInvite, envelope, ReplayGuard } from './crypto.mjs';

const coded = (message, code, retryable = false) => Object.assign(Error(message), { code, retryable });

function connectSocket(WebSocketImpl, url, onFrame) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocketImpl(url); let ready = false;
    ws.onmessage = e => { let f; try { f = JSON.parse(typeof e.data === 'string' ? e.data : e.data.toString()); } catch { return; } if (f.t === 'ready') { ready = true; resolve(ws); } else if (f.t === 'error' && !ready) reject(coded(f.message, f.code)); onFrame(f, ws); };
    ws.onerror = () => { if (!ready) reject(coded('No se pudo conectar con el relay.', 'NETWORK', true)); };
    ws.onclose = e => { if (!ready) reject(coded('El relay cerró la conexión.', e?.reason || 'CLOSED', true)); };
  });
}

// Pairing: scan the QR, show `code`, then await `confirmed` while the person checks the same code on the computer.
export async function startPairing(link, { name, platform, WebSocketImpl = globalThis.WebSocket, identity = newIdentity(), timeoutMs = 10 * 60 * 1000 }) {
  const invite = decodeInvite(link);
  if (invite.expires < Date.now()) throw coded('El código QR venció. Generá uno nuevo en Tropa Desktop.', 'EXPIRED');
  let settle; const confirmed = new Promise((resolve, reject) => { settle = { resolve, reject }; });
  const guard = new ReplayGuard();
  const ws = await connectSocket(WebSocketImpl, invite.relay, (f, sock) => {
    if (f.t === 'challenge') return sock.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, role: 'pair', room: invite.room, token: relayToken(invite.secret) }));
    if (f.t === 'msg' && f.from === 'desktop') {
      let env; try { env = guard.check(open(f.data, invite.boxPk, identity.boxSk)); } catch { return; }
      if (env.type === 'pair.ok' && env.body?.deviceId === idFromSignPk(identity.signPk)) settle.resolve({ identity, desktop: { room: invite.room, relay: invite.relay, signPk: invite.signPk, boxPk: invite.boxPk }, deviceId: env.body.deviceId });
      else if (env.type === 'pair.rejected') settle.reject(coded('El emparejamiento se rechazó en Tropa Desktop.', 'REJECTED'));
      sock.close();
    }
    if (f.t === 'presence' && f.desktop === false) settle.reject(coded('Tropa Desktop no está conectada. Abrila e intentá de nuevo.', 'OFFLINE', true));
  });
  const body = { name: String(name || 'Teléfono').slice(0, 60), platform, signPk: identity.signPk, boxPk: identity.boxPk, proof: pairingProof(invite.secret, identity.signPk, identity.boxPk) };
  ws.send(JSON.stringify({ t: 'msg', to: 'desktop', pk: identity.boxPk, data: seal(envelope('pair.request', body), invite.boxPk, identity.boxSk) }));
  const timer = setTimeout(() => { settle.reject(coded('No se confirmó a tiempo.', 'EXPIRED')); ws.close(); }, timeoutMs);
  timer.unref?.();
  confirmed.finally(() => clearTimeout(timer)).catch(() => {});
  const cancel = () => { clearTimeout(timer); settle.reject(coded('Emparejamiento cancelado.', 'CANCELLED')); try { ws.close(); } catch {} };
  return { code: shortCode(invite.boxPk, identity.boxPk, invite.secret), confirmed, cancel };
}

// A paired phone: encrypted calls with timeouts, live events and desktop presence.
export class TropaClient {
  /** @param {{ identity: any, desktop: any, WebSocketImpl?: any, onEvent?: (body: any) => void, onPresence?: (online: boolean) => void, onRevoked?: () => void, onClose?: (e?: any) => void, callTimeoutMs?: number }} opts */
  constructor({ identity, desktop, WebSocketImpl = globalThis.WebSocket, onEvent = () => {}, onPresence = () => {}, onRevoked = () => {}, onClose = () => {}, callTimeoutMs = 30000 }) {
    Object.assign(this, { identity, desktop, WebSocketImpl, onEvent, onPresence, onRevoked, onClose, callTimeoutMs });
    this.deviceId = idFromSignPk(identity.signPk); this.pending = new Map(); this.guard = new ReplayGuard(); this.desktopOnline = false; this.ws = null;
  }
  async connect() {
    this.ws = await connectSocket(this.WebSocketImpl, this.desktop.relay, (f, sock) => this.frame(f, sock));
    this.ws.onclose = e => { this.ws = null; this.desktopOnline = false; this.onPresence(false); for (const p of this.pending.values()) p.reject(coded('Se perdió la conexión.', 'NETWORK', true)); this.pending.clear(); if (e?.code === 4003) this.onRevoked(); else this.onClose(e); };
    return this;
  }
  frame(f, sock) {
    if (f.t === 'challenge') return sock.send(JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, role: 'device', room: this.desktop.room, device: this.deviceId, signPk: this.identity.signPk, sig: signNonce(f.nonce, this.identity.signSk) }));
    if (f.t === 'error' && f.code === 'REVOKED') return this.onRevoked();
    if (f.t === 'presence' && typeof f.desktop === 'boolean') { this.desktopOnline = f.desktop; return this.onPresence(f.desktop); }
    if (f.t === 'offline' && f.to === 'desktop') { for (const p of this.pending.values()) p.reject(coded('Tu compu no está conectada.', 'OFFLINE', true)); this.pending.clear(); return; }
    if (f.t !== 'msg' || f.from !== 'desktop') return;
    let env; try { env = this.guard.check(open(f.data, this.desktop.boxPk, this.identity.boxSk)); } catch { return; }
    if (env.type === 'event') return this.onEvent(env.body);
    if (env.type === 'rpc.result') {
      const p = this.pending.get(env.body?.id); if (!p) return;
      this.pending.delete(env.body.id);
      env.body.ok ? p.resolve(env.body.result) : p.reject(coded(env.body.error?.message || 'Error', env.body.error?.code || 'FAILED', !!env.body.error?.retryable));
    }
  }
  call(method, params = {}) {
    if (!this.ws || this.ws.readyState !== 1) return Promise.reject(coded('Sin conexión con el relay.', 'NETWORK', true));
    const id = randomToken(12);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(coded('Tropa Desktop no respondió a tiempo.', 'TIMEOUT', true)); }, this.callTimeoutMs);
      this.pending.set(id, { resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); } });
      this.ws.send(JSON.stringify({ t: 'msg', to: 'desktop', data: seal(envelope('rpc', { id, method, params }), this.desktop.boxPk, this.identity.boxSk) }));
    });
  }
  newClientId() { return randomToken(16); }
  setPushToken(token) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ t: 'pushToken', token })); }
  connected() { return this.ws?.readyState === 1; }
  close() { const ws = this.ws; this.ws = null; if (ws) { ws.onclose = null; ws.close(); } }
}

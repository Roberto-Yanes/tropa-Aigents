// Shared by Tropa Desktop, the relay and the mobile app: keep it dependency-free except tweetnacl.
import nacl from 'tweetnacl';

export const PROTOCOL_VERSION = 1;
// Own UTF-8 and base64url helpers: Hermes (React Native) does not guarantee TextDecoder, btoa or atob.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64I = Object.fromEntries([...B64].map((c, i) => [c, i]));
export function utf8Encode(text) {
  const out = [];
  for (let i = 0; i < text.length; i++) {
    let c = text.codePointAt(i); if (c > 0xffff) i++;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | c >> 6, 0x80 | c & 63);
    else if (c < 0x10000) out.push(0xe0 | c >> 12, 0x80 | c >> 6 & 63, 0x80 | c & 63);
    else out.push(0xf0 | c >> 18, 0x80 | c >> 12 & 63, 0x80 | c >> 6 & 63, 0x80 | c & 63);
  }
  return Uint8Array.from(out);
}
export function utf8Decode(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i++]; let c;
    if (b < 0x80) c = b;
    else if (b < 0xe0) c = (b & 31) << 6 | bytes[i++] & 63;
    else if (b < 0xf0) c = (b & 15) << 12 | (bytes[i++] & 63) << 6 | bytes[i++] & 63;
    else c = (b & 7) << 18 | (bytes[i++] & 63) << 12 | (bytes[i++] & 63) << 6 | bytes[i++] & 63;
    s += String.fromCodePoint(c);
  }
  return s;
}
const enc = { encode: utf8Encode }, dec = { decode: utf8Decode };

export function toB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = bytes[i] << 16 | (bytes[i + 1] ?? 0) << 8 | (bytes[i + 2] ?? 0);
    s += B64[n >> 18 & 63] + B64[n >> 12 & 63] + (i + 1 < bytes.length ? B64[n >> 6 & 63] : '') + (i + 2 < bytes.length ? B64[n & 63] : '');
  }
  return s;
}
export function fromB64(text) {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) throw Error('Base64 inválido.');
  const out = new Uint8Array(Math.floor(text.length * 3 / 4));
  let o = 0;
  for (let i = 0; i < text.length; i += 4) {
    const n = (B64I[text[i]] << 18) | (B64I[text[i + 1]] << 12) | ((B64I[text[i + 2]] ?? 0) << 6) | (B64I[text[i + 3]] ?? 0);
    out[o++] = n >> 16 & 255; if (i + 2 < text.length) out[o++] = n >> 8 & 255; if (i + 3 < text.length) out[o++] = n & 255;
  }
  return out;
}
const concat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const hash = (...parts) => nacl.hash(concat(...parts.map(p => typeof p === 'string' ? enc.encode(p) : p)));

export function newIdentity() {
  const sign = nacl.sign.keyPair(), box = nacl.box.keyPair();
  return { signPk: toB64(sign.publicKey), signSk: toB64(sign.secretKey), boxPk: toB64(box.publicKey), boxSk: toB64(box.secretKey) };
}
// Rooms and devices are named by their signing key, so only the key holder can claim them.
export const idFromSignPk = signPk => toB64(hash('tropa-id', fromB64(signPk)).slice(0, 16));
export const randomToken = (n = 32) => toB64(nacl.randomBytes(n));

export function signNonce(nonce, signSk) { return toB64(nacl.sign.detached(fromB64(nonce), fromB64(signSk))); }
export function verifyNonce(nonce, sig, signPk) {
  try { return nacl.sign.detached.verify(fromB64(nonce), fromB64(sig), fromB64(signPk)); } catch { return false; }
}

export function seal(value, theirBoxPk, myBoxSk) {
  const nonce = nacl.randomBytes(24);
  const box = nacl.box(enc.encode(JSON.stringify(value)), nonce, fromB64(theirBoxPk), fromB64(myBoxSk));
  return toB64(concat(nonce, box));
}
export function open(data, theirBoxPk, myBoxSk) {
  const raw = fromB64(data);
  if (raw.length < 24 + nacl.box.overheadLength) throw Error('Mensaje cifrado inválido.');
  const plain = nacl.box.open(raw.slice(24), raw.slice(0, 24), fromB64(theirBoxPk), fromB64(myBoxSk));
  if (!plain) throw Error('No se pudo descifrar el mensaje.');
  return JSON.parse(dec.decode(plain));
}

// Pairing: the relay only ever sees relayToken; the secret proves the phone scanned this QR.
export const relayToken = secret => toB64(hash('tropa-relay', fromB64(secret)).slice(0, 32));
export const tokenHash = token => toB64(hash('tropa-token', fromB64(token)).slice(0, 32));
export const pairingProof = (secret, signPk, boxPk) => toB64(hash('tropa-proof', fromB64(secret), fromB64(signPk), fromB64(boxPk)).slice(0, 32));
export function shortCode(desktopBoxPk, deviceBoxPk, secret) {
  const h = hash('tropa-code', fromB64(desktopBoxPk), fromB64(deviceBoxPk), fromB64(secret));
  const n = ((h[0] << 24) >>> 0) + (h[1] << 16) + (h[2] << 8) + h[3];
  return String(n % 1000000).padStart(6, '0');
}
export function sameBytes(a, b) {
  try { const x = fromB64(a), y = fromB64(b); return x.length === y.length && nacl.verify(x, y); } catch { return false; }
}

export function encodeInvite(invite) { return 'tropa://pair?d=' + toB64(enc.encode(JSON.stringify(invite))); }
export function decodeInvite(link) {
  const m = /^tropa:\/\/pair\?d=([A-Za-z0-9_-]+)$/.exec(String(link).trim());
  if (!m) throw Error('Código QR de Tropa inválido.');
  const invite = JSON.parse(dec.decode(fromB64(m[1])));
  if (invite.v !== PROTOCOL_VERSION) throw Error('Esta versión de la app no es compatible con tu Tropa Desktop.');
  return invite;
}

// Envelope inside every sealed message: rejects stale clocks and replays.
export function envelope(type, body) { return { id: randomToken(12), ts: Date.now(), type, body }; }
export class ReplayGuard {
  constructor({ windowMs = 300000, remember = 2000, now = () => Date.now() } = {}) { Object.assign(this, { windowMs, remember, now }); this.seen = new Map(); }
  check(env) {
    if (!env || typeof env.id !== 'string' || typeof env.ts !== 'number' || typeof env.type !== 'string') throw Error('Mensaje inválido.');
    if (Math.abs(this.now() - env.ts) > this.windowMs) throw Error('El reloj de este dispositivo está desfasado.');
    if (this.seen.has(env.id)) throw Error('Mensaje repetido.');
    this.seen.set(env.id, env.ts);
    if (this.seen.size > this.remember) this.seen.delete(this.seen.keys().next().value);
    return env;
  }
}

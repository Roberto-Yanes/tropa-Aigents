import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../engine.mjs';
import { Operations } from '../operations.mjs';
import { MobileGateway } from '../mobile/gateway.mjs';
import { createRelay } from '../relay/server.mjs';
import { startPairing, TropaClient } from '../protocol/client.mjs';
import { seal, open, envelope, newIdentity, decodeInvite, ReplayGuard } from '../protocol/crypto.mjs';

const wait = (ms = 30) => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 3000) { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn(); if (v) return v; await wait(15); } throw Error('Tiempo agotado esperando la condición.'); }

class FakeBrowser extends EventEmitter {
  constructor() { super(); this.open = []; this.decisions = []; }
  pendingApprovals() { return this.open; }
  decide(runId, pendingId, allow) { this.decisions.push({ runId, pendingId, allow }); this.open = this.open.filter(a => a.pendingId !== pendingId); return allow ? 'approved' : 'rejected'; }
  safeEmit(n, v) { this.emit(n, v); }
}

async function setup(t, invoke = async a => JSON.stringify({ accion: 'finalizar', mensaje: `Hola, soy ${a.name}` })) {
  const dir = mkdtempSync(join(tmpdir(), 'tropa-mobile-'));
  const pushes = [];
  const relay = createRelay({ dataDir: join(dir, 'relay'), push: async (token, kind) => { pushes.push({ token, kind }); } });
  const port = await relay.listen(0, '127.0.0.1');
  const engine = new Engine(join(dir, 'desktop'), invoke);
  const operations = new Operations(engine), browser = new FakeBrowser();
  const gateway = new MobileGateway({ engine, operations, browser, dir: join(dir, 'desktop'), relayUrl: `ws://127.0.0.1:${port}` });
  const clients = [];
  t.after(async () => { for (const c of clients) c.close(); await gateway.stop(); await engine.close(); await relay.close(); rmSync(dir, { recursive: true, force: true }); });
  const main = engine.createMain({ name: 'Atlas', provider: 'codex' });
  async function pair(name = 'iPhone de Rober') {
    const { link } = gateway.createInvite();
    await until(() => gateway.connected);
    const pairing = await startPairing(link, { name, platform: 'ios' });
    const pending = await until(() => gateway.status().invite?.pending);
    assert.equal(pending.code, pairing.code, 'both screens show the same code');
    gateway.confirmPairing(true);
    const paired = await pairing.confirmed;
    const events = [], presence = [];
    const client = new TropaClient({ ...paired, onEvent: e => events.push(e), onPresence: p => presence.push(p) });
    clients.push(client); await client.connect();
    await until(() => gateway.status().devices.find(d => d.id === paired.deviceId)?.online);
    return { client, paired, events, presence, link };
  }
  return { dir, relay, port, engine, operations, browser, gateway, main, pair, pushes, clients };
}

test('a phone pairs with the QR and the same 6-digit code, then talks to the main agent', async t => {
  const { gateway, main, pair, engine } = await setup(t);
  const { client, events } = await pair();
  const state = await client.call('state.get');
  assert.equal(state.mainTeamId, main.id); assert.equal(state.teams[0].agents[0].name, 'Atlas');
  const clientId = client.newClientId();
  const turn = await client.call('chat.send', { teamId: main.id, index: 0, text: 'Hola Atlas', clientId });
  await engine.active.get(turn.id)?.done;
  const again = await client.call('chat.send', { teamId: main.id, index: 0, text: 'Hola Atlas', clientId });
  assert.equal(again.id, turn.id, 'a repeated send never starts a second run');
  assert.equal(engine.chatRuns(main.id, 0).length, 1);
  await assert.rejects(client.call('chat.send', { teamId: main.id, index: 0, text: 'Otra cosa', clientId }), e => e.code === 'CONFLICT');
  const history = await client.call('chat.history', { teamId: main.id, index: 0 });
  assert.equal(history.turns[0].reply, 'Hola, soy Atlas');
  await until(() => events.some(e => e.kind === 'run' && e.runId === turn.id && e.status === 'completed'));
  assert.equal(engine.get(turn.id).source.channel, 'mobile');
  assert.equal(gateway.status().devices[0].name, 'iPhone de Rober');
});

test('the QR is single use and a wrong proof never pairs', async t => {
  const { gateway, pair } = await setup(t);
  const { link } = await pair();
  const second = await startPairing(link, { name: 'Intruso', platform: 'android' }).catch(e => e);
  await wait(150);
  assert.equal(gateway.status().invite, null, 'a used invitation cannot be confirmed again');
  if (second.cancel) { second.confirmed.catch(() => {}); second.cancel(); }
  // Fresh invite, forged proof: the desktop ignores it.
  const fresh = gateway.createInvite(); const inv = decodeInvite(fresh.link), me = newIdentity();
  const ws = new WebSocket(inv.relay);
  await new Promise(res => { ws.onmessage = e => { const f = JSON.parse(e.data); if (f.t === 'challenge') ws.send(JSON.stringify({ t: 'hello', v: 1, role: 'pair', room: inv.room, token: 'AAAA' })); else res(f); }; });
  ws.close();
  assert.equal(gateway.status().invite.pending, null);
  assert.equal(gateway.status().devices.length, 1);
});

test('events are recorded and a reconnecting phone catches up without duplicates', async t => {
  const { main, pair, engine } = await setup(t);
  const { client } = await pair();
  const { cursor } = await client.call('state.get');
  client.close(); await wait(50);
  const run = engine.chat(main.id, 0, 'mientras estaba desconectado'); await engine.active.get(run.id)?.done;
  await client.connect();
  const page = await until(async () => { const p = await client.call('events.since', { cursor }); return p.events.some(e => e.runId === run.id && e.status === 'completed') && p; });
  const seqs = page.events.map(e => e.seq);
  assert.deepEqual(seqs, [...new Set(seqs)].sort((a, b) => a - b));
  const next = await client.call('events.since', { cursor: page.cursor });
  assert.equal(next.events.length, 0);
});

test('a desktop chat emits enough information for the phone to refresh the correct conversation', async t => {
  const { main, pair, engine } = await setup(t);
  const { events } = await pair();
  const run=engine.chat(main.id,0,'Iniciado desde la computadora');
  await engine.active.get(run.id)?.done;
  const event=await until(()=>events.find(e=>e.runId===run.id&&e.status==='completed'));
  assert.equal(event.teamId,main.id);assert.equal(event.chatKind,'chat');assert.equal(event.index,0);
});

test('browser and flow approvals are listed, pushed and decided from the phone', async t => {
  const { gateway, pair, browser, engine, operations, pushes } = await setup(t);
  const team = engine.addTeam({ name: 'Ventas', agents: [{ name: 'Caro', provider: 'codex', instructions: 'Redacta' }] });
  const { client, events } = await pair();
  client.setPushToken('ExponentPushToken[abc123]'); await wait(50);
  const run = engine.chat(team.id, 0, 'abrí la web'); await engine.active.get(run.id)?.done;
  browser.open = [{ runId: run.id, pendingId: 'p1', action: { type: 'Completar campo', target: 'Correo', value: 'un-valor-privado-muy-largo-que-no-debe-salir-entero@example.com' }, url: 'https://example.com', agent: 'Caro' }];
  browser.safeEmit('approval:pending', { ...browser.open[0] });
  const ev = await until(() => events.find(e => e.kind === 'approval' && e.state === 'pending'));
  assert.ok(ev.value.length <= 41, 'only a short prefix of the value leaves the computer');
  const list = await client.call('approvals.list');
  assert.equal(list.approvals[0].pendingId, 'p1');
  const decided = await client.call('approvals.decide', { kind: 'browser', runId: run.id, pendingId: 'p1', allow: false, clientId: client.newClientId() });
  assert.equal(decided.result, 'rejected'); assert.deepEqual(browser.decisions, [{ runId: run.id, pendingId: 'p1', allow: false }]);
  await assert.rejects(client.call('approvals.decide', { kind: 'browser', runId: run.id, pendingId: 'p1', allow: true, clientId: client.newClientId() }), e => e.code === 'EXPIRED');
  // Flow approval while the phone is offline: a content-free push goes out.
  const flow = operations.save('workflows', { name: 'Con revisión', objective: 'x', nodes: [{ type: 'agent', teamId: team.id, index: 0 }, { type: 'approval', message: 'Revisá' }, { type: 'agent', teamId: team.id, index: 0 }] });
  client.close(); await until(() => !gateway.status().devices[0].online);
  const fr = operations.run('workflows', flow.id); await until(() => engine.get(fr.id).status === 'waiting');
  await until(() => pushes.some(p => p.kind === 'approval'));
  assert.deepEqual(pushes.at(-1), { token: 'ExponentPushToken[abc123]', kind: 'approval' });
  await client.connect();
  const pending = (await client.call('approvals.list')).approvals.find(a => a.kind === 'flow');
  const ok = await client.call('approvals.decide', { kind: 'flow', runId: fr.id, pendingId: pending.pendingId, allow: true, clientId: client.newClientId() });
  assert.equal(ok.result, 'approved');
  await until(() => engine.get(fr.id).status === 'completed');
});

test('a revoked phone is cut off at once and cannot reconnect', async t => {
  const { gateway, pair, relay } = await setup(t);
  const { client, paired } = await pair();
  let revoked = false; client.onRevoked = () => { revoked = true; };
  gateway.revoke(paired.deviceId);
  await until(() => revoked);
  const again = new TropaClient({ ...paired });
  await assert.rejects(again.connect(), e => e.code === 'REVOKED');
  assert.deepEqual(relay.rooms[gateway.room].allowed, []);
});

test('the phone has no admin powers and resuming needs confirmation', async t => {
  const { pair, main, engine } = await setup(t, async () => { throw Error('Sin cuota'); });
  const { client } = await pair();
  for (const method of ['teams.delete', 'teams.update', 'google.grant', 'device.pair', 'whatsapp.link'])
    await assert.rejects(client.call(method, {}), e => e.code === 'METHOD_NOT_FOUND');
  const turn = await client.call('chat.send', { teamId: main.id, index: 0, text: 'hola', clientId: client.newClientId() });
  await until(() => engine.get(turn.id).status === 'failed');
  await assert.rejects(client.call('runs.resume', { id: turn.id }), e => e.code === 'CONFIRM_REQUIRED');
  await assert.rejects(client.call('runs.get', { id: 'nada' }), e => e.code === 'INVALID');
});

test('files are downloaded in chunks and the desktop being off is reported', async t => {
  const big = 'x'.repeat(300 * 1024);
  const { pair, main, engine, gateway } = await setup(t, async (_a, _p, cwd) => { writeFileSync(join(cwd, 'informe.md'), big); return JSON.stringify({ accion: 'finalizar', mensaje: 'listo' }); });
  const { client, presence } = await pair();
  const turn = await client.call('chat.send', { teamId: main.id, index: 0, text: 'hacé el informe', clientId: client.newClientId() });
  await until(() => engine.get(turn.id).status === 'completed');
  const files = await client.call('files.list', { runId: turn.id });
  assert.deepEqual(files.files.map(f => f.name), ['informe.md']);
  const a = await client.call('files.get', { runId: turn.id, name: 'informe.md' });
  const b = await client.call('files.get', { runId: turn.id, name: 'informe.md', offset: a.offset + Buffer.from(a.data, 'base64').length });
  assert.equal(a.done, false); assert.equal(b.done, true);
  assert.equal(Buffer.concat([Buffer.from(a.data, 'base64'), Buffer.from(b.data, 'base64')]).toString(), big);
  await gateway.stop();
  await until(() => presence.at(-1) === false);
  await assert.rejects(client.call('state.get'), e => ['OFFLINE', 'NETWORK', 'TIMEOUT'].includes(e.code));
});

test('envelopes reject tampering, replays and stale clocks', () => {
  const a = newIdentity(), b = newIdentity();
  const env = envelope('rpc', { x: 1 }), sealed = seal(env, b.boxPk, a.boxSk);
  assert.deepEqual(open(sealed, a.boxPk, b.boxSk).body, { x: 1 });
  const bad = sealed.slice(0, -4) + (sealed.endsWith('AAAA') ? 'BBBB' : 'AAAA');
  assert.throws(() => open(bad, a.boxPk, b.boxSk), /descifrar/);
  const guard = new ReplayGuard();
  guard.check(env); assert.throws(() => guard.check(env), /repetido/);
  assert.throws(() => guard.check({ ...envelope('rpc', {}), ts: Date.now() - 600000 }), /desfasado/);
});

test('the desktop identity file is private', async t => {
  const { dir } = await setup(t);
  if (process.platform !== 'win32') assert.equal(statSync(join(dir, 'desktop', 'mobile', 'identity.json')).mode & 0o777, 0o600);
});

test('the mobile app ships the same protocol as the desktop', async t => {
  const { readFileSync, readdirSync, existsSync } = await import('node:fs');
  if (!process.env.TROPA_MOBILE_DIR) return t.skip('Set TROPA_MOBILE_DIR to a mobile checkout for cross-repository checks');
  const dir = join(process.env.TROPA_MOBILE_DIR, 'src/protocol');
  if (!existsSync(dir)) throw Error('TROPA_MOBILE_DIR no contiene el protocolo móvil');
  for (const f of readdirSync(new URL('../protocol/', import.meta.url)).filter(f => f.endsWith('.mjs'))) {
    const src = readFileSync(new URL(`../protocol/${f}`, import.meta.url), 'utf8').replace(/from '\.\/([\w-]+)\.mjs'/g, "from './$1'");
    const copy = readFileSync(join(dir, f.replace(/\.mjs$/, '.js')), 'utf8');
    assert.equal(copy.slice(copy.indexOf('\n') + 1), src, `${f} desincronizado: corré npm run sync-protocol en mobile-app`);
  }
});

test('the mobile app ships the same avatars and animations as the desktop', async t => {
  const { readFileSync, existsSync } = await import('node:fs');
  if (!process.env.TROPA_MOBILE_DIR) return t.skip('Set TROPA_MOBILE_DIR to a mobile checkout for cross-repository checks');
  const file = join(process.env.TROPA_MOBILE_DIR, 'src/avatars/generated.js');
  if (!existsSync(file)) throw Error('TROPA_MOBILE_DIR no contiene las animaciones móviles');
  const generated = readFileSync(file, 'utf8');
  const js = readFileSync(new URL('../public/tropa-animation.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../public/tropa-animaciones.css', import.meta.url), 'utf8');
  const hint = 'desincronizado: corré npm run sync en mobile-app';
  assert.ok(generated.includes(js.slice('window.tropaAnimation = '.length).replace(/;\s*$/, '')), `tropa-animation.js ${hint}`);
  assert.ok(generated.includes(JSON.stringify(css).slice(1, -1)), `tropa-animaciones.css ${hint}`);
  for (const group of ['personajes', 'formas', 'lapiz', 'garabatos'])
    for (let i = 0; i < 12; i++) assert.ok(generated.includes(`'${group}-${i}': require(`), `avatar ${group}-${i} ${hint}`);
});

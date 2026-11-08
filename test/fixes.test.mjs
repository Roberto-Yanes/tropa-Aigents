import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine, parseDecision } from '../engine.mjs';
import { VisualBrowser } from '../browser-service.mjs';
import { messageKind } from '../channels/transport-baileys.mjs';

test('decisions wrapped in extra CLI text are still understood', () => {
  assert.deepEqual(parseDecision('Pensando...\n{"accion":"finalizar","mensaje":"ok"}\nListo.'), { accion: 'finalizar', mensaje: 'ok' });
  assert.deepEqual(parseDecision('```json\n{"accion":"finalizar","mensaje":"ok"}\n```'), { accion: 'finalizar', mensaje: 'ok' });
  assert.throws(() => parseDecision('sin json'));
});

test('every stuck run is marked interrupted at startup, not only the latest 100', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'agents-fix-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let e = new Engine(dir, async () => 'ok');
  const team = { id: 'x', name: 'E', agents: [{ name: 'A', provider: 'demo', instructions: 'a' }] };
  e.db.prepare('INSERT INTO runs VALUES (?,?)').run('old', JSON.stringify({ id: 'old', status: 'running', steps: [], team, source: {} }));
  for (let i = 0; i < 120; i++) e.db.prepare('INSERT INTO runs VALUES (?,?)').run('n' + i, JSON.stringify({ id: 'n' + i, status: 'completed', steps: [], team }));
  await e.close(); e = new Engine(dir, async () => 'ok');
  assert.equal(e.get('old').status, 'interrupted');
  await e.close();
});

test('resuming a chat never runs beside a newer message of the same chat', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'agents-fix-'));
  let release;
  const e = new Engine(dir, (_a, p, _c, signal) => /primero/.test(p) ? Promise.reject(Error('Sin cuota')) : new Promise((resolve, reject) => { release = () => resolve(JSON.stringify({ accion: 'finalizar', mensaje: 'ok' })); signal.addEventListener('abort', () => reject(Error('x'))); }));
  t.after(async () => { await e.close(); rmSync(dir, { recursive: true, force: true }); });
  const team = e.addTeam({ name: 'E', agents: [{ name: 'Ana', provider: 'codex', instructions: 'a' }] });
  const first = e.chat(team.id, 0, 'primero'); await e.active.get(first.id).done;
  assert.equal(e.get(first.id).status, 'failed');
  const second = e.chat(team.id, 0, 'segundo');
  assert.throws(() => e.resume(first.id), /respuesta en curso/);
  release(); await e.active.get(second.id).done;
});

test('a finished run closes its isolated browser but keeps the last capture', async () => {
  const b = new VisualBrowser(() => 'http://127.0.0.1:1', null);
  let closed = 0;
  b.sessions.set('run', { context: { close: async () => { closed++; } }, url: 'https://example.com', image: 'img', history: [{ text: 'Abrió' }], refs: new Map(), pending: null, agent: 'Ana' });
  await b.retire('run');
  const state = b.state('run');
  assert.equal(closed, 1); assert.equal(state.open, false); assert.equal(state.image, 'img'); assert.equal(state.history.length, 1);
  await b.close('run'); assert.equal(closed, 1, 'never closes the same context twice');
  clearInterval(b.timer);
});

test('WhatsApp traffic is classified so only text and media are handled', () => {
  assert.equal(messageKind({ conversation: 'hola' }, 'hola'), 'text');
  assert.equal(messageKind({ reactionMessage: { text: '⏳' } }), 'reaction');
  assert.equal(messageKind({ protocolMessage: {} }), 'protocol');
  assert.equal(messageKind({ imageMessage: {} }), 'media');
  assert.equal(messageKind({}), 'protocol');
});

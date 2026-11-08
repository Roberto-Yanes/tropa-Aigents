import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../engine.mjs';
import { Operations } from '../operations.mjs';
import { VisualBrowser } from '../browser-service.mjs';

function setup(t, invoke) {
  const dir = mkdtempSync(join(tmpdir(), 'agents-flows-'));
  const calls = [];
  const engine = new Engine(dir, async (agent, prompt, cwd, signal, ctx) => { calls.push({ agent: agent.name, prompt, ctx }); return invoke(agent, prompt, calls.length); });
  t.after(async () => { await engine.close(); rmSync(dir, { recursive: true, force: true }); });
  const ops = new Operations(engine);
  const research = engine.addTeam({ name: 'Investigación', agents: [
    { name: 'Ana', provider: 'codex', instructions: 'Investiga' },
    { name: 'Beto', provider: 'claude', instructions: 'Resume' }] });
  const writing = engine.addTeam({ name: 'Redacción', agents: [{ name: 'Caro', provider: 'claude', instructions: 'Redacta' }] });
  return { engine, ops, calls, research, writing };
}
const done = async (engine, run) => { await engine.active.get(run.id)?.done; return engine.get(run.id); };

test('agent steps keep their own team, task and chosen input', async t => {
  const { engine, ops, calls, research, writing } = setup(t, a => `resultado de ${a.name}`);
  engine.setGoogleAccess(research.id, ['gmail'], 'yo@x.com');
  const flow = ops.save('workflows', { name: 'Informe', objective: 'Preparar informe', nodes: [
    { type: 'agent', teamId: research.id, index: 1, instruction: 'Buscá tres fuentes' },
    { type: 'agent', teamId: writing.id, index: 0, instruction: 'Redactá el borrador', input: 'last' },
    { type: 'agent', teamId: research.id, index: 0, instruction: 'Revisá', input: 'none' }] });
  const run = await done(engine, ops.run('workflows', flow.id));
  assert.equal(run.status, 'completed');
  assert.deepEqual(calls.map(c => c.agent), ['Beto', 'Caro', 'Ana']);
  assert.equal(calls[0].ctx.teamId, research.id, 'Google permissions follow the real team');
  assert.deepEqual(engine.googleAccess(calls[0].ctx.teamId, 'yo@x.com'), ['gmail']);
  assert.equal(calls[1].ctx.teamId, writing.id);
  assert.match(calls[0].prompt, /Buscá tres fuentes/);
  assert.match(calls[1].prompt, /Paso 1 · Beto · Investigación:\nresultado de Beto/);
  assert.doesNotMatch(calls[2].prompt, /resultado de (Beto|Caro)/);
  assert.deepEqual(run.steps.map(s => s.node), [0, 1, 2]);
});

test('team step lets the coordinator consult teammates inside the step', async t => {
  const { engine, ops, calls, research } = setup(t, (a, p) => {
    if (a.name === 'Ana' && !/Beto/.test(p.split('Contexto:')[1] || '')) return JSON.stringify({ accion: 'delegar', destinatario: 1, mensaje: '¿Qué encontraste?' });
    if (a.name === 'Beto') return JSON.stringify({ accion: 'finalizar', mensaje: 'Encontré dos datos' });
    return JSON.stringify({ accion: 'finalizar', mensaje: 'Síntesis del equipo' });
  });
  const flow = ops.save('workflows', { name: 'Equipo', objective: 'Analizar', nodes: [{ type: 'team', teamId: research.id, index: 0, instruction: 'Analizá el mercado' }] });
  const run = await done(engine, ops.run('workflows', flow.id));
  assert.equal(run.status, 'completed', run.error);
  assert.deepEqual(calls.map(c => c.agent), ['Ana', 'Beto', 'Ana']);
  assert.deepEqual(run.steps.map(s => s.kind), ['delegation', 'reply', 'node']);
  assert.equal(run.source.outputs[0], 'Síntesis del equipo');
});

test('conditions stop or jump; an AI condition explains its decision', async t => {
  const { engine, ops, calls, research, writing } = setup(t, (a, p, n) => {
    if (/Evaluá si se cumple/.test(p)) return JSON.stringify({ cumple: false, motivo: 'Falta el precio' });
    return a.name === 'Ana' ? 'Estado: APROBADO' : `texto ${n}`;
  });
  const nodes = (mode, value, extra = {}) => [
    { type: 'agent', teamId: research.id, index: 0 },
    { type: 'condition', mode, value, ...extra },
    { type: 'agent', teamId: writing.id, index: 0 },
    { type: 'agent', teamId: research.id, index: 1 }];
  let run = await done(engine, ops.run('workflows', ops.save('workflows', { name: 'A', objective: 'x', nodes: nodes('contains', 'aprobado') }).id));
  assert.deepEqual(run.steps.map(s => s.agent), ['Ana', 'Condición', 'Caro', 'Beto']);
  calls.length = 0;
  run = await done(engine, ops.run('workflows', ops.save('workflows', { name: 'B', objective: 'x', nodes: nodes('not_contains', 'aprobado') }).id));
  assert.equal(run.status, 'completed'); assert.deepEqual(calls.map(c => c.agent), ['Ana']); assert.match(run.steps.at(-1).output, /termina/);
  calls.length = 0;
  run = await done(engine, ops.run('workflows', ops.save('workflows', { name: 'C', objective: 'x', nodes: nodes('agent', '¿Incluye precio?', { teamId: writing.id, index: 0, onFalse: 'goto', target: 3 }) }).id));
  assert.deepEqual(calls.map(c => c.agent), ['Ana', 'Caro', 'Beto']);
  assert.match(run.steps[1].output, /Falta el precio. Salta al paso 4/);
  assert.throws(() => ops.save('workflows', { name: 'D', objective: 'x', nodes: nodes('contains', 'x', { onFalse: 'goto', target: 0 }) }), /paso posterior/);
});

test('approval pauses the flow, survives a restart and continues only when approved', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'agents-flows-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const calls = [];
  let engine = new Engine(dir, async a => { calls.push(a.name); return `hecho por ${a.name}`; });
  let ops = new Operations(engine);
  const team = engine.addTeam({ name: 'Equipo', agents: [{ name: 'Ana', provider: 'codex', instructions: 'x' }, { name: 'Beto', provider: 'codex', instructions: 'y' }] });
  const flow = ops.save('workflows', { name: 'Con revisión', objective: 'x', nodes: [
    { type: 'agent', teamId: team.id, index: 0 }, { type: 'approval', message: 'Revisá el borrador' }, { type: 'agent', teamId: team.id, index: 1 }] });
  let run = await done(engine, ops.run('workflows', flow.id));
  assert.equal(run.status, 'waiting'); assert.equal(run.waiting.message, 'Revisá el borrador'); assert.deepEqual(calls, ['Ana']);
  assert.throws(() => engine.resume(run.id), /no se puede continuar/);
  await engine.close(); engine = new Engine(dir, async a => { calls.push(a.name); return `hecho por ${a.name}`; }); ops = new Operations(engine);
  assert.equal(engine.get(run.id).status, 'waiting', 'a pause is not an interruption');
  run = await done(engine, engine.approve(run.id, true));
  assert.equal(run.status, 'completed'); assert.deepEqual(calls, ['Ana', 'Beto']);
  const second = await done(engine, ops.run('workflows', flow.id));
  const rejected = engine.approve(second.id, false);
  assert.equal(rejected.status, 'cancelled'); assert.deepEqual(calls, ['Ana', 'Beto', 'Ana']);
  await engine.close();
});

test('resume after a failure continues the same step without repeating earlier ones', async t => {
  let fail = true;
  const { engine, ops, calls, research, writing } = setup(t, a => { if (a.name === 'Caro' && fail) { fail = false; throw Error('Sin cuota'); } return 'ok'; });
  const flow = ops.save('workflows', { name: 'F', objective: 'x', nodes: [{ type: 'agent', teamId: research.id, index: 0 }, { type: 'agent', teamId: writing.id, index: 0 }] });
  let run = await done(engine, ops.run('workflows', flow.id));
  assert.equal(run.status, 'failed'); assert.equal(run.error, 'Sin cuota');
  run = await done(engine, engine.resume(run.id));
  assert.equal(run.status, 'completed'); assert.deepEqual(calls.map(c => c.agent), ['Ana', 'Caro', 'Caro']);
});

test('old flows keep working, and flows can be duplicated, deleted and scheduled', async t => {
  const { engine, ops, research } = setup(t, () => 'ok');
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  ops.put('workflows', { id, name: 'Viejo', objective: 'x', teamIds: [research.id] });
  const legacy = ops.get('workflows', id);
  assert.deepEqual(legacy.nodes.map(n => [n.type, n.index]), [['agent', 0], ['agent', 1]]);
  const run = await done(engine, ops.run('workflows', id));
  assert.equal(run.steps.length, 2);
  const copy = ops.duplicate('workflows', id);
  assert.equal(copy.name, 'Viejo (copia)'); assert.notEqual(copy.id, id); assert.equal(copy.nodes.length, 2);
  const schedule = ops.save('schedules', { name: 'Diario', targetKind: 'workflows', targetId: copy.id, nextAt: new Date(Date.now() + 60000).toISOString(), intervalMinutes: 1440 });
  assert.throws(() => ops.remove('workflows', copy.id), /programaciones/);
  ops.tick(Date.now() + 61000);
  const scheduled = ops.get('schedules', schedule.id);
  assert.equal(scheduled.enabled, true); assert.ok(scheduled.lastRunId);
  assert.equal(engine.get(scheduled.lastRunId).source.id, copy.id);
  await engine.active.get(scheduled.lastRunId)?.done;
  ops.remove('schedules', schedule.id); ops.remove('workflows', copy.id);
  assert.throws(() => ops.get('workflows', copy.id), /no encontrado/);
});

test('a busy engine postpones a schedule instead of disabling it', async t => {
  const { engine, ops, research } = setup(t, () => new Promise(() => {}));
  const routine = ops.save('routines', { name: 'R', objective: 'x', teamId: research.id });
  const s = ops.save('schedules', { name: 'S', routineId: routine.id, nextAt: new Date(Date.now() + 60000).toISOString() });
  const busy = engine.startSnapshot;
  engine.startSnapshot = () => { throw Object.assign(Error('El motor está ocupado o cerrado.'), { code: 'ENGINE_BUSY' }); };
  ops.tick(Date.now() + 61000);
  assert.equal(ops.get('schedules', s.id).enabled, true);
  engine.startSnapshot = busy;
  for (const c of engine.active.values()) c.abort();
});

test('routines run as the real team so its permissions apply', async t => {
  const { engine, ops, calls, research } = setup(t, () => 'ok');
  const routine = ops.save('routines', { name: 'R', objective: 'x', teamId: research.id });
  const run = await done(engine, ops.run('routines', routine.id));
  assert.equal(run.team.id, research.id); assert.equal(calls[0].ctx.teamId, research.id);
});

test('invalid flows are rejected with a clear message', async t => {
  const { ops, research } = setup(t, () => 'ok');
  assert.throws(() => ops.save('workflows', { name: 'X', objective: 'x', nodes: [] }), /al menos un paso/);
  assert.throws(() => ops.save('workflows', { name: 'X', objective: 'x', nodes: [{ type: 'approval' }] }), /agente o de equipo/);
  assert.throws(() => ops.save('workflows', { name: 'X', objective: 'x', nodes: [{ type: 'agent', teamId: research.id, index: 7 }] }), /agente ya no existe/);
  assert.throws(() => ops.save('workflows', { name: 'X', objective: 'x', nodes: [{ type: 'magia' }] }), /desconocido/);
});

test('a run switching browser modes never reuses the previous session', async () => {
  const b = new VisualBrowser(() => 'http://127.0.0.1:1', null);
  const closed = [];
  b.close = async id => { closed.push(id); b.sessions.delete(id); };
  b.sessions.set('run', { internal: true, history: [] });
  await b.session('run', { mode: 'existing', sites: ['https://example.com'] }).catch(() => {});
  assert.deepEqual(closed, ['run']);
  clearInterval(b.timer);
});

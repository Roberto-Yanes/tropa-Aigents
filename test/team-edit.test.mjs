import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../engine.mjs';
import { Operations } from '../operations.mjs';

function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'agents-edit-'));
  const engine = new Engine(dir, async a => JSON.stringify({ accion: 'finalizar', mensaje: `soy ${a.name}` }));
  t.after(async () => { await engine.close(); rmSync(dir, { recursive: true, force: true }); });
  const team = engine.addTeam({ name: 'Equipo', agents: [
    { name: 'Ana', provider: 'codex', instructions: 'a' }, { name: 'Beto', provider: 'codex', instructions: 'b' }, { name: 'Caro', provider: 'claude', instructions: 'c' }] });
  return { engine, ops: new Operations(engine), team };
}
const agent = (team, i, extra = {}) => ({ ...team.agents[i], from: i, ...extra });
const done = async (engine, run) => { await engine.active.get(run.id)?.done; return engine.get(run.id); };

test('editing keeps every chat attached to the same agent after a removal', async t => {
  const { engine, team } = setup(t);
  await done(engine, engine.chat(team.id, 0, 'hola Ana'));
  await done(engine, engine.chat(team.id, 1, 'hola Beto'));
  await done(engine, engine.chat(team.id, 2, 'hola Caro'));
  const updated = engine.updateTeam(team.id, { name: 'Equipo nuevo', agents: [agent(team, 0, { instructions: 'investiga mejor' }), agent(team, 2), { name: 'Dani', provider: 'codex', instructions: 'd' }] }).team;
  assert.deepEqual(updated.agents.map(a => a.name), ['Ana', 'Caro', 'Dani']);
  assert.equal(updated.agents[0].instructions, 'investiga mejor');
  assert.equal(updated.id, team.id);
  assert.deepEqual(engine.chatRuns(team.id, 0).map(r => r.source.message), ['hola Ana']);
  assert.deepEqual(engine.chatRuns(team.id, 1).map(r => r.source.message), ['hola Caro']);
  assert.deepEqual(engine.chatRuns(team.id, 2), [], 'the new agent starts with an empty chat');
  assert.equal(engine.runs().find(r => r.source.message === 'hola Beto').source.archivedIndex, 1);
});

test('flows follow the agent they pointed at and fail clearly for a removed one', async t => {
  const { engine, ops, team } = setup(t);
  const flow = ops.save('workflows', { name: 'F', objective: 'x', nodes: [{ type: 'agent', teamId: team.id, index: 2 }, { type: 'agent', teamId: team.id, index: 1 }] });
  const { map } = engine.updateTeam(team.id, { name: 'Equipo', agents: [agent(team, 0), agent(team, 2)] });
  ops.remapAgents(team.id, map);
  const nodes = ops.get('workflows', flow.id).nodes;
  assert.deepEqual(nodes.map(n => n.index), [1, -1]);
  assert.throws(() => ops.run('workflows', flow.id), /Paso 2: el agente ya no existe/);
});

test('invalid edits are rejected and the main agent stays a single agent', async t => {
  const { engine, team } = setup(t);
  assert.throws(() => engine.updateTeam(team.id, { name: 'X', agents: [agent(team, 2), agent(team, 0)] }), /orden/);
  assert.throws(() => engine.updateTeam(team.id, { name: 'X', agents: [{ name: 'N', provider: 'codex', instructions: 'n' }, agent(team, 0)] }), /al final/);
  const main = engine.createMain({ name: 'Atlas', provider: 'codex' });
  assert.throws(() => engine.updateTeam(main.id, { name: main.name, agents: [agent(main, 0), { name: 'Otro', provider: 'codex', instructions: 'x' }] }), /un solo agente/);
  assert.throws(() => engine.updateTeam(main.id, { name: main.name, agents: [agent(main, 0, { provider: 'demo' })] }), /cuenta de IA real/);
  const renamed = engine.updateTeam(main.id, { name: main.name, agents: [agent(main, 0, { name: 'Atlas 2' })] }).team;
  assert.equal(renamed.agents[0].name, 'Atlas 2'); assert.equal(engine.mainTeamId(), main.id);
  assert.throws(() => engine.deleteTeam(main.id), /no se puede borrar/);
});

test('teams cannot change while something runs and deleting removes their Google grant', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'agents-edit-'));
  const engine = new Engine(dir, (_a, _p, _c, signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Error('cancelado')))));
  t.after(async () => { await engine.close(); rmSync(dir, { recursive: true, force: true }); });
  const team = engine.addTeam({ name: 'Equipo', agents: [{ name: 'Ana', provider: 'codex', instructions: 'a' }] });
  engine.setGoogleAccess(team.id, ['gmail'], 'yo@x.com');
  const run = engine.chat(team.id, 0, 'hola');
  assert.throws(() => engine.updateTeam(team.id, { name: 'X', agents: [agent(team, 0)] }), /ejecuciones activas/);
  assert.throws(() => engine.deleteTeam(team.id), /ejecuciones activas/);
  engine.cancel(run.id); await engine.active.get(run.id)?.done;
  engine.deleteTeam(team.id);
  assert.equal(engine.teams().length, 0); assert.deepEqual(engine.googleAccess(team.id, 'yo@x.com'), []);
});

test('a team used by a routine or flow reports where it is used', async t => {
  const { ops, team } = setup(t);
  ops.save('routines', { name: 'Diaria', objective: 'x', teamId: team.id });
  ops.save('workflows', { name: 'Informe', objective: 'x', nodes: [{ type: 'agent', teamId: team.id, index: 0 }] });
  assert.deepEqual(ops.teamUsers(team.id), ['rutina «Diaria»', 'flujo «Informe»']);
});

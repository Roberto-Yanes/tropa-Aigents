import { finalText } from '../engine.mjs';
import { listFiles, readArtifact } from '../files.mjs';

const CHUNK = 256 * 1024;
const coded = (message, code, retryable = false) => Object.assign(Error(message), { code, retryable });
const cut = (v, n) => typeof v === 'string' ? (v.length > n ? v.slice(0, n) + '…' : v) : v;
const str = (v, name, max) => { if (typeof v !== 'string' || !v.trim() || v.length > max) throw coded(`${name}: valor vacío o demasiado largo.`, 'INVALID'); return v; };
const uuid = (v, name) => { if (typeof v !== 'string' || !/^[a-f0-9-]{36}$/.test(v)) throw coded(`${name}: identificador inválido.`, 'INVALID'); return v; };
const int = (v, name) => { const n = Number(v); if (!Number.isInteger(n) || n < 0) throw coded(`${name}: número inválido.`, 'INVALID'); return n; };

// Safe view of an approval: the value can be private, so only a prefix leaves the computer.
export function approvalView(a) {
  const action = a.action || {};
  return { kind: 'browser', runId: a.runId, pendingId: a.pendingId, agent: a.agent || '', type: cut(String(action.type || ''), 120), target: cut(String(action.target || ''), 250), destination: cut(String(action.destination || action.url || a.url || ''), 300), value: cut(String(action.value ?? ''), 40), session: action.session || '' };
}
export function runSummary(r) {
  return { id: r.id, status: r.status, title: r.team?.name || '', objective: cut(r.objective || r.source?.message || '', 200), kind: r.source?.kind || 'task', mode: r.source?.mode || null, teamId: r.source?.teamId ?? r.team?.id ?? null, index: r.source?.index ?? null, createdAt: r.createdAt, steps: r.steps?.length || 0, currentAgent: r.currentAgent || '', waiting: r.waiting || null, error: r.error || '', channel: r.source?.channel || null,
    progress: r.source?.mode === 'flow' ? { step: Math.min((r.source.cursor || 0) + 1, r.source.nodes.length), total: r.source.nodes.length } : null };
}
function runDetail(r) {
  const flow = r.source?.mode === 'flow';
  return { ...runSummary(r), objective: cut(r.objective || '', 12000), message: r.source?.message || null, reply: r.status === 'completed' || r.status === 'failed' ? finalText(r) : null,
    steps: (r.steps || []).map(s => ({ agent: s.agent, provider: s.provider || '', target: s.target || '', kind: s.kind || 'step', node: s.node ?? null, output: cut(s.output || '', 20000), completedAt: s.completedAt || null })),
    nodes: flow ? r.source.nodes.map((n, i) => ({ type: n.type, title: n.title, done: r.source.outputs[i] !== undefined })) : null };
}
function chatTurn(r) {
  return { id: r.id, status: r.status, message: r.source?.message || '', recipient: r.source?.index ?? 0, reply: ['completed', 'failed', 'cancelled', 'interrupted'].includes(r.status) ? (finalText(r) || r.error || '') : null, error: r.error || '', createdAt: r.createdAt, currentAgent: r.currentAgent || '',
    exchanges: (r.steps || []).filter(s => s.kind === 'delegation' || s.kind === 'reply').map(s => ({ from: s.agent, to: s.target, text: cut(s.output || '', 4000), kind: s.kind })) };
}
function translate(e) {
  const codes = { ENGINE_BUSY: ['BUSY', true], CHAT_PENDING: ['PENDING', true], MESSAGE_INVALID: ['INVALID', false], AGENT_NOT_FOUND: ['NOT_FOUND', false] };
  if (e.code && !codes[e.code]) return Object.assign(e, { retryable: !!e.retryable });
  const [code, retryable] = codes[e.code] || (/no encontrad|ya no existe|no está activa/i.test(e.message) ? ['NOT_FOUND', false] : /Esperá a que termine/.test(e.message) ? ['PENDING', true] : ['FAILED', false]);
  return coded(e.message, code, retryable);
}

// Every method calls the same engine functions as the desktop UI: the phone gets no extra powers.
export class MobileApi {
  constructor({ engine, operations, browser, store }) { Object.assign(this, { engine, operations, browser, store }); }
  team(id) { const t = this.engine.teams().find(x => x.id === id); if (!t) throw coded('Equipo no encontrado.', 'NOT_FOUND'); return t; }
  run(id) { try { return this.engine.get(uuid(id, 'Ejecución')); } catch (e) { throw e.code ? e : coded('Ejecución no encontrada.', 'NOT_FOUND'); } }
  approvals() {
    const browser = (this.browser?.pendingApprovals?.() || []).map(approvalView);
    const flows = this.engine.runs().filter(r => r.status === 'waiting' && r.waiting).map(r => ({ kind: 'flow', runId: r.id, pendingId: `flow:${r.waiting.node}`, agent: '', type: 'Aprobación de flujo', target: r.team?.name || '', destination: '', value: '', message: cut(r.waiting.message, 2000) }));
    return [...browser, ...flows];
  }
  async call(deviceId, method, params = {}) {
    if (!params || typeof params !== 'object' || Array.isArray(params)) throw coded('Parámetros inválidos.', 'INVALID');
    const fn = this.methods[method];
    if (!fn) throw coded('Operación no disponible desde el teléfono.', 'METHOD_NOT_FOUND');
    try { return await fn.call(this, params, deviceId); } catch (e) { throw translate(e); }
  }
  methods = {
    'state.get'() {
      return { mainTeamId: this.engine.mainTeamId(), cursor: this.store.lastSeq(),
        teams: this.engine.teams().map(t => ({ id: t.id, name: t.name, main: t.id === this.engine.mainTeamId(), agents: t.agents.map((a, index) => ({ index, name: a.name, provider: a.provider, avatar: a.avatar || null, tools: !!a.tools, browser: !!a.browser })) })),
        workflows: this.operations.list('workflows').map(w => ({ id: w.id, name: w.name, objective: cut(w.objective, 300), steps: w.nodes.length })),
        runs: this.engine.runs().slice(0, 30).map(runSummary), approvals: this.approvals() };
    },
    'chat.history'({ teamId, index }) { this.team(teamId); return { turns: this.engine.chatRuns(teamId, int(index, 'Agente')).slice(-30).map(chatTurn) }; },
    'chat.send'({ teamId, index, text, clientId }, deviceId) {
      return this.store.idempotent(deviceId, clientId, 'chat.send', { teamId, index, text }, () => chatTurn(this.engine.chat(teamId, int(index, 'Agente'), str(text, 'Mensaje', 4000), { channel: 'mobile', deviceId })));
    },
    'team.history'({ teamId }) { this.team(teamId); return { turns: this.engine.teamChatRuns(teamId).slice(-30).map(chatTurn) }; },
    'team.send'({ teamId, index = 0, text, clientId }, deviceId) {
      return this.store.idempotent(deviceId, clientId, 'team.send', { teamId, index, text }, () => chatTurn(this.engine.teamChat(teamId, str(text, 'Mensaje', 4000), int(index, 'Agente'), { channel: 'mobile', deviceId })));
    },
    'runs.list'({ limit = 30 } = {}) { return { runs: this.engine.runs().slice(0, Math.min(int(limit, 'Límite'), 100)).map(runSummary) }; },
    'runs.get'({ id }) { return runDetail(this.run(id)); },
    'runs.cancel'({ id }) { this.run(id); return runSummary(this.engine.cancel(id)); },
    'runs.resume'({ id, confirm }) {
      this.run(id);
      if (confirm !== true) throw coded('Reanudar puede repetir acciones externas. Confirmá para continuar.', 'CONFIRM_REQUIRED');
      return runSummary(this.engine.resume(id));
    },
    'flows.run'({ id, clientId }, deviceId) {
      return this.store.idempotent(deviceId, clientId, 'flows.run', { id }, () => runSummary(this.operations.run('workflows', uuid(id, 'Flujo'))));
    },
    'approvals.list'() { return { approvals: this.approvals() }; },
    'approvals.decide'({ kind, runId, pendingId, allow, clientId }, deviceId) {
      if (typeof allow !== 'boolean') throw coded('Decisión inválida.', 'INVALID');
      return this.store.idempotent(deviceId, clientId, 'approvals.decide', { kind, runId, pendingId, allow }, () => {
        this.run(runId);
        if (kind === 'flow') {
          const r = this.engine.get(runId);
          if (r.status !== 'waiting' || pendingId !== `flow:${r.waiting?.node}`) throw coded('Esa aprobación ya no está vigente.', 'EXPIRED');
          return { result: allow ? 'approved' : 'rejected', run: runSummary(this.engine.approve(runId, allow)) };
        }
        if (kind !== 'browser') throw coded('Tipo de aprobación inválido.', 'INVALID');
        const open = this.approvals().find(a => a.kind === 'browser' && a.runId === runId && a.pendingId === pendingId);
        if (!open) throw coded('Esa autorización ya no está vigente.', 'EXPIRED');
        return { result: this.browser.decide(runId, pendingId, allow) || (allow ? 'approved' : 'rejected') };
      });
    },
    'files.list'({ runId }) { this.run(runId); return { files: listFiles(this.engine.dir, runId) }; },
    'files.get'({ runId, name, offset = 0 }) {
      this.run(runId); str(name, 'Archivo', 500);
      let data; try { data = readArtifact(this.engine.dir, runId, name); } catch (e) { throw coded(e.message, 'NOT_FOUND'); }
      const start = int(offset, 'Posición'), part = data.subarray(start, start + CHUNK);
      return { name, size: data.length, offset: start, data: part.toString('base64'), done: start + part.length >= data.length };
    },
    'events.since'({ cursor = 0, limit = 200 }) { return this.store.eventsSince(int(cursor, 'Cursor'), int(limit, 'Límite')); },
  };
}

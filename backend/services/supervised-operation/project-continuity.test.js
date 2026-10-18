'use strict';
// Cliente Cero real test (18/10/2026): asked for the state and decisions of
// Cliente Cero, or explicitly for the continuity registry and two of its
// fronts, V3 answered "He consultado tu memoria y no he encontrado
// resultados". V3 had no project source, so the decider planned the only
// internal one: personal memory. Project continuity is now answered from the
// canonical registry (orchestration/CONTINUITY-REGISTRY.json) as recorded,
// with its date and evidence, never from personal memory nor from a model,
// and only for Cliente Cero.
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const http = require('node:http'); const { randomBytes } = require('node:crypto');
const { createServerComposition } = require('./server-composition');
const { interpretIntention } = require('./intention-interpreter');
const { createExecutiveAuthorizer } = require('../../security/executive-authorization');
const { answerContinuityQuery } = require('../../projects/continuity-registry');

const OWNER = 'fixture-owner-a'; const FAMILY = 'fixture-family-b';
const authorize = createExecutiveAuthorizer({ OXKIO_ADMIN_FIREBASE_UIDS: OWNER, OXKIO_FAMILY_FIREBASE_UIDS: FAMILY });
const POLICY = { publicExternalAllowed: true, internalProviders: [{ providerId: 'fixture' }], confidentialProviders: [] };
const MEMORY_EMPTY = 'He consultado tu memoria y no he encontrado resultados.';
const entry = (id, title, state, fields = {}) => ({ id, title, aliases: [], state, priority: 'P1', decision: 'Decisión de ' + id + '.', nextAction: 'Siguiente de ' + id + '.', reopenCondition: 'No aplica.', confidence: 'high', blockedBy: null, updatedAt: '2026-10-17T18:44:23.227Z', evidence: [], ...fields });
// The registry as it stood on 17/10: both fronts BLOCKED although their PRs
// merged on 18/10. OXKIO must report the record, not certify what it lacks.
const REGISTRY = {
 revision: 25, updatedAt: '2026-10-17T18:44:23.294Z',
 entries: [
  entry('CZ-PG-RLS-REAL', 'Approval PostgreSQL con RLS real en CI', 'BLOCKED', { aliases: ['postgresql rls', 'rls real'], blockedBy: 'merge de la PR #51', evidence: [{ ref: 'gh:run/39049802907', kind: 'ci_failure', result: 'failure', observedAt: '2026-10-17T10:00:00Z' }, { ref: 'gh:pr/51', kind: 'ci_green', result: 'success', observedAt: '2026-10-17T18:40:00Z' }] }),
  entry('CZ-CONTINUITY-PREFLIGHT', 'Registro de continuidad y preflight', 'BLOCKED', { aliases: ['registro de continuidad', 'preflight de continuidad'], blockedBy: 'merge de la PR #52', evidence: [{ ref: 'gh:pr/52', kind: 'ci_green', result: 'success', observedAt: '2026-10-17T18:44:00Z' }] }),
  entry('CZ-LEDGER-PID', 'Ledger con identidad de proceso', 'CLOSED', { evidence: [{ ref: 'gh:pr/46', kind: 'ci_green', result: 'success', observedAt: '2026-10-16T12:00:00Z' }] }),
  entry('CZ-ROADMAP-STALE', 'ROADMAP desactualizado', 'BACKLOG', { priority: 'P2' }),
 ],
};
const NOW = '2026-10-18T13:30:00.000Z';

function decider() { const calls = []; const modelId = 'fixture:luna'; return { status: 'ready', provider: 'fixture', region: 'eu', modelId, calls,
 catalog: { [modelId]: { provider: 'fixture', tier: 'small_model', inputUsdPerMillion: 0.2, outputUsdPerMillion: 1.2, residency: 'eu', privacy: 'fixture', pricingVersion: 'f', pricingSource: 'f', reviewedAt: '2026-10-04' } },
 // The failing production decision: every unmatched question planned as memory.
 async reason(request) { calls.push(request); return { status: 'ok', content: { action: 'plan', plan: [{ key: 's0', capability: 'memory.search', dependsOn: [] }] }, usage: { inputTokens: 400, outputTokens: 120 } }; } }; }
async function setup({ uid = OWNER, projectContinuity = () => REGISTRY } = {}) {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v3-continuity-')); const p = decider(); const reads = [];
 const reader = projectContinuity && (() => { reads.push(1); return projectContinuity(); });
 const c = createServerComposition({ enabled: true, cohortUids: [OWNER, FAMILY].join(','), memoryRoot: root, integrityKey: randomBytes(32), authorizeIdentity: authorize, projectContinuity: reader, reasoning: { providers: [p], requestPrivacyFloor: 'INTERNAL', privacyPolicy: POLICY, approvedDailyBudgetUsd: 0.9 } });
 const server = http.createServer((req, res) => { req.oxkioIdentity = authorize({ uid }).identity; c.handle(req, res); });
 await new Promise(r => server.listen(0, '127.0.0.1', r)); const port = server.address().port;
 const ask = query => new Promise((resolve, reject) => { const body = JSON.stringify({ query, includeDetails: true }); const req = http.request({ host: '127.0.0.1', port, path: '/api/executive/chat', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, res => { let d = ''; res.on('data', s => d += s); res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(d || '{}') })); }); req.on('error', reject); req.end(body); });
 return { ask, p, reads, close: async () => { await new Promise(r => server.close(r)); fs.rmSync(root, { recursive: true, force: true }); } };
}

test('reproduction 1: the general question about Cliente Cero is answered from the registry, not from personal memory nor a model', async () => {
 const s = await setup();
 try {
  const r = await s.ask('¿Cuál es el estado de Cliente Cero y qué decisiones hay tomadas?');
  assert.equal(r.status, 200); assert.notEqual(r.data.response, MEMORY_EMPTY); assert.doesNotMatch(r.data.response, /He consultado tu memoria/);
  assert.equal(r.data.details.mode, 'PROJECT_CONTINUITY'); assert.equal(s.p.calls.length, 0, 'no model call'); assert.equal(s.reads.length, 1);
  assert.match(r.data.response, /registro de continuidad \(revisión 25, actualizado el 17\/10\/2026\)/i);
  assert.match(r.data.response, /1 cerrado, 0 pendientes, 2 bloqueados y 1 en backlog/);
  assert.match(r.data.response, /CZ-PG-RLS-REAL — Approval PostgreSQL con RLS real en CI: bloqueado \(P1, confianza alta\)/);
  assert.match(r.data.response, /Decisión: Decisión de CZ-PG-RLS-REAL\./);
  // Open fronts in the registry's own priority order; closed and backlog ones are only counted.
  assert.deepEqual(r.data.details.continuity.ids, ['CZ-CONTINUITY-PREFLIGHT', 'CZ-PG-RLS-REAL']);
  assert.doesNotMatch(r.data.response, /CZ-LEDGER-PID|CZ-ROADMAP-STALE/);
 } finally { await s.close(); }
});

test('reproduction 2: the explicit question cites each named front as recorded, with its evidence, and certifies nothing newer', async () => {
 const s = await setup();
 try {
  const r = await s.ask('¿Qué dice el registro de continuidad sobre los hitos CZ-PG-RLS-REAL y CZ-CONTINUITY-PREFLIGHT?');
  const text = r.data.response;
  assert.notEqual(text, MEMORY_EMPTY); assert.equal(s.p.calls.length, 0);
  assert.deepEqual(r.data.details.continuity.ids, ['CZ-PG-RLS-REAL', 'CZ-CONTINUITY-PREFLIGHT']);
  assert.match(text, /CZ-PG-RLS-REAL — Approval PostgreSQL con RLS real en CI: bloqueado \(P1, confianza alta\), registrado el 17\/10\/2026\. Bloqueado por: merge de la PR #51\./);
  assert.match(text, /Evidencia: gh:run\/39049802907 \(ci_failure, failure, 17\/10\/2026\); gh:pr\/51 \(ci_green, success, 17\/10\/2026\)\./);
  assert.match(text, /CZ-CONTINUITY-PREFLIGHT — Registro de continuidad y preflight: bloqueado/);
  // Recorded BLOCKED is never turned into closed, merged or done.
  assert.doesNotMatch(text, /CZ-PG-RLS-REAL[^\n]*(cerrado|completad|mergead|resuelt)/i);
  assert.match(text, /Es el estado registrado, no una comprobación en vivo/); assert.match(text, /No he consultado tu memoria personal ni he cambiado nada\./);
  assert.doesNotMatch(text, /CZ-LEDGER-PID|CZ-ROADMAP-STALE/, 'only the fronts that were asked');
 } finally { await s.close(); }
});

test('an id that the registry does not hold is said to be missing, never described', () => {
 const a = answerContinuityQuery({ registry: REGISTRY, query: '¿En qué estado está CZ-NO-EXISTE?', now: NOW });
 assert.deepEqual(a.ids, []); assert.deepEqual(a.missing, ['CZ-NO-EXISTE']);
 assert.match(a.text, /CZ-NO-EXISTE no figura en el registro de continuidad\./);
});

test('a registry not updated for more than a day is flagged as possibly outdated', () => {
 const fresh = answerContinuityQuery({ registry: REGISTRY, query: 'estado de Cliente Cero', now: '2026-10-17T20:00:00.000Z' });
 assert.equal(fresh.stale, false); assert.doesNotMatch(fresh.text, /desactualizado/);
 const old = answerContinuityQuery({ registry: REGISTRY, query: 'estado de Cliente Cero', now: '2026-10-20T20:00:00.000Z' });
 assert.equal(old.stale, true); assert.match(old.text, /no se actualiza desde hace 3 días: puede estar desactualizado/);
});

test('personal memory stays personal memory: questions about what the person said never reach the registry', async () => {
 const s = await setup();
 try {
  const r = await s.ask('¿Recuerdas lo que te dije sobre la cena del sábado?');
  assert.equal(r.data.response, MEMORY_EMPTY); assert.notEqual(r.data.details.mode, 'PROJECT_CONTINUITY'); assert.equal(s.reads.length, 0);
 } finally { await s.close(); }
 for (const q of ['¿Recuerdas lo que te dije de Cliente Cero?', 'Recuerda que la decisión de Cliente Cero es esperar', '¿Qué tengo mañana en la agenda?', '¿Cuál es tu estado operativo?', 'Estado de mi proyecto de cocina'])
  assert.notEqual(interpretIntention(q).reason, 'project_continuity', q);
 for (const q of ['¿Qué dice el registro de continuidad?', 'Estado de CZ-RUNTIME-SYNC', 'Decisiones de Cliente Cero', '¿Qué frentes bloqueados tiene OXKIO?', '¿Qué recuerdas del registro de continuidad?'])
  assert.equal(interpretIntention(q).reason, 'project_continuity', q);
});

test('isolation: a family member never receives the project registry', async () => {
 const s = await setup({ uid: FAMILY });
 try {
  const r = await s.ask('¿Qué dice el registro de continuidad sobre CZ-PG-RLS-REAL?');
  assert.equal(r.status, 200); assert.equal(s.reads.length, 0, 'the registry is not even read');
  assert.doesNotMatch(r.data.response, /CZ-PG-RLS-REAL —|bloqueado|revisión 25/); assert.match(r.data.response, /No tengo acceso al registro de continuidad del proyecto/);
 } finally { await s.close(); }
});

test('an unavailable registry is reported as such, never as personal memory nor as an empty all-clear', async () => {
 for (const projectContinuity of [null, () => { throw Object.assign(new Error('x'), { code: 'registry_invalid' }); }]) {
  const s = await setup({ projectContinuity });
  try {
   const r = await s.ask('Estado y decisiones de Cliente Cero');
   assert.notEqual(r.data.response, MEMORY_EMPTY); assert.equal(s.p.calls.length, 0);
   assert.match(r.data.response, /No tengo acceso al registro de continuidad del proyecto, así que no puedo darte su estado\. No lo he buscado en tu memoria personal, que no es donde está\./);
  } finally { await s.close(); }
 }
});

test('changing the registry from the chat is still an action that needs approval', () => {
 assert.equal(interpretIntention('Actualiza el registro de continuidad con el merge de la PR #52').outcome, 'NEEDS_APPROVAL');
});

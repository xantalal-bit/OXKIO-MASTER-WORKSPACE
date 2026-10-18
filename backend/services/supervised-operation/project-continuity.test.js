'use strict';
// Cliente Cero (18/10/2026). First real test: asked for the state and
// decisions of Cliente Cero, or for the continuity registry and two of its
// fronts, V3 answered "He consultado tu memoria y no he encontrado
// resultados" (PR #55). Second step: the answer reads like an executive
// summary first and keeps two layers apart — the state recorded in the
// registry and the latest verified evidence — saying when they disagree and
// certifying neither. Personal memory, operational knowledge and live checks
// stay distinct; no model states a front's status; only Cliente Cero reads it.
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
const RAW = /\b(?:BLOCKED|PENDING|CLOSED|BACKLOG|ci_green|ci_failure|real_test|pr_merged|test_failure)\b/;
const ev = (ref, kind, result, observedAt, source = 'github') => ({ ref, kind, result, observedAt, source, summary: `${kind} ${ref}` });
const entry = (id, title, state, fields = {}) => ({ id, title, aliases: [], state, priority: 'P1', decision: 'Decisión de ' + id + '.', nextAction: 'Siguiente de ' + id + '.', reopenCondition: 'No aplica.', confidence: 'high', requiresRealTest: false, updatedAt: '2026-10-18T13:51:44.000Z', evidence: [], ...fields });
// The registry after the reconciliation of 18/10: real shapes, fixture text.
const REGISTRY = Object.freeze({
 revision: 33, updatedAt: '2026-10-18T13:51:44.000Z',
 entries: [
  entry('CZ-PG-RLS-REAL', 'Approval contra PostgreSQL/RLS real', 'CLOSED', { aliases: ['postgresql rls', 'postgres rls'], requiresRealTest: true, signals: ['approval-postgres-integration'], evidence: [
   ev('ci:39058177785#approval-postgres-integration', 'ci_failure', 'failure', '2026-10-17T18:28:26Z', 'github-actions:feat'), ev('pr:51#merge', 'pr_merged', 'success', '2026-10-17T18:59:20Z'),
   ev('ci:39124465439#approval-postgres-integration', 'ci_green', 'success', '2026-10-18T11:45:33Z', 'github-actions:main@9b05eb5'), ev('realpg:ci-39124465439', 'real_test', 'success', '2026-10-18T11:45:31Z', 'github-actions:main@9b05eb5')] }),
  entry('CZ-CONTINUITY-PREFLIGHT', 'Preflight de continuidad antes de planificar', 'CLOSED', { aliases: ['registro de continuidad', 'preflight de continuidad'], confidence: 'medium', requiresRealTest: true, evidence: [
   ev('dogfood:cz-20261017', 'real_test', 'success', '2026-10-17T18:06:00Z'), ev('pr:52#merge', 'pr_merged', 'success', '2026-10-18T08:02:25Z'), ev('ci:39109919092#backend-tests', 'ci_green', 'success', '2026-10-18T08:10:16Z', 'github-actions:main@f97910b')] }),
  entry('CZ-RUNTIME-SYNC', 'Sincronización del runtime local', 'BLOCKED', { aliases: ['runtime local'], requiresRealTest: true, blockedBy: 'puerta humana: prueba autenticada de Cliente Cero', evidence: [
   ev('local:window-20261018-1534', 'observation', 'info', '2026-10-18T13:34:44Z', 'ventana local'), ev('ci:39124465439#backend-tests', 'ci_green', 'success', '2026-10-18T11:52:02Z', 'github-actions:main@9b05eb5')] }),
  entry('CZ-V3-CHAT-CONTINUITY', 'Continuidad en el chat V3', 'BLOCKED', { requiresRealTest: true, blockedBy: 'puerta humana: prueba autenticada de Cliente Cero', evidence: [
   ev('pr:55#defect', 'defect', 'failure', '2026-10-18T11:30:52Z'), ev('pr:55', 'pr_merged', 'success', '2026-10-18T11:44:38Z'), ev('ci:39124465439#backend-tests', 'ci_green', 'success', '2026-10-18T11:52:02Z')] }),
  // Disagreements between the layers, for the tests that must surface them.
  entry('CZ-READY-UNRECONCILED', 'Frente con criterios cumplidos', 'PENDING', { priority: 'P2', evidence: [ev('pr:60', 'pr_merged', 'success', '2026-10-18T09:00:00Z'), ev('ci:600#backend-tests', 'ci_green', 'success', '2026-10-18T09:10:00Z')] }),
  entry('CZ-REGRESSED', 'Frente cerrado con un fallo posterior', 'CLOSED', { priority: 'P2', evidence: [ev('pr:61', 'pr_merged', 'success', '2026-10-17T09:00:00Z'), ev('ci:610#backend-tests', 'ci_green', 'success', '2026-10-17T09:10:00Z'), ev('ci:611#backend-tests', 'ci_failure', 'failure', '2026-10-18T10:00:00Z')] }),
  entry('CZ-ROADMAP-STALE', 'ROADMAP desactualizado', 'BACKLOG', { priority: 'P2' }),
 ],
});
const NOW = '2026-10-18T14:00:00.000Z';

function decider(content = () => ({ action: 'plan', plan: [{ key: 's0', capability: 'memory.search', dependsOn: [] }] })) { const calls = []; const modelId = 'fixture:luna'; return { status: 'ready', provider: 'fixture', region: 'eu', modelId, calls,
 catalog: { [modelId]: { provider: 'fixture', tier: 'small_model', inputUsdPerMillion: 0.2, outputUsdPerMillion: 1.2, residency: 'eu', privacy: 'fixture', pricingVersion: 'f', pricingSource: 'f', reviewedAt: '2026-10-04' } },
 // By default, the failing production decision: every unmatched question planned as memory.
 async reason(request) { calls.push(request); return { status: 'ok', content: content(request), usage: { inputTokens: 400, outputTokens: 120 } }; } }; }
async function setup({ projectContinuity = () => REGISTRY, content } = {}) {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v3-continuity-')); const p = decider(content); const reads = [];
 const reader = projectContinuity && (() => { reads.push(1); return projectContinuity(); });
 const c = createServerComposition({ enabled: true, cohortUids: [OWNER, FAMILY].join(','), memoryRoot: root, integrityKey: randomBytes(32), authorizeIdentity: authorize, projectContinuity: reader, reasoning: { providers: [p], requestPrivacyFloor: 'INTERNAL', privacyPolicy: POLICY, approvedDailyBudgetUsd: 0.9 } });
 const server = http.createServer((req, res) => { req.oxkioIdentity = authorize({ uid: req.headers['x-fixture-uid'] }).identity; c.handle(req, res); });
 await new Promise(r => server.listen(0, '127.0.0.1', r)); const port = server.address().port;
 const ask = (query, uid = OWNER) => new Promise((resolve, reject) => { const body = JSON.stringify({ query, includeDetails: true }); const req = http.request({ host: '127.0.0.1', port, path: '/api/executive/chat', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'x-fixture-uid': uid } }, res => { let d = ''; res.on('data', s => d += s); res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(d || '{}') })); }); req.on('error', reject); req.end(body); });
 return { ask, p, reads, close: async () => { await new Promise(r => server.close(r)); fs.rmSync(root, { recursive: true, force: true }); } };
}
const firstLine = text => text.split('\n')[0];

test('reproduction 1: the general question gets an executive summary first, from the registry, with no model', async () => {
 const s = await setup();
 try {
  const r = await s.ask('¿Cuál es el estado de Cliente Cero y qué decisiones hay tomadas?'); const text = r.data.response;
  assert.equal(r.status, 200); assert.notEqual(text, MEMORY_EMPTY); assert.doesNotMatch(text, /He consultado tu memoria/);
  assert.equal(r.data.details.mode, 'PROJECT_CONTINUITY'); assert.equal(r.data.details.continuity.source, 'CONTINUITY_REGISTRY'); assert.equal(s.p.calls.length, 0, 'no model call'); assert.equal(s.reads.length, 1);
  assert.equal(firstLine(text), 'En resumen: hay 3 frentes abiertos (2 bloqueados y 1 pendiente). Lo más prioritario es CZ-RUNTIME-SYNC (Sincronización del runtime local), que espera una acción tuya: prueba autenticada de Cliente Cero.');
  // The disagreements between the layers are named even when not listed.
  assert.match(text, /Además, CZ-REGRESSED está cerrado, aunque hay un fallo posterior a su cierre que el registro todavía no ha reconciliado\./);
  assert.match(text, /- CZ-RUNTIME-SYNC — Sincronización del runtime local: bloqueado; falta el merge y una prueba real\./);
  assert.match(text, /- CZ-V3-CHAT-CONTINUITY — Continuidad en el chat V3: bloqueado; falta una prueba real posterior al último fallo\./);
  assert.match(text, /pregúntame por su código \(por ejemplo, CZ-RUNTIME-SYNC\)/);
  assert.doesNotMatch(text, /Evidencia verificada|ci:\d|pr:\d/, 'refs only on request'); assert.doesNotMatch(text, RAW);
  assert.match(text, /Fuente: registro de continuidad \(revisión 33, actualizado el 18\/10\/2026\)\. Es conocimiento operativo registrado, no tu memoria personal ni una comprobación en vivo/);
 } finally { await s.close(); }
});

test('reproduction 2: named fronts get both layers, apart and traceable, and nothing newer is certified', async () => {
 const s = await setup();
 try {
  const r = await s.ask('¿Qué dice el registro de continuidad sobre los hitos CZ-PG-RLS-REAL y CZ-CONTINUITY-PREFLIGHT?'); const text = r.data.response;
  assert.equal(s.p.calls.length, 0); assert.deepEqual(r.data.details.continuity.ids, ['CZ-PG-RLS-REAL', 'CZ-CONTINUITY-PREFLIGHT']);
  assert.equal(firstLine(text), 'En resumen: CZ-PG-RLS-REAL está cerrado y CZ-CONTINUITY-PREFLIGHT está cerrado.');
  assert.match(text, /CZ-PG-RLS-REAL — Approval contra PostgreSQL\/RLS real\n· Estado registrado \(18\/10\/2026\): cerrado, prioridad P1, confianza alta\. Decisión: Decisión de CZ-PG-RLS-REAL\. Siguiente acción: Siguiente de CZ-PG-RLS-REAL\.\n· Evidencia verificada más reciente: CI en verde el 18\/10\/2026 \(ci:39124465439#approval-postgres-integration; github-actions:main@9b05eb5\); prueba real superada el 18\/10\/2026 \(realpg:ci-39124465439; github-actions:main@9b05eb5\)\./);
  assert.match(text, /CZ-CONTINUITY-PREFLIGHT — Preflight de continuidad antes de planificar\n· Estado registrado \(18\/10\/2026\): cerrado, prioridad P1, confianza media/);
  assert.doesNotMatch(text, /CZ-RUNTIME-SYNC/, 'only the fronts that were asked, plus disagreements elsewhere');
  assert.match(text, /Además, CZ-READY-UNRECONCILED está pendiente, aunque su evidencia ya cumple/);
 } finally { await s.close(); }
});

test('two layers never merge: met criteria are not a closure, and a later failure is not hidden by a closure', () => {
 const ready = answerContinuityQuery({ registry: REGISTRY, query: 'Estado de CZ-READY-UNRECONCILED', now: NOW });
 assert.equal(ready.summary, 'En resumen: CZ-READY-UNRECONCILED está pendiente, aunque su evidencia ya cumple los criterios de cierre y el registro aún no lo ha cerrado: queda pendiente de reconciliar.');
 assert.deepEqual(ready.fronts, [{ id: 'CZ-READY-UNRECONCILED', state: 'PENDING', gaps: [], conflict: 'closable' }]);
 assert.doesNotMatch(ready.text, /CZ-READY-UNRECONCILED está cerrado/);
 const regressed = answerContinuityQuery({ registry: REGISTRY, query: 'Estado de CZ-REGRESSED', now: NOW });
 assert.equal(regressed.summary, 'En resumen: CZ-REGRESSED está cerrado, aunque hay un fallo posterior a su cierre que el registro todavía no ha reconciliado.');
 assert.match(regressed.text, /· Evidencia verificada más reciente: fallo de CI el 18\/10\/2026 \(ci:611#backend-tests; github\); CI en verde el 17\/10\/2026/);
 assert.match(regressed.text, /· Atención: hay un fallo posterior a su cierre/);
 // A green run newer than the failure answers it: no conflict is left.
 const answered = { ...REGISTRY, entries: [entry('CZ-REGRESSED', 'x', 'CLOSED', { evidence: [ev('pr:61', 'pr_merged', 'success', '2026-10-17T09:00:00Z'), ev('ci:611#backend-tests', 'ci_failure', 'failure', '2026-10-18T10:00:00Z'), ev('ci:612#backend-tests', 'ci_green', 'success', '2026-10-18T11:00:00Z')] })] };
 assert.deepEqual(answerContinuityQuery({ registry: answered, query: 'CZ-REGRESSED', now: NOW }).conflicts, []);
});

test('naturalness: summary first and short, plain words, detail only when asked or a front is named', () => {
 const general = answerContinuityQuery({ registry: REGISTRY, query: '¿Cómo va Cliente Cero?', now: NOW });
 assert.match(general.summary, /^En resumen: /); assert.ok(general.summary.length <= 240, general.summary.length); assert.equal(general.detail, false);
 assert.doesNotMatch(general.text, RAW); assert.doesNotMatch(general.text, /Estado registrado|Evidencia verificada/);
 const asked = answerContinuityQuery({ registry: REGISTRY, query: '¿Cómo va Cliente Cero? Dame el detalle con las evidencias', now: NOW });
 assert.equal(asked.detail, true); assert.match(asked.text, /· Estado registrado/); assert.match(asked.text, /· Evidencia verificada más reciente/);
 assert.doesNotMatch(asked.text, RAW, 'evidence kinds are told in words');
});

test('freshness: an id the registry lacks is named, and a registry older than a day is flagged', () => {
 const missing = answerContinuityQuery({ registry: REGISTRY, query: '¿En qué estado está CZ-NO-EXISTE?', now: NOW });
 assert.deepEqual(missing.ids, []); assert.deepEqual(missing.missing, ['CZ-NO-EXISTE']);
 assert.match(missing.summary, /^En resumen: CZ-NO-EXISTE no figura en el registro\.$/);
 assert.equal(answerContinuityQuery({ registry: REGISTRY, query: 'estado de Cliente Cero', now: NOW }).stale, false);
 const old = answerContinuityQuery({ registry: REGISTRY, query: 'estado de Cliente Cero', now: '2026-10-21T15:00:00.000Z' });
 assert.equal(old.stale, true); assert.match(old.text, /El registro no se actualiza desde hace 3 días: puede estar desactualizado\./);
});

test('a front named by its title or alias reaches the registry instead of personal memory', async () => {
 const s = await setup();
 try {
  const r = await s.ask('¿Cómo va lo de postgres rls?');
  assert.equal(r.data.details.mode, 'PROJECT_CONTINUITY'); assert.equal(s.p.calls.length, 0);
  assert.equal(firstLine(r.data.response), 'En resumen: CZ-PG-RLS-REAL está cerrado.');
  // Nothing to do with a front: the ordinary conversation, untouched.
  const other = await s.ask('¿Qué me recomiendas para organizar la semana?');
  assert.notEqual(other.data.details.mode, 'PROJECT_CONTINUITY'); assert.ok(s.p.calls.length >= 1, 'the ordinary decider path');
 } finally { await s.close(); }
});

test('personal memory, operational knowledge and orders stay apart', async () => {
 const s = await setup();
 try {
  const memory = await s.ask('¿Recuerdas lo que te dije sobre la cena del sábado?');
  assert.equal(memory.data.response, MEMORY_EMPTY); assert.notEqual(memory.data.details.mode, 'PROJECT_CONTINUITY'); assert.equal(s.reads.length, 0);
  const recall = await s.ask('¿Recuerdas lo que te dije del runtime local?');
  assert.notEqual(recall.data.details.mode, 'PROJECT_CONTINUITY', 'what the person said is memory, even about a front');
  // "Close it" is answered as a read: the record is not changed from the chat.
  const order = await s.ask('Cierra CZ-RUNTIME-SYNC');
  assert.equal(order.data.details.mode, 'PROJECT_CONTINUITY'); assert.match(order.data.response, /CZ-RUNTIME-SYNC sigue bloqueado/); assert.match(order.data.response, /No he cambiado nada\./);
 } finally { await s.close(); }
 for (const q of ['Recuerda que la decisión de Cliente Cero es esperar', '¿Qué tengo mañana en la agenda?', '¿Cuál es tu estado operativo?', 'Estado de mi proyecto de cocina'])
  assert.notEqual(interpretIntention(q).reason, 'project_continuity', q);
 for (const q of ['¿Qué dice el registro de continuidad?', 'Estado de CZ-RUNTIME-SYNC', 'Decisiones de Cliente Cero', '¿Qué frentes bloqueados tiene OXKIO?', '¿Qué recuerdas del registro de continuidad?'])
  assert.equal(interpretIntention(q).reason, 'project_continuity', q);
 assert.equal(interpretIntention('Actualiza el registro de continuidad con el merge de la PR #52').outcome, 'NEEDS_APPROVAL');
});

test('multi-user isolation: a family member never reaches the registry, by code, by alias or after the owner asked', async () => {
 const s = await setup();
 try {
  await s.ask('Estado de CZ-PG-RLS-REAL'); assert.equal(s.reads.length, 1);
  for (const q of ['Estado de CZ-PG-RLS-REAL', '¿Cómo va lo de postgres rls?', 'Decisiones de Cliente Cero']) {
   const r = await s.ask(q, FAMILY);
   assert.equal(r.status, 200, q); assert.doesNotMatch(r.data.response, /CZ-PG-RLS-REAL (está|sigue)|revisión 33|Estado registrado/, q);
  }
  assert.equal(s.reads.length, 1, 'only the owner question read the registry');
  const coded = await s.ask('Estado de CZ-PG-RLS-REAL', FAMILY);
  assert.match(coded.data.response, /No tengo acceso al registro de continuidad del proyecto/);
 } finally { await s.close(); }
});

test('an unavailable registry is said plainly, never as personal memory nor as an all-clear', async () => {
 for (const projectContinuity of [null, () => { throw Object.assign(new Error('x'), { code: 'registry_invalid' }); }]) {
  const s = await setup({ projectContinuity });
  try {
   const r = await s.ask('Estado y decisiones de Cliente Cero');
   assert.notEqual(r.data.response, MEMORY_EMPTY); assert.equal(s.p.calls.length, 0);
   assert.equal(r.data.response, 'No tengo acceso al registro de continuidad del proyecto, así que no puedo darte su estado. No lo he buscado en tu memoria personal, que no es donde está.');
  } finally { await s.close(); }
 }
});

test('no model may state the status of a front: such an answer is refused, never shown', async () => {
 const s = await setup({ content: () => ({ action: 'answer', message: 'Todo va bien: CZ-RUNTIME-SYNC ya está cerrado y no queda nada pendiente.', plan: [] }) });
 try {
  const r = await s.ask('¿Qué me recomiendas para organizar la semana?');
  assert.ok(s.p.calls.length >= 1, 'the decider was consulted'); assert.doesNotMatch(r.data.response, /CZ-|ya está cerrado|no queda nada pendiente/);
 } finally { await s.close(); }
});

'use strict';
// Second real Cliente Cero mission (06/10/2026): the mission waited for an
// expired agenda connection, but reconnecting Google leaves the page, and the
// page comes back with a new conversation. A continuation must still find the
// person's waiting mission, persisted under its owner, and resume the SAME
// mission without a new interpretation. Several waiting missions are listed,
// never chosen by recency. No real OAuth: connections are fixture adapters.
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const { Readable } = require('node:stream'); const { randomBytes } = require('node:crypto');
const { createServerComposition } = require('./server-composition');
const { createReadonlyAdapter } = require('./resource-adapters');
const { createSupervisedRuntime } = require('./mission-runtime');
const { createExecutiveAuthorizer } = require('../../security/executive-authorization');
const INTERNAL = /\b(?:AVAILABLE_NOW|AVAILABLE_WITH_APPROVAL|NEEDS_CONNECTION|NEEDS_INFORMATION|WAITING_RESOURCE|UNAVAILABLE|BLOCKED|NEEDS_APPROVAL|NEEDS_CAPABILITY)\b|\b[a-z]+\.(?:read|search|remember|analyze|propose|schedule|extract|write)\b|mission-[0-9a-f]{8}/;
// Fixture items shaped like the production private adapters (text + closed
// signals); the agenda date is relative to today so the fixture never expires.
const inDays = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const MAIL_ITEM = { text: 'Gestoría — Modelo 303: falta tu confirmación', signals: { type: 'mail', unread: true, important: true, starred: false, category: 'primary', date: '2026-10-06T08:00:00Z' } };
const EVENT_ITEM = () => ({ text: inDays(3) + ' · Comité semanal', signals: { type: 'calendar', start: inDays(3), allDay: true } });
const POLICY = { publicExternalAllowed: true, internalProviders: [{ providerId: 'fixture' }], confidentialProviders: [] };
const ORDER = 'Organízame lo que tengo pendiente y dime qué debería hacer primero hoy.';
const PRIVATE_TEXT = /Modelo 303|Comité semanal/;

// --- HTTP composition: the real flow ------------------------------------------
const UID = 'fixture-cliente-cero'; const authorize = createExecutiveAuthorizer({ OXKIO_ADMIN_FIREBASE_UIDS: UID });
function decider() { const calls = []; const modelId = 'fixture:luna'; return { status: 'ready', provider: 'fixture', region: 'eu', modelId, calls,
 catalog: { [modelId]: { provider: 'fixture', tier: 'small_model', inputUsdPerMillion: 0.2, outputUsdPerMillion: 1.2, residency: 'eu', privacy: 'fixture', pricingVersion: 'f', pricingSource: 'f', reviewedAt: '2026-10-04' } },
 async reason(request) { calls.push(request); const m = request.mission;
  // "continúa" with no context is unclear to a decider; the order itself is
  // planned like Luna did at 19:36:57; a mail question plans the mail.
  const content = /^contin/i.test(m) ? { action: 'clarify', message: '¿Qué quieres que continúe?', plan: [] }
   : /gestor/i.test(m) ? { action: 'plan', plan: [{ key: 'g', capability: 'gmail.read', dependsOn: [] }] }
    : { action: 'plan', plan: [{ key: 'm', capability: 'memory.search', dependsOn: [] }, { key: 'c', capability: 'calendar.read', dependsOn: [] }, { key: 'g', capability: 'gmail.read', dependsOn: [] }, { key: 'a', capability: 'data.analyze', dependsOn: ['m', 'c', 'g'] }] };
  return { status: 'ok', content, usage: { inputTokens: 600, outputTokens: 200 } }; } }; }
// Like the production readers: always installed, unverified; an expired token fails each read.
function google() {
 const state = { expired: true, reads: [] };
 const read = kind => async () => { if (state.expired) throw Object.assign(new Error('expired'), { code: 'oauth_token_invalid', failureKind: 'connection' }); state.reads.push(kind); return [kind === 'mail' ? MAIL_ITEM : EVENT_ITEM()]; };
 const factory = async (who, scope) => ({ mail: { ...createReadonlyAdapter({ scope, permissions: ['mail.read'], origin: 'fixture', read: read('mail') }), authorizationVerified: false }, calendar: { ...createReadonlyAdapter({ scope, permissions: ['calendar.read'], origin: 'fixture', read: read('calendar') }), authorizationVerified: false } });
 return { state, factory };
}
async function setup() {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v3-cross-resume-')); const p = decider(); const g = google();
 const server = createServerComposition({ enabled: true, cohortUids: UID, integrityKey: randomBytes(32), memoryRoot: root, authorizeIdentity: authorize, adapterFactory: g.factory, reasoning: { providers: [p], privacyPolicy: POLICY, requestPrivacyFloor: 'INTERNAL', approvedDailyBudgetUsd: 0.9 } });
 const ask = async (query, conversationId, extra = {}) => { const req = Readable.from([JSON.stringify({ query, includeDetails: true, conversationId, ...extra })]); req.oxkioIdentity = authorize({ uid: UID }).identity; let status, body; await server.handle(req, { writeHead(s) { status = s; }, end(b) { body = b; } }); return { status, data: JSON.parse(body) }; };
 return { p, g, ask, close: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('real case: expired agenda, page reloaded after reconnecting, "continúa" in a new conversation resumes the SAME mission without a new model call', async () => {
 const s = await setup();
 try {
  const first = await s.ask(ORDER, 'conversation-before-oauth'); const id = first.data.missionId;
  assert.equal(first.data.details.status, 'NEEDS_CONNECTION'); assert.deepEqual(first.data.details.connectionRequests.map(g => g.capability + ':' + g.status), ['calendar.read:EXPIRED']);
  assert.equal(s.p.calls.length, 1);
  s.g.state.expired = false; // the person reconnects Google; the browser comes back with another conversation
  const resumed = await s.ask('continúa', 'conversation-after-oauth'); const d = resumed.data.details;
  assert.equal(resumed.status, 200); assert.equal(resumed.data.missionId, id, 'same mission id');
  assert.equal(s.p.calls.length, 1, 'no new interpretation, no model call');
  assert.equal(d.status, 'COMPLETED'); assert.deepEqual(s.g.state.reads.sort(), ['calendar', 'mail']);
  const events = d.trace.map(t => t.event); assert.ok(events.lastIndexOf('VERIFY') > events.lastIndexOf('CONSULT')); assert.ok(events.includes('TERMINATE'));
  assert.match(resumed.data.response, /^Retomo la tarea «Organízame lo que tengo pendiente y dime qué debería hacer primero hoy\.» desde donde la dejamos\.\n/);
  assert.match(resumed.data.response, /Comité semanal/); assert.doesNotMatch(resumed.data.response, INTERNAL);
  // Privacy and authority: private material never reached the provider; nothing executes.
  assert.ok(!s.p.calls.some(c => PRIVATE_TEXT.test(JSON.stringify(c)))); assert.equal(resumed.data.executionEnabled, false); assert.equal(first.data.executionEnabled, false);
  // The new conversation now owns the resumed context: a later "continúa" there finds nothing more to resume.
  const after = await s.ask('continúa', 'conversation-after-oauth'); assert.notEqual(after.data.details.status, 'RUNNING');
 } finally { s.close(); }
});

test('same conversation keeps the existing resume; a connection still invalid keeps the mission waiting, with no false progress', async () => {
 const s = await setup();
 try {
  const first = await s.ask(ORDER, 'conversation-one-tab'); const id = first.data.missionId;
  // Still expired: a new conversation resumes the same mission, which waits again honestly.
  const still = await s.ask('Ya lo he conectado', 'conversation-other-tab');
  assert.equal(still.data.missionId, id); assert.equal(still.data.details.status, 'NEEDS_CONNECTION'); assert.deepEqual(s.g.state.reads, []);
  assert.match(still.data.response, /^Retomo la tarea «.+» desde donde la dejamos\.\nLa autorización para consultar tu agenda ha caducado/);
  assert.doesNotMatch(still.data.response, /ya está disponible|continúo/i, 'never promises an unverified connection'); assert.doesNotMatch(still.data.response, INTERNAL);
  // Same conversation, existing path: valid now, the same mission completes.
  s.g.state.expired = false;
  const same = await s.ask('continúa', 'conversation-one-tab');
  assert.equal(same.data.missionId, id); assert.equal(same.data.details.status, 'COMPLETED'); assert.doesNotMatch(same.data.response, /^Retomo/);
  assert.equal(s.p.calls.length, 1);
 } finally { s.close(); }
});

test('0 candidates: "continúa" in a new conversation invents no mission and takes the ordinary path', async () => {
 const s = await setup();
 try {
  const r = await s.ask('continúa', 'conversation-empty');
  assert.equal(r.data.missionId, null); assert.equal(r.data.details.mode, 'CLARIFICATION'); assert.doesNotMatch(r.data.response, /^Retomo|tareas pendientes/);
  assert.deepEqual(s.g.state.reads, []); assert.equal(r.data.executionEnabled, false);
 } finally { s.close(); }
});

test('several waiting missions: the person is asked which one; nothing resumes until they choose, then only the chosen one does', async () => {
 const s = await setup();
 try {
  const a = await s.ask(ORDER, 'conversation-a'); const b = await s.ask('¿Me ha escrito la gestoría?', 'conversation-b');
  assert.equal(a.data.details.status, 'NEEDS_CONNECTION'); assert.equal(b.data.details.status, 'NEEDS_CONNECTION'); assert.notEqual(a.data.missionId, b.data.missionId);
  const calls = s.p.calls.length; s.g.state.expired = false;
  const ask = await s.ask('continúa', 'conversation-new');
  assert.equal(ask.data.missionId, null); assert.equal(ask.data.details.status, 'NEEDS_INFORMATION'); assert.equal(ask.data.details.mode, 'CLARIFICATION');
  assert.match(ask.data.response, /^Tengo 2 tareas pendientes que pueden continuar:/);
  assert.match(ask.data.response, /1\) «¿Me ha escrito la gestoría\?» \(esperando la conexión de tu correo\)/);
  assert.match(ask.data.response, /2\) «Organízame lo que tengo pendiente y dime qué debería hacer primero hoy\.» \(esperando la conexión de tu agenda\)/);
  assert.match(ask.data.response, /¿Cuál quieres que retome\? Responde con su número\. Todavía no he retomado ninguna\./);
  assert.doesNotMatch(ask.data.response, INTERNAL); assert.doesNotMatch(ask.data.response, PRIVATE_TEXT);
  assert.deepEqual(s.g.state.reads, [], 'nothing resumed before the choice'); assert.equal(s.p.calls.length, calls);
  // The choice resumes only that mission.
  const chosen = await s.ask('la segunda', 'conversation-new');
  assert.equal(chosen.data.missionId, a.data.missionId); assert.equal(chosen.data.details.status, 'COMPLETED'); assert.match(chosen.data.response, /^Retomo la tarea «Organízame/);
  assert.equal(s.p.calls.length, calls, 'no model call to resume');
  const other = await s.ask('', 'conversation-b', { action: 'status', missionId: b.data.missionId });
  assert.equal(other.data.details.status, 'NEEDS_CONNECTION', 'the other mission did not move');
 } finally { s.close(); }
});

// --- Runtime: isolation and candidate states -----------------------------------
const A = { tenantId: 'tenant-aaa', clientId: 'client-aaa', userId: 'user-aaa', roles: ['owner'], status: 'ACTIVE' };
const C = { tenantId: 'tenant-aaa', clientId: 'client-aaa', userId: 'user-ccc', roles: ['owner'], status: 'ACTIVE' };
const B = { tenantId: 'tenant-bbb', clientId: 'client-bbb', userId: 'user-aaa-b', roles: ['owner'], status: 'ACTIVE' };
const membershipProvider = { findMemberships: async ({ authenticatedUserId }) => [A, B, C].filter(v => v.userId === authenticatedUserId) };
test('isolation: another user of the same tenant, or another tenant, never sees or resumes the waiting mission', async () => {
 const r = createSupervisedRuntime({ membershipProvider });
 const a = await r.openSession(A.userId); const c = await r.openSession(C.userId); const b = await r.openSession(B.userId);
 const waiting = await r.start(a, { text: '¿Qué tengo en mi agenda hoy?', conversationId: 'conv-owner-a' });
 assert.equal(waiting.status, 'NEEDS_CONNECTION');
 assert.equal(await r.resumeTarget(c, 'conv-other-user', 'continúa'), null, 'same tenant, other user: invisible');
 assert.equal(await r.resumeTarget(b, 'conv-other-tenant', 'continúa'), null, 'other tenant: invisible');
 for (const h of [b, c]) await assert.rejects(() => r.resume(h, waiting.id), { code: 'mission_not_found' });
 const own = await r.resumeTarget(a, 'conv-owner-a-new', 'continúa'); assert.equal(own.missionId, waiting.id);
 assert.equal(r.executionEnabled, false);
});

test('only waits a resume can end are candidates: NEEDS_INFORMATION, COMPLETED and CANCELLED never are; ambiguous words never resume', async () => {
 const r = createSupervisedRuntime({ membershipProvider, conversationDecider: async () => ({ action: 'plan', plan: [{ key: 'm', capability: 'memory.search', dependsOn: [] }, { key: 'x', capability: 'data.analyze', dependsOn: ['m'] }] }) });
 const a = await r.openSession(A.userId);
 // Unmet objective first, while the memory is still empty.
 const info = await r.start(a, { text: 'Revisa lo que tengo y dime qué es urgente.', conversationId: 'conv-info' });
 assert.equal(info.status, 'NEEDS_INFORMATION'); assert.equal(info.diagnosis.class, 'objective_unmet');
 assert.equal((await r.start(a, { text: 'Recuerda que la reunión es el martes', conversationId: 'conv-done' })).status, 'COMPLETED');
 const cancelled = await r.start(a, { text: '¿Qué tengo en mi agenda hoy?', conversationId: 'conv-cancel' }); await r.cancel(a, cancelled.id);
 assert.equal(await r.resumeTarget(a, 'conv-new-0001', 'continúa'), null, 'no candidate among completed, unmet or cancelled missions');
 const waiting = await r.start(a, { text: '¿Qué tengo en mi agenda mañana?', conversationId: 'conv-wait' });
 assert.equal(waiting.status, 'NEEDS_CONNECTION');
 for (const word of ['hazlo', 'listo', 'vale', 'sí']) assert.equal(await r.resumeTarget(a, 'conv-new-0002', word), null, word);
 assert.equal((await r.resumeTarget(a, 'conv-new-0003', 'ya lo he conectado')).missionId, waiting.id);
});

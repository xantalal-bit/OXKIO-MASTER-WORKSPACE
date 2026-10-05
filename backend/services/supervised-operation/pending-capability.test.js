'use strict';
// Executive continuity (05/10/2026): a goal that needs a capability pending a
// connection becomes a resumable mission, not a conversational dead end; the
// person sees plain words, never internal status names. No real OAuth: the
// connection is a trusted fixture adapter installed by the composition.
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const http = require('node:http'); const { randomBytes } = require('node:crypto');
const { createAdaptivePlanner } = require('./adaptive-planner');
const { createServerComposition } = require('./server-composition');
const { createReadonlyAdapter } = require('./resource-adapters');
const { createExecutiveAuthorizer } = require('../../security/executive-authorization');
const INTERNAL = /\b(?:AVAILABLE_NOW|AVAILABLE_WITH_APPROVAL|NEEDS_CONNECTION|UNAVAILABLE|BLOCKED|NEEDS_APPROVAL|NEEDS_CAPABILITY)\b|\b[a-z]+\.(?:read|search|remember|analyze|propose|schedule|extract|write)\b/;
const POLICY = { publicExternalAllowed: true, internalProviders: [{ providerId: 'fixture' }], confidentialProviders: [] };

// --- Decider contract -------------------------------------------------------
const ctx = () => ({ missionId: 'fixture', spend: { estimate: () => 0.001, reserve: () => ({}), settle: () => 0.001 } });
function planner(content) { const calls = []; return { calls, p: createAdaptivePlanner({ provider: { status: 'ready', provider: 'fixture', region: 'eu', modelId: 'fixture:luna', reason: async r => { calls.push(r); return { status: 'ok', content }; } }, privacyPolicy: POLICY, approvedDailyBudgetUsd: 1, requestFloor: 'INTERNAL' }) }; }
const VIEW = [{ id: 'gmail.read', status: 'NEEDS_CONNECTION' }, { id: 'memory.search', status: 'AVAILABLE_NOW' }, { id: 'documents.read', status: 'UNAVAILABLE' }];
const input = { intention: 'Busca en mi correo el último mensaje de la gestoría', capabilities: ['gmail.read', 'memory.search'], capabilityStatus: VIEW };
test('the contract tells the decider to plan a needed capability that is pending a connection, and to keep internal names out of messages', async () => {
 const x = planner({ action: 'plan', plan: [{ key: 'a', capability: 'gmail.read', dependsOn: [] }] }); const r = await x.p.decide(input, ctx());
 assert.equal(r.action, 'plan'); const c = x.calls[0].constraints;
 assert.ok(c.some(v => /status is NEEDS_CONNECTION, choose plan and include it; do not clarify only to ask for the connection/.test(v)));
 assert.ok(c.some(v => /NEEDS_CONNECTION: plan it when the goal needs it; OXKIO asks the person to connect it and then continues the same task/.test(v)));
 assert.ok(c.some(v => /never write capability ids or status names/.test(v)));
 assert.ok(c.some(v => /capability that is UNAVAILABLE or BLOCKED, say so plainly/.test(v)));
});
test('a message carrying internal status names or capability ids is refused with its own fixed code; plain words pass', async () => {
 for (const message of ['Gmail figura como «NEEDS_CONNECTION», así que debes conectarlo.', 'Ahora mismo calendar.read está UNAVAILABLE.', 'Esa acción está BLOCKED.', 'Puedo usar memory.search para buscarlo.']) {
  const x = planner({ action: 'clarify', message, plan: [] }); const e = await x.p.decide(input, ctx()).then(() => null, v => v);
  assert.deepEqual(e.attempts.map(a => a.detail), ['planning_message_internal_terms'], message); assert.ok(!JSON.stringify(e.attempts).includes(message), message);
 }
 for (const message of ['Necesito acceso a tu correo para comprobarlo. En cuanto esté conectado podré continuar.', 'Ahora mismo no tengo acceso a tu calendario.', '¿A qué te refieres con «aquello»?']) {
  const x = planner({ action: 'clarify', message, plan: [] }); assert.equal((await x.p.decide(input, ctx())).action, 'clarify', message);
 }
});

// --- Runtime: plan → wait for connection → resume the same mission ------------
const UID = 'fixture-owner-a'; const authorize = createExecutiveAuthorizer({ OXKIO_ADMIN_FIREBASE_UIDS: UID });
function decider(decide) { const calls = []; const modelId = 'fixture:luna'; return { status: 'ready', provider: 'fixture', region: 'eu', modelId, calls,
 catalog: { [modelId]: { provider: 'fixture', tier: 'small_model', inputUsdPerMillion: 0.2, outputUsdPerMillion: 1.2, residency: 'eu', privacy: 'fixture', pricingVersion: 'f', pricingSource: 'f', reviewedAt: '2026-10-04' } },
 async reason(request) { calls.push(request); return { status: 'ok', content: decide(request.mission), usage: { inputTokens: 400, outputTokens: 120 } }; } }; }
const plan = (...caps) => ({ action: 'plan', plan: caps.map((capability, i) => ({ key: 's' + i, capability, dependsOn: [] })) });
// Trusted connection fixtures: absent until the test "authorizes" them.
function connections() {
 const state = { mail: false, calendar: false, reads: [] };
 const factory = async (identity, scope) => ({
  ...(state.mail ? { mail: createReadonlyAdapter({ scope, permissions: ['mail.read'], origin: 'fixture', read: async () => { state.reads.push('mail'); return [{ text: 'Gestoría — Modelo 303: falta tu confirmación' }]; } }) } : {}),
  ...(state.calendar ? { calendar: createReadonlyAdapter({ scope, permissions: ['calendar.read'], origin: 'fixture', read: async () => { state.reads.push('calendar'); return [{ text: 'Lunes 10:00 · Comité semanal' }]; } }) } : {}),
 });
 return { state, factory };
}
async function setup(providers, adapters) {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v3-continuity-'));
 const c = createServerComposition({ enabled: true, cohortUids: UID, memoryRoot: root, integrityKey: randomBytes(32), authorizeIdentity: authorize, adapterFactory: adapters, reasoning: { providers, requestPrivacyFloor: 'INTERNAL', privacyPolicy: POLICY, approvedDailyBudgetUsd: 0.9 } });
 const server = http.createServer((req, res) => { req.oxkioIdentity = authorize({ uid: UID }).identity; c.handle(req, res); });
 await new Promise(r => server.listen(0, '127.0.0.1', r)); const port = server.address().port;
 const ask = (query, extra = {}) => new Promise((resolve, reject) => { const body = JSON.stringify({ query, includeDetails: true, ...extra }); const req = http.request({ host: '127.0.0.1', port, path: '/api/executive/chat', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, res => { let d = ''; res.on('data', s => d += s); res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(d || '{}') })); }); req.on('error', reject); req.end(body); });
 return { ask, close: async () => { await new Promise(r => server.close(r)); fs.rmSync(root, { recursive: true, force: true }); } };
}
const MAIL = /correo|emails?|gestor/i, AGENDA = /agenda|reuni|calendario|citas/i;
const semantic = m => MAIL.test(m) && AGENDA.test(m) ? plan('calendar.read', 'gmail.read', 'data.analyze') : MAIL.test(m) ? plan('gmail.read') : AGENDA.test(m) ? plan('calendar.read') : /aquello/.test(m) ? { action: 'clarify', message: '¿A qué te refieres con «aquello»?', plan: [] } : { action: 'answer', message: 'Te propongo cinco ideas concretas para tu objetivo.', plan: [] };

test('A/B/C and paraphrases: the needed source is planned, the mission waits for its connection, and the person reads plain words', async () => {
 const conn = connections(); const p = decider(semantic); const s = await setup([p], conn.factory);
 try {
  for (const [q, caps] of [['Busca en mi correo el último mensaje de la gestoría.', ['gmail.read']], ['¿Tengo algún email de la gestoría sin contestar?', ['gmail.read']], ['¿Qué reuniones tengo el lunes?', ['calendar.read']], ['Mira qué citas tengo esta semana en el calendario', ['calendar.read']], ['Organiza mis prioridades usando mi agenda y mi correo.', ['calendar.read', 'gmail.read']]]) {
   const r = await s.ask(q); const d = r.data.details;
   assert.equal(d.status, 'NEEDS_CONNECTION', q); assert.ok(r.data.missionId, q); assert.deepEqual(d.connectionRequests.map(g => g.capability).sort(), caps, q);
   assert.equal(d.result, null, q); assert.equal(r.data.executionEnabled, false, q);
   assert.doesNotMatch(r.data.response, INTERNAL, q); assert.match(r.data.response, /sin que tengas que repetir la petición/, q); assert.match(r.data.response, /Nunca podré enviar, publicar o ejecutar cambios externos/, q);
  }
  assert.deepEqual(conn.state.reads, []);
 } finally { await s.close(); }
});
test('D/E/F/H: no waiting where none is needed; an unclear goal is clarified without a mission; an available capability runs at once', async () => {
 // The double answers like the real model did for ideas and explanations
 // (validated 05/10/2026); it is not a vocabulary router.
 const p = decider(m => /preferencias/.test(m) ? plan('memory.search') : /aquello/.test(m) ? semantic(m) : { action: 'answer', message: 'Te propongo cinco ideas concretas para tu objetivo.', plan: [] }); const s = await setup([p], connections().factory);
 try {
  for (const q of ['Dame cinco ideas para mejorar una reunión.', 'Explícame qué es la factura electrónica.', 'Ideas para que mis reuniones sean más cortas']) { const r = await s.ask(q); assert.equal(r.data.details.mode, 'COGNITIVE_ADVICE', q); assert.equal(r.data.missionId, null, q); }
  const f = await s.ask('Revisa aquello.'); assert.equal(f.data.details.mode, 'CLARIFICATION'); assert.equal(f.data.missionId, null);
  const h = await s.ask('¿Qué sabes de mis preferencias?'); assert.equal(h.data.details.status, 'COMPLETED'); assert.equal(h.data.details.connectionRequests.length, 0); assert.ok(!h.data.details.trace.some(t => t.event === 'NEEDS_CONNECTION'));
 } finally { await s.close(); }
});
test('G: a capability that does not exist for the account is not presented as connectable, and no continuation is promised', async () => {
 const p = decider(() => plan('documents.read')); const s = await setup([p], connections().factory);
 try {
  const r = await s.ask('Resume el documento Plan2026 de mis archivos.');
  assert.equal(r.data.details.status, 'NEEDS_CONNECTION'); assert.equal(r.data.details.connectionRequests[0].connectable, false);
  assert.match(r.data.response, /todavía no está disponible para tu cuenta/); assert.match(r.data.response, /no podré continuarla mientras esa conexión no esté disponible/);
  assert.doesNotMatch(r.data.response, /di «continúa»/); assert.doesNotMatch(r.data.response, INTERNAL);
 } finally { await s.close(); }
});
test('full cycle without OAuth: the order is given once, the same mission resumes from its checkpoint after the connection becomes valid', async () => {
 const conn = connections(); const p = decider(semantic); const s = await setup([p], conn.factory);
 try {
  // 1-3. The request becomes a plan; the source has no connection; the mission waits.
  const first = await s.ask('Busca en mi correo el último mensaje de la gestoría.'); const id = first.data.missionId;
  assert.equal(first.data.details.status, 'NEEDS_CONNECTION'); assert.equal(p.calls.length, 1); assert.deepEqual(conn.state.reads, []);
  // Saying "continúa" before connecting keeps the same mission waiting: no duplicate, no new interpretation.
  let again = await s.ask('continúa'); assert.equal(again.data.missionId, id); assert.equal(again.data.details.status, 'NEEDS_CONNECTION'); assert.equal(p.calls.length, 1);
  const status = await s.ask('', { action: 'status' }); assert.equal(status.data.missionId, id); assert.equal(status.data.details.status, 'NEEDS_CONNECTION');
  // 4. A trusted (fixture) authorization makes the connection valid.
  conn.state.mail = true;
  // 5-7. Resume: the same mission continues; the goal is not asked or interpreted again.
  const resumed = await s.ask('Ya lo he conectado'); const d = resumed.data.details;
  assert.equal(resumed.data.missionId, id); assert.equal(d.status, 'COMPLETED'); assert.equal(p.calls.length, 1);
  assert.deepEqual(conn.state.reads, ['mail']); assert.match(resumed.data.response, /Modelo 303/);
  // 8. Gates: the read went through the engine with verified evidence.
  const events = d.trace.map(t => t.event); assert.ok(events.indexOf('NEEDS_CONNECTION') < events.indexOf('CONSULT')); assert.ok(events.includes('VERIFY') && events.includes('TERMINATE'));
  // 9. Nothing external can run: read-only plan, executionEnabled stays false.
  assert.equal(resumed.data.executionEnabled, false); assert.equal(d.result.capability, 'gmail.read');
 } finally { await s.close(); }
});
test('a two-source mission waits until every needed connection exists and then completes the same mission', async () => {
 const conn = connections(); const p = decider(semantic); const s = await setup([p], conn.factory);
 try {
  const first = await s.ask('Organiza mis prioridades usando mi agenda y mi correo.'); const id = first.data.missionId;
  conn.state.calendar = true;
  let r = await s.ask('continúa'); assert.equal(r.data.missionId, id); assert.equal(r.data.details.status, 'NEEDS_CONNECTION'); assert.deepEqual(r.data.details.connectionRequests.map(g => g.capability), ['gmail.read']);
  conn.state.mail = true;
  r = await s.ask('continúa'); assert.equal(r.data.missionId, id); assert.equal(r.data.details.status, 'COMPLETED'); assert.deepEqual(conn.state.reads.sort(), ['calendar', 'mail']); assert.equal(p.calls.length, 1); assert.equal(r.data.executionEnabled, false);
 } finally { await s.close(); }
});

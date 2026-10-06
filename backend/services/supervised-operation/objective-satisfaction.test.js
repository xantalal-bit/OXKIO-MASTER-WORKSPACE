'use strict';
// First real Cliente Cero mission (06/10/2026): a technical PASS is not the
// person's objective. An analysis with no material at all, while personal
// sources that could hold it were left unconsulted, is not COMPLETED and
// teaches no reusable procedure; an empty lookup is still an answer. No real
// OAuth, Gmail or Calendar: connections are trusted fixture adapters.
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const http = require('node:http'); const { randomBytes, createHash } = require('node:crypto');
const { createAdaptivePlanner } = require('./adaptive-planner');
const { createServerComposition } = require('./server-composition');
const { createReadonlyAdapter } = require('./resource-adapters');
const { createSupervisedRuntime } = require('./mission-runtime');
const { createScopedStore } = require('./scope-session');
const { createExecutiveAuthorizer } = require('../../security/executive-authorization');
const INTERNAL = /\b(?:AVAILABLE_NOW|AVAILABLE_WITH_APPROVAL|NEEDS_CONNECTION|NEEDS_INFORMATION|UNAVAILABLE|BLOCKED|NEEDS_APPROVAL|NEEDS_CAPABILITY)\b|\b[a-z]+\.(?:read|search|remember|analyze|propose|schedule|extract|write)\b/;
const POLICY = { publicExternalAllowed: true, internalProviders: [{ providerId: 'fixture' }], confidentialProviders: [] };
const OLD_FALSE_CLOSURE = 'No he encontrado resultados en tus fuentes.';

// --- Decider contract -------------------------------------------------------
const ctx = () => ({ missionId: 'fixture', spend: { estimate: () => 0.001, reserve: () => ({}), settle: () => 0.001 } });
function planner(content) { const calls = []; return { calls, p: createAdaptivePlanner({ provider: { status: 'ready', provider: 'fixture', region: 'eu', modelId: 'fixture:luna', reason: async r => { calls.push(r); return { status: 'ok', content }; } }, privacyPolicy: POLICY, approvedDailyBudgetUsd: 1, requestFloor: 'INTERNAL' }) }; }
test('6/8 contract: personal current matters plan every relevant personal source plus the analysis; advice, ideas and templates need none', async () => {
 const x = planner({ action: 'plan', plan: [{ key: 'a', capability: 'memory.search', dependsOn: [] }] });
 await x.p.decide({ intention: '¿Qué debería atender primero esta semana?', capabilities: ['memory.search', 'gmail.read', 'calendar.read', 'data.analyze'], capabilityStatus: [{ id: 'memory.search', status: 'AVAILABLE_NOW' }, { id: 'gmail.read', status: 'NEEDS_CONNECTION' }, { id: 'calendar.read', status: 'NEEDS_CONNECTION' }, { id: 'data.analyze', status: 'AVAILABLE_NOW' }] }, ctx());
 const rule = x.calls[0].constraints.find(v => /own current matters/.test(v));
 assert.ok(rule, 'the general rule is in the contract');
 assert.match(rule, /every supplied personal source where that information can be, whether AVAILABLE_NOW or NEEDS_CONNECTION, and data\.analyze/);
 assert.match(rule, /Never limit the plan to a source only because it is the one usable now/);
 assert.match(rule, /Advice, ideas, methods or templates about organizing need no source: answer them/);
 // The rule is general: it names no sentence of the person.
 assert.doesNotMatch(rule, /organ[ií]zame|pendiente|hoy/i);
});

// --- HTTP composition with a fixture decider --------------------------------
const UID = 'fixture-owner-a'; const authorize = createExecutiveAuthorizer({ OXKIO_ADMIN_FIREBASE_UIDS: UID });
function decider(decide) { const calls = []; const modelId = 'fixture:luna'; return { status: 'ready', provider: 'fixture', region: 'eu', modelId, calls,
 catalog: { [modelId]: { provider: 'fixture', tier: 'small_model', inputUsdPerMillion: 0.2, outputUsdPerMillion: 1.2, residency: 'eu', privacy: 'fixture', pricingVersion: 'f', pricingSource: 'f', reviewedAt: '2026-10-04' } },
 async reason(request) { calls.push(request); return { status: 'ok', content: decide(request.mission), usage: { inputTokens: 400, outputTokens: 120 } }; } }; }
const plan = (...caps) => ({ action: 'plan', plan: caps.map((capability, i) => ({ key: 's' + i, capability, dependsOn: [] })) });
const analyzed = (...sources) => ({ action: 'plan', plan: [...sources.map((capability, i) => ({ key: 's' + i, capability, dependsOn: [] })), { key: 'order', capability: 'data.analyze', dependsOn: sources.map((_, i) => 's' + i) }] });
function connections() {
 const state = { mail: false, calendar: false, mailItems: [{ text: 'Gestoría — Modelo 303: falta tu confirmación' }], reads: [] };
 const factory = async (identity, scope) => ({
  ...(state.mail ? { mail: createReadonlyAdapter({ scope, permissions: ['mail.read'], origin: 'fixture', read: async () => { state.reads.push('mail'); return state.mailItems; } }) } : {}),
  ...(state.calendar ? { calendar: createReadonlyAdapter({ scope, permissions: ['calendar.read'], origin: 'fixture', read: async () => { state.reads.push('calendar'); return [{ text: 'Lunes 10:00 · Comité semanal' }]; } }) } : {}),
 });
 return { state, factory };
}
async function setup(providers, adapters) {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v3-objective-'));
 const c = createServerComposition({ enabled: true, cohortUids: UID, memoryRoot: root, integrityKey: randomBytes(32), authorizeIdentity: authorize, adapterFactory: adapters, reasoning: { providers, requestPrivacyFloor: 'INTERNAL', privacyPolicy: POLICY, approvedDailyBudgetUsd: 0.9 } });
 const server = http.createServer((req, res) => { req.oxkioIdentity = authorize({ uid: UID }).identity; c.handle(req, res); });
 await new Promise(r => server.listen(0, '127.0.0.1', r)); const port = server.address().port;
 const ask = (query, extra = {}) => new Promise((resolve, reject) => { const body = JSON.stringify({ query, includeDetails: true, ...extra }); const req = http.request({ host: '127.0.0.1', port, path: '/api/executive/chat', method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, res => { let d = ''; res.on('data', s => d += s); res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(d || '{}') })); }); req.on('error', reject); req.end(body); });
 return { ask, close: async () => { await new Promise(r => server.close(r)); fs.rmSync(root, { recursive: true, force: true }); } };
}
const ADVICE = /ideas|expl[ií]came|plantilla/i;
const PERSONAL = /atender|asuntos|urgente|prioridades|pendiente/i;
// The double behaves like the corrected contract: personal current matters
// plan memory, agenda and mail plus the analysis; advice is answered.
const corrected = m => ADVICE.test(m) ? { action: 'answer', message: 'Te propongo un método sencillo para priorizar.', plan: [] } : PERSONAL.test(m) ? analyzed('memory.search', 'calendar.read', 'gmail.read') : { action: 'answer', message: 'De acuerdo.', plan: [] };

test('3/9/10/11: an analysis with no material while personal sources stay unconsulted is not COMPLETED, says what was checked and what is missing', async () => {
 // The real failure: only the source usable now (memory, empty) plus the analysis.
 const conn = connections(); const p = decider(() => analyzed('memory.search')); const s = await setup([p], conn.factory);
 try {
  for (const q of ['Ayúdame a ordenar mis asuntos pendientes.', 'Revisa lo que tengo y dime qué es urgente.']) {
   const before = p.calls.length; const r = await s.ask(q); const d = r.data.details;
   assert.equal(r.status, 200, q); assert.notEqual(d.status, 'COMPLETED', q); assert.equal(d.status, 'NEEDS_INFORMATION', q); assert.equal(r.data.outcome, 'NEEDS_INFORMATION', q);
   assert.equal(d.diagnosis.class, 'objective_unmet', q); assert.deepEqual(d.diagnosis.consulted, ['tu memoria'], q);
   assert.deepEqual(d.diagnosis.missing.map(v => v.label).sort(), ['tu agenda', 'tu correo'], q); assert.ok(d.diagnosis.missing.every(v => v.needsConnection), q);
   // The empty read stays as evidence; the technical verification still passed.
   assert.deepEqual(d.result.items, [], q); assert.ok(d.trace.some(t => t.event === 'OBJECTIVE_UNMET'), q); assert.ok(!d.trace.some(t => t.event === 'TERMINATE'), q);
   assert.match(r.data.response, /He comprobado tu memoria y no contiene información para esto/, q);
   assert.match(r.data.response, /como tu agenda y tu correo, que primero hay que conectar/, q);
   assert.match(r.data.response, /No doy la tarea por terminada/, q);
   assert.notEqual(r.data.response, OLD_FALSE_CLOSURE, q); assert.doesNotMatch(r.data.response, INTERNAL, q);
   // 10/11: only the decision call left OXKIO; nothing was read or executed.
   assert.equal(p.calls.length, before + 1, q); assert.deepEqual(conn.state.reads, [], q); assert.equal(r.data.executionEnabled, false, q);
  }
  // An unmet mission is not resumable as if it were waiting.
  const r = await s.ask('Organiza mis prioridades.'); const resumed = await s.ask('', { action: 'resume', missionId: r.data.missionId });
  assert.equal(resumed.status, 400); assert.equal(resumed.data.code, 'terminal_mission'); assert.equal(resumed.data.executionEnabled, false);
 } finally { await s.close(); }
});

test('4: a mission that did not satisfy its objective teaches no reusable workflow: the same request is decided again', async () => {
 const p = decider(() => analyzed('memory.search')); const s = await setup([p], connections().factory);
 try {
  const q = 'Organiza mis prioridades de esta semana.';
  const a = await s.ask(q); assert.equal(a.data.details.status, 'NEEDS_INFORMATION'); assert.equal(p.calls.length, 1);
  const b = await s.ask(q); assert.equal(b.data.details.status, 'NEEDS_INFORMATION'); assert.equal(p.calls.length, 2);
  assert.ok(b.data.details.trace.some(t => t.event === 'CONVERSATIONAL_DECISION'));
 } finally { await s.close(); }
});

test('1/2: a satisfied objective completes and is learned; an empty lookup is a genuine answer that names the consulted source', async () => {
 const conn = connections(); conn.state.mail = true; conn.state.mailItems = [];
 const p = decider(m => /correos/.test(m) ? plan('gmail.read') : /prioridades/.test(m) ? analyzed('gmail.read') : { action: 'answer', message: 'De acuerdo.', plan: [] });
 const s = await setup([p], conn.factory);
 try {
  // 2. "Do I have mail from X?" -> 0 items answers the question.
  const empty = await s.ask('¿Tengo correos de la gestoría?');
  assert.equal(empty.data.details.status, 'COMPLETED'); assert.deepEqual(empty.data.details.result.items, []);
  assert.equal(empty.data.response, 'He consultado tu correo y no he encontrado resultados.'); assert.doesNotMatch(empty.data.response, INTERNAL);
  // A satisfied lookup is learned: the same request reuses the procedure.
  const again = await s.ask('¿Tengo correos de la gestoría?'); assert.equal(again.data.details.status, 'COMPLETED'); assert.equal(p.calls.length, 1);
  // 1. Material present: the analysis completes (no confidential egress: listed, not analysed).
  conn.state.mailItems = [{ text: 'Gestoría — Modelo 303: falta tu confirmación' }];
  const done = await s.ask('Organiza mis prioridades con mi correo.');
  assert.equal(done.data.details.status, 'COMPLETED'); assert.equal(done.data.details.result.capability, 'data.analyze'); assert.match(done.data.response, /Modelo 303/);
  assert.ok(!p.calls.some(c => JSON.stringify(c).includes('Modelo 303')), 'private mail text never reached the provider');
  assert.equal(done.data.executionEnabled, false);
 } finally { await s.close(); }
});

test('6/7: an executive personal objective plans its relevant sources, waits for the needed connections and resumes the same mission without repeating the order', async () => {
 const conn = connections(); const p = decider(corrected); const s = await setup([p], conn.factory);
 try {
  for (const q of ['¿Qué debería atender primero esta semana?', 'Ayúdame a ordenar mis asuntos pendientes.', 'Revisa lo que tengo y dime qué es urgente.', 'Organiza mis prioridades.', '¿Qué tengo pendiente?']) {
   const r = await s.ask(q); const d = r.data.details;
   assert.equal(d.status, 'NEEDS_CONNECTION', q); assert.ok(r.data.missionId, q); assert.deepEqual(d.connectionRequests.map(g => g.capability).sort(), ['calendar.read', 'gmail.read'], q);
   assert.match(r.data.response, /sin que tengas que repetir la petición/, q); assert.doesNotMatch(r.data.response, INTERNAL, q); assert.notEqual(r.data.response, OLD_FALSE_CLOSURE, q);
  }
  assert.deepEqual(conn.state.reads, []);
  const first = await s.ask('Organízame lo que tengo pendiente y dime qué debería hacer primero hoy.'); const id = first.data.missionId; const calls = p.calls.length;
  assert.equal(first.data.details.status, 'NEEDS_CONNECTION');
  conn.state.mail = true; conn.state.calendar = true;
  const resumed = await s.ask('Ya lo he conectado'); const d = resumed.data.details;
  assert.equal(resumed.data.missionId, id); assert.equal(d.status, 'COMPLETED'); assert.equal(p.calls.length, calls);
  assert.deepEqual(conn.state.reads.sort(), ['calendar', 'mail']); assert.match(resumed.data.response, /Comité semanal/); assert.match(resumed.data.response, /Modelo 303/);
  assert.equal(resumed.data.executionEnabled, false);
 } finally { await s.close(); }
});

test('8: general advice about organizing reads no private source and creates no mission', async () => {
 const conn = connections(); conn.state.mail = true; conn.state.calendar = true; const p = decider(corrected); const s = await setup([p], conn.factory);
 try {
  for (const q of ['Dame cinco ideas para organizarme.', 'Explícame cómo priorizar tareas.', 'Hazme una plantilla semanal.']) {
   const r = await s.ask(q); assert.equal(r.data.details.mode, 'COGNITIVE_ADVICE', q); assert.equal(r.data.missionId, null, q); assert.equal(r.data.executionEnabled, false, q);
  }
  assert.deepEqual(conn.state.reads, []);
 } finally { await s.close(); }
});

// --- Runtime: historical and invalidated workflows ---------------------------
const A = { tenantId: 'tenant-aaa', clientId: 'client-aaa', userId: 'user-aaa', roles: ['owner'], status: 'ACTIVE' };
const membershipProvider = { findMemberships: async ({ authenticatedUserId }) => [A].filter(v => v.userId === authenticatedUserId) };
const workflowId = text => 'wf-' + createHash('sha256').update(text).digest('hex').slice(0, 40);
test('5: a workflow learned before this rule (no satisfaction mark) or invalidated by an unmet mission is never replayed', async () => {
 let store; let decisions = 0;
 const r = createSupervisedRuntime({ membershipProvider, storeFactory: sessions => (store = createScopedStore(sessions)), conversationDecider: async () => { decisions++; return { action: 'plan', plan: [{ key: 'm', capability: 'memory.search', dependsOn: [] }, { key: 'a', capability: 'data.analyze', dependsOn: ['m'] }] }; } });
 const h = await r.openSession(A.userId);
 // Historical record, shaped like the one the real mission left (memory only, no mark).
 const real = 'Organízame lo que tengo pendiente y dime qué debería hacer primero hoy.';
 store.put(h, 'workflow', workflowId(real), { intention: real, plan: [{ key: 'buscar-pendientes', capability: 'memory.search', dependsOn: [] }], searchTerms: ['pendiente'], executionEnabled: false });
 const s = await r.start(h, { text: real, conversationId: 'conv-0001' });
 assert.equal(decisions, 1, 'the historical workflow was not replayed'); assert.equal(s.status, 'NEEDS_INFORMATION'); assert.equal(s.executionEnabled, false);
 // The historical record stays as evidence, now explicitly marked.
 assert.equal(store.get(h, 'workflow', workflowId(real)).objectiveSatisfied, false);
 // A marked (satisfied) workflow is replayed; if its mission now fails its objective it is invalidated.
 const t = 'Ordena mis temas abiertos';
 store.put(h, 'workflow', workflowId(t), { intention: t, plan: [{ key: 'm', capability: 'memory.search', dependsOn: [] }, { key: 'a', capability: 'data.analyze', dependsOn: ['m'] }], searchTerms: ['temas'], objectiveSatisfied: true, missionId: 'mission-old', executionEnabled: false });
 const before = decisions; const replay = await r.start(h, { text: t, conversationId: 'conv-0002' });
 assert.equal(decisions, before, 'a satisfied workflow is reused'); assert.equal(replay.status, 'NEEDS_INFORMATION');
 const marked = store.get(h, 'workflow', workflowId(t)); assert.equal(marked.objectiveSatisfied, false); assert.equal(marked.invalidatedBy, replay.id); assert.equal(marked.missionId, 'mission-old');
 await r.start(h, { text: t, conversationId: 'conv-0003' }); assert.equal(decisions, before + 1, 'an invalidated workflow is decided again');
 // 11: nothing in the state enables execution.
 assert.equal(r.executionEnabled, false);
});

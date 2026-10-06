'use strict';
// First real Cliente Cero mission (06/10/2026): a technical PASS is not the
// person's objective. An empty result answers only over the scope the person
// delimited by naming its sources (deterministic reading); over a scope a
// model inferred it never certifies the objective while relevant personal
// sources stay unconsulted. The needed sources come from the person's words
// or, once, from the decider: the same mission is extended, waits for its
// connections and resumes, so the order is never asked again. No real OAuth,
// Gmail or Calendar: connections are trusted fixture adapters.
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const http = require('node:http'); const { randomBytes, createHash } = require('node:crypto');
const { createAdaptivePlanner } = require('./adaptive-planner');
const { createServerComposition } = require('./server-composition');
const { createReadonlyAdapter } = require('./resource-adapters');
const { createSupervisedRuntime } = require('./mission-runtime');
const { createScopedStore } = require('./scope-session');
const { createExecutiveAuthorizer } = require('../../security/executive-authorization');
const INTERNAL = /\b(?:AVAILABLE_NOW|AVAILABLE_WITH_APPROVAL|NEEDS_CONNECTION|NEEDS_INFORMATION|UNAVAILABLE|BLOCKED|NEEDS_APPROVAL|NEEDS_CAPABILITY)\b|\b[a-z]+\.(?:read|search|remember|analyze|propose|schedule|extract|write)\b/;
// Fixture items shaped like the production private adapters (text + closed
// signals); the agenda date is relative to today so the fixture never expires.
const inDays = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const MAIL_ITEM = { text: 'Gestoría — Modelo 303: falta tu confirmación', signals: { type: 'mail', unread: true, important: true, starred: false, category: 'primary', date: '2026-10-06T08:00:00Z' } };
const EVENT_ITEM = () => ({ text: inDays(3) + ' · Comité semanal', signals: { type: 'calendar', start: inDays(3), allDay: true } });
const POLICY = { publicExternalAllowed: true, internalProviders: [{ providerId: 'fixture' }], confidentialProviders: [] };
const OLD_FALSE_CLOSURE = 'No he encontrado resultados en tus fuentes.';
const PRIVATE_TEXT = /Modelo 303|Comité semanal/;

// --- Decider contract -------------------------------------------------------
const ctx = () => ({ missionId: 'fixture', spend: { estimate: () => 0.001, reserve: () => ({}), settle: () => 0.001 } });
function planner(content) { const calls = []; return { calls, p: createAdaptivePlanner({ provider: { status: 'ready', provider: 'fixture', region: 'eu', modelId: 'fixture:luna', reason: async r => { calls.push(r); return { status: 'ok', content }; } }, privacyPolicy: POLICY, approvedDailyBudgetUsd: 1, requestFloor: 'INTERNAL' }) }; }
test('contract: personal current matters plan their relevant personal sources plus the analysis; advice, ideas and templates need none', async () => {
 const x = planner({ action: 'plan', plan: [{ key: 'a', capability: 'memory.search', dependsOn: [] }] });
 await x.p.decide({ intention: '¿Qué debería atender primero esta semana?', capabilities: ['memory.search', 'gmail.read', 'calendar.read', 'data.analyze'], capabilityStatus: [{ id: 'memory.search', status: 'AVAILABLE_NOW' }, { id: 'gmail.read', status: 'NEEDS_CONNECTION' }, { id: 'calendar.read', status: 'NEEDS_CONNECTION' }, { id: 'data.analyze', status: 'AVAILABLE_NOW' }] }, ctx());
 const rule = x.calls[0].constraints.find(v => /own current matters/.test(v));
 assert.ok(rule); assert.match(rule, /Never limit the plan to a source only because it is the one usable now/); assert.match(rule, /Advice, ideas, methods or templates about organizing need no source: answer them/);
 assert.doesNotMatch(rule, /organ[ií]zame|pendiente|hoy/i, 'the rule names no sentence of the person');
});

// --- HTTP composition with a fixture decider --------------------------------
const UID = 'fixture-owner-a'; const authorize = createExecutiveAuthorizer({ OXKIO_ADMIN_FIREBASE_UIDS: UID });
// decide(mission, replanning): replanning is true when the decider is asked
// again with the evidence of an empty first reading.
function decider(decide) { const calls = []; const modelId = 'fixture:luna'; return { status: 'ready', provider: 'fixture', region: 'eu', modelId, calls,
 catalog: { [modelId]: { provider: 'fixture', tier: 'small_model', inputUsdPerMillion: 0.2, outputUsdPerMillion: 1.2, residency: 'eu', privacy: 'fixture', pricingVersion: 'f', pricingSource: 'f', reviewedAt: '2026-10-04' } },
 async reason(request) { calls.push(request); return { status: 'ok', content: decide(request.mission, !!request.context?.conversation), usage: { inputTokens: 400, outputTokens: 120 } }; } }; }
const plan = (...caps) => ({ action: 'plan', plan: caps.map((capability, i) => ({ key: 's' + i, capability, dependsOn: [] })) });
const analyzed = (...sources) => ({ action: 'plan', plan: [...sources.map((capability, i) => ({ key: 's' + i, capability, dependsOn: [] })), { key: 'order', capability: 'data.analyze', dependsOn: sources.map((_, i) => 's' + i) }] });
const ADVICE = { action: 'answer', message: 'Te propongo un método sencillo para priorizar.', plan: [] };
function connections() {
 const state = { mail: false, calendar: false, mailItems: [MAIL_ITEM], reads: [] };
 const factory = async (identity, scope) => ({
  ...(state.mail ? { mail: createReadonlyAdapter({ scope, permissions: ['mail.read'], origin: 'fixture', read: async () => { state.reads.push('mail'); return state.mailItems; } }) } : {}),
  ...(state.calendar ? { calendar: createReadonlyAdapter({ scope, permissions: ['calendar.read'], origin: 'fixture', read: async () => { state.reads.push('calendar'); return [EVENT_ITEM()]; } }) } : {}),
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
const decisions = (p, from = 0) => p.calls.slice(from).length;

test('1/9: an explicit lookup of one named source that finds nothing is a COMPLETED answer, and its procedure is learned', async () => {
 const conn = connections(); conn.state.mail = true; conn.state.mailItems = [];
 const p = decider(m => /correos/.test(m) ? plan('gmail.read') : plan('memory.search')); const s = await setup([p], conn.factory);
 try {
  // Memory named explicitly: the deterministic fast path, no model at all.
  const r = await s.ask('¿Tengo algo guardado en mi memoria sobre el viaje a Oporto?'); const d = r.data.details;
  assert.equal(d.status, 'COMPLETED'); assert.deepEqual(d.result.items, []); assert.equal(d.connectionRequests.length, 0);
  assert.equal(r.data.response, 'He consultado tu memoria y no he encontrado resultados.'); assert.doesNotMatch(r.data.response, INTERNAL);
  assert.equal(decisions(p), 0); assert.ok(!d.trace.some(t => t.event === 'OBJECTIVE_REPLAN'));
  // Mail named explicitly, planned by the decider: an empty read answers it, with no replanning.
  const q = '¿Tengo correos de la gestoría?';
  const m = await s.ask(q); assert.equal(m.data.details.status, 'COMPLETED'); assert.equal(m.data.response, 'He consultado tu correo y no he encontrado resultados.');
  assert.equal(decisions(p), 1, 'no replanning over a scope the person delimited');
  const again = await s.ask(q); assert.equal(again.data.details.status, 'COMPLETED'); assert.equal(decisions(p), 1, 'a satisfied objective is reused');
  assert.equal(r.data.executionEnabled, false); assert.deepEqual(conn.state.reads, ['mail', 'mail']);
 } finally { await s.close(); }
});

test('2/3/4/10: the observed fault (decider picks only the empty memory) is never certified; the same mission is extended, waits for its connections and resumes without repeating the order', async () => {
 // First decision reproduces the real mission; with the evidence of the empty
 // reading the decider names the sources the objective needs.
 const conn = connections(); const p = decider((m, replanning) => replanning ? analyzed('calendar.read', 'gmail.read') : plan('memory.search')); const s = await setup([p], conn.factory);
 try {
  const q = 'Organízame lo que tengo pendiente y dime qué debería hacer primero hoy.';
  const first = await s.ask(q); const d = first.data.details; const id = first.data.missionId;
  assert.notEqual(d.status, 'COMPLETED'); assert.equal(d.status, 'NEEDS_CONNECTION'); assert.ok(id);
  assert.deepEqual(d.connectionRequests.map(g => g.capability).sort(), ['calendar.read', 'gmail.read']);
  assert.equal(d.diagnosis.class, 'objective_unmet'); assert.deepEqual(d.diagnosis.consulted, ['tu memoria']);
  const events = d.trace.map(t => t.event); assert.ok(events.indexOf('OBJECTIVE_REPLAN') > events.indexOf('CONSULT')); assert.ok(!events.includes('TERMINATE'));
  assert.match(first.data.response, /^He comprobado tu memoria y no contiene información para esto\./); assert.match(first.data.response, /sin que tengas que repetir la petición/);
  assert.notEqual(first.data.response, OLD_FALSE_CLOSURE); assert.doesNotMatch(first.data.response, INTERNAL);
  assert.equal(decisions(p), 2); assert.deepEqual(conn.state.reads, []);
  // 10: the replanning request carries only labels, never source content.
  assert.match(JSON.stringify(p.calls[1].context.conversation), /He consultado tu memoria y no contiene información/);
  // 4: the connections become valid; the same mission continues, no new interpretation.
  conn.state.mail = true; conn.state.calendar = true;
  const resumed = await s.ask('Ya lo he conectado'); const rd = resumed.data.details;
  assert.equal(resumed.data.missionId, id); assert.equal(rd.status, 'COMPLETED'); assert.equal(decisions(p), 2);
  assert.deepEqual(conn.state.reads.sort(), ['calendar', 'mail']); assert.match(resumed.data.response, /Comité semanal/); assert.match(resumed.data.response, /Modelo 303/);
  // 10: the private material was never sent to the provider; nothing executes.
  assert.ok(!p.calls.some(c => PRIVATE_TEXT.test(JSON.stringify(c)))); assert.equal(resumed.data.executionEnabled, false); assert.equal(first.data.executionEnabled, false);
  // 9: the satisfied mission teaches its extended procedure.
  const again = await s.ask(q); assert.equal(again.data.details.status, 'COMPLETED'); assert.equal(decisions(p), 2);
 } finally { await s.close(); }
});

test('7: only the sources the objective needs are requested, never every personal source', async () => {
 const conn = connections(); const p = decider((m, replanning) => replanning ? plan('calendar.read') : plan('memory.search')); const s = await setup([p], conn.factory);
 try {
  const r = await s.ask('¿Qué compromisos me quedan por cerrar esta semana?');
  assert.equal(r.data.details.status, 'NEEDS_CONNECTION'); assert.deepEqual(r.data.details.connectionRequests.map(g => g.capability), ['calendar.read']);
  assert.doesNotMatch(r.data.response, /tu correo/);
 } finally { await s.close(); }
 // Named scope: the person delimited agenda and mail; the decider read only the
 // mail (empty). The missing named source is added deterministically, with no
 // further model decision, and memory is never requested.
 const conn2 = connections(); conn2.state.mail = true; conn2.state.mailItems = [];
 const p2 = decider(() => plan('gmail.read')); const s2 = await setup([p2], conn2.factory);
 try {
  const r = await s2.ask('Organiza mis prioridades con mi correo y mi agenda.');
  assert.equal(r.data.details.status, 'NEEDS_CONNECTION'); assert.deepEqual(r.data.details.connectionRequests.map(g => g.capability), ['calendar.read']);
  assert.equal(decisions(p2), 1); assert.deepEqual(r.data.details.diagnosis.consulted, ['tu correo']);
 } finally { await s2.close(); }
});

test('2/8: when the decider keeps the fault, the runtime still certifies nothing: NEEDS_INFORMATION, and no procedure is learned', async () => {
 const p = decider(() => analyzed('memory.search')); const s = await setup([p], connections().factory);
 try {
  const q = 'Revisa lo que tengo y dime qué es urgente.';
  const r = await s.ask(q); const d = r.data.details;
  assert.equal(d.status, 'NEEDS_INFORMATION'); assert.equal(r.data.outcome, 'NEEDS_INFORMATION'); assert.equal(d.diagnosis.class, 'objective_unmet');
  assert.deepEqual(d.diagnosis.missing.map(v => v.label).sort(), ['tu agenda', 'tu correo']);
  assert.match(r.data.response, /He comprobado tu memoria y no contiene información para esto/); assert.match(r.data.response, /Dime dónde puede estar esa información/);
  assert.match(r.data.response, /No doy la tarea por terminada/); assert.doesNotMatch(r.data.response, INTERNAL);
  assert.equal(decisions(p), 2, 'one decision and one replanning, never more');
  // 8: the uncertified mission taught nothing: the same request is decided again.
  await s.ask(q); assert.equal(decisions(p), 4);
  assert.equal(r.data.executionEnabled, false);
 } finally { await s.close(); }
});

test('5: information only the person can give becomes a real NEEDS_INFORMATION with the decider\'s question, and is not resumable as a wait', async () => {
 const question = '¿Qué entregas o reuniones tienes previstas para mañana?';
 const p = decider((m, replanning) => replanning ? { action: 'clarify', message: question, plan: [] } : plan('memory.search')); const s = await setup([p], connections().factory);
 try {
  const r = await s.ask('Ponme en orden lo que tengo entre manos para mañana.');
  assert.equal(r.data.details.status, 'NEEDS_INFORMATION'); assert.equal(r.data.details.diagnosis.question, question);
  assert.equal(r.data.response, 'He comprobado tu memoria y no contiene información para esto. ' + question + ' No doy la tarea por terminada y no he realizado envíos ni cambios externos.');
  const resumed = await s.ask('', { action: 'resume', missionId: r.data.missionId });
  assert.equal(resumed.status, 400); assert.equal(resumed.data.code, 'terminal_mission'); assert.equal(resumed.data.executionEnabled, false);
 } finally { await s.close(); }
});

test('6: advice, ideas, methods and templates read no private source and create no mission', async () => {
 const conn = connections(); conn.state.mail = true; conn.state.calendar = true; const p = decider(() => ADVICE); const s = await setup([p], conn.factory);
 try {
  for (const q of ['Dame cinco ideas para organizarme.', 'Explícame cómo priorizar tareas.', 'Hazme una plantilla semanal.']) {
   const r = await s.ask(q); assert.equal(r.data.details.mode, 'COGNITIVE_ADVICE', q); assert.equal(r.data.missionId, null, q); assert.equal(r.data.executionEnabled, false, q);
  }
  assert.deepEqual(conn.state.reads, []);
 } finally { await s.close(); }
});

// --- Runtime: historical, satisfied and invalidated workflows ------------------
const A = { tenantId: 'tenant-aaa', clientId: 'client-aaa', userId: 'user-aaa', roles: ['owner'], status: 'ACTIVE' };
const membershipProvider = { findMemberships: async ({ authenticatedUserId }) => [A].filter(v => v.userId === authenticatedUserId) };
const workflowId = text => 'wf-' + createHash('sha256').update(text).digest('hex').slice(0, 40);
test('8/9: only a workflow whose mission satisfied its objective is replayed; historical and invalidated ones are kept but never reused', async () => {
 let store; let decided = 0;
 const r = createSupervisedRuntime({ membershipProvider, storeFactory: sessions => (store = createScopedStore(sessions)), conversationDecider: async () => { decided++; return { action: 'plan', plan: [{ key: 'm', capability: 'memory.search', dependsOn: [] }, { key: 'a', capability: 'data.analyze', dependsOn: ['m'] }] }; } });
 const h = await r.openSession(A.userId);
 // Historical record shaped like the one the real mission left (memory only, no mark).
 const real = 'Organízame lo que tengo pendiente y dime qué debería hacer primero hoy.';
 store.put(h, 'workflow', workflowId(real), { intention: real, plan: [{ key: 'buscar-pendientes', capability: 'memory.search', dependsOn: [] }], searchTerms: ['pendiente'], executionEnabled: false });
 const s = await r.start(h, { text: real, conversationId: 'conv-0001' });
 assert.equal(decided, 2, 'decided and replanned, not replayed'); assert.equal(s.status, 'NEEDS_INFORMATION'); assert.equal(s.executionEnabled, false);
 assert.equal(store.get(h, 'workflow', workflowId(real)).objectiveSatisfied, false, 'kept as history, marked');
 // A satisfied workflow is replayed; when its mission no longer satisfies the objective it is invalidated.
 const t = 'Ordena mis temas abiertos';
 store.put(h, 'workflow', workflowId(t), { intention: t, plan: [{ key: 'm', capability: 'memory.search', dependsOn: [] }, { key: 'a', capability: 'data.analyze', dependsOn: ['m'] }], searchTerms: ['temas'], objectiveSatisfied: true, missionId: 'mission-old', executionEnabled: false });
 const before = decided; const replay = await r.start(h, { text: t, conversationId: 'conv-0002' });
 assert.equal(decided, before + 1, 'replayed without a first decision; only the replanning was asked'); assert.equal(replay.status, 'NEEDS_INFORMATION');
 const marked = store.get(h, 'workflow', workflowId(t)); assert.equal(marked.objectiveSatisfied, false); assert.equal(marked.invalidatedBy, replay.id); assert.equal(marked.missionId, 'mission-old');
 await r.start(h, { text: t, conversationId: 'conv-0003' }); assert.equal(decided, before + 3, 'an invalidated workflow is decided again');
 assert.equal(r.executionEnabled, false);
});

'use strict';
// Issue #85 — conversational contract of the Cliente Cero cloud revision.
// A revision is conversational only when V3 has its own reasoning provider;
// health 200 or green CI is not enough. These tests compose V3 exactly as
// server.js does in the cloud with -V3Reasoning InternalEgress (the reviewed
// values are read from the deploy script, so both cannot drift), with a
// fixture model instead of the real provider. Synthetic data only.
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const http = require('node:http'); const { randomBytes } = require('node:crypto');
const { createServerComposition, reasoningEgressFromEnv, v3ReasoningEnv } = require('./server-composition');
const { createReadonlyAdapter } = require('./resource-adapters');
const { createExecutiveAuthorizer } = require('../../security/executive-authorization');
const { createExecutiveReasoningProvider } = require('../executive-brain/executive-reasoning-provider');

const ROOT = path.join(__dirname, '..', '..', '..');
const SCRIPT = fs.readFileSync(path.join(ROOT, 'deploy/cloud-run/v3/Invoke-OxkioV3CloudRevision.ps1'), 'utf8');
const SERVER = fs.readFileSync(path.join(ROOT, 'backend/api/server.js'), 'utf8');
// The reviewed cloud reasoning environment, as the deploy script writes it.
const block = SCRIPT.match(/\$script:V3ReasoningEnv=\[ordered\]@\{([\s\S]*?)\}\r?\n/);
const REVIEWED = block ? Object.fromEntries([...block[1].matchAll(/([A-Z0-9_]+)='([^']*)'/g)].map(m => [m[1], m[2]])) : {};
const READY_LINE = (SCRIPT.match(/\$script:V3ReasoningReadyLog='([^']+)'/) || [])[1];
const OFF_LINE = (SCRIPT.match(/\$script:V3ReasoningOffLog='([^']+)'/) || [])[1];

const UIDS = ['fixture-owner-a', 'fixture-owner-b'];
const authorize = createExecutiveAuthorizer({ OXKIO_ADMIN_FIREBASE_UIDS: UIDS.join(',') });
const GENERIC = /^Para avanzar necesito concretar el objetivo/;
const MARKER = 'ZZ-CONTRACT-77'; const EVENT = 'Comité sintético ZZ';

function withKey(fn) {
 const saved = process.env.OXKIO_REASONING_API_KEY; process.env.OXKIO_REASONING_API_KEY = 'sk-fixture-not-a-real-key';
 try { return fn(); } finally { if (saved === undefined) delete process.env.OXKIO_REASONING_API_KEY; else process.env.OXKIO_REASONING_API_KEY = saved; }
}
const startupLine = p => p.status === 'ready' ? `V3 Reasoning: ready (${p.modelId}, region ${p.region})` : 'V3 Reasoning: not configured';

test('contract: the reviewed cloud configuration starts the existing provider and the deploy smoke expects exactly its startup line', () => {
 assert.deepEqual(Object.keys(REVIEWED).sort(), ['OXKIO_V3_PLANNER_DAILY_BUDGET_USD', 'OXKIO_V3_REASONING_BASE_URL', 'OXKIO_V3_REASONING_INPUT_USD_PER_MILLION', 'OXKIO_V3_REASONING_INTERNAL_EGRESS', 'OXKIO_V3_REASONING_MODEL', 'OXKIO_V3_REASONING_OUTPUT_USD_PER_MILLION', 'OXKIO_V3_REASONING_PRICING_REVIEWED_AT', 'OXKIO_V3_REASONING_PROVIDER']);
 assert.ok(!Object.keys(REVIEWED).some(k => /KEY|SECRET|CONFIDENTIAL/.test(k)), 'no key or confidential egress in the reviewed values');
 // server.js prints the line the smoke test looks for.
 assert.match(SERVER, /console\.log\("V3 Reasoning:", v3ReasoningProvider\.status === "ready"\s*\? `ready \(\$\{v3ReasoningProvider\.modelId\}, region \$\{v3ReasoningProvider\.region\}\)`/);
 const provider = withKey(() => createExecutiveReasoningProvider({ env: v3ReasoningEnv(REVIEWED) }));
 assert.equal(provider.status, 'ready');
 assert.equal(startupLine(provider), READY_LINE);
 assert.equal(READY_LINE, 'V3 Reasoning: ready (openai:gpt-5.6-luna, region eu)');
 // Without the key (or without the reviewed values) the revision is not conversational and says so.
 const saved = process.env.OXKIO_REASONING_API_KEY; delete process.env.OXKIO_REASONING_API_KEY;
 try { assert.equal(startupLine(createExecutiveReasoningProvider({ env: v3ReasoningEnv(REVIEWED) })), OFF_LINE); } finally { if (saved !== undefined) process.env.OXKIO_REASONING_API_KEY = saved; }
 assert.equal(withKey(() => startupLine(createExecutiveReasoningProvider({ env: v3ReasoningEnv({}) }))), OFF_LINE);
 // Privacy Gate: INTERNAL may reach this provider only; CONFIDENTIAL never.
 const egress = reasoningEgressFromEnv(REVIEWED, provider);
 assert.equal(egress.requestPrivacyFloor, 'INTERNAL');
 assert.deepEqual(egress.privacyPolicy.internalProviders, [{ providerId: 'openai' }]);
 assert.deepEqual(egress.privacyPolicy.confidentialProviders, []);
 assert.deepEqual(reasoningEgressFromEnv({ ...REVIEWED, OXKIO_V3_REASONING_INTERNAL_EGRESS: 'false' }, provider), {});
});

// A fixture model with the reviewed provider identity, so the real cloud policy object applies to it.
function model(decide) {
 const calls = []; const modelId = 'openai:gpt-5.6-luna';
 return { status: 'ready', provider: 'openai', region: 'eu', modelId, calls,
  catalog: { [modelId]: { provider: 'openai', tier: 'small_model', inputUsdPerMillion: 0.2, outputUsdPerMillion: 1.2, residency: 'eu', privacy: 'fixture', pricingVersion: 'f', pricingSource: 'f', reviewedAt: '2026-10-04' } },
  async reason(request) { calls.push(request); return { status: 'ok', content: decide(String(request.mission || '')), usage: { inputTokens: 300, outputTokens: 90 } }; } };
}
const plan = (...caps) => ({ action: 'plan', plan: caps.map((capability, i) => ({ key: 's' + i, capability, dependsOn: [] })) });
// Natural wording, no fixed keyword: understanding decides what to read.
const understand = m => /c[oó]digo/i.test(m) ? plan('memory.search') : /semana|agenda/i.test(m) ? plan('calendar.read') : { action: 'answer', message: 'Hola. Puedo ayudarte a organizar tu trabajo, recordar lo que me pidas y consultar tu agenda cuando la conectes.', plan: [] };

function connections() {
 const state = { calendar: false, reads: 0 };
 const factory = async (identity, scope) => (state.calendar ? { calendar: createReadonlyAdapter({ scope, permissions: ['calendar.read'], origin: 'fixture', read: async () => { state.reads += 1; const d = new Date(); d.setDate(d.getDate() + 2); return [{ text: d.toISOString().slice(0, 10) + ' · ' + EVENT, signals: { type: 'calendar', start: d.toISOString().slice(0, 10), allDay: true } }]; } }) } : {});
 return { state, factory };
}
async function compose({ root, key, provider, adapters }) {
 const egress = reasoningEgressFromEnv(REVIEWED, provider);
 assert.equal(egress.requestPrivacyFloor, 'INTERNAL');
 const c = createServerComposition({ enabled: true, cohortUids: UIDS.join(','), memoryRoot: root, integrityKey: key, authorizeIdentity: authorize, adapterFactory: adapters,
  reasoning: { provider, catalog: provider.catalog, approvedDailyBudgetUsd: Number(REVIEWED.OXKIO_V3_PLANNER_DAILY_BUDGET_USD), ...egress } });
 const server = http.createServer((req, res) => { const uid = req.headers['x-fixture-owner']; req.oxkioIdentity = uid ? authorize({ uid }).identity : null; c.handle(req, res).catch(() => { res.writeHead(500); res.end('{}'); }); });
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 const ask = async (query, { uid = UIDS[0], conversationId = 'conversation-contract-1' } = {}) => {
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/executive/chat`, { method: 'POST', headers: { 'content-type': 'application/json', ...(uid ? { 'x-fixture-owner': uid } : {}) }, body: JSON.stringify({ query, conversationId, includeDetails: true }) });
  const text = await res.text(); return { status: res.status, data: text ? JSON.parse(text) : {} };
 };
 return { ask, close: () => new Promise(r => server.close(r)) };
}
const sent = p => JSON.stringify(p.calls);

test('contract: natural conversation, memory by owner, Google connection, read-only agenda, continuation, privacy and reboot', async () => {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v3-contract-')); const key = randomBytes(32);
 const conn = connections(); const provider = model(understand);
 let s = await compose({ root, key, provider, adapters: conn.factory });
 try {
  // Greeting: a real answer from the reasoner, not the generic clarification.
  let r = await s.ask('Hola, buenas tardes');
  assert.equal(r.status, 200); assert.doesNotMatch(r.data.response, GENERIC); assert.match(r.data.response, /Puedo ayudarte/); assert.equal(r.data.executionEnabled, false);
  // Memory written only on an explicit request.
  r = await s.ask(`Recuerda que el código de la prueba de contrato es ${MARKER}`);
  assert.match(r.data.response, /He guardado/);
  // Natural question in a new conversation, without the marker nor a fixed keyword.
  r = await s.ask('¿Cuál era el código de la prueba de contrato?', { conversationId: 'conversation-contract-2' });
  assert.doesNotMatch(r.data.response, GENERIC); assert.match(r.data.response, new RegExp(MARKER));
  // Another owner never sees it.
  r = await s.ask('¿Cuál era el código de la prueba de contrato?', { uid: UIDS[1], conversationId: 'conversation-contract-3' });
  assert.doesNotMatch(r.data.response, new RegExp(MARKER));
  // Agenda without connection: the existing Google flow is offered; nothing is read.
  r = await s.ask('¿Qué tengo esta semana?', { conversationId: 'conversation-contract-4' });
  assert.equal(r.data.outcome, 'NEEDS_CONNECTION'); assert.equal(r.data.connect, 'google'); assert.equal(conn.state.reads, 0);
  // After the (fixture) authorization, «continúa» resumes the same mission, read-only.
  conn.state.calendar = true; const id = r.data.missionId;
  r = await s.ask('continúa', { conversationId: 'conversation-contract-4' });
  assert.equal(r.data.missionId, id); assert.equal(r.data.details.status, 'COMPLETED'); assert.equal(conn.state.reads, 1);
  assert.match(r.data.response, new RegExp(EVENT)); assert.equal(r.data.executionEnabled, false); assert.equal(r.data.connect, undefined);
  // A follow-up on private content stays local.
  const before = provider.calls.length;
  r = await s.ask('¿Cuál elegirías?', { conversationId: 'conversation-contract-4' });
  assert.equal(provider.calls.length, before); assert.equal(r.data.executionEnabled, false);
  // Privacy: memory and agenda content never reached the provider.
  // The reasoner really understood the natural questions (the agenda question is read locally).
  assert.ok(provider.calls.length >= 2 && sent(provider).includes('Hola, buenas tardes') && sent(provider).includes('prueba de contrato'), 'the reasoner really received the questions');
  assert.ok(!sent(provider).includes(MARKER), 'memory content egressed'); assert.ok(!sent(provider).includes(EVENT), 'agenda content egressed');
  // Boundary: unauthenticated 401.
  assert.equal((await s.ask('Hola', { uid: null })).status, 401);
  // Reboot: a new composition over the same sealed store recalls the memory.
  await s.close(); s = await compose({ root, key, provider: model(understand), adapters: conn.factory });
  r = await s.ask('¿Cuál era el código de la prueba de contrato?', { conversationId: 'conversation-contract-5' });
  assert.match(r.data.response, new RegExp(MARKER));
 } finally { await s.close(); fs.rmSync(root, { recursive: true, force: true }); }
});

test('contract: the same natural questions without a reasoning provider are NOT conversational (the state a cloud Off revision must declare)', async () => {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v3-contract-off-'));
 const provider = createExecutiveReasoningProvider({ env: {} });
 const c = createServerComposition({ enabled: true, cohortUids: UIDS[0], memoryRoot: root, integrityKey: randomBytes(32), authorizeIdentity: authorize, reasoning: { provider, catalog: {}, approvedDailyBudgetUsd: 0, ...reasoningEgressFromEnv(REVIEWED, provider) } });
 const server = http.createServer((req, res) => { req.oxkioIdentity = authorize({ uid: UIDS[0] }).identity; c.handle(req, res).catch(() => { res.writeHead(500); res.end('{}'); }); });
 await new Promise(r => server.listen(0, '127.0.0.1', r));
 try {
  const ask = async q => (await (await fetch(`http://127.0.0.1:${server.address().port}/api/executive/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: q, conversationId: 'conversation-off-1' }) })).json());
  await ask(`Recuerda que el código de la prueba de contrato es ${MARKER}`);
  for (const q of ['Hola, buenas tardes', '¿Cuál era el código de la prueba de contrato?']) assert.match((await ask(q)).response, GENERIC, q);
 } finally { await new Promise(r => server.close(r)); fs.rmSync(root, { recursive: true, force: true }); }
});

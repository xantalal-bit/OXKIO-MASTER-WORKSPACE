'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { randomBytes } = require('node:crypto');
const { createServerComposition } = require('./server-composition');
const { createExecutiveAuthorizer } = require('../../security/executive-authorization');
const { createGovernedReasoner, FAILURES } = require('./governed-reasoning');
const { createExecutiveReasoningProvider } = require('../executive-brain/executive-reasoning-provider');
const { DEFAULT_PRIVACY_POLICY } = require('../executive-brain/privacy-gate');
// Local, zero-cost stand-ins with the exact Executive Reasoning Provider
// contract. No network and no real model: these tests prove the governed
// path (privacy, budget, ledger, verifier, failover, checkpoint), not quality.
const UID = 'cliente-cero-controlled';
const authorize = createExecutiveAuthorizer({ OXKIO_ADMIN_FIREBASE_UIDS: UID });
const identity = authorize({ uid: UID }).identity;
function provider(providerId, model, behaviour) {
 const modelId = providerId + ':' + model; const calls = [];
 return { calls, status: 'ready', provider: providerId, model, modelId, region: 'eu', behaviour,
  catalog: { [modelId]: { provider: providerId, tier: 'small_model', inputUsdPerMillion: 1, outputUsdPerMillion: 2, residency: 'eu', privacy: 'provider_api', pricingVersion: 'fixture', pricingSource: 'test-fixture', reviewedAt: '2026-10-04' } },
  async reason(request) { calls.push(request); return this.behaviour(request); } };
}
const synthesis = request => {
 const ids = request.context.sources.map(s => s.id);
 return { status: 'ok', usage: { inputTokens: 400, outputTokens: 120 }, content: {
  findings: [{ claim: 'Alfa cuesta más pero da soporte en español.', sourceIds: [ids[0]] }, { claim: 'Beta es más barato y no da soporte en español.', sourceIds: [ids[1]] }],
  comparison: 'Difieren en precio y en soporte.', conclusion: 'Si el soporte en español es imprescindible conviene Alfa; si prima el coste, Beta.' } };
};
const rateLimited = () => ({ status: 'error', errorCode: 'reasoning_rate_limited' });
const quota = () => ({ status: 'error', errorCode: 'reasoning_rate_limited', failureType: 'QUOTA_EXHAUSTED' });
const EU = providerId => ({ providerId, region: 'eu' });
const QUESTION = 'Recupera de mi memoria lo que guardé sobre proveedores y compáralos';
async function setup({ providers = [], budget = 1, policy = { publicExternalAllowed: true, internalProviders: [], confidentialProviders: providers.map(p => EU(p.provider)) }, root, key, floor, adapterFactory = null } = {}) {
 const memoryRoot = root || fs.mkdtempSync(path.join(os.tmpdir(), 'v3-cognitive-')); const integrityKey = key || randomBytes(32);
 const server = createServerComposition({ enabled: true, cohortUids: UID, integrityKey, memoryRoot, authorizeIdentity: authorize, adapterFactory,
  reasoning: { providers, privacyPolicy: policy, approvedDailyBudgetUsd: budget, ...(floor ? { requestPrivacyFloor: floor } : {}) } });
 async function ask(query, extra = {}) {
  const req = Readable.from([JSON.stringify({ query, includeDetails: true, ...extra })]); req.oxkioIdentity = identity;
  let status, body; await server.handle(req, { writeHead(s) { status = s; }, end(b) { body = b; } });
  return { status, data: body ? JSON.parse(body) : null };
 }
 async function seed() {
  for (const fact of ['Recuerda que entre los proveedores, Alfa cuesta 10 euros al mes con soporte en español', 'Recuerda que entre los proveedores, Beta cuesta 7 euros al mes sin soporte en español'])
   assert.equal((await ask(fact)).data.details.status, 'COMPLETED');
 }
 return { ask, seed, root: memoryRoot, key: integrityKey, cleanup: () => fs.rmSync(memoryRoot, { recursive: true, force: true }) };
}
const events = details => details.trace.map(t => t.event);

test('cognition stays off by default: zero budget keeps the deterministic analysis and no text leaves', async () => {
 const primary = provider('openai', 'primary', synthesis);
 const s = await setup({ providers: [primary], budget: 0 });
 try {
  await s.seed(); const r = await s.ask(QUESTION);
  assert.equal(r.data.details.status, 'COMPLETED'); assert.equal(r.data.details.result.synthesis, undefined);
  assert.equal(primary.calls.length, 0); assert.match(r.data.response, /Alfa/);
 } finally { s.cleanup(); }
});

test('real cognitive path: retrieve -> analyze/compare/synthesize with a model -> verified citations -> cost in the owner ledger', async () => {
 const primary = provider('openai', 'primary', synthesis);
 const s = await setup({ providers: [primary] });
 try {
  await s.seed(); const r = await s.ask(QUESTION); const d = r.data.details;
  assert.equal(d.status, 'COMPLETED'); assert.equal(primary.calls.length, 1);
  // Minimal context only: the objective and the bounded source snapshot.
  assert.deepEqual(Object.keys(primary.calls[0].context).sort(), ['objective', 'sources']);
  assert.equal(primary.calls[0].context.sources.length, 2);
  assert.equal(d.result.synthesis.resource, 'openai:primary'); assert.equal(d.result.synthesis.privacyClass, 'CONFIDENTIAL');
  assert.deepEqual(d.result.synthesis.failover, []);
  assert.match(r.data.response, /conviene Alfa/); assert.match(r.data.response, /\[fuente 1\]/); assert.match(r.data.response, /\[fuente 2\]/);
  assert.match(r.data.response, /Análisis generado por openai:primary; verificado contra 2 fuentes/);
  assert.ok(events(d).includes('COGNITION'));
  assert.equal(d.cost.models['openai:primary'].calls, 1); assert.ok(d.cost.chargedUsd > 0);
 } finally { s.cleanup(); }
});

test('failover: primary QUOTA_EXHAUSTED -> fallback resource -> verified -> completed, with no human turn', async () => {
 const primary = provider('openai', 'primary', quota); const fallback = provider('anthropic', 'fallback', synthesis);
 const s = await setup({ providers: [primary, fallback] });
 try {
  await s.seed(); const r = await s.ask(QUESTION); const d = r.data.details;
  assert.equal(d.status, 'COMPLETED'); assert.equal(primary.calls.length, 1); assert.equal(fallback.calls.length, 1);
  // The same minimal context, never more, reached the fallback.
  assert.deepEqual(fallback.calls[0].context, primary.calls[0].context);
  assert.equal(d.result.synthesis.resource, 'anthropic:fallback');
  assert.deepEqual(d.result.synthesis.failover, [{ resource: 'openai:primary', failure: 'QUOTA_EXHAUSTED' }]);
  const ev = events(d); assert.ok(ev.indexOf('RESOURCE_FAILED') < ev.indexOf('COGNITION'));
  assert.match(r.data.response, /tras no estar disponible openai:primary/);
  assert.equal(d.cost.models['openai:primary'].calls, 1); assert.equal(d.cost.models['anthropic:fallback'].calls, 1);
 } finally { s.cleanup(); }
});

test('verifier: a synthesis citing an unissued source is rejected and the next resource is used', async () => {
 const lying = provider('openai', 'primary', req => { const ok = synthesis(req); ok.content.findings[0].sourceIds = ['invented-source']; return ok; });
 const fallback = provider('anthropic', 'fallback', synthesis);
 const s = await setup({ providers: [lying, fallback] });
 try {
  await s.seed(); const d = (await s.ask(QUESTION)).data.details;
  assert.equal(d.status, 'COMPLETED'); assert.deepEqual(d.result.synthesis.failover, [{ resource: 'openai:primary', failure: 'INVALID_OUTPUT' }]);
 } finally { s.cleanup(); }
});

test('Privacy Gate runs before any transfer: an unapproved fallback never receives the context; the mission waits instead', async () => {
 const primary = provider('openai', 'primary', rateLimited); const fallback = provider('anthropic', 'fallback', synthesis);
 const s = await setup({ providers: [primary, fallback], policy: { publicExternalAllowed: true, internalProviders: [], confidentialProviders: [EU('openai')] } });
 try {
  await s.seed(); const r = await s.ask(QUESTION); const d = r.data.details;
  assert.equal(fallback.calls.length, 0); assert.equal(d.status, 'WAITING_RESOURCE');
  assert.deepEqual(d.diagnosis.attempts.map(a => a.failure), ['RATE_LIMIT', 'PRIVACY_BLOCKED']);
  assert.match(r.data.response, /quedan guardadas en este punto/);
 } finally { s.cleanup(); }
});

test('with every resource privacy-blocked (canonical default policy) the deterministic analysis stands and nothing leaves', async () => {
 const primary = provider('openai', 'primary', synthesis);
 const s = await setup({ providers: [primary], policy: DEFAULT_PRIVACY_POLICY });
 try {
  await s.seed(); const d = (await s.ask(QUESTION)).data.details;
  assert.equal(d.status, 'COMPLETED'); assert.equal(primary.calls.length, 0); assert.equal(d.result.synthesis, undefined);
  assert.ok(events(d).includes('COGNITION_SKIPPED'));
 } finally { s.cleanup(); }
});

test('BUDGET_EXHAUSTED never calls the model and keeps the mission at its checkpoint', async () => {
 const primary = provider('openai', 'primary', synthesis);
 const s = await setup({ providers: [primary], budget: 0.0000001 });
 try {
  await s.seed(); const d = (await s.ask(QUESTION)).data.details;
  assert.equal(primary.calls.length, 0); assert.equal(d.status, 'WAITING_RESOURCE');
  assert.deepEqual(d.diagnosis.attempts.map(a => a.failure), ['BUDGET_EXHAUSTED']);
 } finally { s.cleanup(); }
});

test('no substitute: WAITING_RESOURCE survives a restart with the same integrity key and resumes from the checkpoint', async () => {
 const primary = provider('openai', 'primary', rateLimited); const fallback = provider('anthropic', 'fallback', rateLimited);
 const s = await setup({ providers: [primary, fallback] });
 try {
  await s.seed(); const waiting = await s.ask(QUESTION);
  assert.equal(waiting.data.details.status, 'WAITING_RESOURCE'); const missionId = waiting.data.missionId;
  assert.deepEqual(waiting.data.details.diagnosis.attempts.map(a => a.failure), ['RATE_LIMIT', 'RATE_LIMIT']);
  // Process restart: new composition, same sealed root and key; the primary recovered.
  const recovered = provider('openai', 'primary', synthesis); const later = provider('anthropic', 'fallback', rateLimited);
  const s2 = await setup({ providers: [recovered, later], root: s.root, key: s.key });
  const r = await s2.ask('continúa', { action: 'resume', missionId });
  const d = r.data.details;
  assert.equal(d.status, 'COMPLETED'); assert.equal(d.result.synthesis.resource, 'openai:primary');
  // The source step was sealed evidence: it was not consulted again.
  assert.equal(d.trace.filter(t => t.event === 'CONSULT' && t.capability === 'memory.search').length, 1);
  assert.ok(events(d).includes('WAITING_RESOURCE'));
 } finally { s.cleanup(); }
});

test('a different integrity key cannot resume sealed missions (fail closed, nothing replayed)', async () => {
 const s = await setup({ providers: [provider('openai', 'primary', rateLimited)] });
 try {
  await s.seed(); const waiting = await s.ask(QUESTION);
  const s2 = await setup({ providers: [provider('openai', 'primary', synthesis)], root: s.root });
  const r = await s2.ask('continúa', { action: 'resume', missionId: waiting.data.missionId });
  assert.equal(r.status, 409); assert.equal(r.data.code, 'stored_integrity_invalid');
 } finally { s.cleanup(); }
});

test('governed reasoner classifies each failure type and is disabled without budget or provider', async () => {
 assert.equal(createGovernedReasoner({ providers: [provider('openai', 'p', synthesis)], approvedDailyBudgetUsd: 0 }).enabled, false);
 assert.equal(createGovernedReasoner({ providers: [], approvedDailyBudgetUsd: 5 }).enabled, false);
 assert.equal(createGovernedReasoner({ providers: [{ status: 'not_configured' }], approvedDailyBudgetUsd: 5 }).enabled, false);
 const behaviours = [[() => ({ status: 'not_configured' }), FAILURES.RESOURCE_UNAVAILABLE], [rateLimited, FAILURES.RATE_LIMIT], [quota, FAILURES.QUOTA_EXHAUSTED],
  [() => ({ status: 'error', errorCode: 'reasoning_upstream_error' }), FAILURES.PROVIDER_ERROR], [() => { throw new Error('network'); }, FAILURES.PROVIDER_ERROR]];
 for (const [behaviour, expected] of behaviours) {
  const p = provider('openai', 'p', behaviour);
  const spend = { estimate: () => 0.001, reserve: () => ({}), settle: () => 0.001 };
  const r = createGovernedReasoner({ providers: [p], privacyPolicy: { confidentialProviders: [EU('openai')] }, approvedDailyBudgetUsd: 1 });
  await assert.rejects(r.reason({ objective: 'objetivo', egressText: 'objetivo', request: {}, basis: {}, spend, missionId: 'm-1' }), e => e.code === 'reasoning_resource_unavailable' && e.attempts[0].failure === expected && e.transient === true);
 }
});

test('existing provider: OpenAI insufficient_quota keeps its errorCode and adds QUOTA_EXHAUSTED; a plain 429 stays a rate limit', async () => {
 const env = { OXKIO_REASONING_PROVIDER: 'openai', OXKIO_REASONING_MODEL: 'm', OXKIO_REASONING_BASE_URL: 'https://eu.api.openai.com/v1', OXKIO_REASONING_INPUT_USD_PER_MILLION: '1', OXKIO_REASONING_OUTPUT_USD_PER_MILLION: '2', OXKIO_REASONING_PRICING_REVIEWED_AT: '2026-10-04' };
 const make = error => createExecutiveReasoningProvider({ env, secretRuntime: { getSecret: () => 'not-a-real-key' }, adapters: { openai: () => async () => { throw error; } } });
 const exhausted = await make(Object.assign(new Error('x'), { status: 429, code: 'insufficient_quota' })).reason({ mission: 'm', context: {}, constraints: [], output: {} });
 assert.deepEqual(exhausted, { status: 'error', errorCode: 'reasoning_rate_limited', failureType: 'QUOTA_EXHAUSTED' });
 const limited = await make(Object.assign(new Error('x'), { status: 429, code: 'rate_limit_exceeded' })).reason({ mission: 'm', context: {}, constraints: [], output: {} });
 assert.deepEqual(limited, { status: 'error', errorCode: 'reasoning_rate_limited' });
});

test('repeated waits never burn the engine attempt budget: a long outage still ends COMPLETED', async () => {
 const primary = provider('openai', 'primary', rateLimited);
 const s = await setup({ providers: [primary] });
 try {
  await s.seed(); let r = await s.ask(QUESTION);
  for (let i = 0; i < 6; i++) { r = await s.ask('continúa', { action: 'resume', missionId: r.data.missionId }); assert.equal(r.data.details.status, 'WAITING_RESOURCE'); }
  primary.behaviour = synthesis;
  r = await s.ask('continúa', { action: 'resume', missionId: r.data.missionId });
  assert.equal(r.data.details.status, 'COMPLETED'); assert.equal(r.data.details.result.synthesis.resource, 'openai:primary');
 } finally { s.cleanup(); }
});

// Authorization B (04/10/2026): PUBLIC and non-sensitive INTERNAL may reach the
// approved provider; CONFIDENTIAL, SECRET and personal data stay blocked.
const { createPublicResearchAdapters } = require('./resource-adapters');
const POLICY_B = { publicExternalAllowed: true, internalProviders: [{ providerId: 'openai' }], confidentialProviders: [] };
const PUBLIC_QUESTION = 'Investiga en fuentes públicas el reglamento de protección de datos y la ley de inteligencia artificial y compáralos';
const publicSources = async (identityArg, scope) => createPublicResearchAdapters({ scope, origin: 'fixture',
 search: async () => [{ title: 'snippet rgpd', url: 'https://example.org/rgpd' }, { title: 'snippet ia', url: 'https://example.org/ia' }],
 fetcher: { fetchPage: async url => ({ text: url.endsWith('rgpd') ? 'El reglamento de protección de datos regula el tratamiento de datos personales en la unión.' : 'La ley de inteligencia artificial clasifica los sistemas por niveles de riesgo.' }) } });
const publicSynthesis = request => { const ids = request.context.sources.map(s => s.id); return { status: 'ok', usage: { inputTokens: 300, outputTokens: 90, cachedTokens: 0 }, evidence: { responseId: 'resp-fixture', responseModel: 'fixture-model' },
 content: { findings: [{ claim: 'Uno regula datos personales.', sourceIds: [ids[0]] }, { claim: 'La otra clasifica sistemas por riesgo.', sourceIds: [ids[1]] }], comparison: 'Objetos distintos.', conclusion: 'Son complementarios.' } }; };

test('B: a public-only mission reasons as INTERNAL, over fetched pages only (snippets are not final evidence)', async () => {
 const p = provider('openai', 'luna', publicSynthesis); p.region = 'global';
 const s = await setup({ providers: [p], policy: POLICY_B, floor: 'INTERNAL', adapterFactory: publicSources });
 try {
  const d = (await s.ask(PUBLIC_QUESTION)).data.details;
  assert.equal(d.status, 'COMPLETED'); assert.equal(p.calls.length, 1);
  assert.equal(d.result.synthesis.privacyClass, 'INTERNAL');
  assert.deepEqual(p.calls[0].context.sources.map(v => v.provenance), ['PUBLIC_WEB', 'PUBLIC_WEB']);
  assert.deepEqual(d.result.synthesis.call, { responseId: 'resp-fixture', responseModel: 'fixture-model' });
  assert.equal(d.result.synthesis.usage.cachedTokens, 0); assert.equal(d.result.synthesis.sourceIds.length, 2);
 } finally { s.cleanup(); }
});

test('B: private memory (CONFIDENTIAL) never leaves; the deterministic analysis stands', async () => {
 const p = provider('openai', 'luna', synthesis); p.region = 'global';
 const s = await setup({ providers: [p], policy: POLICY_B, floor: 'INTERNAL' });
 try {
  await s.seed(); const d = (await s.ask(QUESTION)).data.details;
  assert.equal(p.calls.length, 0); assert.equal(d.status, 'COMPLETED'); assert.equal(d.result.synthesis, undefined); assert.ok(events(d).includes('COGNITION_SKIPPED'));
 } finally { s.cleanup(); }
});

test('B: a request about a person or carrying an identifier is CONFIDENTIAL and is not sent', async () => {
 for (const question of ['Investiga en fuentes públicas el reglamento de protección de datos y compáralo con mis contratos', 'Investiga en fuentes públicas la ley de inteligencia artificial y compárala para ana@example.org']) {
  const p = provider('openai', 'luna', publicSynthesis); p.region = 'global';
  const s = await setup({ providers: [p], policy: POLICY_B, floor: 'INTERNAL', adapterFactory: publicSources });
  try {
   const d = (await s.ask(question)).data.details;
   assert.equal(p.calls.length, 0, question); assert.equal(d.result?.synthesis, undefined);
  } finally { s.cleanup(); }
 }
});

test('B: without the explicit INTERNAL floor nothing leaves, and a PUBLIC floor is refused', async () => {
 const p = provider('openai', 'luna', publicSynthesis); p.region = 'global';
 const s = await setup({ providers: [p], policy: POLICY_B, adapterFactory: publicSources });
 try { const d = (await s.ask(PUBLIC_QUESTION)).data.details; assert.equal(p.calls.length, 0); assert.ok(events(d).includes('COGNITION_SKIPPED')); } finally { s.cleanup(); }
 assert.throws(() => createGovernedReasoner({ providers: [p], approvedDailyBudgetUsd: 1, requestFloor: 'PUBLIC' }), e => e.code === 'request_floor_invalid');
});

test('the real OpenAI adapter reports cached tokens, response id and model snapshot without content', async () => {
 const { ADAPTERS } = require('../executive-brain/executive-reasoning-provider');
 const Module = require('node:module'); const original = Module._load;
 Module._load = function (request, ...rest) { if (request === 'openai') return class { constructor() { this.chat = { completions: { create: async () => ({ id: 'chatcmpl-x', model: 'gpt-5.6-luna-2026-x', choices: [{ message: { content: '{}' } }], usage: { prompt_tokens: 10, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 4 } } }) } }; } }; return original.call(this, request, ...rest); };
 try {
  const complete = ADAPTERS.openai({ apiKey: 'not-a-real-key', model: 'gpt-5.6-luna', timeoutMs: 1000, baseURL: 'https://api.openai.com/v1' });
  const r = await complete({ system: 's', user: 'u', maxOutputTokens: 10 });
  assert.deepEqual(r.usage, { inputTokens: 10, outputTokens: 5, cachedTokens: 4 }); assert.deepEqual(r.evidence, { responseId: 'chatcmpl-x', responseModel: 'gpt-5.6-luna-2026-x' });
 } finally { Module._load = original; }
});

test('a model call longer than a source read is bounded by the cognition timeout, not retried as a tool timeout', async () => {
 const { createSupervisedRuntime } = require('./mission-runtime');
 const A = { tenantId: 'tenant-aaa', clientId: 'client-aaa', userId: 'user-aaa', roles: ['owner'], status: 'ACTIVE' };
 const slow = provider('openai', 'primary', async req => { await new Promise(r => setTimeout(r, 300)); return synthesis(req); });
 const reasoner = createGovernedReasoner({ providers: [slow], privacyPolicy: { confidentialProviders: [EU('openai')] }, approvedDailyBudgetUsd: 1 });
 const r = createSupervisedRuntime({ membershipProvider: { findMemberships: async () => [A] }, reasoner, catalog: slow.catalog, taskTimeoutMs: 100, cognitionTimeoutMs: 3000 });
 const h = await r.openSession(A.userId);
 for (const t of ['Recuerda que entre los proveedores, Alfa cuesta 10 euros', 'Recuerda que entre los proveedores, Beta cuesta 7 euros']) await r.start(h, { text: t, conversationId: 'conv-0001' });
 const done = await r.start(h, { text: QUESTION, conversationId: 'conv-0001' });
 assert.equal(done.status, 'COMPLETED'); assert.equal(slow.calls.length, 1); assert.equal(done.result.synthesis.resource, 'openai:primary');
});

test('public pages become readable source text (paragraphs, no markup or scripts)', () => {
 const { readableText } = require('./resource-adapters');
 const html = '<html><head><title>T</title><script>var x=1;</script></head><body><nav>Menú principal</nav><p>Primer párrafo con <b>contenido</b> suficiente para ser evidencia legible.</p><p>corto</p><p>Segundo párrafo que también cuenta como texto de la fuente pública.</p></body></html>';
 assert.equal(readableText(html), 'Primer párrafo con contenido suficiente para ser evidencia legible. Segundo párrafo que también cuenta como texto de la fuente pública.');
 assert.equal(readableText('<div>Solo texto visible</div><script>no</script>'), 'Solo texto visible');
});

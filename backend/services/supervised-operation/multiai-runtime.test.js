'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { randomBytes } = require('node:crypto');
const { routeReasoning, ROUTES, EXCLUSIONS } = require('./reasoning-router');
const { createGovernedReasoner, FAILURES, ROLES } = require('./governed-reasoning');
const { createCostLedger, resolveBudget, ACCOUNTING_CURRENCY } = require('./cost-ledger');
const { createMemoryStoreFactory } = require('./memory-store');
const { createHmacIntegrity } = require('./integrity');
const { createServerComposition, reasoningEgressFromEnv } = require('./server-composition');
const { createExecutiveAuthorizer } = require('../../security/executive-authorization');
const { DEFAULT_PRIVACY_POLICY } = require('../executive-brain/privacy-gate');
// Multi-IA V1-A (10/10/2026): router, budget, execution records. Local,
// zero-cost fake providers with the Executive Reasoning Provider contract; no
// network, no real model, no real provider is configured by these tests.
const NOW = '2026-10-10T10:00:00.000Z';
const BASIS = { inputTokens: 1000, outputTokens: 500 };
function provider(providerId, model, behaviour, { input = 1, output = 2, tier = 'small_model', tasks } = {}) {
 const modelId = providerId + ':' + model; const calls = [];
 return { calls, status: 'ready', provider: providerId, model, modelId, region: 'eu', behaviour, ...(tasks ? { tasks } : {}),
  catalog: { [modelId]: { provider: providerId, tier, inputUsdPerMillion: input, outputUsdPerMillion: output, residency: 'eu', privacy: 'provider_api', pricingVersion: 'fixture', pricingSource: 'test-fixture', reviewedAt: '2026-10-04' } },
  async reason(request) { calls.push(request); return this.behaviour(request); } };
}
const ok = () => ({ status: 'ok', usage: { inputTokens: 1000, outputTokens: 500 }, content: { answer: 'fixture' }, evidence: { responseId: 'resp_fixture_1', responseModel: 'fixture' } });
const quota = () => ({ status: 'error', errorCode: 'reasoning_rate_limited', failureType: 'QUOTA_EXHAUSTED' });
const catalogOf = (...ps) => Object.assign({}, ...ps.map(p => p.catalog));
function fakeStore() {
 const rows = new Map(); let n = 0;
 return { rows,
  get(h, kind, id) { const k = kind + '/' + id; if (!rows.has(k)) throw Object.assign(new Error('resource_not_found'), { code: 'resource_not_found' }); return structuredClone(rows.get(k)); },
  put(h, kind, id, value) { rows.set(kind + '/' + id, structuredClone(value)); return value; },
  list(h, kind) { return [...rows].filter(([k]) => k.startsWith(kind + '/')).map(([, v]) => structuredClone(v)); },
  newId() { n += 1; return 'id-' + n; } };
}
const spendOf = (ledger, h = 'owner') => ({ estimate: ledger.estimate, reserve: o => ledger.reserve(h, o), settle: (r, u) => ledger.settle(h, r, u), budget: () => ledger.budget(h), recordExecution: e => ledger.recordExecution(h, e) });
const INTERNAL_BOTH = { publicExternalAllowed: true, internalProviders: [{ providerId: 'openai' }, { providerId: 'anthropic' }], confidentialProviders: [] };
const PUBLIC_TEXT = 'Compara dos proveedores de alojamiento web para una tienda online';
function reasoner(providers, options = {}) { return createGovernedReasoner({ providers, privacyPolicy: INTERNAL_BOTH, approvedDailyBudgetUsd: 1, requestFloor: 'INTERNAL', ...options }); }
const ask = (r, spend, extra = {}) => r.reason({ objective: PUBLIC_TEXT, egressText: PUBLIC_TEXT, request: { context: { objective: PUBLIC_TEXT } }, basis: BASIS, spend, missionId: 'mission-1', taskId: 'mission-1:analizar', taskType: 'data.analyze', ...extra });
const candidate = (id, providerId, estimatedUsd, extra = {}) => ({ id, providerId, region: 'eu', tier: 'small_model', estimatedUsd, ...extra });

// 1, 2, 7: deterministic routing, cheapest eligible first, unreviewed price out.
test('router: deterministic order over 2+ fake providers, cheapest eligible first, unreviewed pricing excluded', () => {
 const input = { privacyClass: 'INTERNAL', policy: INTERNAL_BOTH, candidates: [candidate('openai:a', 'openai', 0.004), candidate('anthropic:b', 'anthropic', 0.001), candidate('anthropic:c', 'anthropic', null), candidate('openai:d', 'openai', 0.001)] };
 const first = routeReasoning(input);
 for (let i = 0; i < 5; i++) assert.deepEqual(routeReasoning(input), first);
 assert.equal(first.route, ROUTES.ORDERED);
 // Equal cost keeps configuration order; the unpriced candidate never routes.
 assert.deepEqual(first.candidates, ['anthropic:b', 'openai:d', 'openai:a']);
 assert.deepEqual(first.excluded, [{ id: 'anthropic:c', failure: EXCLUSIONS.PRICING_UNREVIEWED }]);
 // Every exclusion is a failure the governed reasoner already knows.
 for (const failure of Object.values(EXCLUSIONS)) assert.equal(FAILURES[failure], failure);
});

// 3: explicit preference wins when valid, never over an exclusion.
test('router: an explicit preference goes first when eligible and is ignored when it is not', () => {
 const candidates = [candidate('openai:cheap', 'openai', 0.001), candidate('anthropic:pricey', 'anthropic', 0.009)];
 assert.deepEqual(routeReasoning({ privacyClass: 'INTERNAL', policy: INTERNAL_BOTH, candidates, preference: ['anthropic'] }).candidates, ['anthropic:pricey', 'openai:cheap']);
 assert.deepEqual(routeReasoning({ privacyClass: 'INTERNAL', policy: INTERNAL_BOTH, candidates, preference: ['anthropic:pricey'] }).candidates, ['anthropic:pricey', 'openai:cheap']);
 // A preferred provider the policy does not approve stays out.
 const onlyOpenai = { ...INTERNAL_BOTH, internalProviders: [{ providerId: 'openai' }] };
 const r = routeReasoning({ privacyClass: 'INTERNAL', policy: onlyOpenai, candidates, preference: ['anthropic'] });
 assert.deepEqual(r.candidates, ['openai:cheap']); assert.deepEqual(r.excluded.map(x => x.failure), ['PRIVACY_BLOCKED']);
 // Suitability for the task comes before cost when no preference is given.
 const suited = [candidate('openai:cheap', 'openai', 0.001), candidate('anthropic:fit', 'anthropic', 0.005, { tasks: ['data.analyze'] })];
 assert.deepEqual(routeReasoning({ privacyClass: 'INTERNAL', policy: INTERNAL_BOTH, candidates: suited, taskType: 'data.analyze' }).candidates, ['anthropic:fit', 'openai:cheap']);
});

// 5, 6: SECRET is BLOCKED; nothing eligible is LOCAL_ONLY; tier and circuit.
test('router: SECRET or unknown class is BLOCKED; no eligible candidate is LOCAL_ONLY; tier and circuit exclude', () => {
 const candidates = [candidate('openai:a', 'openai', 0.001)];
 assert.equal(routeReasoning({ privacyClass: 'SECRET', policy: INTERNAL_BOTH, candidates }).route, ROUTES.BLOCKED);
 assert.equal(routeReasoning({ privacyClass: 'WHATEVER', policy: INTERNAL_BOTH, candidates }).route, ROUTES.BLOCKED);
 const none = routeReasoning({ privacyClass: 'CONFIDENTIAL', policy: INTERNAL_BOTH, candidates });
 assert.equal(none.route, ROUTES.LOCAL_ONLY); assert.deepEqual(none.excluded.map(x => x.failure), ['PRIVACY_BLOCKED']);
 assert.deepEqual(routeReasoning({ privacyClass: 'INTERNAL', policy: INTERNAL_BOTH, candidates, requiredTier: 'premium_model' }).excluded.map(x => x.failure), ['CAPABILITY_MISMATCH']);
 assert.deepEqual(routeReasoning({ privacyClass: 'INTERNAL', policy: INTERNAL_BOTH, candidates: [candidate('openai:a', 'openai', 0.001, { circuitOpen: true })] }).excluded.map(x => x.failure), ['CIRCUIT_OPEN']);
 assert.deepEqual(routeReasoning({ privacyClass: 'INTERNAL', policy: INTERNAL_BOTH, candidates: [candidate('openai:a', 'openai', 0.001, { available: false })] }).excluded.map(x => x.failure), ['CIRCUIT_OPEN']);
});

test('governed: SECRET never reaches the router or any provider; LOCAL_ONLY makes zero calls', async () => {
 const a = provider('openai', 'a', ok); const ledger = createCostLedger({ store: fakeStore(), catalog: catalogOf(a), now: () => NOW });
 await assert.rejects(ask(reasoner([a]), spendOf(ledger), { egressText: PUBLIC_TEXT + ' api_key=abcdef123456' }), e => e.code === 'secret_context');
 const local = createGovernedReasoner({ providers: [a], privacyPolicy: DEFAULT_PRIVACY_POLICY, approvedDailyBudgetUsd: 1 });
 await assert.rejects(ask(local, spendOf(ledger)), e => e.code === 'reasoning_resource_unavailable' && e.route === ROUTES.LOCAL_ONLY && e.transient === false && e.attempts[0].failure === 'PRIVACY_BLOCKED');
 assert.equal(a.calls.length, 0);
 const tier = reasoner([a]);
 await assert.rejects(ask(tier, spendOf(ledger), { requiredTier: 'premium_model' }), e => e.route === ROUTES.LOCAL_ONLY && e.attempts[0].failure === 'CAPABILITY_MISMATCH' && e.transient === false);
 assert.equal(a.calls.length, 0);
});

// 4: a privacy-blocked provider never receives context, even cheaper and preferred.
test('privacy: a provider the policy does not approve never receives the context, even when cheaper and preferred', async () => {
 const approved = provider('openai', 'approved', ok, { input: 5, output: 5 }); const other = provider('anthropic', 'cheap', ok, { input: 0.1, output: 0.1 });
 const ledger = createCostLedger({ store: fakeStore(), catalog: catalogOf(approved, other), now: () => NOW });
 const r = createGovernedReasoner({ providers: [approved, other], privacyPolicy: { publicExternalAllowed: true, internalProviders: [{ providerId: 'openai' }], confidentialProviders: [] }, approvedDailyBudgetUsd: 1, requestFloor: 'INTERNAL', preference: ['anthropic'] });
 const result = await ask(r, spendOf(ledger));
 assert.equal(result.resource, 'openai:approved'); assert.equal(other.calls.length, 0);
 assert.deepEqual(result.attempts.map(a => [a.resource, a.failure]), [['anthropic:cheap', 'PRIVACY_BLOCKED']]);
});

test('privacy: a new provider never inherits the INTERNAL authorization of the configured one', () => {
 const primary = provider('openai', 'primary', ok);
 const egress = reasoningEgressFromEnv({ OXKIO_V3_REASONING_INTERNAL_EGRESS: 'true' }, primary);
 assert.deepEqual(egress.privacyPolicy.internalProviders.map(p => p.providerId), ['openai']);
 assert.deepEqual(egress.privacyPolicy.confidentialProviders, []);
 const r = routeReasoning({ privacyClass: 'INTERNAL', policy: egress.privacyPolicy, candidates: [candidate('openai:primary', 'openai', 0.002), candidate('anthropic:new', 'anthropic', 0.0001)] });
 assert.deepEqual(r.candidates, ['openai:primary']); assert.deepEqual(r.excluded, [{ id: 'anthropic:new', failure: 'PRIVACY_BLOCKED' }]);
 // CONFIDENTIAL stays local under that policy.
 assert.equal(routeReasoning({ privacyClass: 'CONFIDENTIAL', policy: egress.privacyPolicy, candidates: [candidate('openai:primary', 'openai', 0.002)] }).route, ROUTES.LOCAL_ONLY);
});

// Currency: the human budget keeps its currency; no implicit FX.
test('budget: 40 EUR stays 40 EUR; without a reviewed FX policy every paid call stops; an injected rate converts', async () => {
 const unconverted = resolveBudget({ human: { amount: 40, currency: 'EUR' }, providers: { openai: { amount: 25, currency: 'EUR' } } });
 assert.equal(unconverted.status, 'FX_POLICY_REQUIRED'); assert.deepEqual(unconverted.human, { amount: 40, currency: 'EUR' });
 assert.equal(unconverted.monthlyLimitUsd, null); assert.equal(unconverted.accountingCurrency, ACCOUNTING_CURRENCY);
 // An FX object without source/review date is not a policy.
 assert.equal(resolveBudget({ human: { amount: 40, currency: 'EUR' }, fx: { from: 'EUR', to: 'USD', rate: 2 } }).status, 'FX_POLICY_REQUIRED');
 const a = provider('openai', 'a', ok); const ledger = createCostLedger({ store: fakeStore(), catalog: catalogOf(a), budget: { human: { amount: 40, currency: 'EUR' }, providers: { openai: { amount: 25, currency: 'EUR' } } }, now: () => NOW });
 assert.throws(() => ledger.reserve('owner', { missionId: 'm', modelId: 'openai:a', estimatedUsd: 0.001, approvedDailyBudgetUsd: 1 }), e => e.code === 'planning_budget_gate' && e.detail === 'fx_policy_required');
 await assert.rejects(ask(reasoner([a]), spendOf(ledger)), e => e.attempts[0].failure === 'BUDGET_POLICY_REQUIRED' && e.transient === false);
 assert.equal(a.calls.length, 0);
 // Fictitious, explicit rate injected by the test (never a built-in value).
 const converted = resolveBudget({ human: { amount: 40, currency: 'EUR' }, providers: { openai: { amount: 25, currency: 'EUR' } }, fx: { from: 'EUR', to: 'USD', rate: 1.5, source: 'test-fixture', reviewedAt: '2026-10-10' } });
 assert.equal(converted.status, 'LIMITED'); assert.equal(converted.monthlyLimitUsd, 60); assert.equal(converted.providerLimitsUsd.openai, 37.5);
 assert.deepEqual(converted.human, { amount: 40, currency: 'EUR' });
 assert.throws(() => resolveBudget({ human: { amount: -1, currency: 'EUR' } }), e => e.code === 'budget_invalid');
 // No budget configured keeps the previous behaviour (daily and mission limits only).
 assert.equal(resolveBudget({}).status, 'UNLIMITED');
});

const usdBudget = (monthly, providers) => ({ human: { amount: monthly, currency: 'USD' }, providers: Object.fromEntries(Object.entries(providers).map(([k, v]) => [k, { amount: v, currency: 'USD' }])) });
const call = (ledger, modelId = 'openai:a', usage = BASIS) => { const r = ledger.reserve('owner', { missionId: 'm-' + Math.random().toString(36).slice(2), modelId, estimatedUsd: 0.002, approvedDailyBudgetUsd: 1 }); return ledger.settle('owner', r, usage); };

// 8, 9, 10: monthly and per-provider hard stops; warnings never block.
test('budget: monthly and per-provider hard stops; a provider without its own limit gets nothing', () => {
 const a = provider('openai', 'a', ok); const b = provider('anthropic', 'b', ok);
 const monthly = createCostLedger({ store: fakeStore(), catalog: catalogOf(a, b), budget: usdBudget(0.005, { openai: 1, anthropic: 1 }), now: () => NOW });
 call(monthly); call(monthly, 'anthropic:b');
 assert.throws(() => call(monthly), e => e.detail === 'monthly_budget');
 const perProvider = createCostLedger({ store: fakeStore(), catalog: catalogOf(a, b), budget: usdBudget(1, { openai: 0.003, anthropic: 1 }), now: () => NOW });
 call(perProvider);
 assert.throws(() => call(perProvider), e => e.detail === 'provider_budget');
 assert.equal(call(perProvider, 'anthropic:b'), 0.002);
 const unset = createCostLedger({ store: fakeStore(), catalog: catalogOf(a, b), budget: usdBudget(1, { openai: 1 }), now: () => NOW });
 assert.throws(() => call(unset, 'anthropic:b'), e => e.detail === 'provider_budget_unset');
 // An open (unsettled) reservation counts toward the hard stop.
 const open = createCostLedger({ store: fakeStore(), catalog: catalogOf(a), budget: usdBudget(0.003, { openai: 1 }), now: () => NOW });
 open.reserve('owner', { missionId: 'm', modelId: 'openai:a', estimatedUsd: 0.002, approvedDailyBudgetUsd: 1 });
 assert.throws(() => open.reserve('owner', { missionId: 'm2', modelId: 'openai:a', estimatedUsd: 0.002, approvedDailyBudgetUsd: 1 }), e => e.detail === 'monthly_budget');
 // A per-call reservation limit is its own hard stop.
 const perCall = createCostLedger({ store: fakeStore(), catalog: catalogOf(a), budget: { perCallMaxUsd: 0.001 }, now: () => NOW });
 assert.throws(() => call(perCall), e => e.detail === 'per_call_limit');
});

test('budget: warnings at 70 % and 90 % never block before the hard stop; another month does not count', () => {
 const a = provider('openai', 'a', ok); const store = fakeStore();
 store.put('owner', 'cost', 'day-2026-09-30', { date: '2026-09-30', reservedUsd: 0, chargedUsd: 5, knownActualUsd: 5, calls: 1, tokens: 0, models: { 'openai:a': { calls: 1, usd: 5 } }, tools: {}, reservations: {} });
 const ledger = createCostLedger({ store, catalog: catalogOf(a), budget: usdBudget(0.01, { openai: 0.0125 }), now: () => NOW });
 const levels = [];
 for (let i = 0; i < 5; i++) { call(ledger); levels.push(ledger.budget('owner').monthly.warning); }
 assert.deepEqual(levels, [null, null, null, 'WARN_70', 'WARN_90']);
 // 0.01 of 0.0125 = 80 %: the provider line warns on its own threshold.
 assert.equal(ledger.budget('owner').monthly.spentUsd, 0.01); assert.equal(ledger.budget('owner').providers.openai.warning, 'WARN_70');
 assert.throws(() => call(ledger), e => e.detail === 'monthly_budget');
});

// 11, 12, 15: failover, single charge per call, roles in the records.
test('failover: primary QUOTA_EXHAUSTED -> second provider, each call charged once, executor/fallback recorded', async () => {
 const primary = provider('openai', 'primary', quota); const second = provider('anthropic', 'second', ok);
 const store = fakeStore(); const ledger = createCostLedger({ store, catalog: catalogOf(primary, second), now: () => NOW });
 let t = 1000; const r = reasoner([primary, second], { preference: ['openai'], clock: () => (t += 7) });
 const result = await ask(r, spendOf(ledger));
 assert.equal(result.resource, 'anthropic:second'); assert.equal(result.role, ROLES.FALLBACK);
 // The fallback receives exactly the request the primary received: no more context.
 assert.deepEqual(second.calls, primary.calls);
 const day = ledger.owner('owner')[0];
 assert.equal(day.calls, 2); assert.equal(day.openReservations, 0); assert.equal(day.reservedUsd, 0);
 assert.equal(day.chargedUsd, 0.004); // primary without usage keeps its estimate; second its reported usage
 const executions = ledger.mission('owner', 'mission-1').executions;
 assert.deepEqual(executions.map(e => [e.role, e.provider, e.model, e.status, e.verificationStatus, e.failureKind, e.fallbackReason]), [
  ['EXECUTOR', 'openai', 'primary', 'FAILED', 'NOT_RUN', 'QUOTA_EXHAUSTED', null],
  ['FALLBACK', 'anthropic', 'second', 'ACCEPTED', 'PASS', null, 'QUOTA_EXHAUSTED'],
 ]);
 assert.deepEqual(executions.map(e => e.latencyMs), [7, 7]);
 for (const e of executions) { assert.equal(e.missionId, 'mission-1'); assert.equal(e.taskId, 'mission-1:analizar'); assert.equal(e.accountingCurrency, 'USD'); assert.equal(e.reviewer, ROLES.REVIEWER); assert.equal(e.privacyClass, 'INTERNAL'); assert.equal(e.estimatedCost, 0.002); }
 assert.equal(executions[1].responseId, 'resp_fixture_1'); assert.equal(executions[0].responseId, null);
 // A settled reservation cannot be settled again.
 const reservation = ledger.reserve('owner', { missionId: 'm-x', modelId: 'openai:primary', estimatedUsd: 0.002, approvedDailyBudgetUsd: 1 });
 ledger.settle('owner', reservation, BASIS);
 assert.throws(() => ledger.settle('owner', reservation, BASIS), e => e.code === 'reservation_unknown');
});

// 13: exhausted budget -> zero calls.
test('budget exhausted: the router and the ledger stop the call before any provider is reached', async () => {
 const a = provider('openai', 'a', ok); const b = provider('anthropic', 'b', ok);
 const ledger = createCostLedger({ store: fakeStore(), catalog: catalogOf(a, b), budget: usdBudget(0.001, { openai: 1, anthropic: 1 }), now: () => NOW });
 await assert.rejects(ask(reasoner([a, b]), spendOf(ledger)), e => e.code === 'reasoning_resource_unavailable' && e.transient === true && e.attempts.every(x => x.failure === 'BUDGET_EXHAUSTED' && x.detail === 'monthly_budget'));
 assert.equal(a.calls.length + b.calls.length, 0);
 // Without the router snapshot (budget() absent) the ledger still refuses.
 const noSnapshot = { ...spendOf(ledger) }; delete noSnapshot.budget;
 await assert.rejects(ask(reasoner([a]), noSnapshot), e => e.attempts[0].failure === 'BUDGET_EXHAUSTED');
 assert.equal(a.calls.length, 0);
});

// 14: telemetry holds codes and numbers only.
test('telemetry: execution records never hold the prompt, private text or secrets', async () => {
 const a = provider('openai', 'a', () => ({ ...ok(), content: { answer: 'PRIVMARK respuesta' } }));
 const store = fakeStore(); const ledger = createCostLedger({ store, catalog: catalogOf(a), now: () => NOW });
 await ask(reasoner([a]), spendOf(ledger), { egressText: PUBLIC_TEXT + ' PRIVMARK', request: { context: { objective: 'PRIVMARK cuerpo de correo', sources: [{ id: 's', text: 'PRIVMARK' }] } } });
 const saved = JSON.stringify([...store.rows.values()]);
 assert.ok(!saved.includes('PRIVMARK')); assert.ok(!saved.includes('alojamiento'));
 // Even a careless caller cannot store free text through a record.
 const entry = ledger.recordExecution('owner', { missionId: 'mission-1', provider: 'openai', status: 'Texto libre con espacios', responseId: 'x'.repeat(300), prompt: 'PRIVMARK', latencyMs: -5 });
 assert.equal(entry.status, null); assert.equal(entry.responseId, null); assert.equal(entry.latencyMs, null); assert.equal('prompt' in entry, false);
 assert.ok(!JSON.stringify([...store.rows.values()]).includes('PRIVMARK'));
});

// 16: the deterministic verifier stays the authority.
test('verifier: a provider answer the deterministic verifier refuses is never accepted; the next provider is tried', async () => {
 const first = provider('openai', 'first', ok); const second = provider('anthropic', 'second', ok);
 const ledger = createCostLedger({ store: fakeStore(), catalog: catalogOf(first, second), now: () => NOW });
 const r = reasoner([first, second], { preference: ['openai'] });
 let n = 0; const accept = () => (++n === 1 ? 'unissued_source' : true);
 const result = await ask(r, spendOf(ledger), { accept });
 assert.equal(result.resource, 'anthropic:second');
 const [rejected, accepted] = ledger.mission('owner', 'mission-1').executions;
 assert.deepEqual([rejected.status, rejected.verificationStatus, rejected.failureKind], ['REJECTED', 'REJECTED', 'INVALID_OUTPUT']);
 assert.deepEqual([accepted.status, accepted.verificationStatus, accepted.fallbackReason], ['ACCEPTED', 'PASS', 'INVALID_OUTPUT']);
 // All refused: no acceptance at all, and waiting would not help.
 await assert.rejects(ask(r, spendOf(ledger), { accept: () => 'verifier_rejected', missionId: 'mission-2' }), e => e.transient === false && e.attempts.every(a => a.failure === 'INVALID_OUTPUT'));
 // A truthy non-true verdict never accepts.
 await assert.rejects(ask(r, spendOf(ledger), { accept: () => 'yes', missionId: 'mission-3' }), e => e.attempts.every(a => a.failure === 'INVALID_OUTPUT'));
});

test('circuit: an open circuit excludes a provider (transient) and the next one serves', async () => {
 const a = provider('openai', 'a', ok); const b = provider('anthropic', 'b', ok);
 const ledger = createCostLedger({ store: fakeStore(), catalog: catalogOf(a, b), now: () => NOW });
 const r = reasoner([a, b], { preference: ['openai'], availability: id => (id === 'openai' ? { circuitOpen: true } : {}) });
 const result = await ask(r, spendOf(ledger));
 assert.equal(result.resource, 'anthropic:b'); assert.equal(a.calls.length, 0); assert.equal(result.role, ROLES.EXECUTOR);
 assert.deepEqual(result.attempts.map(x => x.failure), ['CIRCUIT_OPEN']);
});

// 17: a restart keeps the ledger (sealed store on disk).
test('persistence: a restart keeps monthly spend, open reservations and execution records', async () => {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'v3-multiai-')); const key = randomBytes(32); const sessions = { key: () => 'owner-key' };
 try {
  const a = provider('openai', 'a', ok); const budget = usdBudget(0.005, { openai: 1 });
  const open = () => createCostLedger({ store: createMemoryStoreFactory({ root, integrity: createHmacIntegrity({ key }) })(sessions), catalog: catalogOf(a), budget, now: () => NOW });
  const before = open();
  await ask(reasoner([a]), spendOf(before));
  before.reserve('owner', { missionId: 'm-open', modelId: 'openai:a', estimatedUsd: 0.002, approvedDailyBudgetUsd: 1 });
  const after = open();
  assert.equal(after.budget('owner').monthly.spentUsd, 0.004);
  assert.equal(after.mission('owner', 'mission-1').executions.length, 1);
  assert.throws(() => after.reserve('owner', { missionId: 'm-3', modelId: 'openai:a', estimatedUsd: 0.002, approvedDailyBudgetUsd: 1 }), e => e.detail === 'monthly_budget');
 } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// 19 + integration: the real V3 composition, fake providers, executionEnabled=false.
const UID = 'cliente-cero-controlled';
const authorize = createExecutiveAuthorizer({ OXKIO_ADMIN_FIREBASE_UIDS: UID });
const identity = authorize({ uid: UID }).identity;
const synthesis = request => ({ status: 'ok', usage: { inputTokens: 400, outputTokens: 120 }, evidence: { responseId: 'resp_fixture_2' }, content: {
 findings: request.context.sources.map(s => ({ claim: s.text.replace(/^.*?(?=Alfa|Beta)/u, '').replace(/[.\s]*$/u, '.'), quote: s.text, sourceIds: [s.id] })),
 comparison: 'Difieren en precio y en soporte.', conclusion: 'Si el soporte en español es imprescindible conviene Alfa; si prima el coste, Beta.' } });
test('composition: failover through the real V3 runtime records executor and fallback in the mission cost, executionEnabled stays false', async () => {
 const primary = provider('openai', 'primary', quota); const fallback = provider('anthropic', 'fallback', synthesis);
 const memoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v3-multiai-composition-'));
 const policy = { publicExternalAllowed: true, internalProviders: [], confidentialProviders: [{ providerId: 'openai', region: 'eu' }, { providerId: 'anthropic', region: 'eu' }] };
 const server = createServerComposition({ enabled: true, cohortUids: UID, integrityKey: randomBytes(32), memoryRoot, authorizeIdentity: authorize,
  reasoning: { providers: [primary, fallback], preference: ['openai'], privacyPolicy: policy, approvedDailyBudgetUsd: 1, budget: usdBudget(1, { openai: 0.5, anthropic: 0.5 }) } });
 const chat = async query => { const req = Readable.from([JSON.stringify({ query, includeDetails: true })]); req.oxkioIdentity = identity; let body; await server.handle(req, { writeHead() {}, end(b) { body = b; } }); return JSON.parse(body); };
 try {
  for (const fact of ['Recuerda que entre los proveedores, Alfa cuesta 10 euros al mes con soporte en español', 'Recuerda que entre los proveedores, Beta cuesta 7 euros al mes sin soporte en español']) assert.equal((await chat(fact)).details.status, 'COMPLETED');
  const r = await chat('Recupera de mi memoria lo que guardé sobre proveedores y compáralos'); const d = r.details;
  assert.equal(d.status, 'COMPLETED'); assert.equal(d.executionEnabled, false); assert.equal(r.executionEnabled, false);
  assert.equal(d.result.synthesis.resource, 'anthropic:fallback');
  const executions = d.cost.executions;
  assert.deepEqual(executions.map(e => [e.role, e.resource, e.status, e.fallbackReason]), [['EXECUTOR', 'openai:primary', 'FAILED', null], ['FALLBACK', 'anthropic:fallback', 'ACCEPTED', 'QUOTA_EXHAUSTED']]);
  assert.ok(executions.every(e => e.taskId && e.taskId.startsWith(d.id + ':') && e.taskType === 'data.analyze' && e.privacyClass === 'CONFIDENTIAL'));
  assert.ok(!JSON.stringify(executions).includes('Alfa')); assert.ok(!JSON.stringify(executions).includes('euros'));
 } finally { fs.rmSync(memoryRoot, { recursive: true, force: true }); }
});

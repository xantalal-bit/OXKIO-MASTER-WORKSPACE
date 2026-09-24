'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CostController, isCostDecision } = require('./cost-controller');
const { CostDecisionCache } = require('./cost-decision-cache');
const { stableHash } = require('./cost-decision-evidence');

test('selects deterministic work and emits auditable evidence', () => {
  const controller = new CostController({ now: () => '2026-09-18T15:30:00.000Z' });
  const result = controller.decide({
    mission: { missionId: 'm-1', deterministicAvailable: true },
  });
  assert.equal(result.source, 'policy');
  assert.equal(result.decision.level, 'deterministic');
  assert.equal(result.executionPattern.pattern, 'deterministic');
  assert.equal(result.evidence.missionId, 'm-1');
  assert.match(result.evidence.evidenceHash, /^[a-f0-9]{64}$/);
});

test('selects the minimum execution pattern together with the cost level', () => {
  const controller = new CostController();
  const simple = controller.decide({ mission: { missionId: 'm-pattern-simple' } });
  assert.equal(simple.executionPattern.pattern, 'single_shot');
  assert.equal(simple.executionPattern.reason, 'simplest_sufficient_pattern');

  const sensitive = controller.decide({
    mission: { missionId: 'm-pattern-sensitive', sensitiveAction: true },
  });
  assert.equal(sensitive.executionPattern.pattern, 'verifier_gated');
  assert.equal(sensitive.executionPattern.reason, 'verification_required');
});

test('reuses compatible cached decisions without accumulating a cost metric', () => {
  let nowMs = 1000;
  const cache = new CostDecisionCache({ now: () => nowMs });
  const catalog = {
    test_small: {
      provider: 'test', tier: 'small', inputUsdPerMillion: 1,
      outputUsdPerMillion: 2, residency: 'eu', privacy: 'internal',
      pricingVersion: 'test-v1', pricingSource: 'https://example.invalid/pricing',
      reviewedAt: '2026-09-21',
    },
  };
  const controller = new CostController({ cache, catalog, now: () => '2026-09-18T15:30:00.000Z' });
  const request = {
    mission: { missionId: 'm-2', smallModelEstimatedCostUsd: 0.01 },
    cacheContext: {
      taskType: 'classify', capability: 'routing', privacyClass: 'internal',
      residency: 'eu', policyVersion: 1, inputFingerprint: 'sha256:abc',
    },
    costBasis: { modelId: 'test_small', inputTokens: 6000, outputTokens: 2000 },
  };
  const first = controller.decide(request);
  const second = controller.decide(request);
  assert.equal(first.source, 'policy');
  assert.equal(second.source, 'cache');
  assert.equal(second.executionPattern.pattern, first.executionPattern.pattern);
  assert.equal(second.evidence.evidenceHash, first.evidence.evidenceHash);
  assert.equal(controller.metrics().hits, 1);
  assert.equal(Object.hasOwn(controller.metrics(), 'avoidedEstimatedCostUsd'), false);
  assert.deepEqual(second.costEstimate, { status: 'estimated', estimatedCostUsd: 0.01, modelId: 'test_small', pricingVersion: 'test-v1' });
});

test('ignores caller-declared USD and fails closed for unknown catalog model', () => {
  const controller = new CostController();
  const request = {
    mission: { missionId: 'm-3', deterministicAvailable: true },
    cacheContext: { inputFingerprint: 'safe-fingerprint', policyVersion: 1 },
    costBasis: { modelId: 'unknown-model', inputTokens: 1000000, outputTokens: 1000000 },
    estimatedAvoidedCostUsd: 999999,
  };
  controller.decide(request);
  const hit = controller.decide(request);
  assert.equal(controller.metrics().hits, 1);
  assert.equal(hit.costEstimate.status, 'unknown_model');
  assert.equal(hit.costEstimate.estimatedCostUsd, null);
  assert.equal(JSON.stringify(controller.metrics()).includes('999999'), false);
  assert.equal(JSON.stringify(hit).includes('999999'), false);
});

test('cache hits always report the costEstimate of the current request', () => {
  const catalog = {
    paid: {
      provider: 'test', tier: 'small', inputUsdPerMillion: 1, outputUsdPerMillion: 2,
      residency: 'eu', privacy: 'internal', pricingVersion: 'paid-v1',
      pricingSource: 'https://example.invalid/pricing', reviewedAt: '2026-09-21',
    },
    local_deterministic: {
      provider: 'local', inputUsdPerMillion: 0, outputUsdPerMillion: 0,
      pricingVersion: 'builtin-zero-v1', pricingSource: 'internal', reviewedAt: '2026-09-21',
    },
  };
  const controller = new CostController({ catalog });
  const request = (costBasis) => controller.decide({
    mission: { smallModelEstimatedCostUsd: 0.01 },
    cacheContext: { inputFingerprint: 'safe-fingerprint', policyVersion: 1 },
    costBasis,
  });

  const first = request({ modelId: 'paid', inputTokens: 10 });
  assert.equal(first.source, 'policy');
  assert.equal(first.costEstimate.estimatedCostUsd, 0.00001);

  const cases = [
    [{ modelId: 'paid', inputTokens: 1000000 }, 'estimated', 1],
    [{ modelId: 'paid', inputTokens: 1000, outputTokens: 500 }, 'estimated', 0.002],
    [{ modelId: 'local_deterministic', inputTokens: 1000000 }, 'estimated', 0],
    [{ modelId: 'missing', inputTokens: 1000 }, 'unknown_model', null],
    [{}, 'not_requested', null],
    [{ modelId: 'paid', inputTokens: 10, estimatedCostUsd: 999999 }, 'estimated', 0.00001],
  ];
  for (const [costBasis, status, estimatedCostUsd] of cases) {
    const hit = request(costBasis);
    assert.equal(hit.source, 'cache');
    assert.equal(hit.cacheKey, first.cacheKey);
    assert.deepEqual(hit.decision, first.decision);
    assert.equal(hit.costEstimate.status, status);
    assert.equal(hit.costEstimate.estimatedCostUsd, estimatedCostUsd);
  }

  const metrics = controller.metrics();
  assert.equal(metrics.hits, cases.length);
  assert.deepEqual(Object.keys(metrics).sort(), ['evictions', 'hits', 'invalidations', 'misses', 'size', 'writes']);
});

test('does not cache when no privacy-safe input fingerprint is supplied', () => {
  const controller = new CostController();
  const result = controller.decide({ mission: { deterministicAvailable: true } });
  assert.equal(result.cacheKey, null);
  assert.equal(controller.metrics().writes, 0);
});

test('explicit invalidation forces a fresh policy decision', () => {
  const controller = new CostController({ now: () => '2026-09-18T15:30:00.000Z' });
  const cacheContext = { inputFingerprint: 'safe-fingerprint', policyVersion: 1 };
  controller.decide({ mission: { deterministicAvailable: true }, cacheContext });
  assert.equal(controller.invalidate(cacheContext), true);
  const fresh = controller.decide({ mission: { deterministicAvailable: true }, cacheContext });
  assert.equal(fresh.source, 'policy');
  assert.equal(controller.metrics().invalidations, 1);
});

test('exposes a controlled costEstimate on the policy path without a cache key', () => {
  const controller = new CostController();
  const result = controller.decide({
    mission: { deterministicAvailable: true },
    costBasis: { modelId: 'local_deterministic', inputTokens: 1000, outputTokens: 1000 },
  });
  assert.equal(result.cacheKey, null);
  assert.deepEqual(result.costEstimate, {
    status: 'estimated', estimatedCostUsd: 0, modelId: 'local_deterministic', pricingVersion: 'builtin-zero-v1',
  });
});

test('distinguishes unknown model and missing estimate from zero cost', () => {
  const controller = new CostController();
  const unknown = controller.decide({ costBasis: { modelId: 'toString', inputTokens: 10 } });
  assert.deepEqual(unknown.costEstimate, { status: 'unknown_model', estimatedCostUsd: null, modelId: 'toString', pricingVersion: null });

  const missing = controller.decide({});
  assert.deepEqual(missing.costEstimate, { status: 'not_requested', estimatedCostUsd: null, modelId: null, pricingVersion: null });

  const noTokens = controller.decide({ costBasis: { modelId: 'local_deterministic' } });
  assert.equal(noTokens.costEstimate.status, 'not_requested');
  assert.equal(noTokens.costEstimate.estimatedCostUsd, null);

  const badTokens = controller.decide({ costBasis: { modelId: 'local_deterministic', inputTokens: -5 } });
  assert.equal(badTokens.costEstimate.status, 'not_requested');
});

test('never trusts caller-supplied USD as the cost estimate', () => {
  const controller = new CostController();
  const result = controller.decide({
    costBasis: { modelId: 'unknown-model', inputTokens: 1000, estimatedCostUsd: 0.5, usd: 0.5 },
  });
  assert.equal(result.costEstimate.status, 'unknown_model');
  assert.equal(result.costEstimate.estimatedCostUsd, null);
});

test('costEstimate is coherent on fresh, cache-keyed and cache-hit paths', () => {
  const catalog = {
    test_small: {
      provider: 'test', tier: 'small', inputUsdPerMillion: 1, outputUsdPerMillion: 2,
      residency: 'eu', privacy: 'internal', pricingVersion: 'test-v1',
      pricingSource: 'https://example.invalid/pricing', reviewedAt: '2026-09-21',
    },
  };
  const controller = new CostController({ catalog });
  const cacheContext = { inputFingerprint: 'safe-fingerprint', policyVersion: 1 };
  const mission = { smallModelEstimatedCostUsd: 0.01 };
  const first = controller.decide({ mission, cacheContext, costBasis: { modelId: 'test_small', inputTokens: 1000, outputTokens: 500 } });
  const hit = controller.decide({ mission, cacheContext, costBasis: { modelId: 'test_small', inputTokens: 2000, outputTokens: 0 } });
  const hitUnknown = controller.decide({ mission, cacheContext, costBasis: { modelId: 'missing' } });
  const expected = { status: 'estimated', estimatedCostUsd: 0.002, modelId: 'test_small', pricingVersion: 'test-v1' };
  assert.equal(first.source, 'policy');
  assert.deepEqual(first.costEstimate, expected);
  assert.equal(hit.source, 'cache');
  assert.deepEqual(hit.costEstimate, expected);
  assert.equal(hitUnknown.source, 'cache');
  assert.equal(hitUnknown.costEstimate.status, 'unknown_model');
  assert.equal(hitUnknown.costEstimate.estimatedCostUsd, null);
});

test('cache never degrades a sensitive mission to a cached single_shot decision', () => {
  const controller = new CostController({ now: () => '2026-09-24T10:00:00.000Z' });
  const cacheContext = {
    taskType: 'classify', capability: 'routing', privacyClass: 'internal',
    residency: 'eu', policyVersion: 1, inputFingerprint: 'sha256:same',
  };
  const first = controller.decide({ mission: { missionId: 'm-plain' }, cacheContext });
  assert.equal(first.executionPattern.pattern, 'single_shot');

  const second = controller.decide({ mission: { missionId: 'm-sensitive', sensitiveAction: true }, cacheContext });
  assert.equal(second.source, 'policy');
  assert.equal(second.executionPattern.pattern, 'verifier_gated');
  assert.notEqual(second.cacheKey, first.cacheKey);

  const repeat = controller.decide({ mission: { missionId: 'm-sensitive', sensitiveAction: true }, cacheContext });
  assert.equal(repeat.source, 'cache');
  assert.equal(repeat.executionPattern.pattern, 'verifier_gated');
});

test('cache key separates signals that differ by type or by cost-policy inputs', () => {
  const controller = new CostController();
  const cacheContext = { inputFingerprint: 'safe-fingerprint', policyVersion: 1 };
  const plain = controller.decide({ mission: { specialistHandoffs: null }, cacheContext });
  const stringy = controller.decide({ mission: { specialistHandoffs: '2' }, cacheContext });
  assert.equal(plain.executionPattern.pattern, 'single_shot');
  assert.equal(stringy.source, 'policy');
  assert.equal(stringy.executionPattern.pattern, 'planner_executor');

  const withinBudget = controller.decide({ mission: { smallModelEstimatedCostUsd: 0.01 }, cacheContext });
  const overBudget = controller.decide({ mission: { smallModelEstimatedCostUsd: 0.01, dailySpentUsd: 2 }, cacheContext });
  assert.equal(withinBudget.decision.level, 'small_model');
  assert.equal(overBudget.source, 'policy');
  assert.equal(overBudget.decision.level, null);
});

test('shared cache does not leak decisions between controllers with different policies', () => {
  const cache = new CostDecisionCache();
  const cacheContext = { inputFingerprint: 'safe-fingerprint', policyVersion: 1 };
  const mission = { premiumModelEstimatedCostUsd: 0.1, expectedValueUsd: 5, smallModelSufficient: false };
  const permissive = new CostController({ cache }).decide({ mission, cacheContext });
  const restricted = new CostController({ cache, policy: { allowPremium: false } }).decide({ mission, cacheContext });
  assert.equal(permissive.decision.level, 'premium_model');
  assert.equal(restricted.source, 'policy');
  assert.equal(restricted.decision.level, null);
});

test('non-primitive routing signals disable caching instead of risking collisions', () => {
  const controller = new CostController();
  const result = controller.decide({
    mission: { parallelSubtasks: [3] },
    cacheContext: { inputFingerprint: 'safe-fingerprint', policyVersion: 1 },
  });
  assert.equal(result.cacheKey, null);
  assert.equal(controller.metrics().writes, 0);
});

test('routing signal list covers every mission field read by both selectors', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { ROUTING_SIGNALS } = require('./cost-controller');
  for (const file of ['cost-policy.js', 'execution-pattern-router.js']) {
    const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
    const fields = new Set([...source.matchAll(/\bmission\.([A-Za-z_$][\w$]*)/g)].map((match) => match[1]));
    assert.ok(fields.size > 0);
    for (const field of fields) assert.ok(ROUTING_SIGNALS.includes(field), `${file} reads mission.${field}`);
  }
});

test('invalidation removes every routing variant of a cache context', () => {
  const controller = new CostController();
  const cacheContext = { inputFingerprint: 'safe-fingerprint', policyVersion: 1 };
  controller.decide({ mission: {}, cacheContext });
  controller.decide({ mission: { sensitiveAction: true }, cacheContext });
  assert.equal(controller.invalidate(cacheContext), true);
  assert.equal(controller.metrics().size, 0);
  assert.equal(controller.metrics().invalidations, 2);
  assert.equal(controller.invalidate(cacheContext), false);
});

test('mutating a returned decision cannot alter the cache or later results', () => {
  const controller = new CostController({ now: () => '2026-09-24T10:00:00.000Z' });
  const request = {
    mission: { missionId: 'm-alias', smallModelEstimatedCostUsd: 0.01 },
    cacheContext: { inputFingerprint: 'safe-fingerprint', policyVersion: 1 },
    costBasis: { modelId: 'local_deterministic', inputTokens: 10, outputTokens: 10 },
  };
  const first = controller.decide(request);
  const snapshot = structuredClone(first);

  assert.ok(Object.isFrozen(first));
  assert.throws(() => { first.decision.level = 'multi_agent'; }, TypeError);
  assert.throws(() => { first.executionPattern.pattern = 'react'; }, TypeError);
  assert.throws(() => { first.evidence.decision.reason = 'tampered'; }, TypeError);
  assert.throws(() => { first.costEstimate.estimatedCostUsd = 999; }, TypeError);
  assert.equal(Reflect.deleteProperty(first.evidence.spend, 'dailySpentUsd'), false);
  assert.deepEqual(first, snapshot);

  const hit = controller.decide(request);
  assert.equal(hit.source, 'cache');
  for (const field of ['decision', 'executionPattern', 'evidence', 'costEstimate']) {
    assert.deepEqual(hit[field], snapshot[field]);
    assert.notEqual(hit[field], first[field]);
  }
  const again = controller.decide(request);
  assert.notEqual(again.evidence, hit.evidence);
  assert.deepEqual(again.evidence, snapshot.evidence);
});

test('cache hit reuses the decision but rebinds evidence to the current mission', () => {
  const timestamps = ['2026-09-24T10:00:00.000Z', '2026-09-24T10:05:00.000Z'];
  let calls = 0;
  const cache = new CostDecisionCache();
  const controller = new CostController({ cache, now: () => timestamps[calls++] });
  const cacheContext = { taskType: 'classify', inputFingerprint: 'sha256:shared', policyVersion: 1 };
  const signals = { smallModelEstimatedCostUsd: 0.01, missionSpentUsd: 0.02 };

  const first = controller.decide({ mission: { missionId: 'mission-A', ...signals }, cacheContext });
  const second = controller.decide({
    mission: { missionId: 'mission-B', ...signals },
    cacheContext,
    costBasis: { modelId: 'local_deterministic', inputTokens: 10, outputTokens: 10 },
  });

  assert.equal(first.source, 'policy');
  assert.equal(second.source, 'cache');
  assert.equal(second.cacheKey, first.cacheKey);
  assert.deepEqual(second.decision, first.decision);
  assert.equal(second.decision.level, 'small_model');
  assert.deepEqual(second.executionPattern, first.executionPattern);

  assert.equal(first.evidence.missionId, 'mission-A');
  assert.equal(second.evidence.missionId, 'mission-B');
  assert.equal(JSON.stringify(second.evidence).includes('mission-A'), false);
  assert.equal(first.evidence.timestamp, timestamps[0]);
  assert.equal(second.evidence.timestamp, timestamps[1]);
  assert.deepEqual(second.evidence.decision, first.evidence.decision);

  const { evidenceHash, ...material } = second.evidence;
  assert.equal(evidenceHash, stableHash(material));
  assert.notEqual(evidenceHash, first.evidence.evidenceHash);

  assert.equal(first.costEstimate.status, 'not_requested');
  assert.equal(second.costEstimate.status, 'estimated');
  assert.ok(Object.isFrozen(second.evidence) && Object.isFrozen(second.evidence.decision));

  // The cache holds only the reusable routing outcome, never request evidence.
  const [entry] = cache.entries.values();
  assert.deepEqual(Object.keys(entry.value).sort(), ['decision', 'executionPattern']);
});

test('isCostDecision brands only the exact objects returned by decide()', () => {
  const cache = new CostDecisionCache();
  const controller = new CostController({ cache, now: () => '2026-09-24T12:00:00.000Z' });
  const request = { mission: { smallModelEstimatedCostUsd: 0.01 }, cacheContext: { inputFingerprint: 'fp', policyVersion: 1 } };
  const fresh = controller.decide(request);
  const hit = controller.decide(request);
  const uncached = controller.decide({ mission: {} });
  assert.equal(hit.source, 'cache');
  for (const real of [fresh, hit, uncached]) assert.equal(isCostDecision(real), true);

  const deepFreeze = (value) => {
    if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(deepFreeze); }
    return value;
  };
  const lookAlikes = [
    structuredClone(fresh),
    { ...fresh },
    deepFreeze(structuredClone(fresh)),
    deepFreeze(JSON.parse(JSON.stringify(fresh))),
    fresh.decision,
    [...cache.entries.values()][0].value,
    {}, null, undefined, 'decision', 42,
  ];
  for (const value of lookAlikes) assert.equal(isCostDecision(value), false);
});

test('branding does not change the decide() contract', () => {
  const controller = new CostController({ now: () => '2026-09-24T12:00:00.000Z' });
  const result = controller.decide({ mission: { missionId: 'm-brand', smallModelEstimatedCostUsd: 0.01 } });
  assert.deepEqual(Object.keys(result).sort(), ['cacheKey', 'costEstimate', 'decision', 'evidence', 'executionPattern', 'source']);
  assert.ok(Object.isFrozen(result));
  assert.equal(Object.getOwnPropertySymbols(result).length, 0);
  assert.equal(result.decision.level, 'small_model');
  assert.equal(result.evidence.missionId, 'm-brand');
});

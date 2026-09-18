'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CostController } = require('./cost-controller');
const { CostDecisionCache } = require('./cost-decision-cache');

test('selects deterministic work and emits auditable evidence', () => {
  const controller = new CostController({ now: () => '2026-09-18T15:30:00.000Z' });
  const result = controller.decide({
    mission: { missionId: 'm-1', deterministicAvailable: true },
  });
  assert.equal(result.source, 'policy');
  assert.equal(result.decision.level, 'deterministic');
  assert.equal(result.evidence.missionId, 'm-1');
  assert.match(result.evidence.evidenceHash, /^[a-f0-9]{64}$/);
});

test('reuses compatible cached decisions and records avoided estimated cost', () => {
  let nowMs = 1000;
  const cache = new CostDecisionCache({ now: () => nowMs });
  const controller = new CostController({ cache, now: () => '2026-09-18T15:30:00.000Z' });
  const request = {
    mission: { missionId: 'm-2', smallModelEstimatedCostUsd: 0.01 },
    cacheContext: {
      taskType: 'classify', capability: 'routing', privacyClass: 'internal',
      residency: 'eu', policyVersion: 1, inputFingerprint: 'sha256:abc',
    },
    estimatedAvoidedCostUsd: 0.01,
  };
  const first = controller.decide(request);
  const second = controller.decide(request);
  assert.equal(first.source, 'policy');
  assert.equal(second.source, 'cache');
  assert.equal(second.evidence.evidenceHash, first.evidence.evidenceHash);
  assert.equal(controller.metrics().hits, 1);
  assert.equal(controller.metrics().avoidedEstimatedCostUsd, 0.01);
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

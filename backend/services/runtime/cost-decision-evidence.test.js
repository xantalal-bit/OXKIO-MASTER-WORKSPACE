'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildCostDecisionEvidence, stableHash } = require('./cost-decision-evidence');

test('builds deterministic evidence when timestamp is supplied', () => {
  const input = {
    mission: {
      missionId: 'mission-1',
      deterministicAvailable: true,
      missionSpentUsd: 0.05,
      dailySpentUsd: 0.20,
    },
    timestamp: '2026-09-17T15:30:00.000Z',
  };
  const first = buildCostDecisionEvidence(input);
  const second = buildCostDecisionEvidence(input);
  assert.deepEqual(first, second);
  assert.equal(first.decision.level, 'deterministic');
  assert.match(first.evidenceHash, /^[a-f0-9]{64}$/);
});

test('does not record prompts, credentials, or arbitrary mission payload', () => {
  const evidence = buildCostDecisionEvidence({
    mission: {
      missionId: 'mission-secret-test',
      prompt: 'do not persist me',
      apiKey: 'secret-value',
      metadata: { private: 'nope' },
      smallModelEstimatedCostUsd: 0.01,
    },
    timestamp: '2026-09-17T15:30:00.000Z',
  });
  const serialized = JSON.stringify(evidence);
  assert.equal(serialized.includes('do not persist me'), false);
  assert.equal(serialized.includes('secret-value'), false);
  assert.equal(serialized.includes('nope'), false);
});

test('fails closed to non-negative numeric evidence fields', () => {
  const evidence = buildCostDecisionEvidence({
    mission: { missionSpentUsd: -5, dailySpentUsd: Number.NaN, smallModelEstimatedCostUsd: -1 },
    decision: { level: null, reason: 'blocked', availableBudgetUsd: -1 },
    timestamp: '2026-09-17T15:30:00.000Z',
  });
  assert.equal(evidence.spend.missionSpentUsd, 0);
  assert.equal(evidence.spend.dailySpentUsd, 0);
  assert.equal(evidence.estimates.smallModelUsd, 0);
  assert.equal(evidence.decision.availableBudgetUsd, 0);
});

test('stableHash changes when material evidence changes', () => {
  assert.notEqual(stableHash({ level: 'small_model' }), stableHash({ level: 'premium_model' }));
});

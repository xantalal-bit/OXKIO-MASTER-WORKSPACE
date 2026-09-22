'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { LEVELS, estimateCallCostUsd, remainingBudgetUsd, selectExecutionLevel } = require('./cost-policy');

test('cost estimation and remaining budget are deterministic', () => {
  assert.equal(estimateCallCostUsd({ inputTokens: 1000000, outputTokens: 500000, inputUsdPerMillion: 1, outputUsdPerMillion: 2 }), 2);
  assert.equal(remainingBudgetUsd(0.25, 0.10), 0.15);
  assert.equal(remainingBudgetUsd(0.25, 0.50), 0);
});

test('prefers deterministic then reusable skill', () => {
  assert.equal(selectExecutionLevel({ deterministicAvailable: true, reusableSkillAvailable: true }).level, LEVELS.DETERMINISTIC);
  assert.equal(selectExecutionLevel({ reusableSkillAvailable: true }).level, LEVELS.SKILL);
});

test('small model is preferred when sufficient and affordable', () => {
  const result = selectExecutionLevel({ smallModelEstimatedCostUsd: 0.05, smallModelSufficient: true });
  assert.equal(result.level, LEVELS.SMALL_MODEL);
});

test('premium requires insufficiency of small model and sufficient expected value', () => {
  const result = selectExecutionLevel({ smallModelSufficient: false, premiumModelEstimatedCostUsd: 0.10, expectedValueUsd: 2 });
  assert.equal(result.level, LEVELS.PREMIUM_MODEL);
});

test('multi-agent requires cheaper paths to fail and sufficient expected gain', () => {
  const result = selectExecutionLevel({ smallModelSufficient: false, premiumModelEstimatedCostUsd: 0.50, expectedValueUsd: 0, multiAgentEstimatedCostUsd: 0.20, multiAgentExpectedQualityGain: 0.20 });
  assert.equal(result.level, LEVELS.MULTI_AGENT);
});

test('fails closed when mission budget is exhausted', () => {
  const result = selectExecutionLevel({ smallModelEstimatedCostUsd: 0.10, missionSpentUsd: 0.25 });
  assert.equal(result.level, null);
  assert.equal(result.reason, 'budget_or_value_gate_failed');
  assert.equal(result.availableBudgetUsd, 0);
});

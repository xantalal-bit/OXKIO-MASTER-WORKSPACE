'use strict';

const DEFAULT_POLICY = Object.freeze({
  missionBudgetUsd: 0.25,
  dailyBudgetUsd: 2.0,
  premiumMinExpectedValueUsd: 1.0,
  multiAgentMinExpectedGain: 0.15,
  preferDeterministic: true,
  allowPremium: true,
  allowMultiAgent: true,
});

const LEVELS = Object.freeze({
  DETERMINISTIC: 'deterministic',
  SKILL: 'skill',
  SMALL_MODEL: 'small_model',
  PREMIUM_MODEL: 'premium_model',
  MULTI_AGENT: 'multi_agent',
});

function finiteNonNegative(value, fallback) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function normalizePolicy(policy = {}) {
  return {
    ...DEFAULT_POLICY,
    ...policy,
    missionBudgetUsd: finiteNonNegative(policy.missionBudgetUsd, DEFAULT_POLICY.missionBudgetUsd),
    dailyBudgetUsd: finiteNonNegative(policy.dailyBudgetUsd, DEFAULT_POLICY.dailyBudgetUsd),
    premiumMinExpectedValueUsd: finiteNonNegative(policy.premiumMinExpectedValueUsd, DEFAULT_POLICY.premiumMinExpectedValueUsd),
    multiAgentMinExpectedGain: finiteNonNegative(policy.multiAgentMinExpectedGain, DEFAULT_POLICY.multiAgentMinExpectedGain),
  };
}

function estimateCallCostUsd({ inputTokens = 0, outputTokens = 0, inputUsdPerMillion = 0, outputUsdPerMillion = 0 } = {}) {
  const input = finiteNonNegative(inputTokens, 0) * finiteNonNegative(inputUsdPerMillion, 0) / 1_000_000;
  const output = finiteNonNegative(outputTokens, 0) * finiteNonNegative(outputUsdPerMillion, 0) / 1_000_000;
  return Number((input + output).toFixed(8));
}

function remainingBudgetUsd(limit, spent = 0) {
  return Math.max(0, finiteNonNegative(limit, 0) - finiteNonNegative(spent, 0));
}

function selectExecutionLevel(mission = {}, policyInput = {}) {
  const policy = normalizePolicy(policyInput);
  const missionRemaining = remainingBudgetUsd(policy.missionBudgetUsd, mission.missionSpentUsd);
  const dailyRemaining = remainingBudgetUsd(policy.dailyBudgetUsd, mission.dailySpentUsd);
  const availableBudgetUsd = Math.min(missionRemaining, dailyRemaining);

  if (policy.preferDeterministic && mission.deterministicAvailable === true) {
    return { level: LEVELS.DETERMINISTIC, reason: 'deterministic_available', availableBudgetUsd };
  }
  if (mission.reusableSkillAvailable === true) {
    return { level: LEVELS.SKILL, reason: 'reusable_skill_available', availableBudgetUsd };
  }

  const smallCost = finiteNonNegative(mission.smallModelEstimatedCostUsd, Infinity);
  if (smallCost <= availableBudgetUsd && mission.smallModelSufficient !== false) {
    return { level: LEVELS.SMALL_MODEL, reason: 'small_model_sufficient', availableBudgetUsd };
  }

  const premiumCost = finiteNonNegative(mission.premiumModelEstimatedCostUsd, Infinity);
  const expectedValue = finiteNonNegative(mission.expectedValueUsd, 0);
  if (policy.allowPremium && premiumCost <= availableBudgetUsd && expectedValue >= policy.premiumMinExpectedValueUsd) {
    return { level: LEVELS.PREMIUM_MODEL, reason: 'premium_value_justified', availableBudgetUsd };
  }

  const multiAgentCost = finiteNonNegative(mission.multiAgentEstimatedCostUsd, Infinity);
  const expectedGain = finiteNonNegative(mission.multiAgentExpectedQualityGain, 0);
  if (policy.allowMultiAgent && multiAgentCost <= availableBudgetUsd && expectedGain >= policy.multiAgentMinExpectedGain) {
    return { level: LEVELS.MULTI_AGENT, reason: 'multi_agent_gain_justified', availableBudgetUsd };
  }

  return { level: null, reason: 'budget_or_value_gate_failed', availableBudgetUsd };
}

module.exports = {
  DEFAULT_POLICY,
  LEVELS,
  normalizePolicy,
  estimateCallCostUsd,
  remainingBudgetUsd,
  selectExecutionLevel,
};

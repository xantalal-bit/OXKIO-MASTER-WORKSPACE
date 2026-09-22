'use strict';

const crypto = require('node:crypto');
const { selectExecutionLevel } = require('./cost-policy');

const SCHEMA_VERSION = 1;

function finiteNonNegative(value, fallback = 0) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function buildCostDecisionEvidence({ mission = {}, policy = {}, decision = null, timestamp = null } = {}) {
  const resolvedDecision = decision || selectExecutionLevel(mission, policy);
  const safeTimestamp = timestamp || new Date().toISOString();
  const evidence = {
    schemaVersion: SCHEMA_VERSION,
    type: 'cost_policy_decision',
    timestamp: safeTimestamp,
    missionId: mission.missionId || null,
    decision: {
      level: resolvedDecision.level || null,
      reason: resolvedDecision.reason,
      availableBudgetUsd: finiteNonNegative(resolvedDecision.availableBudgetUsd),
    },
    spend: {
      missionSpentUsd: finiteNonNegative(mission.missionSpentUsd),
      dailySpentUsd: finiteNonNegative(mission.dailySpentUsd),
    },
    estimates: {
      smallModelUsd: finiteNonNegative(mission.smallModelEstimatedCostUsd),
      premiumModelUsd: finiteNonNegative(mission.premiumModelEstimatedCostUsd),
      multiAgentUsd: finiteNonNegative(mission.multiAgentEstimatedCostUsd),
    },
    valueSignals: {
      expectedValueUsd: finiteNonNegative(mission.expectedValueUsd),
      multiAgentExpectedQualityGain: finiteNonNegative(mission.multiAgentExpectedQualityGain),
    },
  };

  return { ...evidence, evidenceHash: stableHash(evidence) };
}

module.exports = { SCHEMA_VERSION, buildCostDecisionEvidence, stableHash };

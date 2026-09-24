'use strict';

// In-memory outcome counters for supervised autonomy. A policy-required human
// approval is NOT a human intervention: it is counted separately through
// approvalGated and never changes the outcome.
const OUTCOMES = Object.freeze({
  COMPLETED: 'completed',
  HUMAN_INTERVENTION: 'human_intervention',
  BLOCKED: 'blocked',
  FAILED: 'failed',
});

const COUNTER_BY_OUTCOME = Object.freeze({
  [OUTCOMES.COMPLETED]: 'completedCount',
  [OUTCOMES.HUMAN_INTERVENTION]: 'humanInterventionCount',
  [OUTCOMES.BLOCKED]: 'blockedCount',
  [OUTCOMES.FAILED]: 'failedCount',
});

const RECORD_OPTION_KEYS = new Set(['approvalGated']);

// Fixed error codes only: messages never echo received values.
function fail(code) {
  const error = new TypeError(code);
  error.code = code;
  throw error;
}

function isOutcome(value) {
  return typeof value === 'string' && Object.hasOwn(COUNTER_BY_OUTCOME, value);
}

function isPlainObject(value) {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null;
}

// totalAttempts counts every recorded attempt, including blocked and failed
// ones, so failures are never hidden from the denominator. Division by zero
// yields null, never Infinity, NaN or an artificial 0.
function computeRates({ completedCount = 0, humanInterventionCount = 0, blockedCount = 0, failedCount = 0 } = {}) {
  const totalAttempts = completedCount + humanInterventionCount + blockedCount + failedCount;
  return {
    totalAttempts,
    autonomousCompletionRate: ratio(completedCount, totalAttempts),
    overallCompletionRate: ratio(completedCount + humanInterventionCount, totalAttempts),
    autonomousPerHumanIntervention: ratio(completedCount, humanInterventionCount),
  };
}

// Validates without mutating anything; returns the normalized approvalGated.
function validateOutcomeRecord(outcome, options) {
  if (!isOutcome(outcome)) fail('TELEMETRY_INVALID_OUTCOME');
  if (options === undefined) return false;
  if (!isPlainObject(options)) fail('TELEMETRY_INVALID_OPTIONS');
  for (const key of Object.keys(options)) {
    if (!RECORD_OPTION_KEYS.has(key)) fail('TELEMETRY_UNEXPECTED_FIELD');
  }
  const { approvalGated = false } = options;
  if (typeof approvalGated !== 'boolean') fail('TELEMETRY_INVALID_APPROVAL_GATED');
  return approvalGated;
}

class AgentProductivityMetrics {
  constructor() {
    this.counts = {
      completedCount: 0,
      humanInterventionCount: 0,
      blockedCount: 0,
      failedCount: 0,
      approvalGatedCount: 0,
    };
  }

  recordOutcome(outcome, options) {
    const approvalGated = validateOutcomeRecord(outcome, options);
    this.counts[COUNTER_BY_OUTCOME[outcome]] += 1;
    if (approvalGated) this.counts.approvalGatedCount += 1;
  }

  snapshot() {
    return Object.freeze({ ...this.counts, ...computeRates(this.counts) });
  }
}

module.exports = { OUTCOMES, computeRates, validateOutcomeRecord, AgentProductivityMetrics };

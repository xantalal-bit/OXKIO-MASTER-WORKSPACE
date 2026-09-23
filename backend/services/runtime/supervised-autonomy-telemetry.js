'use strict';

const { AgentProductivityMetrics } = require('./agent-productivity-metrics');

const SUPPORTED_OUTCOMES = new Set([
  'completed',
  'human_intervention',
  'blocked',
  'failed',
]);

function finiteNonNegative(value) {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

class SupervisedAutonomyTelemetry {
  constructor({ productivity = null } = {}) {
    this.productivity = productivity || new AgentProductivityMetrics();
    this.patterns = new Map();
    this.executionLevels = new Map();
    this.estimatedCostUsd = 0;
    this.actualCostUsd = 0;
    this.records = 0;
  }

  record({ outcome, costDecision = null, actualCostUsd = 0 } = {}) {
    if (!SUPPORTED_OUTCOMES.has(outcome)) {
      throw new TypeError('unsupported supervised autonomy outcome');
    }

    const executionPattern = costDecision?.executionPattern?.pattern || 'unknown';
    const executionLevel = costDecision?.decision?.level || 'unknown';
    const estimatedCostUsd = finiteNonNegative(costDecision?.estimatedCostUsd);

    this.productivity.record(outcome);
    this.patterns.set(executionPattern, (this.patterns.get(executionPattern) || 0) + 1);
    this.executionLevels.set(executionLevel, (this.executionLevels.get(executionLevel) || 0) + 1);
    this.estimatedCostUsd += estimatedCostUsd;
    this.actualCostUsd += finiteNonNegative(actualCostUsd);
    this.records += 1;

    return this.snapshot();
  }

  snapshot() {
    return Object.freeze({
      records: this.records,
      productivity: this.productivity.snapshot(),
      executionPatterns: Object.fromEntries(this.patterns),
      executionLevels: Object.fromEntries(this.executionLevels),
      estimatedCostUsd: this.estimatedCostUsd,
      actualCostUsd: this.actualCostUsd,
    });
  }
}

module.exports = { SupervisedAutonomyTelemetry };

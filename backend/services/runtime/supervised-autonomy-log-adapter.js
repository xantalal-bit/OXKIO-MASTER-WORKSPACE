'use strict';

const { SupervisedAutonomyTelemetry } = require('./supervised-autonomy-telemetry');

const TERMINAL_OUTCOMES = new Set([
  'completed',
  'human_intervention',
  'blocked',
  'failed',
]);

class SupervisedAutonomyLogAdapter {
  constructor({ telemetry = null, logEngine = null } = {}) {
    if (!logEngine || typeof logEngine.addLog !== 'function') {
      throw new TypeError('logEngine with addLog is required');
    }

    this.telemetry = telemetry || new SupervisedAutonomyTelemetry();
    this.logEngine = logEngine;
    this.recordedTerminalOutcomes = new Map();
  }

  record({ missionId = null, outcome, costDecision = null, actualCostUsd = 0 } = {}) {
    if (!TERMINAL_OUTCOMES.has(outcome)) {
      throw new TypeError('unsupported supervised autonomy outcome');
    }

    if (missionId && this.recordedTerminalOutcomes.has(missionId)) {
      const previousOutcome = this.recordedTerminalOutcomes.get(missionId);
      if (previousOutcome !== outcome) {
        throw new Error('conflicting terminal outcome for mission');
      }
      return this.telemetry.snapshot();
    }

    const snapshot = this.telemetry.record({ outcome, costDecision, actualCostUsd });
    const executionPattern = costDecision?.executionPattern?.pattern || 'unknown';
    const executionLevel = costDecision?.decision?.level || 'unknown';

    this.logEngine.addLog('supervised_autonomy', 'mission outcome recorded', {
      missionId,
      outcome,
      executionPattern,
      executionLevel,
      estimatedCostUsd: Number.isFinite(costDecision?.estimatedCostUsd) && costDecision.estimatedCostUsd >= 0
        ? costDecision.estimatedCostUsd
        : 0,
      actualCostUsd: Number.isFinite(actualCostUsd) && actualCostUsd >= 0 ? actualCostUsd : 0,
    });

    if (missionId) {
      this.recordedTerminalOutcomes.set(missionId, outcome);
    }

    return snapshot;
  }
}

module.exports = { SupervisedAutonomyLogAdapter };

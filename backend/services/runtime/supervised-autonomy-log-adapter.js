'use strict';

const { SupervisedAutonomyTelemetry } = require('./supervised-autonomy-telemetry');

class SupervisedAutonomyLogAdapter {
  constructor({ telemetry = null, logEngine = null } = {}) {
    if (!logEngine || typeof logEngine.addLog !== 'function') {
      throw new TypeError('logEngine with addLog is required');
    }

    this.telemetry = telemetry || new SupervisedAutonomyTelemetry();
    this.logEngine = logEngine;
  }

  record({ missionId = null, outcome, costDecision = null, actualCostUsd = 0 } = {}) {
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

    return snapshot;
  }
}

module.exports = { SupervisedAutonomyLogAdapter };

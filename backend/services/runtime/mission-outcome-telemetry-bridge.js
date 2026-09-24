'use strict';

const { MISSION_STATES } = require('../mission-queue/mission-contract');

const OUTCOME_BY_STATE = Object.freeze({
  [MISSION_STATES.COMPLETED]: 'completed',
  [MISSION_STATES.FAILED]: 'failed',
  [MISSION_STATES.BLOCKED]: 'blocked',
});

class MissionOutcomeTelemetryBridge {
  constructor({ autonomyLogAdapter } = {}) {
    if (!autonomyLogAdapter || typeof autonomyLogAdapter.record !== 'function') {
      throw new TypeError('autonomyLogAdapter with record is required');
    }
    this.autonomyLogAdapter = autonomyLogAdapter;
  }

  recordMissionState({ mission, costDecision = null, actualCostUsd = 0 } = {}) {
    if (!mission || typeof mission !== 'object') {
      throw new TypeError('mission is required');
    }

    const outcome = OUTCOME_BY_STATE[mission.status];
    if (!outcome) return null;

    return this.autonomyLogAdapter.record({
      missionId: mission.missionId,
      outcome,
      costDecision,
      actualCostUsd,
    });
  }

  recordHumanIntervention({ mission, costDecision = null, actualCostUsd = 0 } = {}) {
    if (!mission || typeof mission !== 'object' || !mission.missionId) {
      throw new TypeError('mission with missionId is required');
    }

    return this.autonomyLogAdapter.record({
      missionId: mission.missionId,
      outcome: 'human_intervention',
      costDecision,
      actualCostUsd,
    });
  }
}

module.exports = { MissionOutcomeTelemetryBridge };

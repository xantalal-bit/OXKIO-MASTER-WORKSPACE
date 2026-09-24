'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MISSION_STATES } = require('../mission-queue/mission-contract');
const { MissionOutcomeTelemetryBridge } = require('./mission-outcome-telemetry-bridge');

test('maps completed mission state to completed autonomy outcome', () => {
  const calls = [];
  const bridge = new MissionOutcomeTelemetryBridge({ autonomyLogAdapter: { record: (input) => { calls.push(input); return { ok: true }; } } });
  const result = bridge.recordMissionState({ mission: { missionId: 'mission-1', status: MISSION_STATES.COMPLETED }, actualCostUsd: 0.02 });
  assert.deepEqual(result, { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].outcome, 'completed');
  assert.equal(calls[0].missionId, 'mission-1');
  assert.equal(calls[0].actualCostUsd, 0.02);
});

test('maps failed and blocked mission states without inventing completion', () => {
  const outcomes = [];
  const bridge = new MissionOutcomeTelemetryBridge({ autonomyLogAdapter: { record: ({ outcome }) => outcomes.push(outcome) } });
  bridge.recordMissionState({ mission: { missionId: 'mission-f', status: MISSION_STATES.FAILED } });
  bridge.recordMissionState({ mission: { missionId: 'mission-b', status: MISSION_STATES.BLOCKED } });
  assert.deepEqual(outcomes, ['failed', 'blocked']);
});

test('ignores non-terminal mission states', () => {
  let calls = 0;
  const bridge = new MissionOutcomeTelemetryBridge({ autonomyLogAdapter: { record: () => { calls += 1; } } });
  const result = bridge.recordMissionState({ mission: { missionId: 'mission-r', status: MISSION_STATES.RUNNING } });
  assert.equal(result, null);
  assert.equal(calls, 0);
});

test('human intervention is explicit and never inferred from mission state', () => {
  const calls = [];
  const bridge = new MissionOutcomeTelemetryBridge({ autonomyLogAdapter: { record: (input) => calls.push(input) } });
  bridge.recordHumanIntervention({ mission: { missionId: 'mission-h', status: MISSION_STATES.WAITING_APPROVAL } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].outcome, 'human_intervention');
});

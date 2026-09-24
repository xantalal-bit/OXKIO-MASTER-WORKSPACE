'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const LogEngine = require('../../logs/logEngine');
const { SupervisedAutonomyLogAdapter } = require('./supervised-autonomy-log-adapter');

function quietLogEngine() {
  return new LogEngine({ consoleRef: { log() {} } });
}

test('records telemetry through the existing log engine without a parallel logger', () => {
  const logEngine = quietLogEngine();
  const adapter = new SupervisedAutonomyLogAdapter({ logEngine });
  const costDecision = {
    executionPattern: { pattern: 'single_shot' },
    decision: { level: 'small_model' },
    estimatedCostUsd: 0.02,
  };

  const snapshot = adapter.record({
    missionId: 'mission-1',
    outcome: 'completed',
    costDecision,
    actualCostUsd: 0.015,
  });

  assert.equal(snapshot.records, 1);
  assert.equal(snapshot.productivity.completed, 1);
  const logs = logEngine.getLogsByType('supervised_autonomy');
  assert.equal(logs.length, 1);
  assert.equal(logs[0].data.missionId, 'mission-1');
  assert.equal(logs[0].data.executionPattern, 'single_shot');
  assert.equal(logs[0].data.executionLevel, 'small_model');
  assert.equal(logs[0].data.actualCostUsd, 0.015);
});

test('preserves human intervention as an explicit supervised outcome', () => {
  const logEngine = quietLogEngine();
  const adapter = new SupervisedAutonomyLogAdapter({ logEngine });

  const snapshot = adapter.record({ outcome: 'human_intervention' });

  assert.equal(snapshot.productivity.humanInterventions, 1);
  assert.equal(logEngine.getLogsByType('supervised_autonomy')[0].data.outcome, 'human_intervention');
});

test('rejects invented completion states instead of logging them as evidence', () => {
  const logEngine = quietLogEngine();
  const adapter = new SupervisedAutonomyLogAdapter({ logEngine });

  assert.throws(() => adapter.record({ outcome: 'pretend_done' }), /unsupported supervised autonomy outcome/);
  assert.equal(logEngine.getLogs().length, 0);
});

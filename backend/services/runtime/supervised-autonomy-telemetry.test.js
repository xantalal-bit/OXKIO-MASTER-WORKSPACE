'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SupervisedAutonomyTelemetry } = require('./supervised-autonomy-telemetry');

test('records productivity with execution pattern and level', () => {
  const telemetry = new SupervisedAutonomyTelemetry();
  const snapshot = telemetry.record({
    outcome: 'completed',
    costDecision: {
      decision: { level: 'deterministic' },
      executionPattern: { pattern: 'deterministic' },
    },
  });

  assert.equal(snapshot.records, 1);
  assert.equal(snapshot.productivity.completed, 1);
  assert.equal(snapshot.executionPatterns.deterministic, 1);
  assert.equal(snapshot.executionLevels.deterministic, 1);
});

test('tracks human intervention without treating it as autonomous completion', () => {
  const telemetry = new SupervisedAutonomyTelemetry();
  telemetry.record({ outcome: 'completed' });
  const snapshot = telemetry.record({ outcome: 'human_intervention' });

  assert.equal(snapshot.productivity.autonomousWorkPerHumanIntervention, 1);
  assert.equal(snapshot.productivity.autonomousCompletionRate, 0.5);
});

test('records estimated and actual cost only from finite non-negative values', () => {
  const telemetry = new SupervisedAutonomyTelemetry();
  const snapshot = telemetry.record({
    outcome: 'completed',
    costDecision: {
      decision: { level: 'small_model' },
      executionPattern: { pattern: 'single_shot' },
      estimatedCostUsd: 0.02,
    },
    actualCostUsd: 0.015,
  });

  assert.equal(snapshot.estimatedCostUsd, 0.02);
  assert.equal(snapshot.actualCostUsd, 0.015);
});

test('fails closed on unsupported outcomes', () => {
  const telemetry = new SupervisedAutonomyTelemetry();
  assert.throws(
    () => telemetry.record({ outcome: 'pretend_done' }),
    /unsupported supervised autonomy outcome/,
  );
});

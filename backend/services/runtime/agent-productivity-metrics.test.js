'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AgentProductivityMetrics } = require('./agent-productivity-metrics');

test('measures autonomous work per human intervention', () => {
  const metrics = new AgentProductivityMetrics();
  metrics.record('completed');
  metrics.record('completed');
  metrics.record('human_intervention');
  const snapshot = metrics.snapshot();
  assert.equal(snapshot.completed, 2);
  assert.equal(snapshot.humanInterventions, 1);
  assert.equal(snapshot.autonomousWorkPerHumanIntervention, 2);
  assert.equal(snapshot.autonomousCompletionRate, 2 / 3);
});

test('reports useful autonomy before any human intervention', () => {
  const metrics = new AgentProductivityMetrics();
  metrics.record('completed');
  assert.equal(metrics.snapshot().autonomousWorkPerHumanIntervention, 1);
});

test('tracks blocked and failed outcomes without inflating completion rate', () => {
  const metrics = new AgentProductivityMetrics();
  metrics.record('completed');
  metrics.record('blocked');
  metrics.record('failed');
  const snapshot = metrics.snapshot();
  assert.equal(snapshot.blocked, 1);
  assert.equal(snapshot.failed, 1);
  assert.equal(snapshot.autonomousCompletionRate, 1);
});

test('rejects unknown outcomes', () => {
  const metrics = new AgentProductivityMetrics();
  assert.throws(() => metrics.record('pretend_done'), /unsupported productivity outcome/);
});

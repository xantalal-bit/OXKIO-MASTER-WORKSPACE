'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { OUTCOMES, computeRates, AgentProductivityMetrics } = require('./agent-productivity-metrics');

const COUNTER_BY_OUTCOME = {
  completed: 'completedCount',
  human_intervention: 'humanInterventionCount',
  blocked: 'blockedCount',
  failed: 'failedCount',
};

test('exposes exactly the four supervised autonomy outcomes', () => {
  assert.deepEqual(Object.values(OUTCOMES).sort(), ['blocked', 'completed', 'failed', 'human_intervention']);
  assert.ok(Object.isFrozen(OUTCOMES));
});

test('records each outcome individually into its own counter', () => {
  for (const [outcome, counter] of Object.entries(COUNTER_BY_OUTCOME)) {
    const metrics = new AgentProductivityMetrics();
    metrics.recordOutcome(outcome);
    const snapshot = metrics.snapshot();
    assert.equal(snapshot[counter], 1);
    assert.equal(snapshot.totalAttempts, 1);
    for (const other of Object.values(COUNTER_BY_OUTCOME)) {
      if (other !== counter) assert.equal(snapshot[other], 0);
    }
    assert.equal(snapshot.approvalGatedCount, 0);
  }
});

test('one completed and one failed attempt yield an autonomous rate of 0.5', () => {
  const metrics = new AgentProductivityMetrics();
  metrics.recordOutcome('completed');
  metrics.recordOutcome('failed');
  const snapshot = metrics.snapshot();
  assert.equal(snapshot.totalAttempts, 2);
  assert.equal(snapshot.autonomousCompletionRate, 0.5);
  assert.equal(snapshot.overallCompletionRate, 0.5);
});

test('overall completion counts human-assisted completions but autonomy does not', () => {
  const metrics = new AgentProductivityMetrics();
  metrics.recordOutcome('completed');
  metrics.recordOutcome('human_intervention');
  metrics.recordOutcome('blocked');
  metrics.recordOutcome('failed');
  const snapshot = metrics.snapshot();
  assert.equal(snapshot.totalAttempts, 4);
  assert.equal(snapshot.autonomousCompletionRate, 0.25);
  assert.equal(snapshot.overallCompletionRate, 0.5);
  assert.equal(snapshot.autonomousPerHumanIntervention, 1);
});

test('without human intervention the per-intervention ratio is null, not Infinity', () => {
  const metrics = new AgentProductivityMetrics();
  metrics.recordOutcome('completed');
  const snapshot = metrics.snapshot();
  assert.equal(snapshot.autonomousPerHumanIntervention, null);
  assert.equal(computeRates({ humanInterventionCount: 2 }).autonomousPerHumanIntervention, 0);
});

test('zero attempts yield null ratios instead of NaN or artificial zeros', () => {
  const snapshot = new AgentProductivityMetrics().snapshot();
  assert.equal(snapshot.totalAttempts, 0);
  assert.equal(snapshot.autonomousCompletionRate, null);
  assert.equal(snapshot.overallCompletionRate, null);
  assert.equal(snapshot.autonomousPerHumanIntervention, null);
});

test('policy approval gating is counted separately and never changes the outcome', () => {
  const metrics = new AgentProductivityMetrics();
  metrics.recordOutcome('completed', { approvalGated: true });
  metrics.recordOutcome('failed', { approvalGated: false });
  const snapshot = metrics.snapshot();
  assert.equal(snapshot.completedCount, 1);
  assert.equal(snapshot.humanInterventionCount, 0);
  assert.equal(snapshot.failedCount, 1);
  assert.equal(snapshot.approvalGatedCount, 1);
  assert.equal(snapshot.autonomousCompletionRate, 0.5);
});

test('unknown outcomes fail closed with a fixed code and leave state intact', () => {
  const metrics = new AgentProductivityMetrics();
  metrics.recordOutcome('completed');
  const before = metrics.snapshot();
  for (const outcome of ['Completed', 'success', 'toString', '__proto__', '', null, undefined, 1, {}]) {
    assert.throws(() => metrics.recordOutcome(outcome), (error) => {
      assert.ok(error instanceof TypeError);
      assert.equal(error.message, 'TELEMETRY_INVALID_OUTCOME');
      return true;
    });
  }
  assert.deepEqual(metrics.snapshot(), before);
});

test('non-boolean approvalGated or extra options fail closed and leave state intact', () => {
  const metrics = new AgentProductivityMetrics();
  const before = metrics.snapshot();
  for (const approvalGated of ['true', 1, 0, null, {}]) {
    assert.throws(() => metrics.recordOutcome('completed', { approvalGated }), /^TypeError: TELEMETRY_INVALID_APPROVAL_GATED$/);
  }
  assert.throws(() => metrics.recordOutcome('completed', { humanIntervention: true }), /TELEMETRY_UNEXPECTED_FIELD/);
  assert.throws(() => metrics.recordOutcome('completed', 'approved'), /TELEMETRY_INVALID_OPTIONS/);
  assert.deepEqual(metrics.snapshot(), before);
});

test('snapshots are frozen and independent from internal state', () => {
  const metrics = new AgentProductivityMetrics();
  metrics.recordOutcome('completed');
  const first = metrics.snapshot();
  assert.ok(Object.isFrozen(first));
  assert.throws(() => { first.completedCount = 99; }, TypeError);
  metrics.recordOutcome('failed');
  const second = metrics.snapshot();
  assert.equal(first.failedCount, 0);
  assert.equal(second.failedCount, 1);
  assert.equal(second.completedCount, 1);
  assert.notEqual(first, second);
});

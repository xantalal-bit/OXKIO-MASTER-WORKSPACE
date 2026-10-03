'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MISSION_STATES } = require('../mission-queue/mission-contract');
const {
  ENGINE_STATES, ENGINE_TRANSITIONS, TERMINAL_ENGINE_STATES, canTransition, projectToMissionQueueStatus, transition,
} = require('./mission-engine-states');

function errorCode(fn) {
  try { fn(); } catch (error) { return error.code; }
  return null;
}

test('the 15 canonical engine states exist, each with an explicit transition list', () => {
  assert.deepEqual(Object.keys(ENGINE_STATES), ['CREATED', 'PLANNED', 'READY', 'RUNNING', 'WAITING_AGENT', 'WAITING_TOOL',
    'NEEDS_INFORMATION', 'NEEDS_CONNECTION', 'NEEDS_APPROVAL', 'VERIFYING', 'REPLANNING', 'BLOCKED', 'COMPLETED', 'FAILED', 'CANCELLED']);
  for (const state of Object.keys(ENGINE_STATES)) {
    assert.ok(Array.isArray(ENGINE_TRANSITIONS[state]), state);
    for (const target of ENGINE_TRANSITIONS[state]) assert.ok(Object.hasOwn(ENGINE_STATES, target));
  }
});

test('terminal states never move; impossible transitions are refused', () => {
  for (const terminal of TERMINAL_ENGINE_STATES) {
    for (const target of Object.keys(ENGINE_STATES)) assert.equal(canTransition(terminal, target), false);
  }
  assert.equal(errorCode(() => transition({ state: 'COMPLETED', history: [] }, 'RUNNING', { at: 'x' })), 'invalid_engine_transition');
  assert.equal(errorCode(() => transition({ state: 'CREATED', history: [] }, 'RUNNING', { at: 'x' })), 'invalid_engine_transition');
  assert.equal(errorCode(() => transition({ state: 'CREATED', history: [] }, 'NOPE', { at: 'x' })), 'invalid_engine_state');
});

test('COMPLETED is only reachable through VERIFYING', () => {
  const into = Object.keys(ENGINE_STATES).filter((state) => canTransition(state, 'COMPLETED'));
  assert.deepEqual(into, ['VERIFYING']);
});

test('transitions keep a minimal immutable history', () => {
  const first = transition({ state: 'CREATED', history: [] }, 'PLANNED', { reason: 'plan_created', at: '2026-10-03T10:00:00.000Z' });
  const second = transition(first, 'READY', { reason: 'plan_gated', at: '2026-10-03T10:00:01.000Z' });
  assert.equal(second.state, 'READY');
  assert.deepEqual(second.history.map((entry) => [entry.from, entry.to, entry.reason]), [
    ['CREATED', 'PLANNED', 'plan_created'], ['PLANNED', 'READY', 'plan_gated'],
  ]);
  assert.equal(first.history.length, 1);
  assert.ok(Object.isFrozen(second.history));
});

test('every engine state projects onto a canonical Mission Queue state', () => {
  for (const state of Object.keys(ENGINE_STATES)) {
    assert.ok(Object.values(MISSION_STATES).includes(projectToMissionQueueStatus(state)), state);
  }
  assert.equal(projectToMissionQueueStatus('NEEDS_APPROVAL'), 'WAITING_APPROVAL');
  assert.equal(projectToMissionQueueStatus('VERIFYING'), 'UNDER_REVIEW');
  assert.equal(errorCode(() => projectToMissionQueueStatus('X')), 'invalid_engine_state');
});

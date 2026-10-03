'use strict';

const { MISSION_STATES, MissionDomainError } = require('../mission-queue/mission-contract');

// XATAI CORE V2 (03/10/2026): supervision lifecycle of a mission inside the
// Mission Engine. It is finer-grained than the durable Mission Queue status
// (which is persisted and constrained by migration 001) and never replaces
// it: projectToMissionQueueStatus() maps every engine state onto the
// canonical MISSION_STATES, so a mission plan can become a Mission Queue
// record without a schema change. Transitions are explicit, validated and
// fail-closed; terminal states never move again, and COMPLETED is only
// reachable through VERIFYING.

const ENGINE_STATES = Object.freeze({
  CREATED: 'CREATED',
  PLANNED: 'PLANNED',
  READY: 'READY',
  RUNNING: 'RUNNING',
  WAITING_AGENT: 'WAITING_AGENT',
  WAITING_TOOL: 'WAITING_TOOL',
  NEEDS_INFORMATION: 'NEEDS_INFORMATION',
  NEEDS_CONNECTION: 'NEEDS_CONNECTION',
  NEEDS_APPROVAL: 'NEEDS_APPROVAL',
  VERIFYING: 'VERIFYING',
  REPLANNING: 'REPLANNING',
  BLOCKED: 'BLOCKED',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
});

const S = ENGINE_STATES;
const HUMAN_WAIT = [S.NEEDS_INFORMATION, S.NEEDS_CONNECTION, S.NEEDS_APPROVAL];

const ENGINE_TRANSITIONS = Object.freeze({
  [S.CREATED]: Object.freeze([S.PLANNED, S.NEEDS_INFORMATION, S.BLOCKED, S.CANCELLED]),
  [S.PLANNED]: Object.freeze([S.READY, ...HUMAN_WAIT, S.BLOCKED, S.CANCELLED]),
  [S.READY]: Object.freeze([S.RUNNING, ...HUMAN_WAIT, S.BLOCKED, S.CANCELLED]),
  [S.RUNNING]: Object.freeze([S.WAITING_AGENT, S.WAITING_TOOL, ...HUMAN_WAIT, S.VERIFYING,
    S.REPLANNING, S.BLOCKED, S.FAILED, S.CANCELLED]),
  [S.WAITING_AGENT]: Object.freeze([S.RUNNING, S.REPLANNING, S.BLOCKED, S.FAILED, S.CANCELLED]),
  [S.WAITING_TOOL]: Object.freeze([S.RUNNING, S.REPLANNING, S.BLOCKED, S.FAILED, S.CANCELLED]),
  [S.NEEDS_INFORMATION]: Object.freeze([S.PLANNED, S.READY, S.RUNNING, S.VERIFYING, S.BLOCKED, S.CANCELLED]),
  [S.NEEDS_CONNECTION]: Object.freeze([S.READY, S.RUNNING, S.VERIFYING, S.BLOCKED, S.CANCELLED]),
  [S.NEEDS_APPROVAL]: Object.freeze([S.READY, S.RUNNING, S.VERIFYING, S.BLOCKED, S.CANCELLED]),
  [S.VERIFYING]: Object.freeze([S.COMPLETED, S.REPLANNING, S.NEEDS_APPROVAL, S.BLOCKED, S.FAILED, S.CANCELLED]),
  [S.REPLANNING]: Object.freeze([S.PLANNED, S.READY, S.BLOCKED, S.FAILED, S.CANCELLED]),
  [S.BLOCKED]: Object.freeze([S.PLANNED, S.READY, S.VERIFYING, S.FAILED, S.CANCELLED]),
  [S.COMPLETED]: Object.freeze([]),
  [S.FAILED]: Object.freeze([]),
  [S.CANCELLED]: Object.freeze([]),
});

const TERMINAL_ENGINE_STATES = Object.freeze([S.COMPLETED, S.FAILED, S.CANCELLED]);

const MISSION_QUEUE_PROJECTION = Object.freeze({
  [S.CREATED]: MISSION_STATES.PROPOSED,
  [S.PLANNED]: MISSION_STATES.PROPOSED,
  [S.READY]: MISSION_STATES.READY,
  [S.RUNNING]: MISSION_STATES.RUNNING,
  [S.WAITING_AGENT]: MISSION_STATES.RUNNING,
  [S.WAITING_TOOL]: MISSION_STATES.RUNNING,
  [S.NEEDS_INFORMATION]: MISSION_STATES.BLOCKED,
  [S.NEEDS_CONNECTION]: MISSION_STATES.BLOCKED,
  [S.NEEDS_APPROVAL]: MISSION_STATES.WAITING_APPROVAL,
  [S.VERIFYING]: MISSION_STATES.UNDER_REVIEW,
  [S.REPLANNING]: MISSION_STATES.BLOCKED,
  [S.BLOCKED]: MISSION_STATES.BLOCKED,
  [S.COMPLETED]: MISSION_STATES.COMPLETED,
  [S.FAILED]: MISSION_STATES.FAILED,
  [S.CANCELLED]: MISSION_STATES.CANCELLED,
});

// Task-level lifecycle inside a plan. A plan revision rebuilds a task in
// place; the previous attempt stays in the mission revisions and attempts.
const TASK_STATUS = Object.freeze({
  PLANNED: 'PLANNED',
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  NEEDS_INFORMATION: 'NEEDS_INFORMATION',
  NEEDS_CONNECTION: 'NEEDS_CONNECTION',
  NEEDS_APPROVAL: 'NEEDS_APPROVAL',
  BLOCKED: 'BLOCKED',
  CANCELLED: 'CANCELLED',
  // An optional task that could not run (not connected, refused, failed
  // after retries). It never blocks the mission; its reason is reported as
  // an uncertainty and nothing it would have produced is assumed.
  SKIPPED: 'SKIPPED',
});

function canTransition(from, to) {
  return Object.hasOwn(ENGINE_TRANSITIONS, from) && ENGINE_TRANSITIONS[from].includes(to);
}

function assertTransition(from, to) {
  if (!Object.hasOwn(ENGINE_STATES, to)) throw new MissionDomainError('invalid_engine_state', `Unknown state ${to}.`);
  if (!canTransition(from, to)) {
    throw new MissionDomainError('invalid_engine_transition', `${from} cannot transition to ${to}.`);
  }
}

// Pure: returns the next { state, history } without touching the input.
// History keeps only enums, a short reason code and the timestamp.
function transition(current, to, { reason = null, at } = {}) {
  assertTransition(current.state, to);
  const entry = Object.freeze({
    from: current.state, to, reason: reason ? String(reason).slice(0, 80) : null, at,
  });
  return Object.freeze({ state: to, history: Object.freeze([...(current.history || []), entry]) });
}

function projectToMissionQueueStatus(state) {
  if (!Object.hasOwn(MISSION_QUEUE_PROJECTION, state)) {
    throw new MissionDomainError('invalid_engine_state', `Unknown state ${state}.`);
  }
  return MISSION_QUEUE_PROJECTION[state];
}

module.exports = {
  ENGINE_STATES,
  ENGINE_TRANSITIONS,
  MISSION_QUEUE_PROJECTION,
  TASK_STATUS,
  TERMINAL_ENGINE_STATES,
  assertTransition,
  canTransition,
  projectToMissionQueueStatus,
  transition,
};

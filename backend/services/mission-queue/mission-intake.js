'use strict';

const { MISSION_STATES } = require('./mission-contract');

const INPUT_KEYS = Object.freeze([
  'authenticatedUserId',
  'confirmed',
  'confirmedPlan',
  'idempotencyKey',
]);

const PLAN_KEYS = Object.freeze([
  'missionId',
  'title',
  'objective',
  'scope',
  'projectId',
  'workspaceId',
  'priority',
  'acceptanceCriteria',
  'sourceInteractionId',
  'nextAction',
]);

class MissionIntakeError extends Error {
  constructor(code, message = 'Mission intake failed.') {
    super(message);
    this.name = 'MissionIntakeError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new MissionIntakeError(code, message);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, allowedKeys) {
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

function validateConfirmedPlan(plan) {
  if (!isPlainObject(plan)
    || !hasExactKeys(plan, PLAN_KEYS)
    || PLAN_KEYS.some((key) => !Object.hasOwn(plan, key))
    || PLAN_KEYS.some((key) => plan[key] === undefined)
    || typeof plan.objective !== 'string'
    || !plan.objective.trim()
    || !Array.isArray(plan.acceptanceCriteria)
    || plan.acceptanceCriteria.length === 0) {
    fail('mission_intake_plan_invalid', 'Confirmed Mission plan is invalid.');
  }
  return plan;
}

function buildMissionPayload(plan, missionScope) {
  return {
    missionId: plan.missionId,
    title: plan.title,
    objective: plan.objective,
    scope: plan.scope,
    clientId: missionScope.clientId,
    projectId: plan.projectId,
    workspaceId: plan.workspaceId,
    priority: plan.priority,
    acceptanceCriteria: plan.acceptanceCriteria,
    sourceInteractionId: plan.sourceInteractionId,
    nextAction: plan.nextAction,
  };
}

function sanitizeResult(result) {
  if (!isPlainObject(result)
    || typeof result.created !== 'boolean'
    || !isPlainObject(result.mission)
    || !Array.isArray(result.events)
    || result.mission.status !== MISSION_STATES.PROPOSED) {
    fail('mission_intake_result_invalid', 'MissionService returned an invalid intake result.');
  }
  return Object.freeze({
    created: result.created,
    mission: result.mission,
    events: result.events,
  });
}

function createMissionIntake({ membershipResolver, missionService } = {}) {
  if (!membershipResolver || typeof membershipResolver.resolveMembership !== 'function'
    || !missionService || typeof missionService.createMission !== 'function') {
    fail('mission_intake_dependencies_invalid', 'Mission intake dependencies are unavailable.');
  }

  async function createMissionFromConfirmedPlan(input = {}) {
    if (!isPlainObject(input) || !hasExactKeys(input, INPUT_KEYS)) {
      fail('mission_intake_input_invalid', 'Mission intake input is invalid.');
    }
    if (input.confirmed !== true) {
      fail('mission_intake_not_confirmed', 'Mission creation is not confirmed.');
    }
    if (typeof input.idempotencyKey !== 'string' || !input.idempotencyKey.trim()) {
      fail('mission_intake_idempotency_invalid', 'Mission idempotencyKey is required.');
    }
    const confirmedPlan = validateConfirmedPlan(input.confirmedPlan);
    const missionScope = await membershipResolver.resolveMembership({
      authenticatedUserId: input.authenticatedUserId,
    });
    const payload = buildMissionPayload(confirmedPlan, missionScope);
    const result = await missionService.createMission(missionScope, payload, {
      idempotencyKey: input.idempotencyKey,
    });
    return sanitizeResult(result);
  }

  return Object.freeze({ createMissionFromConfirmedPlan });
}

module.exports = {
  MissionIntakeError,
  createMissionIntake,
};

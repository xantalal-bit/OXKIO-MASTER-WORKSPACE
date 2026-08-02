'use strict';

const PLAN_SCHEMA_VERSION = 1;
const INITIAL_VERSION = 1;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9:_-]{3,128}$/;
const PRIORITIES = Object.freeze(['normal', 'medium', 'high']);

const CONFIRMATION_STATUSES = Object.freeze({
  PENDING: 'PENDING',
  CONFIRMED: 'CONFIRMED',
  CONSUMED: 'CONSUMED',
  REVOKED: 'REVOKED',
});

const CONTRACT_KEYS = Object.freeze([
  'confirmationId',
  'tenantId',
  'userId',
  'clientId',
  'missionId',
  'idempotencyKey',
  'planSnapshot',
  'planSchemaVersion',
  'status',
  'version',
  'createdAt',
  'confirmedAt',
  'consumedAt',
  'revokedAt',
  'expiresAt',
]);

const CREATE_INPUT_KEYS = Object.freeze([
  'confirmationId',
  'tenantId',
  'userId',
  'clientId',
  'missionId',
  'idempotencyKey',
  'planSnapshot',
  'planSchemaVersion',
  'expiresAt',
]);

const PLAN_KEYS = Object.freeze([
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

const CRITERION_KEYS = Object.freeze(['criterionId', 'description']);

const TRANSITIONS = Object.freeze({
  [CONFIRMATION_STATUSES.PENDING]: Object.freeze([
    CONFIRMATION_STATUSES.CONFIRMED,
    CONFIRMATION_STATUSES.REVOKED,
  ]),
  [CONFIRMATION_STATUSES.CONFIRMED]: Object.freeze([
    CONFIRMATION_STATUSES.CONSUMED,
    CONFIRMATION_STATUSES.REVOKED,
  ]),
  [CONFIRMATION_STATUSES.CONSUMED]: Object.freeze([]),
  [CONFIRMATION_STATUSES.REVOKED]: Object.freeze([]),
});

class ConfirmationContractError extends Error {
  constructor(code, message = 'Mission Confirmation contract failed.') {
    super(message);
    this.name = 'ConfirmationContractError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new ConfirmationContractError(code, message);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, keys) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length
    && actual.every((key) => keys.includes(key))
    && keys.every((key) => Object.hasOwn(value, key));
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function freezeValue(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freezeValue);
  return Object.freeze(value);
}

function normalizeIdentifier(value, code = 'confirmation_input_invalid') {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) {
    fail(code, 'An opaque portable identifier is required.');
  }
  return value;
}

function normalizeOptionalIdentifier(value) {
  if (value === null) return null;
  return normalizeIdentifier(value, 'confirmation_plan_invalid');
}

function normalizeText(value, maxLength) {
  if (typeof value !== 'string' || !value.trim()) {
    fail('confirmation_plan_invalid', 'Mission Confirmation plan is invalid.');
  }
  const normalized = value
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized || normalized.length > maxLength) {
    fail('confirmation_plan_invalid', 'Mission Confirmation plan is invalid.');
  }
  return normalized;
}

function normalizeTimestamp(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    fail('confirmation_time_invalid', 'A valid ISO-8601 timestamp is required.');
  }
  const normalized = new Date(value).toISOString();
  if (normalized !== value) {
    fail('confirmation_time_invalid', 'A canonical ISO-8601 timestamp is required.');
  }
  return normalized;
}

function resolveNow(options) {
  if (!hasExactKeys(options, ['now'])) {
    fail('confirmation_time_invalid', 'An injected now value is required.');
  }
  const value = typeof options.now === 'function' ? options.now() : options.now;
  return normalizeTimestamp(value);
}

function normalizeCriterion(criterion) {
  if (!hasExactKeys(criterion, CRITERION_KEYS)) {
    fail('confirmation_plan_invalid', 'Mission Confirmation plan is invalid.');
  }
  return {
    criterionId: normalizeIdentifier(criterion.criterionId, 'confirmation_plan_invalid'),
    description: normalizeText(criterion.description, 300),
  };
}

function normalizePlanSnapshot(planSnapshot) {
  if (!hasExactKeys(planSnapshot, PLAN_KEYS)
    || !Array.isArray(planSnapshot.acceptanceCriteria)
    || planSnapshot.acceptanceCriteria.length === 0
    || planSnapshot.acceptanceCriteria.length > 50
    || !PRIORITIES.includes(planSnapshot.priority)) {
    fail('confirmation_plan_invalid', 'Mission Confirmation plan is invalid.');
  }
  const acceptanceCriteria = planSnapshot.acceptanceCriteria.map(normalizeCriterion);
  const criterionIds = acceptanceCriteria.map((criterion) => criterion.criterionId);
  if (new Set(criterionIds).size !== criterionIds.length) {
    fail('confirmation_plan_invalid', 'Mission Confirmation plan is invalid.');
  }
  return {
    title: normalizeText(planSnapshot.title, 200),
    objective: normalizeText(planSnapshot.objective, 500),
    scope: normalizeText(planSnapshot.scope, 500),
    projectId: normalizeIdentifier(planSnapshot.projectId, 'confirmation_plan_invalid'),
    workspaceId: normalizeOptionalIdentifier(planSnapshot.workspaceId),
    priority: planSnapshot.priority,
    acceptanceCriteria,
    sourceInteractionId: normalizeOptionalIdentifier(planSnapshot.sourceInteractionId),
    nextAction: normalizeText(planSnapshot.nextAction, 300),
  };
}

function assertPlanCanonical(planSnapshot, normalized) {
  for (const key of PLAN_KEYS) {
    if (key === 'acceptanceCriteria') continue;
    if (planSnapshot[key] !== normalized[key]) {
      fail('confirmation_plan_invalid', 'Mission Confirmation plan is invalid.');
    }
  }
  normalized.acceptanceCriteria.forEach((criterion, index) => {
    const original = planSnapshot.acceptanceCriteria[index];
    if (original.criterionId !== criterion.criterionId
      || original.description !== criterion.description) {
      fail('confirmation_plan_invalid', 'Mission Confirmation plan is invalid.');
    }
  });
}

function validateStatusTimestamps(confirmation) {
  const confirmedAt = confirmation.confirmedAt === null
    ? null : normalizeTimestamp(confirmation.confirmedAt);
  const consumedAt = confirmation.consumedAt === null
    ? null : normalizeTimestamp(confirmation.consumedAt);
  const revokedAt = confirmation.revokedAt === null
    ? null : normalizeTimestamp(confirmation.revokedAt);
  const created = Date.parse(confirmation.createdAt);

  if ((confirmedAt && Date.parse(confirmedAt) < created)
    || (consumedAt && (!confirmedAt || Date.parse(consumedAt) < Date.parse(confirmedAt)))
    || (revokedAt && Date.parse(revokedAt) < (confirmedAt ? Date.parse(confirmedAt) : created))) {
    fail('confirmation_time_invalid', 'Mission Confirmation timestamps are inconsistent.');
  }

  const coherent = {
    [CONFIRMATION_STATUSES.PENDING]: !confirmedAt && !consumedAt && !revokedAt,
    [CONFIRMATION_STATUSES.CONFIRMED]: Boolean(confirmedAt) && !consumedAt && !revokedAt,
    [CONFIRMATION_STATUSES.CONSUMED]: Boolean(confirmedAt) && Boolean(consumedAt) && !revokedAt,
    [CONFIRMATION_STATUSES.REVOKED]: Boolean(revokedAt) && !consumedAt,
  };
  if (!coherent[confirmation.status]) {
    fail('confirmation_time_invalid', 'Mission Confirmation timestamps do not match status.');
  }
}

function validateMissionConfirmation(confirmation) {
  if (!hasExactKeys(confirmation, CONTRACT_KEYS)) {
    fail('confirmation_input_invalid', 'Mission Confirmation shape is invalid.');
  }
  normalizeIdentifier(confirmation.confirmationId);
  normalizeIdentifier(confirmation.tenantId);
  normalizeIdentifier(confirmation.userId);
  normalizeIdentifier(confirmation.clientId);
  normalizeIdentifier(confirmation.missionId);
  const expectedKey = `mission-confirmation:v1:${confirmation.confirmationId}`;
  if (confirmation.idempotencyKey !== expectedKey) {
    fail('confirmation_idempotency_invalid', 'Mission Confirmation idempotency is invalid.');
  }
  if (confirmation.planSchemaVersion !== PLAN_SCHEMA_VERSION) {
    fail('confirmation_schema_invalid', 'Mission Confirmation plan schema is unsupported.');
  }
  const normalizedPlan = normalizePlanSnapshot(confirmation.planSnapshot);
  assertPlanCanonical(confirmation.planSnapshot, normalizedPlan);
  if (!Object.values(CONFIRMATION_STATUSES).includes(confirmation.status)) {
    fail('confirmation_status_invalid', 'Mission Confirmation status is invalid.');
  }
  if (!Number.isInteger(confirmation.version) || confirmation.version < INITIAL_VERSION) {
    fail('confirmation_version_invalid', 'Mission Confirmation version is invalid.');
  }
  const createdAt = normalizeTimestamp(confirmation.createdAt);
  const expiresAt = normalizeTimestamp(confirmation.expiresAt);
  if (Date.parse(expiresAt) <= Date.parse(createdAt)) {
    fail('confirmation_time_invalid', 'Mission Confirmation expiration is invalid.');
  }
  validateStatusTimestamps(confirmation);
  return confirmation;
}

function createMissionConfirmation(input, options = {}) {
  if (!hasExactKeys(input, CREATE_INPUT_KEYS)) {
    fail('confirmation_input_invalid', 'Mission Confirmation input is invalid.');
  }
  const createdAt = resolveNow(options);
  const confirmation = {
    confirmationId: normalizeIdentifier(input.confirmationId),
    tenantId: normalizeIdentifier(input.tenantId),
    userId: normalizeIdentifier(input.userId),
    clientId: normalizeIdentifier(input.clientId),
    missionId: normalizeIdentifier(input.missionId),
    idempotencyKey: input.idempotencyKey,
    planSnapshot: normalizePlanSnapshot(input.planSnapshot),
    planSchemaVersion: input.planSchemaVersion,
    status: CONFIRMATION_STATUSES.PENDING,
    version: INITIAL_VERSION,
    createdAt,
    confirmedAt: null,
    consumedAt: null,
    revokedAt: null,
    expiresAt: normalizeTimestamp(input.expiresAt),
  };
  validateMissionConfirmation(confirmation);
  return freezeValue(confirmation);
}

function isMissionConfirmationExpired(confirmation, now) {
  validateMissionConfirmation(confirmation);
  const timestamp = normalizeTimestamp(typeof now === 'function' ? now() : now);
  return Date.parse(timestamp) >= Date.parse(confirmation.expiresAt);
}

function transitionMissionConfirmation(confirmation, nextStatus, options = {}) {
  validateMissionConfirmation(confirmation);
  if (!Object.values(CONFIRMATION_STATUSES).includes(nextStatus)) {
    fail('confirmation_status_invalid', 'Mission Confirmation status is invalid.');
  }
  if (TRANSITIONS[confirmation.status].length === 0) {
    fail('confirmation_terminal', 'Terminal Mission Confirmation is immutable.');
  }
  if (!TRANSITIONS[confirmation.status].includes(nextStatus)) {
    fail('confirmation_transition_invalid', 'Mission Confirmation transition is invalid.');
  }
  const now = resolveNow(options);
  const previousTimestamp = confirmation.confirmedAt || confirmation.createdAt;
  if (Date.parse(now) < Date.parse(previousTimestamp)) {
    fail('confirmation_time_invalid', 'Mission Confirmation transition time is invalid.');
  }
  if ([CONFIRMATION_STATUSES.CONFIRMED, CONFIRMATION_STATUSES.CONSUMED].includes(nextStatus)
    && Date.parse(now) >= Date.parse(confirmation.expiresAt)) {
    fail('confirmation_expired', 'Mission Confirmation has expired.');
  }

  const candidate = cloneValue(confirmation);
  candidate.status = nextStatus;
  candidate.version += 1;
  if (nextStatus === CONFIRMATION_STATUSES.CONFIRMED) candidate.confirmedAt = now;
  if (nextStatus === CONFIRMATION_STATUSES.CONSUMED) candidate.consumedAt = now;
  if (nextStatus === CONFIRMATION_STATUSES.REVOKED) candidate.revokedAt = now;
  validateMissionConfirmation(candidate);
  return freezeValue(candidate);
}

module.exports = {
  CONFIRMATION_STATUSES,
  ConfirmationContractError,
  PLAN_SCHEMA_VERSION,
  createMissionConfirmation,
  isMissionConfirmationExpired,
  transitionMissionConfirmation,
  validateMissionConfirmation,
};

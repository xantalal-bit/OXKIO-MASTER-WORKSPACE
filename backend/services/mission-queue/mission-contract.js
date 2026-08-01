'use strict';

const { randomUUID } = require('node:crypto');

const SCHEMA_VERSION = 1;
const INITIAL_VERSION = 1;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9:_-]{3,128}$/;
const PRIORITIES = Object.freeze(['normal', 'medium', 'high']);

const MISSION_STATES = Object.freeze({
  PROPOSED: 'PROPOSED',
  READY: 'READY',
  WAITING_APPROVAL: 'WAITING_APPROVAL',
  RUNNING: 'RUNNING',
  BLOCKED: 'BLOCKED',
  UNDER_REVIEW: 'UNDER_REVIEW',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
});

const TASK_STATES = Object.freeze({
  PENDING: 'PENDING',
  READY: 'READY',
  WAITING_APPROVAL: 'WAITING_APPROVAL',
  RUNNING: 'RUNNING',
  BLOCKED: 'BLOCKED',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
});

const TERMINAL_MISSION_STATES = Object.freeze([
  MISSION_STATES.COMPLETED,
  MISSION_STATES.FAILED,
  MISSION_STATES.CANCELLED,
]);

const TERMINAL_TASK_STATES = Object.freeze([
  TASK_STATES.COMPLETED,
  TASK_STATES.FAILED,
  TASK_STATES.CANCELLED,
]);

const DOMAIN_EVENT_TYPES = Object.freeze({
  MISSION_CREATED: 'MISSION_CREATED',
  MISSION_STATUS_CHANGED: 'MISSION_STATUS_CHANGED',
  TASK_ADDED: 'TASK_ADDED',
  TASK_STATUS_CHANGED: 'TASK_STATUS_CHANGED',
  APPROVAL_LINKED: 'APPROVAL_LINKED',
  BLOCKER_ADDED: 'BLOCKER_ADDED',
  BLOCKER_RESOLVED: 'BLOCKER_RESOLVED',
  EVIDENCE_LINKED: 'EVIDENCE_LINKED',
  MISSION_COMPLETED: 'MISSION_COMPLETED',
  MISSION_CANCELLED: 'MISSION_CANCELLED',
});

class MissionDomainError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'MissionDomainError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new MissionDomainError(code, message);
}

function cloneDomain(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function freezeDomain(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freezeDomain);
  return Object.freeze(value);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeRequiredText(value, fieldName, maxLength = 500) {
  if (typeof value !== 'string' || !value.trim()) {
    fail(`invalid_${fieldName}`, `${fieldName} must be a non-empty string.`);
  }
  const normalized = value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized || normalized.length > maxLength) {
    fail(`invalid_${fieldName}`, `${fieldName} is outside the allowed length.`);
  }
  return normalized;
}

function validateIdentifier(value, fieldName) {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) {
    fail(`invalid_${fieldName}`, `${fieldName} must be an opaque portable identifier.`);
  }
  return value;
}

function normalizeOptionalIdentifier(value, fieldName) {
  if (value === undefined || value === null || value === '') return null;
  return validateIdentifier(value, fieldName);
}

function normalizeIdentifierArray(value, fieldName, options = {}) {
  const input = value === undefined ? [] : value;
  if (!Array.isArray(input)) fail(`invalid_${fieldName}`, `${fieldName} must be an array.`);
  const normalized = input.map((item) => validateIdentifier(item, fieldName));
  if (options.rejectDuplicates !== false && new Set(normalized).size !== normalized.length) {
    fail(`duplicate_${fieldName}`, `${fieldName} cannot contain duplicate identifiers.`);
  }
  return normalized;
}

function getTimestamp(options = {}) {
  const candidate = typeof options.now === 'function'
    ? options.now()
    : (options.now || new Date().toISOString());
  if (typeof candidate !== 'string' || !Number.isFinite(Date.parse(candidate))) {
    fail('invalid_timestamp', 'A valid ISO-8601 timestamp is required.');
  }
  return new Date(candidate).toISOString();
}

function createIdentifier(options = {}, kind = 'event') {
  const identifier = typeof options.idFactory === 'function'
    ? options.idFactory(kind)
    : randomUUID();
  return validateIdentifier(identifier, `${kind}Id`);
}

function validateSyntheticScope(scope) {
  if (!isPlainObject(scope)) fail('invalid_scope', 'Synthetic scope is required.');
  return freezeDomain({
    tenantId: validateIdentifier(scope.tenantId, 'tenantId'),
    userId: validateIdentifier(scope.userId, 'userId'),
    clientId: validateIdentifier(scope.clientId, 'clientId'),
  });
}

function assertMissionScope(mission, scope) {
  const normalized = validateSyntheticScope(scope);
  if (!mission || mission.requester !== normalized.userId) {
    fail('requester_scope_mismatch', 'Mission requester does not match scope userId.');
  }
  if (mission.clientId !== normalized.clientId) {
    fail('client_scope_mismatch', 'Mission clientId does not match scope clientId.');
  }
  return normalized;
}

function normalizeCriterion(value, index, fieldName = 'acceptanceCriteria') {
  const source = typeof value === 'string' ? { description: value } : value;
  if (!isPlainObject(source)) {
    fail(`invalid_${fieldName}`, `${fieldName} entries must be strings or objects.`);
  }
  const criterionId = source.criterionId
    ? validateIdentifier(source.criterionId, 'criterionId')
    : `criterion-${index + 1}`;
  return {
    criterionId,
    description: normalizeRequiredText(source.description, 'criterionDescription', 300),
    satisfied: source.satisfied === true,
    evidenceReferences: normalizeIdentifierArray(
      source.evidenceReferences,
      'evidenceReferences',
    ),
  };
}

function normalizeCriteria(value, fieldName = 'acceptanceCriteria') {
  if (!Array.isArray(value) || value.length === 0) {
    fail(`invalid_${fieldName}`, `${fieldName} must contain at least one verifiable criterion.`);
  }
  const criteria = value.map((item, index) => normalizeCriterion(item, index, fieldName));
  const ids = criteria.map((item) => item.criterionId);
  if (new Set(ids).size !== ids.length) {
    fail('duplicate_criterionId', 'acceptanceCriteria cannot contain duplicate criterionId values.');
  }
  return criteria;
}

function normalizeEvidence(value, fieldName = 'evidence') {
  const input = value === undefined ? [] : value;
  if (!Array.isArray(input)) fail(`invalid_${fieldName}`, `${fieldName} must be an array.`);
  const normalized = input.map((item) => {
    const source = typeof item === 'string' ? { reference: item } : item;
    if (!isPlainObject(source)) fail(`invalid_${fieldName}`, `${fieldName} entries are invalid.`);
    return {
      reference: validateIdentifier(source.reference, 'evidenceReference'),
      linkedAt: source.linkedAt === undefined || source.linkedAt === null
        ? null
        : getTimestamp({ now: source.linkedAt }),
    };
  });
  const references = normalized.map((item) => item.reference);
  if (new Set(references).size !== references.length) {
    fail('duplicate_evidence', 'Evidence references cannot be duplicated.');
  }
  return normalized;
}

function normalizeBlockers(value) {
  const input = value === undefined ? [] : value;
  if (!Array.isArray(input)) fail('invalid_blockers', 'blockers must be an array.');
  return input.map((item) => {
    if (!isPlainObject(item)) fail('invalid_blocker', 'blocker entries must be objects.');
    const status = item.status || 'active';
    if (!['active', 'resolved'].includes(status)) fail('invalid_blocker_status', 'Invalid blocker status.');
    return {
      blockerId: validateIdentifier(item.blockerId, 'blockerId'),
      taskId: normalizeOptionalIdentifier(item.taskId, 'taskId'),
      reasonCode: validateIdentifier(item.reasonCode, 'reasonCode'),
      status,
      createdAt: getTimestamp({ now: item.createdAt }),
      resolvedAt: item.resolvedAt ? getTimestamp({ now: item.resolvedAt }) : null,
    };
  });
}

function validateTask(task, expectedMissionId) {
  if (!isPlainObject(task)) fail('invalid_task', 'Task must be an object.');
  validateIdentifier(task.taskId, 'taskId');
  validateIdentifier(task.missionId, 'missionId');
  if (expectedMissionId && task.missionId !== expectedMissionId) {
    fail('task_mission_mismatch', 'Task missionId does not match its mission.');
  }
  normalizeRequiredText(task.action, 'action', 500);
  if (!Object.values(TASK_STATES).includes(task.status)) fail('invalid_task_status', 'Invalid task status.');
  normalizeIdentifierArray(task.dependencies, 'dependencies');
  validateIdentifier(task.assignee, 'assignee');
  normalizeIdentifierArray(task.requiredApprovalIds, 'requiredApprovalIds');
  if (task.blocker !== null && !isPlainObject(task.blocker)) {
    fail('invalid_task_blocker', 'Task blocker must be null or an object.');
  }
  normalizeEvidence(task.evidence);
  if (task.result !== null && task.result !== undefined
    && !TERMINAL_TASK_STATES.includes(task.status)) {
    fail('premature_task_result', 'Task result is only valid in a terminal state.');
  }
  normalizeCriteria(task.acceptanceCriteria);
  getTimestamp({ now: task.createdAt });
  getTimestamp({ now: task.updatedAt });
  normalizeRequiredText(task.nextAction, 'nextAction', 300);
  normalizeOptionalIdentifier(task.retryOfTaskId, 'retryOfTaskId');
  normalizeOptionalIdentifier(task.interactionId, 'interactionId');
  normalizeOptionalIdentifier(task.operationId, 'operationId');
  normalizeIdentifierArray(task.resourceKeys, 'resourceKeys');
  return task;
}

function validateTaskGraph(tasks, missionId) {
  if (!Array.isArray(tasks)) fail('invalid_tasks', 'tasks must be an array.');
  const byId = new Map();
  tasks.forEach((task) => {
    validateTask(task, missionId);
    if (byId.has(task.taskId)) fail('duplicate_taskId', 'taskId must be unique within a mission.');
    byId.set(task.taskId, task);
  });
  tasks.forEach((task) => {
    task.dependencies.forEach((dependencyId) => {
      if (dependencyId === task.taskId) fail('task_self_dependency', 'Task cannot depend on itself.');
      if (!byId.has(dependencyId)) fail('task_dependency_not_found', 'Task dependency does not exist.');
    });
  });
  const visiting = new Set();
  const visited = new Set();
  function visit(taskId) {
    if (visiting.has(taskId)) fail('task_dependency_cycle', 'Task dependency cycle detected.');
    if (visited.has(taskId)) return;
    visiting.add(taskId);
    byId.get(taskId).dependencies.forEach(visit);
    visiting.delete(taskId);
    visited.add(taskId);
  }
  tasks.forEach((task) => visit(task.taskId));
  return true;
}

function createTask(input, mission, scope, options = {}) {
  if (!isPlainObject(input)) fail('invalid_task', 'Task payload is required.');
  assertMissionScope(mission, scope);
  const timestamp = getTimestamp(options);
  const missionId = validateIdentifier(input.missionId, 'missionId');
  if (missionId !== mission.missionId) fail('task_mission_mismatch', 'Task missionId does not match.');
  const task = {
    taskId: validateIdentifier(input.taskId, 'taskId'),
    missionId,
    action: normalizeRequiredText(input.action, 'action', 500),
    status: TASK_STATES.PENDING,
    dependencies: normalizeIdentifierArray(input.dependencies, 'dependencies'),
    assignee: validateIdentifier(input.assignee || scope.userId, 'assignee'),
    requiredApprovalIds: normalizeIdentifierArray(input.requiredApprovalIds, 'requiredApprovalIds'),
    blocker: null,
    evidence: normalizeEvidence(input.evidence),
    result: input.result === undefined ? null : cloneDomain(input.result),
    acceptanceCriteria: normalizeCriteria(input.acceptanceCriteria),
    createdAt: timestamp,
    updatedAt: timestamp,
    nextAction: normalizeRequiredText(input.nextAction, 'nextAction', 300),
    retryOfTaskId: normalizeOptionalIdentifier(input.retryOfTaskId, 'retryOfTaskId'),
    interactionId: normalizeOptionalIdentifier(input.interactionId, 'interactionId'),
    operationId: normalizeOptionalIdentifier(input.operationId, 'operationId'),
    resourceKeys: normalizeIdentifierArray(input.resourceKeys, 'resourceKeys'),
  };
  if (task.result !== null) fail('initial_task_result_not_null', 'New task result must be null.');
  validateTask(task, mission.missionId);
  return freezeDomain(task);
}

function validateMission(mission) {
  if (!isPlainObject(mission)) fail('invalid_mission', 'Mission must be an object.');
  validateIdentifier(mission.missionId, 'missionId');
  normalizeRequiredText(mission.title, 'title', 200);
  normalizeRequiredText(mission.objective, 'objective', 500);
  normalizeRequiredText(mission.scope, 'scope', 500);
  validateIdentifier(mission.requester, 'requester');
  validateIdentifier(mission.clientId, 'clientId');
  validateIdentifier(mission.projectId, 'projectId');
  normalizeOptionalIdentifier(mission.workspaceId, 'workspaceId');
  if (!PRIORITIES.includes(mission.priority)) fail('invalid_priority', 'Invalid mission priority.');
  if (!Object.values(MISSION_STATES).includes(mission.status)) fail('invalid_mission_status', 'Invalid mission status.');
  normalizeIdentifierArray(mission.owners, 'owners');
  normalizeIdentifierArray(mission.participants, 'participants');
  normalizeIdentifierArray(mission.dependencies, 'missionDependencies');
  normalizeBlockers(mission.blockers);
  validateTaskGraph(mission.tasks, mission.missionId);
  if (mission.tasks.length === 0
    && ![MISSION_STATES.PROPOSED, MISSION_STATES.CANCELLED].includes(mission.status)) {
    fail('mission_tasks_required', 'Active mission states require at least one task.');
  }
  if (!Array.isArray(mission.risks)) fail('invalid_risks', 'risks must be an array.');
  normalizeIdentifierArray(mission.requiredApprovals, 'requiredApprovals');
  normalizeEvidence(mission.evidence);
  if (mission.result !== null && mission.result !== undefined
    && ![MISSION_STATES.UNDER_REVIEW, ...TERMINAL_MISSION_STATES].includes(mission.status)) {
    fail('premature_mission_result', 'Mission result is only valid during review or in a terminal state.');
  }
  normalizeCriteria(mission.acceptanceCriteria);
  getTimestamp({ now: mission.createdAt });
  getTimestamp({ now: mission.updatedAt });
  normalizeRequiredText(mission.nextAction, 'nextAction', 300);
  if (mission.schemaVersion !== SCHEMA_VERSION) fail('invalid_schema_version', 'Invalid schemaVersion.');
  if (!Number.isInteger(mission.version) || mission.version < INITIAL_VERSION) {
    fail('invalid_version', 'Mission version must be a positive integer.');
  }
  normalizeOptionalIdentifier(mission.sourceInteractionId, 'sourceInteractionId');
  return mission;
}

function createDomainEvent(eventType, scope, details = {}, options = {}) {
  if (!Object.values(DOMAIN_EVENT_TYPES).includes(eventType)) fail('invalid_event_type', 'Unsupported domain event type.');
  const normalizedScope = validateSyntheticScope(scope);
  const event = {
    eventId: createIdentifier(options, 'event'),
    eventType,
    occurredAt: getTimestamp(options),
    tenantId: normalizedScope.tenantId,
    userId: normalizedScope.userId,
    missionId: validateIdentifier(details.missionId, 'missionId'),
    taskId: normalizeOptionalIdentifier(details.taskId, 'taskId'),
    actorId: normalizedScope.userId,
    previousStatus: details.previousStatus || null,
    nextStatus: details.nextStatus || null,
    interactionId: normalizeOptionalIdentifier(details.interactionId, 'interactionId'),
    approvalId: normalizeOptionalIdentifier(details.approvalId, 'approvalId'),
    evidenceReferences: normalizeIdentifierArray(details.evidenceReferences, 'evidenceReferences'),
  };
  return freezeDomain(event);
}

function createMission(input, scope, options = {}) {
  if (!isPlainObject(input)) fail('invalid_mission', 'Mission payload is required.');
  const normalizedScope = validateSyntheticScope(scope);
  if (input.clientId !== normalizedScope.clientId) {
    fail('client_scope_mismatch', 'Mission clientId must match scope clientId.');
  }
  if (input.objective !== undefined && typeof input.objective !== 'string') {
    fail('multiple_objectives_not_allowed', 'Mission objective must be one scalar string.');
  }
  if (input.status && input.status !== MISSION_STATES.PROPOSED) {
    fail('invalid_initial_status', 'New missions must start in PROPOSED.');
  }
  if (Array.isArray(input.blockers) && input.blockers.length > 0) {
    fail('initial_blockers_not_empty', 'New mission blockers must be empty.');
  }
  if (Array.isArray(input.tasks) && input.tasks.length > 0) {
    fail('initial_tasks_not_empty', 'Tasks must be added through the domain operation.');
  }
  if (input.result !== undefined && input.result !== null) {
    fail('initial_result_not_null', 'New mission result must be null.');
  }
  const timestamp = getTimestamp(options);
  const mission = {
    missionId: validateIdentifier(input.missionId, 'missionId'),
    title: normalizeRequiredText(input.title, 'title', 200),
    objective: normalizeRequiredText(input.objective, 'objective', 500),
    scope: normalizeRequiredText(input.scope, 'scope', 500),
    requester: normalizedScope.userId,
    clientId: normalizedScope.clientId,
    projectId: validateIdentifier(input.projectId, 'projectId'),
    workspaceId: normalizeOptionalIdentifier(input.workspaceId, 'workspaceId'),
    priority: input.priority || 'normal',
    status: MISSION_STATES.PROPOSED,
    owners: normalizeIdentifierArray(input.owners || [normalizedScope.userId], 'owners'),
    participants: normalizeIdentifierArray(input.participants, 'participants'),
    dependencies: normalizeIdentifierArray(input.dependencies, 'missionDependencies'),
    blockers: [],
    tasks: [],
    risks: cloneDomain(Array.isArray(input.risks) ? input.risks : []),
    requiredApprovals: normalizeIdentifierArray(input.requiredApprovals, 'requiredApprovals'),
    evidence: normalizeEvidence(input.evidence),
    result: null,
    acceptanceCriteria: normalizeCriteria(input.acceptanceCriteria),
    createdAt: timestamp,
    updatedAt: timestamp,
    nextAction: normalizeRequiredText(input.nextAction, 'nextAction', 300),
    schemaVersion: SCHEMA_VERSION,
    version: INITIAL_VERSION,
    sourceInteractionId: normalizeOptionalIdentifier(input.sourceInteractionId, 'sourceInteractionId'),
  };
  validateMission(mission);
  const frozenMission = freezeDomain(mission);
  const event = createDomainEvent(DOMAIN_EVENT_TYPES.MISSION_CREATED, normalizedScope, {
    missionId: mission.missionId,
    nextStatus: mission.status,
    interactionId: mission.sourceInteractionId,
  }, options);
  return freezeDomain({ mission: frozenMission, events: [event] });
}

module.exports = {
  DOMAIN_EVENT_TYPES,
  INITIAL_VERSION,
  MISSION_STATES,
  MissionDomainError,
  PRIORITIES,
  SCHEMA_VERSION,
  TASK_STATES,
  TERMINAL_MISSION_STATES,
  TERMINAL_TASK_STATES,
  assertMissionScope,
  cloneDomain,
  createDomainEvent,
  createMission,
  createTask,
  freezeDomain,
  getTimestamp,
  normalizeCriteria,
  normalizeEvidence,
  normalizeIdentifierArray,
  normalizeOptionalIdentifier,
  normalizeRequiredText,
  validateIdentifier,
  validateMission,
  validateSyntheticScope,
  validateTask,
  validateTaskGraph,
};

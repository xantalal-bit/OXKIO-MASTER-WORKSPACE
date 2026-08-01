'use strict';

const {
  DOMAIN_EVENT_TYPES,
  MISSION_STATES,
  MissionDomainError,
  TASK_STATES,
  TERMINAL_MISSION_STATES,
  assertMissionScope,
  cloneDomain,
  createDomainEvent,
  createTask,
  freezeDomain,
  getTimestamp,
  normalizeIdentifierArray,
  normalizeRequiredText,
  validateIdentifier,
  validateMission,
  validateTaskGraph,
} = require('./mission-contract');

const MISSION_TRANSITIONS = Object.freeze({
  [MISSION_STATES.PROPOSED]: Object.freeze([
    MISSION_STATES.READY,
    MISSION_STATES.CANCELLED,
  ]),
  [MISSION_STATES.READY]: Object.freeze([
    MISSION_STATES.RUNNING,
    MISSION_STATES.WAITING_APPROVAL,
    MISSION_STATES.BLOCKED,
    MISSION_STATES.CANCELLED,
  ]),
  [MISSION_STATES.WAITING_APPROVAL]: Object.freeze([
    MISSION_STATES.READY,
    MISSION_STATES.BLOCKED,
    MISSION_STATES.CANCELLED,
  ]),
  [MISSION_STATES.RUNNING]: Object.freeze([
    MISSION_STATES.WAITING_APPROVAL,
    MISSION_STATES.BLOCKED,
    MISSION_STATES.UNDER_REVIEW,
    MISSION_STATES.FAILED,
    MISSION_STATES.CANCELLED,
  ]),
  [MISSION_STATES.BLOCKED]: Object.freeze([
    MISSION_STATES.READY,
    MISSION_STATES.FAILED,
    MISSION_STATES.CANCELLED,
  ]),
  [MISSION_STATES.UNDER_REVIEW]: Object.freeze([
    MISSION_STATES.COMPLETED,
    MISSION_STATES.READY,
    MISSION_STATES.BLOCKED,
    MISSION_STATES.FAILED,
    MISSION_STATES.CANCELLED,
  ]),
  [MISSION_STATES.COMPLETED]: Object.freeze([]),
  [MISSION_STATES.FAILED]: Object.freeze([]),
  [MISSION_STATES.CANCELLED]: Object.freeze([]),
});

const TASK_TRANSITIONS = Object.freeze({
  [TASK_STATES.PENDING]: Object.freeze([TASK_STATES.READY]),
  [TASK_STATES.READY]: Object.freeze([
    TASK_STATES.WAITING_APPROVAL,
    TASK_STATES.RUNNING,
    TASK_STATES.BLOCKED,
    TASK_STATES.CANCELLED,
  ]),
  [TASK_STATES.WAITING_APPROVAL]: Object.freeze([
    TASK_STATES.READY,
    TASK_STATES.BLOCKED,
    TASK_STATES.CANCELLED,
  ]),
  [TASK_STATES.RUNNING]: Object.freeze([
    TASK_STATES.COMPLETED,
    TASK_STATES.FAILED,
    TASK_STATES.BLOCKED,
    TASK_STATES.CANCELLED,
  ]),
  [TASK_STATES.BLOCKED]: Object.freeze([
    TASK_STATES.READY,
    TASK_STATES.FAILED,
    TASK_STATES.CANCELLED,
  ]),
  [TASK_STATES.COMPLETED]: Object.freeze([]),
  [TASK_STATES.FAILED]: Object.freeze([]),
  [TASK_STATES.CANCELLED]: Object.freeze([]),
});

function domainFail(code, message) {
  throw new MissionDomainError(code, message);
}

function hasOwn(object, field) {
  return Object.prototype.hasOwnProperty.call(object, field);
}

function assertMissionMutable(mission) {
  if (TERMINAL_MISSION_STATES.includes(mission.status)) {
    domainFail('terminal_mission_immutable', 'Terminal mission cannot be mutated.');
  }
}

function findTask(mission, taskId) {
  validateIdentifier(taskId, 'taskId');
  const index = mission.tasks.findIndex((task) => task.taskId === taskId);
  if (index === -1) domainFail('task_not_found', 'Task does not exist in mission.');
  return { index, task: mission.tasks[index] };
}

function finalizeMutation(candidate, previous, timestamp) {
  candidate.updatedAt = timestamp;
  candidate.version = previous.version + 1;
  validateMission(candidate);
  return freezeDomain(candidate);
}

function addTask(mission, taskInput, scope, options = {}) {
  validateMission(mission);
  const normalizedScope = assertMissionScope(mission, scope);
  assertMissionMutable(mission);
  const timestamp = getTimestamp(options);
  const task = createTask(taskInput, mission, normalizedScope, { ...options, now: timestamp });

  if (task.retryOfTaskId) {
    const previousTask = mission.tasks.find((item) => item.taskId === task.retryOfTaskId);
    if (!previousTask) domainFail('retry_task_not_found', 'retryOfTaskId does not exist.');
    if (previousTask.status !== TASK_STATES.FAILED) {
      domainFail('retry_source_not_failed', 'A retry can only reference a FAILED task.');
    }
  }

  const candidate = cloneDomain(mission);
  candidate.tasks.push(cloneDomain(task));
  validateTaskGraph(candidate.tasks, candidate.missionId);
  const updated = finalizeMutation(candidate, mission, timestamp);
  const event = createDomainEvent(DOMAIN_EVENT_TYPES.TASK_ADDED, normalizedScope, {
    missionId: mission.missionId,
    taskId: task.taskId,
    nextStatus: task.status,
    interactionId: task.interactionId,
  }, { ...options, now: timestamp });
  return freezeDomain({ mission: updated, events: [event] });
}

function assertMissionCompletion(candidate) {
  if (candidate.tasks.length === 0
    || candidate.tasks.some((task) => task.status !== TASK_STATES.COMPLETED)) {
    domainFail('mission_tasks_incomplete', 'All required tasks must be COMPLETED.');
  }
  if (candidate.acceptanceCriteria.some((criterion) => criterion.satisfied !== true)) {
    domainFail('mission_acceptance_incomplete', 'All mission acceptance criteria must be satisfied.');
  }
  if (candidate.evidence.length === 0) {
    domainFail('mission_evidence_required', 'Mission completion requires evidence.');
  }
  if (candidate.result === null || candidate.result === undefined) {
    domainFail('mission_result_required', 'Mission completion requires a result.');
  }
}

function transitionMission(mission, nextStatus, scope, options = {}) {
  validateMission(mission);
  const normalizedScope = assertMissionScope(mission, scope);
  assertMissionMutable(mission);
  if (!Object.values(MISSION_STATES).includes(nextStatus)) {
    domainFail('invalid_mission_status', 'Unsupported mission status.');
  }
  if (!MISSION_TRANSITIONS[mission.status].includes(nextStatus)) {
    domainFail('invalid_mission_transition', `${mission.status} cannot transition to ${nextStatus}.`);
  }

  const timestamp = getTimestamp(options);
  const candidate = cloneDomain(mission);
  if (mission.status === MISSION_STATES.UNDER_REVIEW
    && nextStatus === MISSION_STATES.READY) {
    candidate.result = null;
  }
  if (hasOwn(options, 'result')) {
    if (![MISSION_STATES.UNDER_REVIEW, MISSION_STATES.COMPLETED,
      MISSION_STATES.FAILED, MISSION_STATES.CANCELLED].includes(nextStatus)) {
      domainFail('mission_result_not_allowed', 'Mission result is only accepted during review or terminal transition.');
    }
    candidate.result = cloneDomain(options.result);
  }
  if (hasOwn(options, 'nextAction')) {
    candidate.nextAction = normalizeRequiredText(options.nextAction, 'nextAction', 300);
  }

  if (nextStatus === MISSION_STATES.READY && candidate.tasks.length === 0) {
    domainFail('mission_tasks_required', 'READY requires at least one valid task.');
  }
  if (nextStatus === MISSION_STATES.RUNNING
    && !candidate.tasks.some((task) => task.status === TASK_STATES.READY)) {
    domainFail('ready_task_required', 'RUNNING requires at least one READY task.');
  }
  if (nextStatus === MISSION_STATES.UNDER_REVIEW
    && candidate.tasks.some((task) => task.status !== TASK_STATES.COMPLETED)) {
    domainFail('mission_review_tasks_incomplete', 'UNDER_REVIEW requires all tasks completed.');
  }
  if (nextStatus === MISSION_STATES.COMPLETED) assertMissionCompletion(candidate);

  const previousStatus = mission.status;
  candidate.status = nextStatus;
  const updated = finalizeMutation(candidate, mission, timestamp);
  const events = [createDomainEvent(DOMAIN_EVENT_TYPES.MISSION_STATUS_CHANGED, normalizedScope, {
    missionId: mission.missionId,
    previousStatus,
    nextStatus,
    interactionId: mission.sourceInteractionId,
  }, { ...options, now: timestamp })];
  if (nextStatus === MISSION_STATES.COMPLETED) {
    events.push(createDomainEvent(DOMAIN_EVENT_TYPES.MISSION_COMPLETED, normalizedScope, {
      missionId: mission.missionId,
      previousStatus,
      nextStatus,
      interactionId: mission.sourceInteractionId,
      evidenceReferences: updated.evidence.map((item) => item.reference),
    }, { ...options, now: timestamp }));
  }
  if (nextStatus === MISSION_STATES.CANCELLED) {
    events.push(createDomainEvent(DOMAIN_EVENT_TYPES.MISSION_CANCELLED, normalizedScope, {
      missionId: mission.missionId,
      previousStatus,
      nextStatus,
      interactionId: mission.sourceInteractionId,
    }, { ...options, now: timestamp }));
  }
  return freezeDomain({ mission: updated, events });
}

function dependenciesSatisfied(mission, task) {
  return task.dependencies.every((dependencyId) => {
    const dependency = mission.tasks.find((item) => item.taskId === dependencyId);
    return dependency && dependency.status === TASK_STATES.COMPLETED;
  });
}

function assertTaskCompletion(task) {
  if (task.acceptanceCriteria.some((criterion) => criterion.satisfied !== true)) {
    domainFail('task_acceptance_incomplete', 'All task acceptance criteria must be satisfied.');
  }
  if (task.evidence.length === 0) domainFail('task_evidence_required', 'Task completion requires evidence.');
  if (task.result === null || task.result === undefined) {
    domainFail('task_result_required', 'Task completion requires a result.');
  }
}

function transitionTask(mission, taskId, nextStatus, scope, options = {}) {
  validateMission(mission);
  const normalizedScope = assertMissionScope(mission, scope);
  assertMissionMutable(mission);
  if (!Object.values(TASK_STATES).includes(nextStatus)) {
    domainFail('invalid_task_status', 'Unsupported task status.');
  }
  const { index, task } = findTask(mission, taskId);
  if (!TASK_TRANSITIONS[task.status].includes(nextStatus)) {
    domainFail('invalid_task_transition', `${task.status} cannot transition to ${nextStatus}.`);
  }
  if (task.status === TASK_STATES.PENDING
    && nextStatus === TASK_STATES.READY
    && !dependenciesSatisfied(mission, task)) {
    domainFail('task_dependencies_incomplete', 'Task dependencies are not completed.');
  }
  if (nextStatus === TASK_STATES.RUNNING && mission.status !== MISSION_STATES.RUNNING) {
    domainFail('mission_not_running', 'Task execution requires mission RUNNING.');
  }

  const timestamp = getTimestamp(options);
  const candidate = cloneDomain(mission);
  const candidateTask = candidate.tasks[index];
  if (hasOwn(options, 'result')) {
    if (![TASK_STATES.COMPLETED, TASK_STATES.FAILED, TASK_STATES.CANCELLED].includes(nextStatus)) {
      domainFail('task_result_not_allowed', 'Task result is only accepted during a terminal transition.');
    }
    candidateTask.result = cloneDomain(options.result);
  }
  if (hasOwn(options, 'nextAction')) {
    candidateTask.nextAction = normalizeRequiredText(options.nextAction, 'nextAction', 300);
  }
  if (nextStatus === TASK_STATES.COMPLETED) assertTaskCompletion(candidateTask);
  const previousStatus = candidateTask.status;
  candidateTask.status = nextStatus;
  candidateTask.updatedAt = timestamp;
  const updated = finalizeMutation(candidate, mission, timestamp);
  const event = createDomainEvent(DOMAIN_EVENT_TYPES.TASK_STATUS_CHANGED, normalizedScope, {
    missionId: mission.missionId,
    taskId,
    previousStatus,
    nextStatus,
    interactionId: candidateTask.interactionId,
    evidenceReferences: candidateTask.evidence.map((item) => item.reference),
  }, { ...options, now: timestamp });
  return freezeDomain({ mission: updated, events: [event] });
}

function recordEvidence(mission, reference, scope, options = {}) {
  validateMission(mission);
  const normalizedScope = assertMissionScope(mission, scope);
  assertMissionMutable(mission);
  const evidenceReference = validateIdentifier(reference, 'evidenceReference');
  const criterionIds = normalizeIdentifierArray(options.criterionIds, 'criterionIds');
  const timestamp = getTimestamp(options);
  const candidate = cloneDomain(mission);
  let evidence;
  let criteria;
  let taskId = null;

  if (options.taskId) {
    const found = findTask(candidate, options.taskId);
    taskId = found.task.taskId;
    evidence = found.task.evidence;
    criteria = found.task.acceptanceCriteria;
    found.task.updatedAt = timestamp;
  } else {
    evidence = candidate.evidence;
    criteria = candidate.acceptanceCriteria;
  }
  if (evidence.some((item) => item.reference === evidenceReference)) {
    domainFail('duplicate_evidence', 'Evidence reference is already linked.');
  }
  evidence.push({ reference: evidenceReference, linkedAt: timestamp });
  criterionIds.forEach((criterionId) => {
    const criterion = criteria.find((item) => item.criterionId === criterionId);
    if (!criterion) domainFail('criterion_not_found', 'Acceptance criterion does not exist.');
    criterion.satisfied = true;
    if (!criterion.evidenceReferences.includes(evidenceReference)) {
      criterion.evidenceReferences.push(evidenceReference);
    }
  });
  const updated = finalizeMutation(candidate, mission, timestamp);
  const event = createDomainEvent(DOMAIN_EVENT_TYPES.EVIDENCE_LINKED, normalizedScope, {
    missionId: mission.missionId,
    taskId,
    interactionId: mission.sourceInteractionId,
    evidenceReferences: [evidenceReference],
  }, { ...options, now: timestamp });
  return freezeDomain({ mission: updated, events: [event] });
}

function linkApproval(mission, taskId, approvalId, scope, options = {}) {
  validateMission(mission);
  const normalizedScope = assertMissionScope(mission, scope);
  assertMissionMutable(mission);
  const normalizedApprovalId = validateIdentifier(approvalId, 'approvalId');
  const { index } = findTask(mission, taskId);
  if (mission.requiredApprovals.includes(normalizedApprovalId)) {
    domainFail('duplicate_approval', 'Approval is already linked.');
  }
  const timestamp = getTimestamp(options);
  const candidate = cloneDomain(mission);
  candidate.requiredApprovals.push(normalizedApprovalId);
  candidate.tasks[index].requiredApprovalIds.push(normalizedApprovalId);
  candidate.tasks[index].updatedAt = timestamp;
  const updated = finalizeMutation(candidate, mission, timestamp);
  const event = createDomainEvent(DOMAIN_EVENT_TYPES.APPROVAL_LINKED, normalizedScope, {
    missionId: mission.missionId,
    taskId,
    approvalId: normalizedApprovalId,
    interactionId: candidate.tasks[index].interactionId,
  }, { ...options, now: timestamp });
  return freezeDomain({ mission: updated, events: [event] });
}

function addBlocker(mission, blockerInput, scope, options = {}) {
  validateMission(mission);
  const normalizedScope = assertMissionScope(mission, scope);
  assertMissionMutable(mission);
  if (!blockerInput || typeof blockerInput !== 'object') {
    domainFail('invalid_blocker', 'Blocker input is required.');
  }
  const blockerId = validateIdentifier(blockerInput.blockerId, 'blockerId');
  if (mission.blockers.some((item) => item.blockerId === blockerId)) {
    domainFail('duplicate_blocker', 'Blocker already exists.');
  }
  const taskId = blockerInput.taskId || null;
  if (taskId) findTask(mission, taskId);
  const timestamp = getTimestamp(options);
  const candidate = cloneDomain(mission);
  candidate.blockers.push({
    blockerId,
    taskId,
    reasonCode: validateIdentifier(blockerInput.reasonCode, 'reasonCode'),
    status: 'active',
    createdAt: timestamp,
    resolvedAt: null,
  });
  if (taskId) {
    const candidateTask = candidate.tasks.find((task) => task.taskId === taskId);
    candidateTask.blocker = { blockerId, reasonCode: blockerInput.reasonCode, status: 'active' };
    candidateTask.updatedAt = timestamp;
  }
  const updated = finalizeMutation(candidate, mission, timestamp);
  const event = createDomainEvent(DOMAIN_EVENT_TYPES.BLOCKER_ADDED, normalizedScope, {
    missionId: mission.missionId,
    taskId,
    interactionId: mission.sourceInteractionId,
  }, { ...options, now: timestamp });
  return freezeDomain({ mission: updated, events: [event] });
}

function resolveBlocker(mission, blockerId, scope, options = {}) {
  validateMission(mission);
  const normalizedScope = assertMissionScope(mission, scope);
  assertMissionMutable(mission);
  validateIdentifier(blockerId, 'blockerId');
  const index = mission.blockers.findIndex((item) => item.blockerId === blockerId);
  if (index === -1) domainFail('blocker_not_found', 'Blocker does not exist.');
  if (mission.blockers[index].status !== 'active') domainFail('blocker_already_resolved', 'Blocker is resolved.');
  const timestamp = getTimestamp(options);
  const candidate = cloneDomain(mission);
  candidate.blockers[index].status = 'resolved';
  candidate.blockers[index].resolvedAt = timestamp;
  const taskId = candidate.blockers[index].taskId;
  if (taskId) {
    const candidateTask = candidate.tasks.find((task) => task.taskId === taskId);
    if (candidateTask) {
      candidateTask.blocker = null;
      candidateTask.updatedAt = timestamp;
    }
  }
  const updated = finalizeMutation(candidate, mission, timestamp);
  const event = createDomainEvent(DOMAIN_EVENT_TYPES.BLOCKER_RESOLVED, normalizedScope, {
    missionId: mission.missionId,
    taskId,
    interactionId: mission.sourceInteractionId,
  }, { ...options, now: timestamp });
  return freezeDomain({ mission: updated, events: [event] });
}

module.exports = {
  MISSION_TRANSITIONS,
  TASK_TRANSITIONS,
  addBlocker,
  addTask,
  dependenciesSatisfied,
  linkApproval,
  recordEvidence,
  resolveBlocker,
  transitionMission,
  transitionTask,
};

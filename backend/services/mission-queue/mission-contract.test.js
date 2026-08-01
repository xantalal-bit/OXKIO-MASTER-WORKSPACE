'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DOMAIN_EVENT_TYPES,
  MISSION_STATES,
  SCHEMA_VERSION,
  TASK_STATES,
  createMission,
  createTask,
  validateMission,
  validateSyntheticScope,
  validateTaskGraph,
} = require('./mission-contract');

const NOW = '2026-08-01T10:00:00.000Z';
const SCOPE = Object.freeze({
  tenantId: 'tenant-test-alpha',
  userId: 'user-test-owner',
  clientId: 'client-test-zero',
});

function missionInput(overrides = {}) {
  return {
    missionId: 'mission-test-001',
    title: 'Validar Mission Queue',
    objective: 'Demostrar un objetivo principal verificable',
    scope: 'Dominio puro y pruebas sintéticas',
    requester: 'payload-attacker',
    clientId: SCOPE.clientId,
    projectId: 'project-test-oxkio',
    workspaceId: null,
    priority: 'normal',
    owners: [SCOPE.userId],
    participants: [],
    dependencies: [],
    blockers: [],
    tasks: [],
    risks: [],
    requiredApprovals: [],
    evidence: [],
    result: null,
    acceptanceCriteria: [{
      criterionId: 'mission-criterion-1',
      description: 'El contrato queda validado',
    }],
    nextAction: 'Añadir una tarea válida',
    sourceInteractionId: 'interaction-test-001',
    ...overrides,
  };
}

function taskInput(missionId = 'mission-test-001', overrides = {}) {
  return {
    taskId: 'task-test-001',
    missionId,
    action: 'Validar el contrato de tarea',
    dependencies: [],
    assignee: SCOPE.userId,
    requiredApprovalIds: [],
    evidence: [],
    result: null,
    acceptanceCriteria: [{
      criterionId: 'task-criterion-1',
      description: 'La tarea supera sus guards',
    }],
    nextAction: 'Preparar la tarea',
    retryOfTaskId: null,
    interactionId: 'interaction-task-001',
    operationId: null,
    resourceKeys: ['resource-test-001'],
    ...overrides,
  };
}

function createBaseMission(overrides = {}) {
  return createMission(missionInput(overrides), SCOPE, { now: NOW }).mission;
}

function rawTask(taskId, dependencies = []) {
  const mission = createBaseMission();
  return JSON.parse(JSON.stringify(createTask(taskInput(mission.missionId, {
    taskId,
    dependencies,
    interactionId: null,
    resourceKeys: [],
  }), mission, SCOPE, { now: NOW })));
}

test('creates a valid Mission V1 with backend-derived requester and stable metadata', () => {
  const result = createMission(missionInput(), SCOPE, { now: NOW });

  assert.equal(result.mission.requester, SCOPE.userId);
  assert.equal(result.mission.clientId, SCOPE.clientId);
  assert.equal(result.mission.status, MISSION_STATES.PROPOSED);
  assert.equal(result.mission.schemaVersion, SCHEMA_VERSION);
  assert.equal(result.mission.version, 1);
  assert.equal(result.mission.createdAt, NOW);
  assert.equal(result.mission.updatedAt, NOW);
  assert.equal(result.mission.workspaceId, null);
  assert.deepEqual(result.mission.tasks, []);
  assert.deepEqual(result.mission.blockers, []);
  assert.equal(Object.hasOwn(result.mission, 'organizationId'), false);
  assert.equal(Object.isFrozen(result.mission), true);
  assert.equal(result.events[0].eventType, DOMAIN_EVENT_TYPES.MISSION_CREATED);
  assert.equal(result.events[0].tenantId, SCOPE.tenantId);
  assert.equal(result.events[0].userId, SCOPE.userId);
  assert.equal(result.events[0].actorId, SCOPE.userId);
  assert.equal(result.events[0].interactionId, 'interaction-test-001');
  assert.doesNotThrow(() => validateMission(result.mission));
});

test('rejects missing required Mission fields', () => {
  const required = [
    'missionId', 'title', 'objective', 'scope', 'clientId', 'projectId',
    'acceptanceCriteria', 'nextAction',
  ];

  required.forEach((field) => {
    const input = missionInput();
    delete input[field];
    assert.throws(() => createMission(input, SCOPE, { now: NOW }), { name: 'MissionDomainError' }, field);
  });
});

test('rejects invalid missionId, empty objective, and multiple objectives represented as a collection', () => {
  assert.throws(
    () => createMission(missionInput({ missionId: 'contains spaces' }), SCOPE, { now: NOW }),
    { code: 'invalid_missionId' },
  );
  assert.throws(
    () => createMission(missionInput({ objective: '   ' }), SCOPE, { now: NOW }),
    { code: 'invalid_objective' },
  );
  assert.throws(
    () => createMission(missionInput({ objective: ['objetivo A', 'objetivo B'] }), SCOPE, { now: NOW }),
    { code: 'multiple_objectives_not_allowed' },
  );
});

test('derives requester from scope and rejects client scope mismatch', () => {
  const mission = createMission(missionInput({ requester: 'another-user' }), SCOPE, { now: NOW }).mission;
  assert.equal(mission.requester, SCOPE.userId);

  assert.throws(
    () => createMission(missionInput({ clientId: 'client-foreign' }), SCOPE, { now: NOW }),
    { code: 'client_scope_mismatch' },
  );
  assert.throws(
    () => validateSyntheticScope({ tenantId: SCOPE.tenantId, clientId: SCOPE.clientId }),
    { code: 'invalid_userId' },
  );
});

test('enforces initial Mission guards and acceptance criteria', () => {
  assert.throws(
    () => createMission(missionInput({ acceptanceCriteria: [] }), SCOPE, { now: NOW }),
    { code: 'invalid_acceptanceCriteria' },
  );
  assert.throws(
    () => createMission(missionInput({ blockers: [{ blockerId: 'blocker-1' }] }), SCOPE, { now: NOW }),
    { code: 'initial_blockers_not_empty' },
  );
  assert.throws(
    () => createMission(missionInput({ tasks: [{}] }), SCOPE, { now: NOW }),
    { code: 'initial_tasks_not_empty' },
  );
  assert.throws(
    () => createMission(missionInput({ result: 'already-done' }), SCOPE, { now: NOW }),
    { code: 'initial_result_not_null' },
  );
  assert.throws(
    () => createMission(missionInput({ status: MISSION_STATES.READY }), SCOPE, { now: NOW }),
    { code: 'invalid_initial_status' },
  );
});

test('creates a valid Task V1 inside the mission aggregate', () => {
  const mission = createBaseMission();
  const task = createTask(taskInput(mission.missionId), mission, SCOPE, { now: NOW });

  assert.equal(task.taskId, 'task-test-001');
  assert.equal(task.missionId, mission.missionId);
  assert.equal(task.status, TASK_STATES.PENDING);
  assert.equal(task.assignee, SCOPE.userId);
  assert.equal(task.result, null);
  assert.equal(task.createdAt, NOW);
  assert.equal(task.updatedAt, NOW);
  assert.equal(Object.isFrozen(task), true);
});

test('rejects invalid Task identity, mission mismatch, action, criteria, and duplicate dependencies', () => {
  const mission = createBaseMission();
  assert.throws(
    () => createTask(taskInput(mission.missionId, { taskId: 'bad id' }), mission, SCOPE, { now: NOW }),
    { code: 'invalid_taskId' },
  );
  assert.throws(
    () => createTask(taskInput('mission-foreign'), mission, SCOPE, { now: NOW }),
    { code: 'task_mission_mismatch' },
  );
  assert.throws(
    () => createTask(taskInput(mission.missionId, { action: '' }), mission, SCOPE, { now: NOW }),
    { code: 'invalid_action' },
  );
  assert.throws(
    () => createTask(taskInput(mission.missionId, { acceptanceCriteria: [] }), mission, SCOPE, { now: NOW }),
    { code: 'invalid_acceptanceCriteria' },
  );
  assert.throws(
    () => createTask(taskInput(mission.missionId, {
      dependencies: ['task-dependency', 'task-dependency'],
    }), mission, SCOPE, { now: NOW }),
    { code: 'duplicate_dependencies' },
  );
});

test('detects missing, self, direct-cycle, and indirect-cycle task dependencies', () => {
  const missing = rawTask('task-A', ['task-missing']);
  assert.throws(
    () => validateTaskGraph([missing], 'mission-test-001'),
    { code: 'task_dependency_not_found' },
  );

  const self = rawTask('task-A', ['task-A']);
  assert.throws(
    () => validateTaskGraph([self], 'mission-test-001'),
    { code: 'task_self_dependency' },
  );

  const directA = rawTask('task-A', ['task-B']);
  const directB = rawTask('task-B', ['task-A']);
  assert.throws(
    () => validateTaskGraph([directA, directB], 'mission-test-001'),
    { code: 'task_dependency_cycle' },
  );

  const indirectA = rawTask('task-A', ['task-B']);
  const indirectB = rawTask('task-B', ['task-C']);
  const indirectC = rawTask('task-C', ['task-A']);
  assert.throws(
    () => validateTaskGraph([indirectA, indirectB, indirectC], 'mission-test-001'),
    { code: 'task_dependency_cycle' },
  );
});

test('domain event envelope contains only safe correlation metadata', () => {
  const result = createMission(missionInput({
    title: 'Dato privado que no debe entrar en el evento',
    objective: 'No copiar secreto@example.com al evento',
  }), SCOPE, { now: NOW });
  const serialized = JSON.stringify(result.events[0]);

  assert.deepEqual(Object.keys(result.events[0]), [
    'eventId', 'eventType', 'occurredAt', 'tenantId', 'userId', 'missionId',
    'taskId', 'actorId', 'previousStatus', 'nextStatus', 'interactionId',
    'approvalId', 'evidenceReferences',
  ]);
  assert.equal(serialized.includes('secreto@example.com'), false);
  assert.equal(serialized.includes('Dato privado'), false);
});

test('V1 state sets exclude PLANNED, WAITING_EXTERNAL, and ARCHIVED', () => {
  assert.equal(Object.values(MISSION_STATES).includes('PLANNED'), false);
  assert.equal(Object.values(MISSION_STATES).includes('WAITING_EXTERNAL'), false);
  assert.equal(Object.values(MISSION_STATES).includes('ARCHIVED'), false);
  assert.deepEqual(Object.values(TASK_STATES), [
    'PENDING', 'READY', 'WAITING_APPROVAL', 'RUNNING',
    'BLOCKED', 'COMPLETED', 'FAILED', 'CANCELLED',
  ]);
});

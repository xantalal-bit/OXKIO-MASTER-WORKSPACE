'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DOMAIN_EVENT_TYPES,
  MISSION_STATES,
  TASK_STATES,
  assertMissionScope,
  cloneDomain,
  validateIdentifier,
  validateMission,
} = require('./mission-contract');
const {
  normalizeExpectedVersion,
  normalizeIdempotencyKey,
  normalizeMissionFilters,
  normalizeRepositoryScope,
  repositoryFail,
} = require('./mission-repository-contract');
const {
  REQUIRED_TASK_CANCELLED,
  REQUIRED_TASK_CANCELLED_NEXT_ACTION,
  MissionService,
} = require('./mission-service');

const NOW = '2026-08-01T10:00:00.000Z';
const LATER = '2026-08-01T10:05:00.000Z';
const SCOPE = Object.freeze({
  tenantId: 'tenant-service',
  userId: 'user-service',
  clientId: 'client-service',
});

function copy(value) {
  return cloneDomain(value);
}

function scopeKey(scope) {
  const normalized = normalizeRepositoryScope(scope);
  return JSON.stringify([normalized.tenantId, normalized.userId, normalized.clientId]);
}

class FakeMissionRepository {
  constructor() {
    this.missionsByScope = new Map();
    this.idempotencyByScope = new Map();
  }

  async create(scope, mission, idempotencyKey) {
    const normalizedScope = normalizeRepositoryScope(scope);
    validateMission(mission);
    assertMissionScope(mission, normalizedScope);
    const normalizedKey = normalizeIdempotencyKey(idempotencyKey);
    const key = scopeKey(normalizedScope);
    const missions = this.missionsByScope.get(key) || new Map();
    const idempotency = this.idempotencyByScope.get(key) || new Map();
    if (idempotency.has(normalizedKey)) {
      const existingId = idempotency.get(normalizedKey);
      if (existingId !== mission.missionId) {
        repositoryFail('idempotency_conflict', 'idempotencyKey belongs to another Mission.');
      }
      return { mission: copy(missions.get(existingId)), created: false };
    }
    if (missions.has(mission.missionId)) {
      repositoryFail('mission_already_exists', 'Mission already exists.');
    }
    missions.set(mission.missionId, copy(mission));
    idempotency.set(normalizedKey, mission.missionId);
    this.missionsByScope.set(key, missions);
    this.idempotencyByScope.set(key, idempotency);
    return { mission: copy(mission), created: true };
  }

  async get(scope, missionId) {
    const key = scopeKey(scope);
    const normalizedMissionId = validateIdentifier(missionId, 'missionId');
    const mission = this.missionsByScope.get(key)?.get(normalizedMissionId);
    if (!mission) repositoryFail('mission_not_found', 'Mission was not found.');
    return copy(mission);
  }

  async list(scope, filters = {}) {
    const key = scopeKey(scope);
    const normalizedFilters = normalizeMissionFilters(filters);
    return copy([...(this.missionsByScope.get(key)?.values() || [])]
      .filter((mission) => Object.entries(normalizedFilters)
        .every(([field, value]) => mission[field] === value))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt)
        || left.missionId.localeCompare(right.missionId)));
  }

  async saveIfVersion(scope, mission, expectedVersion) {
    const normalizedScope = normalizeRepositoryScope(scope);
    validateMission(mission);
    const normalizedExpectedVersion = normalizeExpectedVersion(expectedVersion);
    const missions = this.missionsByScope.get(scopeKey(normalizedScope));
    const stored = missions?.get(mission.missionId);
    if (!stored) repositoryFail('mission_not_found', 'Mission was not found.');
    assertMissionScope(mission, normalizedScope);
    if (stored.version !== normalizedExpectedVersion) {
      repositoryFail('version_conflict', 'Mission version does not match expectedVersion.');
    }
    if (mission.version <= normalizedExpectedVersion) {
      repositoryFail('invalid_version_advance', 'Mission version must advance.');
    }
    missions.set(mission.missionId, copy(mission));
    return copy(mission);
  }
}

function missionPayload(scope = SCOPE, missionId = 'mission-service-alpha', overrides = {}) {
  return {
    missionId,
    title: `Mission ${missionId}`,
    objective: 'Exercise the Mission application service',
    scope: 'Synthetic application test scope',
    clientId: scope.clientId,
    projectId: 'project-service',
    workspaceId: 'workspace-service',
    priority: 'normal',
    acceptanceCriteria: [{
      criterionId: `criterion-${missionId}`,
      description: 'Application behavior is verified',
    }],
    nextAction: 'Create the Mission',
    ...overrides,
  };
}

function taskPayload(taskId = 'task-service-alpha', overrides = {}) {
  return {
    taskId,
    action: `Execute ${taskId}`,
    assignee: SCOPE.userId,
    dependencies: [],
    requiredApprovalIds: [],
    acceptanceCriteria: [{
      criterionId: `criterion-${taskId}`,
      description: 'Task behavior is verified',
    }],
    nextAction: 'Prepare the Task',
    resourceKeys: [],
    ...overrides,
  };
}

function operationOptions(expectedVersion, overrides = {}) {
  return {
    expectedVersion,
    now: LATER,
    idFactory: () => 'event-service-test',
    blockerIdFactory: ({ taskId }) => `blocker-${taskId}`,
    ...overrides,
  };
}

function createService() {
  const repository = new FakeMissionRepository();
  return { repository, service: new MissionService({ repository }) };
}

async function createStoredMission(service, scope = SCOPE, missionId = 'mission-service-alpha', overrides = {}) {
  return service.createMission(scope, missionPayload(scope, missionId, overrides), {
    idempotencyKey: `create-${missionId}`,
    now: NOW,
    idFactory: () => `event-${missionId}`,
  });
}

test('creates a Mission with requester derived from scope and one creation event', async () => {
  const { service } = createService();
  const result = await createStoredMission(service);
  assert.equal(result.created, true);
  assert.equal(result.mission.requester, SCOPE.userId);
  assert.equal(result.mission.clientId, SCOPE.clientId);
  assert.deepEqual(result.events.map((event) => event.eventType), [
    DOMAIN_EVENT_TYPES.MISSION_CREATED,
  ]);
});

test('createMission requires an idempotencyKey', async () => {
  const { service } = createService();
  await assert.rejects(
    service.createMission(SCOPE, missionPayload(), { now: NOW }),
    { code: 'invalid_idempotencyKey' },
  );
});

test('createMission is idempotent and does not duplicate MISSION_CREATED', async () => {
  const { service } = createService();
  const first = await createStoredMission(service);
  const repeated = await createStoredMission(service);
  assert.equal(first.created, true);
  assert.equal(repeated.created, false);
  assert.deepEqual(repeated.events, []);
  assert.equal((await service.listMissions(SCOPE)).length, 1);
});

test('same idempotencyKey remains independent across scopes', async () => {
  const { service } = createService();
  const otherScope = { ...SCOPE, tenantId: 'tenant-other' };
  const first = await service.createMission(SCOPE, missionPayload(), {
    idempotencyKey: 'shared-create-key', now: NOW,
  });
  const second = await service.createMission(
    otherScope,
    missionPayload(otherScope, 'mission-other-scope'),
    { idempotencyKey: 'shared-create-key', now: NOW },
  );
  assert.equal(first.created, true);
  assert.equal(second.created, true);
});

test('getMission returns the scoped Mission and fails closed for missing or foreign scope', async () => {
  const { service } = createService();
  await createStoredMission(service);
  assert.equal((await service.getMission(SCOPE, 'mission-service-alpha')).missionId, 'mission-service-alpha');
  await assert.rejects(
    service.getMission(SCOPE, 'mission-missing'),
    { code: 'mission_not_found' },
  );
  await assert.rejects(
    service.getMission({ ...SCOPE, userId: 'user-foreign' }, 'mission-service-alpha'),
    { code: 'mission_not_found' },
  );
});

test('listMissions is scoped, filtered, deterministic, and rejects identity filters', async () => {
  const { service } = createService();
  await createStoredMission(service);
  await createStoredMission(service, SCOPE, 'mission-service-beta', {
    projectId: 'project-beta',
    workspaceId: null,
    priority: 'high',
  });
  await service.addTask(
    SCOPE,
    'mission-service-alpha',
    taskPayload(),
    operationOptions(1),
  );
  await service.transitionMission(
    SCOPE,
    'mission-service-alpha',
    MISSION_STATES.READY,
    operationOptions(2),
  );

  assert.deepEqual(
    (await service.listMissions(SCOPE)).map((mission) => mission.missionId),
    ['mission-service-alpha', 'mission-service-beta'],
  );
  assert.equal((await service.listMissions(SCOPE, { projectId: 'project-beta' })).length, 1);
  assert.equal((await service.listMissions(SCOPE, { workspaceId: null })).length, 1);
  assert.equal((await service.listMissions(SCOPE, { status: MISSION_STATES.READY })).length, 1);
  assert.equal((await service.listMissions(SCOPE, { priority: 'high' })).length, 1);
  assert.deepEqual(await service.listMissions({ ...SCOPE, clientId: 'client-other' }), []);
  await assert.rejects(service.listMissions(undefined), { code: 'invalid_scope' });
  await assert.rejects(
    service.listMissions(SCOPE, { tenantId: 'tenant-other' }),
    { code: 'unsupported_mission_filter' },
  );
});

test('addTask requires expectedVersion, stores through the repository, and preserves its event', async () => {
  const { service } = createService();
  await createStoredMission(service);
  await assert.rejects(
    service.addTask(SCOPE, 'mission-service-alpha', taskPayload(), {}),
    { code: 'invalid_expected_version' },
  );
  await assert.rejects(
    service.addTask(SCOPE, 'mission-service-alpha', taskPayload(), operationOptions(2)),
    { code: 'version_conflict' },
  );

  const added = await service.addTask(
    SCOPE,
    'mission-service-alpha',
    taskPayload(),
    operationOptions(1),
  );
  assert.equal(added.mission.version, 2);
  assert.equal(added.mission.tasks.length, 1);
  assert.deepEqual(added.events.map((event) => event.eventType), [DOMAIN_EVENT_TYPES.TASK_ADDED]);
});

test('transitionTask accepts a valid transition and rejects an invalid transition without saving', async () => {
  const { service } = createService();
  await createStoredMission(service);
  await service.addTask(SCOPE, 'mission-service-alpha', taskPayload(), operationOptions(1));
  const ready = await service.transitionTask(
    SCOPE,
    'mission-service-alpha',
    'task-service-alpha',
    TASK_STATES.READY,
    operationOptions(2),
  );
  assert.equal(ready.mission.tasks[0].status, TASK_STATES.READY);
  assert.equal(ready.events[0].eventType, DOMAIN_EVENT_TYPES.TASK_STATUS_CHANGED);

  await assert.rejects(
    service.transitionTask(
      SCOPE,
      'mission-service-alpha',
      'task-service-alpha',
      TASK_STATES.COMPLETED,
      operationOptions(3, { result: { status: 'invalid-direct-completion' } }),
    ),
    { code: 'invalid_task_transition' },
  );
  assert.equal((await service.getMission(SCOPE, 'mission-service-alpha')).version, 3);
});

test('cancelling a required Task blocks an eligible Mission and records the approved blocker', async () => {
  const { service } = createService();
  await createStoredMission(service);
  await service.addTask(SCOPE, 'mission-service-alpha', taskPayload(), operationOptions(1));
  await service.transitionTask(
    SCOPE, 'mission-service-alpha', 'task-service-alpha', TASK_STATES.READY, operationOptions(2),
  );
  await service.transitionMission(
    SCOPE, 'mission-service-alpha', MISSION_STATES.READY, operationOptions(3),
  );
  const cancelled = await service.transitionTask(
    SCOPE,
    'mission-service-alpha',
    'task-service-alpha',
    TASK_STATES.CANCELLED,
    operationOptions(4, { result: { reason: 'synthetic-cancellation' } }),
  );

  assert.equal(cancelled.mission.status, MISSION_STATES.BLOCKED);
  assert.equal(cancelled.mission.version, 7);
  assert.equal(cancelled.mission.tasks[0].status, TASK_STATES.CANCELLED);
  assert.equal(cancelled.mission.blockers[0].type, REQUIRED_TASK_CANCELLED);
  assert.equal(cancelled.mission.blockers[0].taskId, 'task-service-alpha');
  assert.equal(cancelled.mission.nextAction, REQUIRED_TASK_CANCELLED_NEXT_ACTION);
  assert.deepEqual(cancelled.events.map((event) => event.eventType), [
    DOMAIN_EVENT_TYPES.TASK_STATUS_CHANGED,
    DOMAIN_EVENT_TYPES.BLOCKER_ADDED,
    DOMAIN_EVENT_TYPES.MISSION_STATUS_CHANGED,
  ]);
});

test('PROPOSED Mission remains PROPOSED after Task cancellation and cannot become READY', async () => {
  const { service } = createService();
  await createStoredMission(service);
  await service.addTask(SCOPE, 'mission-service-alpha', taskPayload(), operationOptions(1));
  await service.transitionTask(
    SCOPE, 'mission-service-alpha', 'task-service-alpha', TASK_STATES.READY, operationOptions(2),
  );
  const cancelled = await service.transitionTask(
    SCOPE,
    'mission-service-alpha',
    'task-service-alpha',
    TASK_STATES.CANCELLED,
    operationOptions(3),
  );
  assert.equal(cancelled.mission.status, MISSION_STATES.PROPOSED);
  assert.equal(cancelled.mission.blockers[0].type, REQUIRED_TASK_CANCELLED);
  assert.equal(cancelled.mission.nextAction, REQUIRED_TASK_CANCELLED_NEXT_ACTION);

  await assert.rejects(
    service.transitionMission(
      SCOPE,
      'mission-service-alpha',
      MISSION_STATES.READY,
      operationOptions(cancelled.mission.version),
    ),
    { code: 'required_task_cancelled_blocker_active' },
  );
});

test('terminal Mission rejects Task additions and Task transitions', async () => {
  const { service } = createService();
  await createStoredMission(service);
  await service.addTask(SCOPE, 'mission-service-alpha', taskPayload(), operationOptions(1));
  const cancelled = await service.transitionMission(
    SCOPE,
    'mission-service-alpha',
    MISSION_STATES.CANCELLED,
    operationOptions(2),
  );
  await assert.rejects(
    service.addTask(
      SCOPE,
      'mission-service-alpha',
      taskPayload('task-after-terminal'),
      operationOptions(cancelled.mission.version),
    ),
    { code: 'terminal_mission_immutable' },
  );
  await assert.rejects(
    service.transitionTask(
      SCOPE,
      'mission-service-alpha',
      'task-service-alpha',
      TASK_STATES.READY,
      operationOptions(cancelled.mission.version),
    ),
    { code: 'terminal_mission_immutable' },
  );
});

test('transitionMission preserves valid events and rejects invalid state changes', async () => {
  const { service } = createService();
  await createStoredMission(service);
  await assert.rejects(
    service.transitionMission(
      SCOPE, 'mission-service-alpha', MISSION_STATES.RUNNING, operationOptions(1),
    ),
    { code: 'invalid_mission_transition' },
  );
  await service.addTask(SCOPE, 'mission-service-alpha', taskPayload(), operationOptions(1));
  const ready = await service.transitionMission(
    SCOPE, 'mission-service-alpha', MISSION_STATES.READY, operationOptions(2),
  );
  assert.equal(ready.mission.status, MISSION_STATES.READY);
  assert.deepEqual(ready.events.map((event) => event.eventType), [
    DOMAIN_EVENT_TYPES.MISSION_STATUS_CHANGED,
  ]);
});

test('two service writers using the same expectedVersion allow only one mutation', async () => {
  const { service } = createService();
  await createStoredMission(service);
  const results = await Promise.allSettled([
    service.addTask(
      SCOPE, 'mission-service-alpha', taskPayload('task-writer-left'), operationOptions(1),
    ),
    service.addTask(
      SCOPE, 'mission-service-alpha', taskPayload('task-writer-right'), operationOptions(1),
    ),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  assert.equal(results.find((result) => result.status === 'rejected').reason.code, 'version_conflict');
  assert.equal((await service.getMission(SCOPE, 'mission-service-alpha')).tasks.length, 1);
});

test('objects returned by the service cannot mutate repository state by reference', async () => {
  const { service } = createService();
  await createStoredMission(service);
  const loaded = await service.getMission(SCOPE, 'mission-service-alpha');
  assert.throws(() => {
    loaded.title = 'Attempted external mutation';
  }, TypeError);
  assert.notEqual(
    (await service.getMission(SCOPE, 'mission-service-alpha')).title,
    'Attempted external mutation',
  );
});

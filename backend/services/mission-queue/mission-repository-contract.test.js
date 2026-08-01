'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  assertMissionScope,
  cloneDomain,
  createMission,
  validateIdentifier,
  validateMission,
} = require('./mission-contract');
const {
  MISSION_REPOSITORY_METHODS,
  assertMissionRepository,
  normalizeExpectedVersion,
  normalizeIdempotencyKey,
  normalizeMissionFilters,
  normalizeRepositoryScope,
  repositoryFail,
} = require('./mission-repository-contract');

const NOW = '2026-08-01T10:00:00.000Z';
const SCOPE = Object.freeze({
  tenantId: 'tenant-alpha',
  userId: 'user-alpha',
  clientId: 'client-alpha',
});

function scopeKey(scope) {
  const normalized = normalizeRepositoryScope(scope);
  return JSON.stringify([normalized.tenantId, normalized.userId, normalized.clientId]);
}

function copy(value) {
  return cloneDomain(value);
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
      const existingMissionId = idempotency.get(normalizedKey);
      if (existingMissionId !== mission.missionId) {
        repositoryFail('idempotency_conflict', 'idempotencyKey is already bound to another Mission.');
      }
      return { mission: copy(missions.get(existingMissionId)), created: false };
    }
    if (missions.has(mission.missionId)) {
      repositoryFail('mission_already_exists', 'Mission already exists in this scope.');
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
    const missions = [...(this.missionsByScope.get(key)?.values() || [])]
      .filter((mission) => Object.entries(normalizedFilters)
        .every(([field, value]) => mission[field] === value))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt)
        || left.missionId.localeCompare(right.missionId));
    return copy(missions);
  }

  async saveIfVersion(scope, mission, expectedVersion) {
    const normalizedScope = normalizeRepositoryScope(scope);
    validateMission(mission);
    const normalizedExpectedVersion = normalizeExpectedVersion(expectedVersion);
    const key = scopeKey(normalizedScope);
    const missions = this.missionsByScope.get(key);
    const stored = missions?.get(mission.missionId);
    if (!stored) repositoryFail('mission_not_found', 'Mission was not found.');
    assertMissionScope(mission, normalizedScope);
    if (stored.version !== normalizedExpectedVersion) {
      repositoryFail('version_conflict', 'Mission version does not match expectedVersion.');
    }
    if (mission.version <= normalizedExpectedVersion) {
      repositoryFail('invalid_version_advance', 'Saved Mission version must advance.');
    }
    missions.set(mission.missionId, copy(mission));
    return copy(mission);
  }
}

function missionFor(scope = SCOPE, missionId = 'mission-alpha', overrides = {}) {
  return createMission({
    missionId,
    title: `Mission ${missionId}`,
    objective: 'Verify the repository contract',
    scope: 'Synthetic unit test scope',
    clientId: scope.clientId,
    projectId: 'project-alpha',
    workspaceId: 'workspace-alpha',
    priority: 'normal',
    acceptanceCriteria: [{
      criterionId: `criterion-${missionId}`,
      description: 'Repository behavior is verified',
    }],
    nextAction: 'Store the Mission',
    ...overrides,
  }, scope, { now: NOW }).mission;
}

test('defines only the four V1 repository operations and rejects unsafe contracts', () => {
  assert.deepEqual(MISSION_REPOSITORY_METHODS, ['create', 'get', 'list', 'saveIfVersion']);
  const repository = new FakeMissionRepository();
  assert.equal(assertMissionRepository(repository), repository);
  assert.equal(typeof repository.delete, 'undefined');
  assert.equal(typeof repository.hardDelete, 'undefined');
  assert.equal(typeof repository.globalList, 'undefined');
  assert.equal(typeof repository.findAcrossTenants, 'undefined');

  assert.throws(
    () => assertMissionRepository({ create() {}, get() {}, list() {} }),
    { code: 'invalid_mission_repository' },
  );
  assert.throws(
    () => assertMissionRepository({
      create() {}, get() {}, list() {}, saveIfVersion() {}, delete() {},
    }),
    { code: 'unsafe_mission_repository' },
  );
});

test('creates, gets, and lists Missions with stable deterministic ordering', async () => {
  const repository = new FakeMissionRepository();
  const missionB = missionFor(SCOPE, 'mission-beta');
  const missionA = missionFor(SCOPE, 'mission-alpha');
  assert.equal((await repository.create(SCOPE, missionB, 'create-beta')).created, true);
  assert.equal((await repository.create(SCOPE, missionA, 'create-alpha')).created, true);

  assert.equal((await repository.get(SCOPE, 'mission-alpha')).missionId, 'mission-alpha');
  assert.deepEqual(
    (await repository.list(SCOPE)).map((mission) => mission.missionId),
    ['mission-alpha', 'mission-beta'],
  );
});

test('requires synthetic scope on create, get, list, and saveIfVersion', async () => {
  const repository = new FakeMissionRepository();
  const mission = missionFor();
  await assert.rejects(repository.create(undefined, mission, 'create-alpha'), { code: 'invalid_scope' });
  await assert.rejects(repository.get(undefined, mission.missionId), { code: 'invalid_scope' });
  await assert.rejects(repository.list(undefined), { code: 'invalid_scope' });
  await assert.rejects(repository.saveIfVersion(undefined, mission, 1), { code: 'invalid_scope' });
});

test('isolates tenant, user, and client without revealing cross-scope existence', async () => {
  const repository = new FakeMissionRepository();
  const mission = missionFor();
  await repository.create(SCOPE, mission, 'create-alpha');
  const foreignScopes = [
    { ...SCOPE, tenantId: 'tenant-foreign' },
    { ...SCOPE, userId: 'user-foreign' },
    { ...SCOPE, clientId: 'client-foreign' },
  ];

  for (const foreignScope of foreignScopes) {
    await assert.rejects(
      repository.get(foreignScope, 'mission-alpha'),
      { code: 'mission_not_found' },
    );
    const candidate = copy(mission);
    candidate.version += 1;
    candidate.nextAction = 'Attempt a foreign scoped save';
    await assert.rejects(
      repository.saveIfVersion(foreignScope, candidate, 1),
      { code: 'mission_not_found' },
    );
    assert.deepEqual(await repository.list(foreignScope), []);
  }
});

test('enforces scoped idempotency and permits the same key in another scope', async () => {
  const repository = new FakeMissionRepository();
  const mission = missionFor();
  const first = await repository.create(SCOPE, mission, 'idempotency-alpha');
  const repeated = await repository.create(SCOPE, mission, 'idempotency-alpha');
  assert.equal(first.created, true);
  assert.equal(repeated.created, false);
  assert.equal((await repository.list(SCOPE)).length, 1);

  await assert.rejects(
    repository.create(SCOPE, missionFor(SCOPE, 'mission-other'), 'idempotency-alpha'),
    { code: 'idempotency_conflict' },
  );

  const otherScope = { ...SCOPE, tenantId: 'tenant-independent' };
  const independent = await repository.create(
    otherScope,
    missionFor(otherScope, 'mission-independent'),
    'idempotency-alpha',
  );
  assert.equal(independent.created, true);
});

test('saveIfVersion stores a multi-step advance and rejects a stale writer', async () => {
  const repository = new FakeMissionRepository();
  await repository.create(SCOPE, missionFor(), 'create-alpha');
  const candidate = await repository.get(SCOPE, 'mission-alpha');
  candidate.version += 3;
  candidate.nextAction = 'Persist a multi-step domain update';
  assert.equal((await repository.saveIfVersion(SCOPE, candidate, 1)).version, 4);

  const stale = copy(candidate);
  stale.version += 1;
  stale.nextAction = 'Attempt a stale update';
  await assert.rejects(
    repository.saveIfVersion(SCOPE, stale, 1),
    { code: 'version_conflict' },
  );
});

test('saveIfVersion rejects equal and regressing Mission versions', async () => {
  const repository = new FakeMissionRepository();
  await repository.create(SCOPE, missionFor(), 'create-alpha');
  const equal = await repository.get(SCOPE, 'mission-alpha');
  await assert.rejects(
    repository.saveIfVersion(SCOPE, equal, 1),
    { code: 'invalid_version_advance' },
  );

  const advanced = copy(equal);
  advanced.version = 3;
  advanced.nextAction = 'Advance before testing regression';
  await repository.saveIfVersion(SCOPE, advanced, 1);
  const regressing = copy(advanced);
  regressing.version = 2;
  regressing.nextAction = 'Attempt a regressing update';
  await assert.rejects(
    repository.saveIfVersion(SCOPE, regressing, 3),
    { code: 'invalid_version_advance' },
  );
});

test('two simulated writers with the same expectedVersion allow only one save', async () => {
  const repository = new FakeMissionRepository();
  await repository.create(SCOPE, missionFor(), 'create-alpha');
  const left = await repository.get(SCOPE, 'mission-alpha');
  const right = await repository.get(SCOPE, 'mission-alpha');
  left.version += 1;
  right.version += 1;
  left.nextAction = 'Writer left';
  right.nextAction = 'Writer right';

  const results = await Promise.allSettled([
    repository.saveIfVersion(SCOPE, left, 1),
    repository.saveIfVersion(SCOPE, right, 1),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  assert.equal(results.find((result) => result.status === 'rejected').reason.code, 'version_conflict');
});

test('create, get, list, and save isolate stored data from mutable references', async () => {
  const repository = new FakeMissionRepository();
  const created = await repository.create(SCOPE, missionFor(), 'create-alpha');
  created.mission.title = 'Mutated create result';
  assert.notEqual((await repository.get(SCOPE, 'mission-alpha')).title, created.mission.title);

  const loaded = await repository.get(SCOPE, 'mission-alpha');
  loaded.title = 'Mutated get result';
  assert.notEqual((await repository.get(SCOPE, 'mission-alpha')).title, loaded.title);

  const listed = await repository.list(SCOPE);
  listed[0].title = 'Mutated list result';
  assert.notEqual((await repository.get(SCOPE, 'mission-alpha')).title, listed[0].title);

  const candidate = await repository.get(SCOPE, 'mission-alpha');
  candidate.version += 1;
  candidate.nextAction = 'Save an isolated candidate';
  await repository.saveIfVersion(SCOPE, candidate, 1);
  candidate.nextAction = 'Mutated after save';
  assert.notEqual((await repository.get(SCOPE, 'mission-alpha')).nextAction, candidate.nextAction);
});

test('list supports only project, explicit workspace, status, and priority filters', async () => {
  const repository = new FakeMissionRepository();
  await repository.create(SCOPE, missionFor(), 'create-alpha');
  await repository.create(SCOPE, missionFor(SCOPE, 'mission-null-workspace', {
    workspaceId: null,
    priority: 'high',
  }), 'create-null');

  assert.equal((await repository.list(SCOPE, { projectId: 'project-alpha' })).length, 2);
  assert.equal((await repository.list(SCOPE, { workspaceId: null })).length, 1);
  assert.equal((await repository.list(SCOPE, { status: 'PROPOSED' })).length, 2);
  assert.equal((await repository.list(SCOPE, { priority: 'high' })).length, 1);
  await assert.rejects(
    repository.list(SCOPE, { tenantId: 'tenant-foreign' }),
    { code: 'unsupported_mission_filter' },
  );
});

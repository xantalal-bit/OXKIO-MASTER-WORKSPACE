'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  MISSION_STATES,
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
const { createClientZeroMissionComposition } = require('./client-zero-mission-composition');

const USER_A = 'firebase-user-composition-alpha';
const USER_B = 'firebase-user-composition-beta';

function copy(value) {
  return cloneDomain(value);
}

function scopeKey(scope) {
  const normalized = normalizeRepositoryScope(scope);
  return JSON.stringify([normalized.tenantId, normalized.userId, normalized.clientId]);
}

class FakeMissionRepository {
  constructor({ failCreate = null } = {}) {
    this.failCreate = failCreate;
    this.createCalls = 0;
    this.missionsByScope = new Map();
    this.idempotencyByScope = new Map();
  }

  async create(scope, mission, idempotencyKey) {
    this.createCalls += 1;
    if (this.failCreate) throw this.failCreate;
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
        repositoryFail('idempotency_conflict', 'idempotencyKey belongs to another Mission.');
      }
      return { mission: copy(missions.get(existingMissionId)), created: false };
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
    const mission = this.missionsByScope.get(scopeKey(scope))
      ?.get(validateIdentifier(missionId, 'missionId'));
    if (!mission) repositoryFail('mission_not_found', 'Mission was not found.');
    return copy(mission);
  }

  async list(scope, filters = {}) {
    const normalizedFilters = normalizeMissionFilters(filters);
    return copy([...(this.missionsByScope.get(scopeKey(scope))?.values() || [])]
      .filter((mission) => Object.entries(normalizedFilters)
        .every(([field, value]) => mission[field] === value)));
  }

  async saveIfVersion(scope, mission, expectedVersion) {
    const normalizedScope = normalizeRepositoryScope(scope);
    const normalizedVersion = normalizeExpectedVersion(expectedVersion);
    const stored = this.missionsByScope.get(scopeKey(normalizedScope))?.get(mission.missionId);
    if (!stored) repositoryFail('mission_not_found', 'Mission was not found.');
    validateMission(mission);
    assertMissionScope(mission, normalizedScope);
    if (stored.version !== normalizedVersion || mission.version <= normalizedVersion) {
      repositoryFail('version_conflict', 'Mission version conflict.');
    }
    this.missionsByScope.get(scopeKey(normalizedScope)).set(mission.missionId, copy(mission));
    return copy(mission);
  }
}

function membership(userId = USER_A, suffix = 'alpha') {
  return {
    tenantId: `tenant-composition-${suffix}`,
    clientId: `client-composition-${suffix}`,
    userId,
    roles: ['owner'],
    status: 'ACTIVE',
  };
}

function bootstrapConfig(userId = USER_A, suffix = 'alpha') {
  return {
    enabled: true,
    authenticatedUserId: userId,
    membership: membership(userId, suffix),
  };
}

function confirmedPlan(suffix = 'alpha', overrides = {}) {
  return {
    missionId: `mission-composition-${suffix}`,
    title: `Synthetic composition ${suffix}`,
    objective: `Persist the synthetic ${suffix} objective`,
    scope: `Synthetic composition ${suffix}`,
    projectId: `project-composition-${suffix}`,
    workspaceId: `workspace-composition-${suffix}`,
    priority: 'normal',
    acceptanceCriteria: [{
      criterionId: `criterion-composition-${suffix}`,
      description: 'The synthetic Mission is persisted once',
    }],
    sourceInteractionId: `interaction-composition-${suffix}`,
    nextAction: 'Await a separately authorized integration phase',
    ...overrides,
  };
}

function intakeInput(userId = USER_A, suffix = 'alpha', overrides = {}) {
  return {
    authenticatedUserId: userId,
    confirmed: true,
    confirmedPlan: confirmedPlan(suffix),
    idempotencyKey: `idempotency-composition-${suffix}`,
    ...overrides,
  };
}

function composition({
  config = bootstrapConfig(),
  repository = new FakeMissionRepository(),
} = {}) {
  return {
    repository,
    value: createClientZeroMissionComposition({
      bootstrapConfig: config,
      missionRepository: repository,
    }),
  };
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => error && error.code === code);
}

test('composes the approved bootstrap, MembershipResolver, MissionService, and Mission Intake', async () => {
  const { value, repository } = composition();
  const result = await value.createMissionFromConfirmedPlan(intakeInput());

  assert.equal(result.created, true);
  assert.equal(result.mission.status, MISSION_STATES.PROPOSED);
  assert.equal(result.mission.requester, USER_A);
  assert.equal(result.mission.clientId, 'client-composition-alpha');
  assert.equal(repository.createCalls, 1);
});

test('exposes only a frozen createMissionFromConfirmedPlan operation', () => {
  const { value } = composition();
  assert.deepEqual(Object.keys(value), ['createMissionFromConfirmedPlan']);
  assert.equal(Object.isFrozen(value), true);
  assert.equal(value.membershipResolver, undefined);
  assert.equal(value.bootstrapProvider, undefined);
  assert.equal(value.missionService, undefined);
  assert.equal(value.missionRepository, undefined);
  assert.equal(value.missionIntake, undefined);
  assert.equal(value.scope, undefined);
  assert.equal(value.config, undefined);
  assert.equal(value.addTask, undefined);
  assert.equal(value.transitionMission, undefined);
  assert.equal(value.transitionTask, undefined);
});

test('keeps bootstrap disabled by default and rejects an unmatched UID', async () => {
  const repository = new FakeMissionRepository();
  const disabled = createClientZeroMissionComposition({ missionRepository: repository });
  await expectCode(disabled.createMissionFromConfirmedPlan(intakeInput()), 'membership_not_available');
  assert.equal(repository.createCalls, 0);

  const { value } = composition();
  await expectCode(
    value.createMissionFromConfirmedPlan(intakeInput(USER_B)),
    'membership_not_available',
  );
  assert.equal(repository.createCalls, 0);
});

test('fails closed for incomplete or malformed bootstrap configuration', () => {
  assert.throws(() => createClientZeroMissionComposition({
    bootstrapConfig: { enabled: true },
    missionRepository: new FakeMissionRepository(),
  }), { code: 'bootstrap_configuration_invalid' });
  assert.throws(() => createClientZeroMissionComposition({
    bootstrapConfig: [],
    missionRepository: new FakeMissionRepository(),
  }), { code: 'bootstrap_configuration_invalid' });
});

test('requires a repository implementing the complete V1 contract', () => {
  assert.throws(() => createClientZeroMissionComposition({
    bootstrapConfig: bootstrapConfig(),
  }), { code: 'invalid_mission_repository' });
  assert.throws(() => createClientZeroMissionComposition({
    bootstrapConfig: bootstrapConfig(),
    missionRepository: { create() {}, get() {}, list() {} },
  }), { code: 'invalid_mission_repository' });
});

test('propagates repository failure without fallback or a second create', async () => {
  const failure = Object.assign(new Error('synthetic unavailable'), { code: 'repository_unavailable' });
  const repository = new FakeMissionRepository({ failCreate: failure });
  const { value } = composition({ repository });
  await expectCode(value.createMissionFromConfirmedPlan(intakeInput()), 'repository_unavailable');
  assert.equal(repository.createCalls, 1);
});

test('preserves strict confirmation, plan validation, and caller-provided idempotency', async () => {
  const { value, repository } = composition();
  for (const confirmed of [false, 1, 'true', {}, []]) {
    await expectCode(
      value.createMissionFromConfirmedPlan(intakeInput(USER_A, 'alpha', { confirmed })),
      'mission_intake_not_confirmed',
    );
  }
  await expectCode(
    value.createMissionFromConfirmedPlan(intakeInput(USER_A, 'alpha', { confirmedPlan: {} })),
    'mission_intake_plan_invalid',
  );
  await expectCode(
    value.createMissionFromConfirmedPlan(intakeInput(USER_A, 'alpha', { idempotencyKey: '' })),
    'mission_intake_idempotency_invalid',
  );
  assert.equal(repository.createCalls, 0);
});

test('keeps idempotent retry and rejects the same key for another Mission', async () => {
  const { value, repository } = composition();
  const first = await value.createMissionFromConfirmedPlan(intakeInput());
  const retry = await value.createMissionFromConfirmedPlan(intakeInput());
  assert.equal(first.created, true);
  assert.equal(retry.created, false);
  assert.deepEqual(retry.events, []);
  await expectCode(value.createMissionFromConfirmedPlan(intakeInput(USER_A, 'alpha', {
    confirmedPlan: confirmedPlan('alpha', { missionId: 'mission-composition-conflict' }),
  })), 'idempotency_conflict');
  assert.equal(repository.createCalls, 3);
});

test('rejects authority, status, and metadata injected through the confirmed plan', async () => {
  const { value, repository } = composition();
  for (const field of ['tenantId', 'clientId', 'userId', 'roles', 'requester', 'status', 'metadata']) {
    await expectCode(value.createMissionFromConfirmedPlan(intakeInput(USER_A, 'alpha', {
      confirmedPlan: confirmedPlan('alpha', { [field]: 'forged' }),
    })), 'mission_intake_plan_invalid');
  }
  assert.equal(repository.createCalls, 0);
});

test('isolates two compositions, bootstrap identities, and repositories', async () => {
  const repositoryA = new FakeMissionRepository();
  const repositoryB = new FakeMissionRepository();
  const compositionA = composition({ config: bootstrapConfig(USER_A, 'alpha'), repository: repositoryA }).value;
  const compositionB = composition({ config: bootstrapConfig(USER_B, 'beta'), repository: repositoryB }).value;

  await expectCode(
    compositionA.createMissionFromConfirmedPlan(intakeInput(USER_B, 'beta')),
    'membership_not_available',
  );
  await expectCode(
    compositionB.createMissionFromConfirmedPlan(intakeInput(USER_A, 'alpha')),
    'membership_not_available',
  );
  const resultA = await compositionA.createMissionFromConfirmedPlan(intakeInput(USER_A, 'alpha'));
  const resultB = await compositionB.createMissionFromConfirmedPlan(intakeInput(USER_B, 'beta'));

  assert.equal(resultA.mission.clientId, 'client-composition-alpha');
  assert.equal(resultB.mission.clientId, 'client-composition-beta');
  assert.equal(repositoryA.createCalls, 1);
  assert.equal(repositoryB.createCalls, 1);
  assert.equal((await repositoryA.list(membership(USER_A, 'alpha'))).length, 1);
  assert.equal((await repositoryB.list(membership(USER_B, 'beta'))).length, 1);
  assert.equal((await repositoryA.list(membership(USER_B, 'beta'))).length, 0);
  assert.equal((await repositoryB.list(membership(USER_A, 'alpha'))).length, 0);
});

test('snapshots bootstrap configuration against later caller mutation', async () => {
  const config = bootstrapConfig();
  const { value } = composition({ config });
  config.authenticatedUserId = USER_B;
  config.membership.tenantId = 'tenant-mutated';
  config.membership.clientId = 'client-mutated';
  config.membership.userId = USER_B;
  config.membership.roles.push('viewer');
  config.membership.status = 'REVOKED';

  const result = await value.createMissionFromConfirmedPlan(intakeInput());
  assert.equal(result.mission.requester, USER_A);
  assert.equal(result.mission.clientId, 'client-composition-alpha');
  await expectCode(
    value.createMissionFromConfirmedPlan(intakeInput(USER_B)),
    'membership_not_available',
  );
});

test('production composition remains a pure local dependency capsule', () => {
  const source = fs.readFileSync(path.join(__dirname, 'client-zero-mission-composition.js'), 'utf8');
  assert.match(source, /createClientZeroBootstrapProvider/);
  assert.match(source, /createMembershipResolver/);
  assert.match(source, /new MissionService/);
  assert.match(source, /createMissionIntake/);
  assert.doesNotMatch(source, /process\.env|firebase|oauth|postgres|filesystem|node:fs|fetch|http|server|runtime/i);
  assert.doesNotMatch(source, /ApprovalQueue|OperationsCoordinator|ExecutionService|ActionExecutor|worker/i);
  assert.doesNotMatch(source, /ExecutiveOrchestrator|ExecutiveBrain|transitionMission|transitionTask|addTask/);
  assert.doesNotMatch(source, /new Map|\bMap\(/);
});

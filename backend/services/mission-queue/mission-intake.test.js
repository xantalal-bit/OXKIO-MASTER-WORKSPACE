'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createClientZeroBootstrapProvider,
  createMembershipResolver,
} = require('../../security/membership-resolver');
const {
  DOMAIN_EVENT_TYPES,
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
const { MissionService } = require('./mission-service');
const { MissionIntakeError, createMissionIntake } = require('./mission-intake');

const USER_A = 'firebase-user-intake-alpha';
const USER_B = 'firebase-user-intake-beta';
const MEMBERSHIP_A = Object.freeze({
  tenantId: 'tenant-intake-alpha',
  clientId: 'client-intake-alpha',
  userId: USER_A,
  roles: Object.freeze(['owner']),
  status: 'ACTIVE',
});

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
    const mission = this.missionsByScope.get(scopeKey(scope))?.get(validateIdentifier(missionId, 'missionId'));
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

function activeProvider(membership = MEMBERSHIP_A) {
  return { findMemberships: async () => [membership] };
}

function confirmedPlan(overrides = {}) {
  return {
    missionId: 'mission-intake-alpha',
    title: 'Synthetic confirmed Mission',
    objective: 'Persist one confirmed synthetic objective',
    scope: 'Synthetic Mission Intake test',
    projectId: 'project-intake-alpha',
    workspaceId: 'workspace-intake-alpha',
    priority: 'normal',
    acceptanceCriteria: [{
      criterionId: 'criterion-intake-alpha',
      description: 'The confirmed Mission is persisted once',
    }],
    sourceInteractionId: 'interaction-intake-alpha',
    nextAction: 'Await an explicitly authorized later phase',
    ...overrides,
  };
}

function intakeInput(overrides = {}) {
  return {
    authenticatedUserId: USER_A,
    confirmed: true,
    confirmedPlan: confirmedPlan(),
    idempotencyKey: 'idempotency-intake-alpha',
    ...overrides,
  };
}

function createHarness({ provider = activeProvider(), repository = new FakeMissionRepository() } = {}) {
  const membershipResolver = createMembershipResolver({ provider });
  const missionService = new MissionService({ repository });
  const intake = createMissionIntake({ membershipResolver, missionService });
  return { intake, membershipResolver, missionService, repository };
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => error && error.code === code);
}

test('creates one scoped PROPOSED Mission from an explicitly confirmed plan', async () => {
  const { intake, repository } = createHarness();
  const result = await intake.createMissionFromConfirmedPlan(intakeInput());
  assert.equal(result.created, true);
  assert.equal(result.mission.status, MISSION_STATES.PROPOSED);
  assert.equal(result.mission.requester, USER_A);
  assert.equal(result.mission.clientId, MEMBERSHIP_A.clientId);
  assert.deepEqual(result.events.map((event) => event.eventType), [DOMAIN_EVENT_TYPES.MISSION_CREATED]);
  assert.equal(repository.createCalls, 1);
});

test('uses CLIENT_ZERO_BOOTSTRAP through the same MembershipResolver contract', async () => {
  const provider = createClientZeroBootstrapProvider({
    enabled: true,
    authenticatedUserId: USER_A,
    membership: MEMBERSHIP_A,
  });
  const { intake } = createHarness({ provider });
  assert.equal((await intake.createMissionFromConfirmedPlan(intakeInput())).created, true);
});

test('fails closed for absent, inactive, or ambiguous membership', async () => {
  const cases = [
    { findMemberships: async () => [] },
    activeProvider({ ...MEMBERSHIP_A, status: 'SUSPENDED' }),
    activeProvider({ ...MEMBERSHIP_A, status: 'REVOKED' }),
    { findMemberships: async () => [MEMBERSHIP_A, { ...MEMBERSHIP_A }] },
  ];
  for (const provider of cases) {
    const { intake } = createHarness({ provider });
    await assert.rejects(intake.createMissionFromConfirmedPlan(intakeInput()));
  }
});

test('fails closed for absent authenticatedUserId', async () => {
  const { intake } = createHarness();
  await expectCode(
    intake.createMissionFromConfirmedPlan(intakeInput({ authenticatedUserId: undefined })),
    'membership_identity_invalid',
  );
});

test('rejects all authority and metadata injected into confirmedPlan before membership resolution', async () => {
  const fields = ['tenantId', 'clientId', 'userId', 'requester', 'status', 'roles', 'metadata'];
  for (const field of fields) {
    let providerCalls = 0;
    const provider = { findMemberships: async () => { providerCalls += 1; return [MEMBERSHIP_A]; } };
    const { intake } = createHarness({ provider });
    await expectCode(
      intake.createMissionFromConfirmedPlan(intakeInput({
        confirmedPlan: confirmedPlan({ [field]: field === 'status' ? 'RUNNING' : 'injected' }),
      })),
      'mission_intake_plan_invalid',
    );
    assert.equal(providerCalls, 0);
  }
});

test('rejects READY and RUNNING status injection equally', async () => {
  const { intake } = createHarness();
  for (const status of ['READY', 'RUNNING']) {
    await expectCode(
      intake.createMissionFromConfirmedPlan(intakeInput({
        confirmedPlan: confirmedPlan({ status }),
      })),
      'mission_intake_plan_invalid',
    );
  }
});

test('requires an explicit stable idempotencyKey and never generates one', async () => {
  const { intake, repository } = createHarness();
  for (const idempotencyKey of [undefined, '', '   ']) {
    await expectCode(
      intake.createMissionFromConfirmedPlan(intakeInput({ idempotencyKey })),
      'mission_intake_idempotency_invalid',
    );
  }
  assert.equal(repository.createCalls, 0);
});

test('retry with the same key and Mission returns created false without duplicate event', async () => {
  const { intake, repository } = createHarness();
  const first = await intake.createMissionFromConfirmedPlan(intakeInput());
  const retry = await intake.createMissionFromConfirmedPlan(intakeInput());
  assert.equal(first.created, true);
  assert.equal(retry.created, false);
  assert.deepEqual(retry.events, []);
  assert.equal((await repository.list(MEMBERSHIP_A)).length, 1);
});

test('same key with a different missionId fails with idempotency_conflict', async () => {
  const { intake } = createHarness();
  await intake.createMissionFromConfirmedPlan(intakeInput());
  await expectCode(
    intake.createMissionFromConfirmedPlan(intakeInput({
      confirmedPlan: confirmedPlan({ missionId: 'mission-intake-different' }),
    })),
    'idempotency_conflict',
  );
});

test('the same idempotencyKey remains independent in another resolved scope', async () => {
  const membershipB = {
    tenantId: 'tenant-intake-beta', clientId: 'client-intake-beta', userId: USER_B,
    roles: ['owner'], status: 'ACTIVE',
  };
  const repository = new FakeMissionRepository();
  const provider = {
    findMemberships: async ({ authenticatedUserId }) => (
      authenticatedUserId === USER_A ? [MEMBERSHIP_A] : [membershipB]
    ),
  };
  const { intake } = createHarness({ provider, repository });
  const first = await intake.createMissionFromConfirmedPlan(intakeInput());
  const second = await intake.createMissionFromConfirmedPlan(intakeInput({
    authenticatedUserId: USER_B,
    confirmedPlan: confirmedPlan({ missionId: 'mission-intake-beta' }),
  }));
  assert.equal(first.created, true);
  assert.equal(second.created, true);
  assert.equal(repository.createCalls, 2);
});

test('propagates MissionService, repository, and membership provider failure without fallback', async () => {
  const serviceFailure = Object.assign(new Error('synthetic service failure'), { code: 'service_failed' });
  const intakeWithFailedService = createMissionIntake({
    membershipResolver: createMembershipResolver({ provider: activeProvider() }),
    missionService: { createMission: async () => { throw serviceFailure; } },
  });
  await expectCode(intakeWithFailedService.createMissionFromConfirmedPlan(intakeInput()), 'service_failed');

  const repositoryFailure = Object.assign(new Error('synthetic repository failure'), { code: 'repository_failed' });
  const { intake: intakeWithFailedRepository } = createHarness({
    repository: new FakeMissionRepository({ failCreate: repositoryFailure }),
  });
  await expectCode(intakeWithFailedRepository.createMissionFromConfirmedPlan(intakeInput()), 'repository_failed');

  const { intake: intakeWithFailedProvider } = createHarness({
    provider: { findMemberships: async () => { throw new Error('synthetic provider failure'); } },
  });
  await expectCode(
    intakeWithFailedProvider.createMissionFromConfirmedPlan(intakeInput()),
    'membership_provider_unavailable',
  );
});

test('requires every confirmed plan field to be present and explicit', async () => {
  const required = [
    'missionId', 'title', 'objective', 'scope', 'projectId', 'workspaceId', 'priority',
    'acceptanceCriteria', 'sourceInteractionId', 'nextAction',
  ];
  for (const field of required) {
    const plan = confirmedPlan();
    delete plan[field];
    const { intake } = createHarness();
    await expectCode(
      intake.createMissionFromConfirmedPlan(intakeInput({ confirmedPlan: plan })),
      'mission_intake_plan_invalid',
    );

    const undefinedPlan = confirmedPlan({ [field]: undefined });
    await expectCode(
      intake.createMissionFromConfirmedPlan(intakeInput({ confirmedPlan: undefinedPlan })),
      'mission_intake_plan_invalid',
    );
  }
});

test('accepts workspaceId null because the Mission contract permits it', async () => {
  const { intake } = createHarness();
  const result = await intake.createMissionFromConfirmedPlan(intakeInput({
    confirmedPlan: confirmedPlan({ workspaceId: null }),
  }));
  assert.equal(result.mission.workspaceId, null);
});

test('requires explicit confirmation before membership lookup or Mission creation', async () => {
  let providerCalls = 0;
  const provider = { findMemberships: async () => { providerCalls += 1; return [MEMBERSHIP_A]; } };
  const { intake, repository } = createHarness({ provider });
  for (const confirmed of [undefined, false, 'true', 'confirmed']) {
    await expectCode(
      intake.createMissionFromConfirmedPlan(intakeInput({ confirmed })),
      'mission_intake_not_confirmed',
    );
  }
  assert.equal(providerCalls, 0);
  assert.equal(repository.createCalls, 0);
});

test('rejects a multi-objective value before membership lookup', async () => {
  let providerCalls = 0;
  const provider = { findMemberships: async () => { providerCalls += 1; return [MEMBERSHIP_A]; } };
  const { intake } = createHarness({ provider });
  await expectCode(
    intake.createMissionFromConfirmedPlan(intakeInput({
      confirmedPlan: confirmedPlan({ objective: ['first', 'second'] }),
    })),
    'mission_intake_plan_invalid',
  );
  assert.equal(providerCalls, 0);
});

test('invokes MissionService exactly once and passes a frozen resolved scope', async () => {
  const membershipResolver = createMembershipResolver({ provider: activeProvider() });
  let calls = 0;
  const missionService = {
    createMission: async (scope) => {
      calls += 1;
      assert.equal(Object.isFrozen(scope), true);
      assert.equal(Object.isFrozen(scope.roles), true);
      assert.throws(() => { scope.clientId = 'client-mutated'; }, TypeError);
      return { created: true, mission: { status: 'PROPOSED' }, events: [] };
    },
  };
  const intake = createMissionIntake({ membershipResolver, missionService });
  await intake.createMissionFromConfirmedPlan(intakeInput());
  assert.equal(calls, 1);
});

test('maps only approved plan fields and derives clientId from MissionScope', async () => {
  const membershipResolver = createMembershipResolver({ provider: activeProvider() });
  let observed;
  const missionService = {
    createMission: async (scope, payload, options) => {
      observed = { scope, payload, options };
      return { created: true, mission: { status: 'PROPOSED' }, events: [] };
    },
  };
  const intake = createMissionIntake({ membershipResolver, missionService });
  await intake.createMissionFromConfirmedPlan(intakeInput());
  assert.deepEqual(Object.keys(observed.payload).sort(), [
    'acceptanceCriteria', 'clientId', 'missionId', 'nextAction', 'objective', 'priority',
    'projectId', 'scope', 'sourceInteractionId', 'title', 'workspaceId',
  ]);
  assert.equal(observed.payload.clientId, MEMBERSHIP_A.clientId);
  assert.equal(Object.hasOwn(observed.payload, 'tenantId'), false);
  assert.equal(Object.hasOwn(observed.payload, 'userId'), false);
  assert.equal(Object.hasOwn(observed.payload, 'requester'), false);
  assert.deepEqual(observed.options, { idempotencyKey: 'idempotency-intake-alpha' });
});

test('rejects any MissionService result outside PROPOSED', async () => {
  const membershipResolver = createMembershipResolver({ provider: activeProvider() });
  for (const status of ['READY', 'RUNNING', 'COMPLETED']) {
    const intake = createMissionIntake({
      membershipResolver,
      missionService: {
        createMission: async () => ({ created: true, mission: { status }, events: [] }),
      },
    });
    await expectCode(
      intake.createMissionFromConfirmedPlan(intakeInput()),
      'mission_intake_result_invalid',
    );
  }
});

test('returns only created, mission, and events from MissionService', async () => {
  const membershipResolver = createMembershipResolver({ provider: activeProvider() });
  const intake = createMissionIntake({
    membershipResolver,
    missionService: {
      createMission: async () => ({
        created: true,
        mission: { status: 'PROPOSED' },
        events: [],
        privateMetadata: 'must-not-cross-boundary',
      }),
    },
  });
  const result = await intake.createMissionFromConfirmedPlan(intakeInput());
  assert.deepEqual(Object.keys(result).sort(), ['created', 'events', 'mission']);
  assert.equal(Object.isFrozen(result), true);
});

test('rejects missing dependencies and caller authority fields without fallback', async () => {
  assert.throws(() => createMissionIntake(), {
    code: 'mission_intake_dependencies_invalid',
  });
  const { intake } = createHarness();
  for (const field of ['tenantId', 'clientId', 'userId', 'roles', 'requester', 'status']) {
    await expectCode(
      intake.createMissionFromConfirmedPlan({ ...intakeInput(), [field]: 'injected' }),
      'mission_intake_input_invalid',
    );
  }
});

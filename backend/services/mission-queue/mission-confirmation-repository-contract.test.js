'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  CONFIRMATION_STATUSES,
  createMissionConfirmation,
  transitionMissionConfirmation,
  validateMissionConfirmation,
} = require('./mission-confirmation-contract');
const {
  CONFIRMATION_REPOSITORY_METHODS,
  ConfirmationRepositoryError,
  assertConfirmationRepository,
  assertConfirmationScope,
  assertConfirmationUpdate,
  normalizeConfirmationId,
  normalizeConfirmationScope,
  normalizeConsumeLease,
  normalizeExpectedVersion,
  normalizeLeaseId,
  normalizeOperationTime,
  repositoryFail,
} = require('./mission-confirmation-repository-contract');

const CREATED = '2026-08-03T08:00:00.000Z';
const CONFIRMED = '2026-08-03T08:05:00.000Z';
const LEASE_EXPIRES = '2026-08-03T08:15:00.000Z';
const EXPIRES = '2026-08-03T09:00:00.000Z';
const SCOPE = Object.freeze({
  tenantId: 'tenant-repository-test',
  userId: 'user-repository-test',
  clientId: 'client-repository-test',
});

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

function scopeKey(scope) {
  const normalized = normalizeConfirmationScope(scope);
  return JSON.stringify([normalized.tenantId, normalized.userId, normalized.clientId]);
}

function plan(suffix = 'alpha') {
  return {
    title: `Synthetic confirmation ${suffix}`,
    objective: `Validate repository contract ${suffix}`,
    scope: 'Pure fake repository test',
    projectId: `project-repository-${suffix}`,
    workspaceId: `workspace-repository-${suffix}`,
    priority: 'normal',
    acceptanceCriteria: [{
      criterionId: `criterion-repository-${suffix}`,
      description: 'Repository behavior is deterministic',
    }],
    sourceInteractionId: `interaction-repository-${suffix}`,
    nextAction: 'Await a separately authorized persistence phase',
  };
}

function confirmationFor(scope = SCOPE, suffix = 'alpha', overrides = {}) {
  const confirmationId = `confirmation-repository-${suffix}`;
  return createMissionConfirmation({
    confirmationId,
    tenantId: scope.tenantId,
    userId: scope.userId,
    clientId: scope.clientId,
    missionId: `mission-repository-${suffix}`,
    idempotencyKey: `mission-confirmation:v1:${confirmationId}`,
    planSnapshot: plan(suffix),
    planSchemaVersion: 1,
    expiresAt: EXPIRES,
    ...overrides,
  }, { now: CREATED });
}

function confirmed(confirmation = confirmationFor()) {
  return transitionMissionConfirmation(
    confirmation,
    CONFIRMATION_STATUSES.CONFIRMED,
    { now: CONFIRMED },
  );
}

function sameCreateIntent(left, right) {
  const fields = [
    'confirmationId', 'tenantId', 'userId', 'clientId', 'missionId',
    'idempotencyKey', 'planSnapshot', 'planSchemaVersion', 'expiresAt',
  ];
  return fields.every((field) => JSON.stringify(left[field]) === JSON.stringify(right[field]));
}

class FakeConfirmationRepository {
  constructor({ unavailable = false, unknownCommit = false } = {}) {
    this.unavailable = unavailable;
    this.unknownCommit = unknownCommit;
    this.records = new Map();
    this.missions = new Map();
    this.leases = new Map();
  }

  bucket(scope) {
    const key = scopeKey(scope);
    if (!this.records.has(key)) this.records.set(key, new Map());
    if (!this.missions.has(key)) this.missions.set(key, new Map());
    if (!this.leases.has(key)) this.leases.set(key, new Map());
    return {
      records: this.records.get(key),
      missions: this.missions.get(key),
      leases: this.leases.get(key),
    };
  }

  failIfConfigured() {
    if (this.unavailable) {
      repositoryFail('confirmation_repository_unavailable', 'Repository is unavailable.');
    }
  }

  async create(scope, confirmation) {
    this.failIfConfigured();
    const normalizedScope = assertConfirmationScope(confirmation, scope);
    const bucket = this.bucket(normalizedScope);
    const existing = bucket.records.get(confirmation.confirmationId);
    if (existing) {
      if (!sameCreateIntent(existing, confirmation)) {
        repositoryFail('confirmation_conflict', 'Confirmation identity is already bound.');
      }
      return { confirmation: copy(existing), created: false };
    }
    const missionOwner = bucket.missions.get(confirmation.missionId);
    if (missionOwner && missionOwner !== confirmation.confirmationId) {
      repositoryFail('confirmation_mission_conflict', 'Mission already has a Confirmation.');
    }
    bucket.records.set(confirmation.confirmationId, copy(confirmation));
    bucket.missions.set(confirmation.missionId, confirmation.confirmationId);
    if (this.unknownCommit) {
      repositoryFail('confirmation_unknown_commit_result', 'Commit result is unknown.');
    }
    return { confirmation: copy(confirmation), created: true };
  }

  async get(scope, confirmationId) {
    this.failIfConfigured();
    const record = this.bucket(scope).records.get(normalizeConfirmationId(confirmationId));
    if (!record) repositoryFail('confirmation_not_found', 'Confirmation was not found.');
    return copy(record);
  }

  async saveIfVersion(scope, confirmation, expectedVersion, now) {
    this.failIfConfigured();
    const normalizedScope = assertConfirmationScope(confirmation, scope);
    const expected = normalizeExpectedVersion(expectedVersion);
    const operationTime = normalizeOperationTime(now);
    const bucket = this.bucket(normalizedScope);
    const stored = bucket.records.get(confirmation.confirmationId);
    if (!stored) repositoryFail('confirmation_not_found', 'Confirmation was not found.');
    if (stored.version !== expected) {
      repositoryFail('confirmation_version_conflict', 'Confirmation version conflict.');
    }
    const lease = bucket.leases.get(confirmation.confirmationId);
    if (lease && Date.parse(lease.expiresAt) > Date.parse(operationTime)) {
      repositoryFail('confirmation_lease_conflict', 'Confirmation has an active consume lease.');
    }
    if (lease) bucket.leases.delete(confirmation.confirmationId);
    assertConfirmationUpdate(stored, confirmation);
    bucket.records.set(confirmation.confirmationId, copy(confirmation));
    return copy(confirmation);
  }

  async acquireConsumeLease(scope, confirmationId, expectedVersion, rawLease) {
    this.failIfConfigured();
    const expected = normalizeExpectedVersion(expectedVersion);
    const lease = normalizeConsumeLease(rawLease);
    const bucket = this.bucket(scope);
    const stored = bucket.records.get(normalizeConfirmationId(confirmationId));
    if (!stored) repositoryFail('confirmation_not_found', 'Confirmation was not found.');
    if (stored.version !== expected) {
      repositoryFail('confirmation_version_conflict', 'Confirmation version conflict.');
    }
    if (stored.status !== CONFIRMATION_STATUSES.CONFIRMED) {
      repositoryFail('confirmation_transition_invalid', 'Confirmation is not consumable.');
    }
    const active = bucket.leases.get(confirmationId);
    if (active && Date.parse(active.expiresAt) > Date.parse(lease.acquiredAt)) {
      repositoryFail('confirmation_lease_conflict', 'Consume lease is active.');
    }
    bucket.leases.set(confirmationId, copy(lease));
    return copy(lease);
  }

  async releaseConsumeLease(scope, confirmationId, leaseId) {
    this.failIfConfigured();
    const normalizedId = normalizeConfirmationId(confirmationId);
    const normalizedLeaseId = normalizeLeaseId(leaseId);
    const bucket = this.bucket(scope);
    if (!bucket.records.has(normalizedId)) {
      repositoryFail('confirmation_not_found', 'Confirmation was not found.');
    }
    const active = bucket.leases.get(normalizedId);
    if (!active || active.leaseId !== normalizedLeaseId) {
      repositoryFail('confirmation_lease_invalid', 'Consume lease is invalid.');
    }
    bucket.leases.delete(normalizedId);
    return { released: true };
  }

  async consumeIfLeased(scope, confirmation, expectedVersion, leaseId) {
    this.failIfConfigured();
    const normalizedScope = assertConfirmationScope(confirmation, scope);
    const expected = normalizeExpectedVersion(expectedVersion);
    const normalizedLeaseId = normalizeLeaseId(leaseId);
    const bucket = this.bucket(normalizedScope);
    const stored = bucket.records.get(confirmation.confirmationId);
    if (!stored) repositoryFail('confirmation_not_found', 'Confirmation was not found.');
    if (stored.version !== expected) {
      repositoryFail('confirmation_version_conflict', 'Confirmation version conflict.');
    }
    const active = bucket.leases.get(confirmation.confirmationId);
    if (!active || active.leaseId !== normalizedLeaseId
      || Date.parse(active.expiresAt) <= Date.parse(confirmation.consumedAt)
      || Date.parse(active.acquiredAt) > Date.parse(confirmation.consumedAt)) {
      repositoryFail('confirmation_lease_invalid', 'Consume lease is invalid.');
    }
    assertConfirmationUpdate(stored, confirmation);
    bucket.records.set(confirmation.confirmationId, copy(confirmation));
    bucket.leases.delete(confirmation.confirmationId);
    return copy(confirmation);
  }
}

test('defines only six scoped V1 operations and rejects unsafe repository surfaces', () => {
  assert.deepEqual(CONFIRMATION_REPOSITORY_METHODS, [
    'create', 'get', 'saveIfVersion', 'acquireConsumeLease',
    'releaseConsumeLease', 'consumeIfLeased',
  ]);
  const repository = new FakeConfirmationRepository();
  assert.equal(assertConfirmationRepository(repository), repository);
  for (const method of ['delete', 'hardDelete', 'globalList', 'listAll', 'findAcrossTenants',
    'bypassScope', 'getByMissionId']) {
    assert.equal(repository[method], undefined);
  }
  assert.throws(() => assertConfirmationRepository({}), {
    code: 'invalid_confirmation_repository',
  });
  assert.throws(() => assertConfirmationRepository({
    ...Object.fromEntries(CONFIRMATION_REPOSITORY_METHODS.map((method) => [method, () => {}])),
    delete() {},
  }), { code: 'unsafe_confirmation_repository' });
});

test('normalizes only triple scope, positive versions, opaque IDs, and canonical leases', () => {
  assert.deepEqual(normalizeConfirmationScope(SCOPE), SCOPE);
  assert.equal(normalizeExpectedVersion(1), 1);
  assert.equal(normalizeConfirmationId('confirmation-valid'), 'confirmation-valid');
  assert.equal(normalizeLeaseId('lease-valid'), 'lease-valid');
  assert.equal(normalizeOperationTime(CREATED), CREATED);
  assert.deepEqual(normalizeConsumeLease({
    leaseId: 'lease-valid', acquiredAt: CONFIRMED, expiresAt: LEASE_EXPIRES,
  }), { leaseId: 'lease-valid', acquiredAt: CONFIRMED, expiresAt: LEASE_EXPIRES });
  for (const invalid of [undefined, {}, { ...SCOPE, roles: [] }]) {
    assert.throws(() => normalizeConfirmationScope(invalid), { code: 'confirmation_scope_invalid' });
  }
  for (const invalid of [undefined, 0, -1, 1.5, '1']) {
    assert.throws(() => normalizeExpectedVersion(invalid), { code: 'confirmation_version_invalid' });
  }
});

test('creates idempotently, gets by scope, and enforces one Confirmation per Mission', async () => {
  const repository = new FakeConfirmationRepository();
  const confirmation = confirmationFor();
  assert.equal((await repository.create(SCOPE, confirmation)).created, true);
  assert.equal((await repository.create(SCOPE, confirmation)).created, false);
  assert.equal((await repository.get(SCOPE, confirmation.confirmationId)).missionId,
    confirmation.missionId);

  const conflictingId = confirmationFor(SCOPE, 'other', {
    missionId: confirmation.missionId,
  });
  await assert.rejects(repository.create(SCOPE, conflictingId), {
    code: 'confirmation_mission_conflict',
  });

  const conflictingPlan = confirmationFor(SCOPE, 'alpha', {
    planSnapshot: plan('changed'),
  });
  await assert.rejects(repository.create(SCOPE, conflictingPlan), {
    code: 'confirmation_conflict',
  });
});

test('isolates tenant, user, and client without cross-scope leakage', async () => {
  const repository = new FakeConfirmationRepository();
  const confirmation = confirmationFor();
  await repository.create(SCOPE, confirmation);
  const foreignScopes = [
    { ...SCOPE, tenantId: 'tenant-foreign' },
    { ...SCOPE, userId: 'user-foreign' },
    { ...SCOPE, clientId: 'client-foreign' },
  ];
  for (const foreign of foreignScopes) {
    await assert.rejects(repository.get(foreign, confirmation.confirmationId), {
      code: 'confirmation_not_found',
    });
    await assert.rejects(repository.get(foreign, confirmation.missionId), {
      code: 'confirmation_not_found',
    });
    const candidate = transitionMissionConfirmation(
      confirmation,
      CONFIRMATION_STATUSES.CONFIRMED,
      { now: CONFIRMED },
    );
    await assert.rejects(
      repository.saveIfVersion(foreign, candidate, 1, CONFIRMED),
      { code: 'confirmation_scope_mismatch' },
    );
  }
});

test('saveIfVersion enforces CAS, immutable data, and one winning writer', async () => {
  const repository = new FakeConfirmationRepository();
  const pending = confirmationFor();
  await repository.create(SCOPE, pending);
  const left = transitionMissionConfirmation(
    await repository.get(SCOPE, pending.confirmationId),
    CONFIRMATION_STATUSES.CONFIRMED,
    { now: CONFIRMED },
  );
  const right = copy(left);
  const results = await Promise.allSettled([
    repository.saveIfVersion(SCOPE, left, 1, CONFIRMED),
    repository.saveIfVersion(SCOPE, right, 1, CONFIRMED),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.find((result) => result.status === 'rejected').reason.code,
    'confirmation_version_conflict');

  const tampered = copy(left);
  tampered.version = 3;
  tampered.planSnapshot.title = 'Tampered but structurally valid title';
  await assert.rejects(repository.saveIfVersion(SCOPE, tampered, 2, CONFIRMED), {
    code: 'confirmation_update_invalid',
  });
});

test('immutable snapshot comparison is structural and independent of JSON key order', () => {
  const previous = confirmationFor();
  const next = copy(transitionMissionConfirmation(
    previous,
    CONFIRMATION_STATUSES.CONFIRMED,
    { now: CONFIRMED },
  ));
  const original = next.planSnapshot;
  next.planSnapshot = {
    nextAction: original.nextAction,
    sourceInteractionId: original.sourceInteractionId,
    acceptanceCriteria: original.acceptanceCriteria,
    priority: original.priority,
    workspaceId: original.workspaceId,
    projectId: original.projectId,
    scope: original.scope,
    objective: original.objective,
    title: original.title,
  };
  assert.equal(assertConfirmationUpdate(previous, next), next);
});

test('acquires one lease, rejects a second active lease, and replaces an expired lease', async () => {
  const repository = new FakeConfirmationRepository();
  const value = confirmed();
  await repository.create(SCOPE, value);
  const first = { leaseId: 'lease-first', acquiredAt: CONFIRMED, expiresAt: LEASE_EXPIRES };
  const second = {
    leaseId: 'lease-second',
    acquiredAt: '2026-08-03T08:10:00.000Z',
    expiresAt: '2026-08-03T08:20:00.000Z',
  };
  assert.equal((await repository.acquireConsumeLease(SCOPE, value.confirmationId, 2, first)).leaseId,
    first.leaseId);
  await assert.rejects(
    repository.acquireConsumeLease(SCOPE, value.confirmationId, 2, second),
    { code: 'confirmation_lease_conflict' },
  );
  const replacement = {
    leaseId: 'lease-replacement',
    acquiredAt: LEASE_EXPIRES,
    expiresAt: '2026-08-03T08:25:00.000Z',
  };
  assert.equal((await repository.acquireConsumeLease(
    SCOPE, value.confirmationId, 2, replacement,
  )).leaseId, replacement.leaseId);
});

test('requires the exact lease for release and removes it on success', async () => {
  const repository = new FakeConfirmationRepository();
  const value = confirmed();
  await repository.create(SCOPE, value);
  await repository.acquireConsumeLease(SCOPE, value.confirmationId, 2, {
    leaseId: 'lease-release', acquiredAt: CONFIRMED, expiresAt: LEASE_EXPIRES,
  });
  await assert.rejects(
    repository.releaseConsumeLease(SCOPE, value.confirmationId, 'lease-wrong'),
    { code: 'confirmation_lease_invalid' },
  );
  assert.deepEqual(
    await repository.releaseConsumeLease(SCOPE, value.confirmationId, 'lease-release'),
    { released: true },
  );
});

test('consumes atomically only with the active lease and retires it', async () => {
  const repository = new FakeConfirmationRepository();
  const value = confirmed();
  await repository.create(SCOPE, value);
  await repository.acquireConsumeLease(SCOPE, value.confirmationId, 2, {
    leaseId: 'lease-consume', acquiredAt: CONFIRMED, expiresAt: LEASE_EXPIRES,
  });
  const consumed = transitionMissionConfirmation(
    value,
    CONFIRMATION_STATUSES.CONSUMED,
    { now: '2026-08-03T08:10:00.000Z' },
  );
  await assert.rejects(repository.consumeIfLeased(SCOPE, consumed, 2, 'lease-wrong'), {
    code: 'confirmation_lease_invalid',
  });
  assert.equal((await repository.consumeIfLeased(
    SCOPE, consumed, 2, 'lease-consume',
  )).status, CONFIRMATION_STATUSES.CONSUMED);
  await assert.rejects(
    repository.releaseConsumeLease(SCOPE, value.confirmationId, 'lease-consume'),
    { code: 'confirmation_lease_invalid' },
  );
});

test('blocks ordinary save while lease is active and permits it after lease expiration', async () => {
  const repository = new FakeConfirmationRepository();
  const value = confirmed();
  await repository.create(SCOPE, value);
  await repository.acquireConsumeLease(SCOPE, value.confirmationId, 2, {
    leaseId: 'lease-revoke', acquiredAt: CONFIRMED, expiresAt: LEASE_EXPIRES,
  });
  const revoked = transitionMissionConfirmation(
    value,
    CONFIRMATION_STATUSES.REVOKED,
    { now: '2026-08-03T08:10:00.000Z' },
  );
  await assert.rejects(repository.saveIfVersion(
    SCOPE, revoked, 2, '2026-08-03T08:10:00.000Z',
  ), { code: 'confirmation_lease_conflict' });
  const afterExpiry = transitionMissionConfirmation(
    value,
    CONFIRMATION_STATUSES.REVOKED,
    { now: LEASE_EXPIRES },
  );
  assert.equal((await repository.saveIfVersion(
    SCOPE, afterExpiry, 2, LEASE_EXPIRES,
  )).status, CONFIRMATION_STATUSES.REVOKED);
});

test('isolates stored data from mutable references and validates update identity', async () => {
  const repository = new FakeConfirmationRepository();
  const value = confirmationFor();
  const created = await repository.create(SCOPE, value);
  created.confirmation.status = 'MUTATED';
  assert.equal((await repository.get(SCOPE, value.confirmationId)).status,
    CONFIRMATION_STATUSES.PENDING);
  const loaded = await repository.get(SCOPE, value.confirmationId);
  loaded.planSnapshot.title = 'Mutated loaded copy';
  assert.notEqual((await repository.get(SCOPE, value.confirmationId)).planSnapshot.title,
    loaded.planSnapshot.title);
  assert.throws(() => assertConfirmationScope(value, { ...SCOPE, userId: 'user-foreign' }), {
    code: 'confirmation_scope_mismatch',
  });
});

test('models repository unavailable and unknown commit without fallback', async () => {
  const unavailable = new FakeConfirmationRepository({ unavailable: true });
  await assert.rejects(unavailable.get(SCOPE, 'confirmation-repository-alpha'), {
    code: 'confirmation_repository_unavailable',
  });
  const uncertain = new FakeConfirmationRepository({ unknownCommit: true });
  await assert.rejects(uncertain.create(SCOPE, confirmationFor()), {
    code: 'confirmation_unknown_commit_result',
  });
  assert.equal((await uncertain.get(SCOPE, 'confirmation-repository-alpha')).confirmationId,
    'confirmation-repository-alpha');
});

test('repository errors are stable and sanitized', () => {
  const error = new ConfirmationRepositoryError('confirmation_not_found');
  assert.equal(error.code, 'confirmation_not_found');
  assert.equal(error.message.includes('repository-alpha'), false);
  assert.throws(() => normalizeConsumeLease({
    leaseId: 'lease-invalid', acquiredAt: LEASE_EXPIRES, expiresAt: CONFIRMED,
  }), { code: 'confirmation_lease_invalid' });
  assert.throws(() => validateMissionConfirmation({}), { code: 'confirmation_input_invalid' });
});

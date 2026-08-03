'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  CONFIRMATION_STATUSES,
  transitionMissionConfirmation,
  validateMissionConfirmation,
} = require('./mission-confirmation-contract');
const {
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
const { ConfirmationService, ConfirmationServiceError } = require('./mission-confirmation-service');

const CREATED = '2026-08-03T10:00:00.000Z';
const CONFIRMED = '2026-08-03T10:05:00.000Z';
const CONSUMED = '2026-08-03T10:10:00.000Z';
const LEASE_EXPIRES = '2026-08-03T10:20:00.000Z';
const EXPIRES = '2026-08-03T11:00:00.000Z';
const SCOPE = Object.freeze({
  tenantId: 'tenant-service-test',
  userId: 'user-service-test',
  clientId: 'client-service-test',
});

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
}

function scopeKey(scope) {
  const normalized = normalizeConfirmationScope(scope);
  return JSON.stringify([normalized.tenantId, normalized.userId, normalized.clientId]);
}

function plan(suffix = 'alpha') {
  return {
    title: `Synthetic service plan ${suffix}`,
    objective: `Coordinate Confirmation ${suffix} without creating a Mission`,
    scope: 'Pure ConfirmationService test',
    projectId: `project-service-${suffix}`,
    workspaceId: `workspace-service-${suffix}`,
    priority: 'normal',
    acceptanceCriteria: [{
      criterionId: `criterion-service-${suffix}`,
      description: 'Application behavior remains safe and deterministic',
    }],
    sourceInteractionId: `interaction-service-${suffix}`,
    nextAction: 'Await an explicitly authorized persistence phase',
  };
}

function createInput(suffix = 'alpha', overrides = {}) {
  return {
    planSnapshot: plan(suffix),
    planSchemaVersion: 1,
    expiresAt: EXPIRES,
    ...overrides,
  };
}

function sameCreateIntent(left, right) {
  const fields = [
    'confirmationId', 'tenantId', 'userId', 'clientId', 'missionId',
    'idempotencyKey', 'planSnapshot', 'planSchemaVersion', 'expiresAt',
  ];
  return fields.every((field) => JSON.stringify(left[field]) === JSON.stringify(right[field]));
}

class FakeConfirmationRepository {
  constructor({ unavailable = false, unknownCommit = false, rawFailure = false } = {}) {
    this.unavailable = unavailable;
    this.unknownCommit = unknownCommit;
    this.rawFailure = rawFailure;
    this.calls = [];
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

  failIfConfigured(operation) {
    this.calls.push(operation);
    if (this.rawFailure) throw new Error('private synthetic repository detail');
    if (this.unavailable) {
      repositoryFail('confirmation_repository_unavailable', 'Repository is unavailable.');
    }
  }

  async create(scope, confirmation) {
    this.failIfConfigured('create');
    const normalizedScope = assertConfirmationScope(confirmation, scope);
    const bucket = this.bucket(normalizedScope);
    const existing = bucket.records.get(confirmation.confirmationId);
    if (existing) {
      if (!sameCreateIntent(existing, confirmation)) {
        repositoryFail('confirmation_conflict', 'Confirmation identity conflict.');
      }
      return { confirmation: copy(existing), created: false };
    }
    const owner = bucket.missions.get(confirmation.missionId);
    if (owner && owner !== confirmation.confirmationId) {
      repositoryFail('confirmation_mission_conflict', 'Mission Confirmation conflict.');
    }
    bucket.records.set(confirmation.confirmationId, copy(confirmation));
    bucket.missions.set(confirmation.missionId, confirmation.confirmationId);
    if (this.unknownCommit) {
      repositoryFail('confirmation_unknown_commit_result', 'Commit result is unknown.');
    }
    return { confirmation: copy(confirmation), created: true };
  }

  async get(scope, confirmationId) {
    this.failIfConfigured('get');
    const value = this.bucket(scope).records.get(normalizeConfirmationId(confirmationId));
    if (!value) repositoryFail('confirmation_not_found', 'Confirmation was not found.');
    return copy(value);
  }

  async saveIfVersion(scope, confirmation, expectedVersion, now) {
    this.failIfConfigured('saveIfVersion');
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
      repositoryFail('confirmation_lease_conflict', 'Consume lease is active.');
    }
    if (lease) bucket.leases.delete(confirmation.confirmationId);
    assertConfirmationUpdate(stored, confirmation);
    bucket.records.set(confirmation.confirmationId, copy(confirmation));
    return copy(confirmation);
  }

  async acquireConsumeLease(scope, confirmationId, expectedVersion, rawLease) {
    this.failIfConfigured('acquireConsumeLease');
    const expected = normalizeExpectedVersion(expectedVersion);
    const lease = normalizeConsumeLease(rawLease);
    const bucket = this.bucket(scope);
    const stored = bucket.records.get(normalizeConfirmationId(confirmationId));
    if (!stored) repositoryFail('confirmation_not_found', 'Confirmation was not found.');
    if (stored.version !== expected) {
      repositoryFail('confirmation_version_conflict', 'Confirmation version conflict.');
    }
    const active = bucket.leases.get(confirmationId);
    if (active && Date.parse(active.expiresAt) > Date.parse(lease.acquiredAt)) {
      repositoryFail('confirmation_lease_conflict', 'Consume lease is active.');
    }
    bucket.leases.set(confirmationId, copy(lease));
    return copy(lease);
  }

  async releaseConsumeLease(scope, confirmationId, leaseId) {
    this.failIfConfigured('releaseConsumeLease');
    const id = normalizeConfirmationId(confirmationId);
    const normalizedLeaseId = normalizeLeaseId(leaseId);
    const bucket = this.bucket(scope);
    if (!bucket.records.has(id)) repositoryFail('confirmation_not_found', 'Confirmation was not found.');
    const active = bucket.leases.get(id);
    if (!active || active.leaseId !== normalizedLeaseId) {
      repositoryFail('confirmation_lease_invalid', 'Consume lease is invalid.');
    }
    bucket.leases.delete(id);
    return { released: true };
  }

  async consumeIfLeased(scope, confirmation, expectedVersion, leaseId) {
    this.failIfConfigured('consumeIfLeased');
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
      || Date.parse(active.expiresAt) <= Date.parse(confirmation.consumedAt)) {
      repositoryFail('confirmation_lease_invalid', 'Consume lease is invalid.');
    }
    assertConfirmationUpdate(stored, confirmation);
    bucket.records.set(confirmation.confirmationId, copy(confirmation));
    bucket.leases.delete(confirmation.confirmationId);
    return copy(confirmation);
  }
}

function harness({
  repository = new FakeConfirmationRepository(),
  initialNow = CREATED,
  confirmationIds = ['confirmation-service-alpha'],
  missionIds = ['mission-service-alpha'],
  leaseIds = ['lease-service-alpha'],
} = {}) {
  let now = initialNow;
  let confirmationIndex = 0;
  let missionIndex = 0;
  let leaseIndex = 0;
  const service = new ConfirmationService({
    repository,
    clock: () => now,
    confirmationIdFactory: () => confirmationIds[Math.min(confirmationIndex++, confirmationIds.length - 1)],
    missionIdFactory: () => missionIds[Math.min(missionIndex++, missionIds.length - 1)],
    leaseIdFactory: () => leaseIds[Math.min(leaseIndex++, leaseIds.length - 1)],
  });
  return { repository, service, setNow: (value) => { now = value; } };
}

async function createStored(value, suffix = 'alpha') {
  return value.service.createConfirmation(SCOPE, createInput(suffix));
}

async function createConfirmed(value) {
  const created = await createStored(value);
  value.setNow(CONFIRMED);
  return value.service.confirmConfirmation(
    SCOPE,
    created.confirmation.confirmationId,
    { expectedVersion: 1 },
  );
}

test('exposes only seven frozen application operations and no dependencies', () => {
  const { service } = harness();
  assert.deepEqual(Object.getOwnPropertyNames(ConfirmationService.prototype), [
    'constructor',
    'createConfirmation',
    'getConfirmation',
    'confirmConfirmation',
    'acquireConsumption',
    'markConsumed',
    'revokeConfirmation',
    'releaseConsumption',
  ]);
  assert.deepEqual(Object.keys(service), []);
  assert.equal(Object.isFrozen(service), true);
  for (const field of ['repository', 'clock', 'confirmationIdFactory', 'missionIdFactory',
    'leaseIdFactory', 'leaseStore', 'state']) {
    assert.equal(service[field], undefined);
  }
});

test('requires complete dependencies and rejects repository surfaces outside the contract', () => {
  assert.throws(() => new ConfirmationService(), {
    code: 'confirmation_service_dependencies_invalid',
  });
  assert.throws(() => new ConfirmationService({
    repository: {}, clock() {}, confirmationIdFactory() {}, missionIdFactory() {}, leaseIdFactory() {},
  }), { code: 'invalid_confirmation_repository' });
});

test('creates a scoped immutable PENDING Confirmation through the pure contract', async () => {
  const value = harness();
  const result = await createStored(value);
  assert.equal(result.created, true);
  assert.equal(result.confirmation.status, CONFIRMATION_STATUSES.PENDING);
  assert.equal(result.confirmation.version, 1);
  assert.equal(result.confirmation.tenantId, SCOPE.tenantId);
  assert.equal(result.confirmation.userId, SCOPE.userId);
  assert.equal(result.confirmation.clientId, SCOPE.clientId);
  assert.equal(result.confirmation.idempotencyKey,
    'mission-confirmation:v1:confirmation-service-alpha');
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.confirmation.planSnapshot), true);
  assert.deepEqual(value.repository.calls, ['create']);
});

test('create requires scope and exact input without caller-supplied authority or IDs', async () => {
  const { service, repository } = harness();
  await assert.rejects(service.createConfirmation(undefined, createInput()), {
    code: 'confirmation_scope_invalid',
  });
  for (const field of ['tenantId', 'userId', 'clientId', 'confirmationId', 'missionId',
    'idempotencyKey', 'status', 'roles']) {
    await assert.rejects(service.createConfirmation(SCOPE, {
      ...createInput(), [field]: 'forged',
    }), { code: 'confirmation_service_input_invalid' });
  }
  assert.equal(repository.calls.length, 0);
});

test('create is idempotent for the same generated identities and rejects changed intent', async () => {
  const value = harness();
  const first = await createStored(value);
  value.setNow('2026-08-03T10:01:00.000Z');
  const retry = await createStored(value);
  assert.equal(first.created, true);
  assert.equal(retry.created, false);
  assert.equal(retry.confirmation.createdAt, first.confirmation.createdAt);
  await assert.rejects(value.service.createConfirmation(SCOPE, createInput('changed')), {
    code: 'confirmation_conflict',
  });
  assert.equal(value.repository.calls.filter((call) => call === 'create').length, 3);
});

test('enforces one Confirmation per Mission in a scope', async () => {
  const value = harness({
    confirmationIds: ['confirmation-service-first', 'confirmation-service-second'],
    missionIds: ['mission-service-shared', 'mission-service-shared'],
  });
  await createStored(value, 'first');
  await assert.rejects(createStored(value, 'second'), {
    code: 'confirmation_mission_conflict',
  });
});

test('gets only within triple scope and does not reveal cross-scope existence', async () => {
  const value = harness();
  const created = await createStored(value);
  const loaded = await value.service.getConfirmation(SCOPE, created.confirmation.confirmationId);
  assert.equal(loaded.confirmationId, created.confirmation.confirmationId);
  for (const foreign of [
    { ...SCOPE, tenantId: 'tenant-foreign' },
    { ...SCOPE, userId: 'user-foreign' },
    { ...SCOPE, clientId: 'client-foreign' },
  ]) {
    await assert.rejects(
      value.service.getConfirmation(foreign, created.confirmation.confirmationId),
      { code: 'confirmation_not_found' },
    );
  }
});

test('isolates confirm, lease, consume, revoke, and release across every scope dimension', async () => {
  const value = harness();
  const confirmedValue = await createConfirmed(value);
  const lease = await value.service.acquireConsumption(
    SCOPE, confirmedValue.confirmationId,
    { expectedVersion: 2, leaseExpiresAt: LEASE_EXPIRES },
  );
  const foreignScopes = [
    { ...SCOPE, tenantId: 'tenant-foreign' },
    { ...SCOPE, userId: 'user-foreign' },
    { ...SCOPE, clientId: 'client-foreign' },
  ];
  for (const foreign of foreignScopes) {
    const operations = [
      value.service.getConfirmation(foreign, confirmedValue.confirmationId),
      value.service.getConfirmation(foreign, confirmedValue.missionId),
      value.service.confirmConfirmation(
        foreign, confirmedValue.confirmationId, { expectedVersion: 2 },
      ),
      value.service.acquireConsumption(foreign, confirmedValue.confirmationId, {
        expectedVersion: 2, leaseExpiresAt: LEASE_EXPIRES,
      }),
      value.service.markConsumed(foreign, confirmedValue.confirmationId, {
        expectedVersion: 2, leaseId: lease.leaseId,
      }),
      value.service.revokeConfirmation(
        foreign, confirmedValue.confirmationId, { expectedVersion: 2 },
      ),
      value.service.releaseConsumption(
        foreign, confirmedValue.confirmationId, { leaseId: lease.leaseId },
      ),
    ];
    for (const operation of operations) {
      await assert.rejects(operation, { code: 'confirmation_not_found' });
    }
  }
});

test('confirms PENDING through CAS and never creates a Mission', async () => {
  const value = harness();
  const confirmedValue = await createConfirmed(value);
  assert.equal(confirmedValue.status, CONFIRMATION_STATUSES.CONFIRMED);
  assert.equal(confirmedValue.version, 2);
  assert.equal(confirmedValue.confirmedAt, CONFIRMED);
  assert.deepEqual(value.repository.calls, ['create', 'get', 'saveIfVersion']);
  assert.equal(value.repository.calls.includes('createMission'), false);
});

test('rejects expired, stale, and double confirmation without silent retry', async () => {
  const expired = harness();
  const created = await createStored(expired);
  expired.setNow(EXPIRES);
  await assert.rejects(expired.service.confirmConfirmation(
    SCOPE, created.confirmation.confirmationId, { expectedVersion: 1 },
  ), { code: 'confirmation_expired' });
  assert.equal(expired.repository.calls.includes('saveIfVersion'), false);

  const value = harness();
  const confirmedValue = await createConfirmed(value);
  await assert.rejects(value.service.confirmConfirmation(
    SCOPE, confirmedValue.confirmationId, { expectedVersion: 1 },
  ), { code: 'confirmation_version_conflict' });
  await assert.rejects(value.service.confirmConfirmation(
    SCOPE, confirmedValue.confirmationId, { expectedVersion: 2 },
  ), { code: 'confirmation_transition_invalid' });
});

test('two simultaneous confirms permit one CAS winner', async () => {
  const value = harness();
  const created = await createStored(value);
  value.setNow(CONFIRMED);
  const results = await Promise.allSettled([
    value.service.confirmConfirmation(SCOPE, created.confirmation.confirmationId, { expectedVersion: 1 }),
    value.service.confirmConfirmation(SCOPE, created.confirmation.confirmationId, { expectedVersion: 1 }),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.find((result) => result.status === 'rejected').reason.code,
    'confirmation_version_conflict');
});

test('acquires one lease only for a non-expired CONFIRMED Confirmation', async () => {
  const value = harness();
  const confirmedValue = await createConfirmed(value);
  const lease = await value.service.acquireConsumption(
    SCOPE,
    confirmedValue.confirmationId,
    { expectedVersion: 2, leaseExpiresAt: LEASE_EXPIRES },
  );
  assert.deepEqual(lease, {
    leaseId: 'lease-service-alpha', acquiredAt: CONFIRMED, expiresAt: LEASE_EXPIRES,
  });
  assert.equal(Object.isFrozen(lease), true);
});

test('rejects acquire from PENDING, terminal, expired, stale, or malformed lease input', async () => {
  const pending = harness();
  const created = await createStored(pending);
  await assert.rejects(pending.service.acquireConsumption(
    SCOPE, created.confirmation.confirmationId,
    { expectedVersion: 1, leaseExpiresAt: LEASE_EXPIRES },
  ), { code: 'confirmation_transition_invalid' });

  const expired = harness();
  const confirmedValue = await createConfirmed(expired);
  expired.setNow(EXPIRES);
  await assert.rejects(expired.service.acquireConsumption(
    SCOPE, confirmedValue.confirmationId,
    { expectedVersion: 2, leaseExpiresAt: '2026-08-03T11:10:00.000Z' },
  ), { code: 'confirmation_expired' });

  const stale = harness();
  const staleConfirmed = await createConfirmed(stale);
  await assert.rejects(stale.service.acquireConsumption(
    SCOPE, staleConfirmed.confirmationId,
    { expectedVersion: 1, leaseExpiresAt: LEASE_EXPIRES },
  ), { code: 'confirmation_version_conflict' });
  await assert.rejects(stale.service.acquireConsumption(
    SCOPE, staleConfirmed.confirmationId,
    { expectedVersion: 2, leaseExpiresAt: CONFIRMED },
  ), { code: 'confirmation_lease_invalid' });

  const terminal = harness();
  const terminalConfirmed = await createConfirmed(terminal);
  terminal.setNow(CONSUMED);
  const revoked = await terminal.service.revokeConfirmation(
    SCOPE, terminalConfirmed.confirmationId, { expectedVersion: 2 },
  );
  await assert.rejects(terminal.service.acquireConsumption(
    SCOPE, revoked.confirmationId,
    { expectedVersion: 3, leaseExpiresAt: LEASE_EXPIRES },
  ), { code: 'confirmation_terminal' });
});

test('two acquire attempts allow one active lease and replace it only after expiration', async () => {
  const value = harness({ leaseIds: ['lease-first', 'lease-second', 'lease-third'] });
  const confirmedValue = await createConfirmed(value);
  const options = { expectedVersion: 2, leaseExpiresAt: LEASE_EXPIRES };
  const results = await Promise.allSettled([
    value.service.acquireConsumption(SCOPE, confirmedValue.confirmationId, options),
    value.service.acquireConsumption(SCOPE, confirmedValue.confirmationId, options),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.find((result) => result.status === 'rejected').reason.code,
    'confirmation_lease_conflict');
  value.setNow(LEASE_EXPIRES);
  const replacement = await value.service.acquireConsumption(
    SCOPE,
    confirmedValue.confirmationId,
    { expectedVersion: 2, leaseExpiresAt: '2026-08-03T10:30:00.000Z' },
  );
  assert.equal(replacement.leaseId, 'lease-third');
});

test('markConsumed requires exact active lease and retires it atomically', async () => {
  const value = harness();
  const confirmedValue = await createConfirmed(value);
  const lease = await value.service.acquireConsumption(
    SCOPE, confirmedValue.confirmationId,
    { expectedVersion: 2, leaseExpiresAt: LEASE_EXPIRES },
  );
  value.setNow(CONSUMED);
  await assert.rejects(value.service.markConsumed(
    SCOPE, confirmedValue.confirmationId,
    { expectedVersion: 2, leaseId: 'lease-wrong' },
  ), { code: 'confirmation_lease_invalid' });
  const consumed = await value.service.markConsumed(
    SCOPE, confirmedValue.confirmationId,
    { expectedVersion: 2, leaseId: lease.leaseId },
  );
  assert.equal(consumed.status, CONFIRMATION_STATUSES.CONSUMED);
  assert.equal(consumed.version, 3);
  await assert.rejects(value.service.releaseConsumption(
    SCOPE, confirmedValue.confirmationId, { leaseId: lease.leaseId },
  ), { code: 'confirmation_lease_invalid' });
  await assert.rejects(value.service.markConsumed(
    SCOPE, confirmedValue.confirmationId,
    { expectedVersion: 3, leaseId: lease.leaseId },
  ), { code: 'confirmation_terminal' });
  await assert.rejects(value.service.acquireConsumption(
    SCOPE, confirmedValue.confirmationId,
    { expectedVersion: 3, leaseExpiresAt: LEASE_EXPIRES },
  ), { code: 'confirmation_terminal' });
});

test('two markConsumed attempts allow one winner and no Mission creation', async () => {
  const value = harness();
  const confirmedValue = await createConfirmed(value);
  const lease = await value.service.acquireConsumption(
    SCOPE, confirmedValue.confirmationId,
    { expectedVersion: 2, leaseExpiresAt: LEASE_EXPIRES },
  );
  value.setNow(CONSUMED);
  const results = await Promise.allSettled([
    value.service.markConsumed(SCOPE, confirmedValue.confirmationId, {
      expectedVersion: 2, leaseId: lease.leaseId,
    }),
    value.service.markConsumed(SCOPE, confirmedValue.confirmationId, {
      expectedVersion: 2, leaseId: lease.leaseId,
    }),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  assert.equal(value.repository.calls.includes('createMission'), false);
});

test('current B.2A semantics reject consumption after Confirmation expiration even with a lease', async () => {
  const value = harness();
  const confirmedValue = await createConfirmed(value);
  await assert.rejects(value.service.acquireConsumption(
    SCOPE, confirmedValue.confirmationId,
    { expectedVersion: 2, leaseExpiresAt: '2026-08-03T11:10:00.000Z' },
  ), { code: 'confirmation_lease_invalid' });
  const lease = await value.service.acquireConsumption(
    SCOPE, confirmedValue.confirmationId,
    { expectedVersion: 2, leaseExpiresAt: EXPIRES },
  );
  value.setNow(EXPIRES);
  await assert.rejects(value.service.markConsumed(
    SCOPE, confirmedValue.confirmationId,
    { expectedVersion: 2, leaseId: lease.leaseId },
  ), { code: 'confirmation_expired' });
  assert.equal((await value.service.getConfirmation(
    SCOPE, confirmedValue.confirmationId,
  )).status, CONFIRMATION_STATUSES.CONFIRMED);
});

test('revokes PENDING or CONFIRMED but rejects terminal Confirmation', async () => {
  const pending = harness();
  const created = await createStored(pending);
  pending.setNow(CONFIRMED);
  assert.equal((await pending.service.revokeConfirmation(
    SCOPE, created.confirmation.confirmationId, { expectedVersion: 1 },
  )).status, CONFIRMATION_STATUSES.REVOKED);

  const confirmedHarness = harness();
  const confirmedValue = await createConfirmed(confirmedHarness);
  assert.equal((await confirmedHarness.service.revokeConfirmation(
    SCOPE, confirmedValue.confirmationId, { expectedVersion: 2 },
  )).status, CONFIRMATION_STATUSES.REVOKED);
  await assert.rejects(confirmedHarness.service.revokeConfirmation(
    SCOPE, confirmedValue.confirmationId, { expectedVersion: 3 },
  ), { code: 'confirmation_terminal' });
});

test('active lease blocks revoke and expired lease permits it', async () => {
  const value = harness();
  const confirmedValue = await createConfirmed(value);
  await value.service.acquireConsumption(
    SCOPE, confirmedValue.confirmationId,
    { expectedVersion: 2, leaseExpiresAt: LEASE_EXPIRES },
  );
  value.setNow(CONSUMED);
  await assert.rejects(value.service.revokeConfirmation(
    SCOPE, confirmedValue.confirmationId, { expectedVersion: 2 },
  ), { code: 'confirmation_lease_conflict' });
  value.setNow(LEASE_EXPIRES);
  assert.equal((await value.service.revokeConfirmation(
    SCOPE, confirmedValue.confirmationId, { expectedVersion: 2 },
  )).status, CONFIRMATION_STATUSES.REVOKED);
});

test('release requires exact lease and remains scoped', async () => {
  const value = harness();
  const confirmedValue = await createConfirmed(value);
  const lease = await value.service.acquireConsumption(
    SCOPE, confirmedValue.confirmationId,
    { expectedVersion: 2, leaseExpiresAt: LEASE_EXPIRES },
  );
  await assert.rejects(value.service.releaseConsumption(
    SCOPE, confirmedValue.confirmationId, { leaseId: 'lease-wrong' },
  ), { code: 'confirmation_lease_invalid' });
  await assert.rejects(value.service.releaseConsumption(
    { ...SCOPE, tenantId: 'tenant-foreign' },
    confirmedValue.confirmationId,
    { leaseId: lease.leaseId },
  ), { code: 'confirmation_not_found' });
  assert.deepEqual(await value.service.releaseConsumption(
    SCOPE, confirmedValue.confirmationId, { leaseId: lease.leaseId },
  ), { released: true });
});

test('release permits exact expired-lease cleanup and rejects a missing lease deterministically', async () => {
  const value = harness();
  const confirmedValue = await createConfirmed(value);
  const lease = await value.service.acquireConsumption(
    SCOPE, confirmedValue.confirmationId,
    { expectedVersion: 2, leaseExpiresAt: LEASE_EXPIRES },
  );
  value.setNow(LEASE_EXPIRES);
  assert.deepEqual(await value.service.releaseConsumption(
    SCOPE, confirmedValue.confirmationId, { leaseId: lease.leaseId },
  ), { released: true });
  await assert.rejects(value.service.releaseConsumption(
    SCOPE, confirmedValue.confirmationId, { leaseId: lease.leaseId },
  ), { code: 'confirmation_lease_invalid' });
});

test('propagates unavailable and unknown commit without retry or fallback', async () => {
  const unavailable = harness({ repository: new FakeConfirmationRepository({ unavailable: true }) });
  await assert.rejects(createStored(unavailable), {
    code: 'confirmation_repository_unavailable',
  });
  assert.deepEqual(unavailable.repository.calls, ['create']);

  const unknown = harness({ repository: new FakeConfirmationRepository({ unknownCommit: true }) });
  await assert.rejects(createStored(unknown), {
    code: 'confirmation_unknown_commit_result',
  });
  assert.deepEqual(unknown.repository.calls, ['create']);
  assert.equal((await unknown.service.getConfirmation(
    SCOPE, 'confirmation-service-alpha',
  )).confirmationId, 'confirmation-service-alpha');
});

test('sanitizes unexpected repository failure without leaking private detail', async () => {
  const value = harness({ repository: new FakeConfirmationRepository({ rawFailure: true }) });
  await assert.rejects(createStored(value), (error) => error instanceof ConfirmationServiceError
    && error.code === 'confirmation_repository_unavailable'
    && !error.message.includes('private synthetic'));
  assert.deepEqual(value.repository.calls, ['create']);
});

test('returns frozen copies and never shares mutable repository state', async () => {
  const value = harness();
  const created = await createStored(value);
  assert.throws(() => { created.confirmation.status = CONFIRMATION_STATUSES.CONSUMED; }, TypeError);
  const loaded = await value.service.getConfirmation(SCOPE, created.confirmation.confirmationId);
  assert.throws(() => { loaded.planSnapshot.title = 'Mutated'; }, TypeError);
  assert.equal((await value.service.getConfirmation(
    SCOPE, created.confirmation.confirmationId,
  )).status, CONFIRMATION_STATUSES.PENDING);
});

test('production service remains a pure coordinator with no Mission, Approval, or persistence', () => {
  const source = fs.readFileSync(path.join(__dirname, 'mission-confirmation-service.js'), 'utf8');
  assert.match(source, /mission-confirmation-contract/);
  assert.match(source, /mission-confirmation-repository-contract/);
  assert.doesNotMatch(source,
    /node:fs|filesystem|fetch|http|firebase|oauth|postgres|server|runtime|worker|process\.env/i);
  assert.doesNotMatch(source,
    /MissionService|MissionIntake|ApprovalQueue|ConfirmationManager|Orchestrator|Workflow/);
  assert.doesNotMatch(source, /new Map|\bMap\(|Date\.now|setTimeout|setInterval|randomUUID/);
});

test('service performs no Mission creation, Approval, execution, automatic retry, or fallback', async () => {
  const value = harness();
  const confirmedValue = await createConfirmed(value);
  const lease = await value.service.acquireConsumption(
    SCOPE, confirmedValue.confirmationId,
    { expectedVersion: 2, leaseExpiresAt: LEASE_EXPIRES },
  );
  value.setNow(CONSUMED);
  const consumed = await value.service.markConsumed(
    SCOPE, confirmedValue.confirmationId,
    { expectedVersion: 2, leaseId: lease.leaseId },
  );
  validateMissionConfirmation(consumed);
  assert.equal(consumed.status, CONFIRMATION_STATUSES.CONSUMED);
  assert.equal(Object.hasOwn(consumed, 'mission'), false);
  assert.equal(Object.hasOwn(consumed, 'approval'), false);
  assert.equal(Object.hasOwn(consumed, 'execution'), false);
  assert.deepEqual(value.repository.calls, [
    'create', 'get', 'saveIfVersion', 'get', 'acquireConsumeLease',
    'get', 'consumeIfLeased',
  ]);
});

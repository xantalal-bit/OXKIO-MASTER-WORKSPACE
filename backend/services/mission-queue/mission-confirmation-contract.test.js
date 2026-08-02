'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const contract = require('./mission-confirmation-contract');

const {
  CONFIRMATION_STATUSES,
  ConfirmationContractError,
  PLAN_SCHEMA_VERSION,
  createMissionConfirmation,
  isMissionConfirmationExpired,
  transitionMissionConfirmation,
  validateMissionConfirmation,
} = contract;

const CREATED = '2026-08-02T10:00:00.000Z';
const CONFIRMED = '2026-08-02T10:05:00.000Z';
const CONSUMED = '2026-08-02T10:10:00.000Z';
const EXPIRES = '2026-08-02T11:00:00.000Z';

function plan(overrides = {}) {
  return {
    title: 'Synthetic Mission Confirmation',
    objective: 'Validate one immutable synthetic plan',
    scope: 'Pure contract test without runtime',
    projectId: 'project-confirmation-test',
    workspaceId: 'workspace-confirmation-test',
    priority: 'normal',
    acceptanceCriteria: [{
      criterionId: 'criterion-confirmation-test',
      description: 'The pure contract remains deterministic',
    }],
    sourceInteractionId: 'interaction-confirmation-test',
    nextAction: 'Await a separately authorized service phase',
    ...overrides,
  };
}

function input(overrides = {}) {
  const confirmationId = Object.hasOwn(overrides, 'confirmationId')
    ? overrides.confirmationId
    : 'confirmation-test-alpha';
  return {
    confirmationId,
    tenantId: 'tenant-confirmation-test',
    userId: 'user-confirmation-test',
    clientId: 'client-confirmation-test',
    missionId: 'mission-confirmation-test',
    idempotencyKey: `mission-confirmation:v1:${confirmationId}`,
    planSnapshot: plan(),
    planSchemaVersion: 1,
    expiresAt: EXPIRES,
    ...overrides,
  };
}

function create(overrides = {}, now = CREATED) {
  return createMissionConfirmation(input(overrides), { now });
}

function reconstructed(overrides = {}) {
  return {
    confirmationId: 'confirmation-reconstructed-test',
    tenantId: 'tenant-reconstructed-test',
    userId: 'user-reconstructed-test',
    clientId: 'client-reconstructed-test',
    missionId: 'mission-reconstructed-test',
    idempotencyKey: 'mission-confirmation:v1:confirmation-reconstructed-test',
    planSnapshot: plan(),
    planSchemaVersion: 1,
    status: CONFIRMATION_STATUSES.PENDING,
    version: 1,
    createdAt: CREATED,
    confirmedAt: null,
    consumedAt: null,
    revokedAt: null,
    expiresAt: EXPIRES,
    ...overrides,
  };
}

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

function expectCode(callback, code) {
  assert.throws(callback, (error) => error instanceof ConfirmationContractError
    && error.code === code
    && !error.message.includes('Synthetic'));
}

test('exports only the pure V1 contract surface', () => {
  assert.deepEqual(Object.keys(contract).sort(), [
    'CONFIRMATION_STATUSES',
    'ConfirmationContractError',
    'PLAN_SCHEMA_VERSION',
    'createMissionConfirmation',
    'isMissionConfirmationExpired',
    'transitionMissionConfirmation',
    'validateMissionConfirmation',
  ]);
  assert.equal(PLAN_SCHEMA_VERSION, 1);
  assert.deepEqual(Object.values(CONFIRMATION_STATUSES), [
    'PENDING', 'CONFIRMED', 'CONSUMED', 'REVOKED',
  ]);
});

test('creates an exact immutable PENDING V1 aggregate', () => {
  const confirmation = create();
  assert.deepEqual(Object.keys(confirmation), [
    'confirmationId', 'tenantId', 'userId', 'clientId', 'missionId',
    'idempotencyKey', 'planSnapshot', 'planSchemaVersion', 'status', 'version',
    'createdAt', 'confirmedAt', 'consumedAt', 'revokedAt', 'expiresAt',
  ]);
  assert.equal(confirmation.status, CONFIRMATION_STATUSES.PENDING);
  assert.equal(confirmation.version, 1);
  assert.equal(confirmation.createdAt, CREATED);
  assert.equal(confirmation.confirmedAt, null);
  assert.equal(confirmation.consumedAt, null);
  assert.equal(confirmation.revokedAt, null);
  assert.equal(validateMissionConfirmation(confirmation), confirmation);
  assert.equal(Object.isFrozen(confirmation), true);
  assert.equal(Object.isFrozen(confirmation.planSnapshot), true);
  assert.equal(Object.isFrozen(confirmation.planSnapshot.acceptanceCriteria), true);
  assert.equal(Object.isFrozen(confirmation.planSnapshot.acceptanceCriteria[0]), true);
});

test('rejects missing and malformed identifiers and an incomplete scope', () => {
  for (const field of ['confirmationId', 'tenantId', 'userId', 'clientId', 'missionId']) {
    expectCode(() => create({ [field]: undefined }), 'confirmation_input_invalid');
    expectCode(() => create({ [field]: 'x' }), 'confirmation_input_invalid');
    expectCode(() => create({ [field]: 'synthetic@example.invalid' }), 'confirmation_input_invalid');
  }
});

test('requires a key derived exactly from confirmationId', () => {
  expectCode(() => create({ idempotencyKey: 'arbitrary-key' }), 'confirmation_idempotency_invalid');
  expectCode(() => create({
    confirmationId: 'confirmation-test-other',
    idempotencyKey: 'mission-confirmation:v1:confirmation-test-alpha',
  }), 'confirmation_idempotency_invalid');
  assert.equal(create().idempotencyKey, 'mission-confirmation:v1:confirmation-test-alpha');
});

test('rejects absent, non-object, extra, and incomplete snapshots', () => {
  for (const planSnapshot of [undefined, null, [], 'plan']) {
    expectCode(() => create({ planSnapshot }), 'confirmation_plan_invalid');
  }
  expectCode(() => create({ planSnapshot: plan({ prompt: 'synthetic prompt' }) }),
    'confirmation_plan_invalid');
  const incomplete = plan();
  delete incomplete.objective;
  expectCode(() => create({ planSnapshot: incomplete }), 'confirmation_plan_invalid');
});

test('allows only structured bounded plan fields needed by future Mission intake', () => {
  const confirmation = create({
    planSnapshot: plan({ workspaceId: null, sourceInteractionId: null, priority: 'high' }),
  });
  assert.deepEqual(Object.keys(confirmation.planSnapshot), [
    'title', 'objective', 'scope', 'projectId', 'workspaceId', 'priority',
    'acceptanceCriteria', 'sourceInteractionId', 'nextAction',
  ]);
  assert.equal(confirmation.planSnapshot.workspaceId, null);
  assert.equal(confirmation.planSnapshot.sourceInteractionId, null);
  assert.equal(Object.hasOwn(confirmation.planSnapshot, 'missionId'), false);
});

test('rejects malformed criteria, duplicates, invalid priority, and oversized text', () => {
  const cases = [
    plan({ acceptanceCriteria: [] }),
    plan({ acceptanceCriteria: [{ criterionId: 'criterion-test', description: 'valid', extra: true }] }),
    plan({ acceptanceCriteria: [
      { criterionId: 'criterion-duplicate', description: 'first' },
      { criterionId: 'criterion-duplicate', description: 'second' },
    ] }),
    plan({ priority: 'urgent' }),
    plan({ title: 'x'.repeat(201) }),
  ];
  cases.forEach((planSnapshot) => {
    expectCode(() => create({ planSnapshot }), 'confirmation_plan_invalid');
  });
});

test('rejects non-plain and non-portable plan snapshot structures', () => {
  class CustomPlan {
    constructor() {
      Object.assign(this, plan());
    }
  }
  class CustomCriterion {
    constructor() {
      this.criterionId = 'criterion-custom-test';
      this.description = 'Custom prototype must be rejected';
    }
  }
  const inheritedPlan = Object.assign(Object.create({ inherited: true }), plan());
  const candidates = [
    new CustomPlan(),
    inheritedPlan,
    new Date(CREATED),
    new Map([['title', 'map']]),
    new Set(['set']),
    Buffer.from('synthetic'),
    plan({ title: () => 'function' }),
    plan({ acceptanceCriteria: [new CustomCriterion()] }),
  ];
  candidates.forEach((planSnapshot) => {
    expectCode(() => create({ planSnapshot }), 'confirmation_plan_invalid');
  });
});

test('rejects Approval, execution, conversation, prompt, token, and secret fields', () => {
  const forbidden = [
    'approvalId', 'requiresApproval', 'executionEnabled', 'status', 'workerId',
    'conversation', 'prompt', 'token', 'secret', 'missionId',
  ];
  forbidden.forEach((field) => {
    expectCode(() => create({ planSnapshot: plan({ [field]: 'synthetic-only' }) }),
      'confirmation_plan_invalid');
  });
});

test('accepts only plan schema V1 and no upcaster', () => {
  for (const planSchemaVersion of [undefined, 0, 2, '1']) {
    expectCode(() => create({ planSchemaVersion }), 'confirmation_schema_invalid');
  }
  assert.equal(create().planSchemaVersion, 1);
});

test('creation derives status, version, and lifecycle timestamps', () => {
  for (const field of ['status', 'version', 'createdAt', 'confirmedAt', 'consumedAt', 'revokedAt']) {
    expectCode(() => create({ [field]: field === 'version' ? 99 : 'forged' }),
      'confirmation_input_invalid');
  }
});

test('requires an explicit deterministic now and canonical valid timestamps', () => {
  expectCode(() => createMissionConfirmation(input()), 'confirmation_time_invalid');
  expectCode(() => create({}, 'invalid'), 'confirmation_time_invalid');
  expectCode(() => create({}, '2026-08-02'), 'confirmation_time_invalid');
  assert.equal(createMissionConfirmation(input(), { now: () => CREATED }).createdAt, CREATED);
});

test('requires expiresAt to be valid and later than createdAt without choosing a TTL', () => {
  for (const expiresAt of ['invalid', '2026-08-02', CREATED, '2026-08-02T09:59:59.999Z']) {
    expectCode(() => create({ expiresAt }), 'confirmation_time_invalid');
  }
  assert.equal(create().expiresAt, EXPIRES);
});

test('recognizes expiration as a derived condition and never persists EXPIRED', () => {
  const confirmation = create();
  assert.equal(isMissionConfirmationExpired(confirmation, CONFIRMED), false);
  assert.equal(isMissionConfirmationExpired(confirmation, EXPIRES), true);
  assert.equal(Object.values(CONFIRMATION_STATUSES).includes('EXPIRED'), false);
  assert.equal(confirmation.status, CONFIRMATION_STATUSES.PENDING);
});

test('transitions PENDING to CONFIRMED without creating or consuming a Mission', () => {
  const pending = create();
  const confirmed = transitionMissionConfirmation(
    pending, CONFIRMATION_STATUSES.CONFIRMED, { now: CONFIRMED },
  );
  assert.equal(confirmed.status, CONFIRMATION_STATUSES.CONFIRMED);
  assert.equal(confirmed.version, 2);
  assert.equal(confirmed.confirmedAt, CONFIRMED);
  assert.equal(confirmed.consumedAt, null);
  assert.equal(confirmed.missionId, pending.missionId);
  assert.equal(Object.hasOwn(confirmed, 'mission'), false);
});

test('transitions PENDING to REVOKED without deleting any evidence', () => {
  const pending = create();
  const revoked = transitionMissionConfirmation(
    pending, CONFIRMATION_STATUSES.REVOKED, { now: CONFIRMED },
  );
  assert.equal(revoked.status, CONFIRMATION_STATUSES.REVOKED);
  assert.equal(revoked.version, 2);
  assert.equal(revoked.revokedAt, CONFIRMED);
  assert.equal(revoked.confirmedAt, null);
  assert.deepEqual(revoked.planSnapshot, pending.planSnapshot);
});

test('rejects PENDING to CONSUMED and leaves the original unchanged', () => {
  const pending = create();
  expectCode(() => transitionMissionConfirmation(
    pending, CONFIRMATION_STATUSES.CONSUMED, { now: CONSUMED },
  ), 'confirmation_transition_invalid');
  assert.equal(pending.status, CONFIRMATION_STATUSES.PENDING);
  assert.equal(pending.version, 1);
  assert.equal(pending.consumedAt, null);
});

test('transitions CONFIRMED to CONSUMED as a semantic mark only', () => {
  const confirmed = transitionMissionConfirmation(
    create(), CONFIRMATION_STATUSES.CONFIRMED, { now: CONFIRMED },
  );
  const consumed = transitionMissionConfirmation(
    confirmed, CONFIRMATION_STATUSES.CONSUMED, { now: CONSUMED },
  );
  assert.equal(consumed.status, CONFIRMATION_STATUSES.CONSUMED);
  assert.equal(consumed.version, 3);
  assert.equal(consumed.confirmedAt, CONFIRMED);
  assert.equal(consumed.consumedAt, CONSUMED);
  assert.deepEqual(Object.keys(consumed), Object.keys(confirmed));
});

test('transitions CONFIRMED to REVOKED without cancelling a Mission', () => {
  const confirmed = transitionMissionConfirmation(
    create(), CONFIRMATION_STATUSES.CONFIRMED, { now: CONFIRMED },
  );
  const revoked = transitionMissionConfirmation(
    confirmed, CONFIRMATION_STATUSES.REVOKED, { now: CONSUMED },
  );
  assert.equal(revoked.status, CONFIRMATION_STATUSES.REVOKED);
  assert.equal(revoked.confirmedAt, CONFIRMED);
  assert.equal(revoked.revokedAt, CONSUMED);
  assert.equal(Object.hasOwn(revoked, 'cancelledMission'), false);
});

test('keeps CONSUMED and REVOKED terminal and immutable', () => {
  const confirmed = transitionMissionConfirmation(
    create(), CONFIRMATION_STATUSES.CONFIRMED, { now: CONFIRMED },
  );
  const terminal = [
    transitionMissionConfirmation(confirmed, CONFIRMATION_STATUSES.CONSUMED, { now: CONSUMED }),
    transitionMissionConfirmation(confirmed, CONFIRMATION_STATUSES.REVOKED, { now: CONSUMED }),
  ];
  for (const confirmation of terminal) {
    for (const status of Object.values(CONFIRMATION_STATUSES)) {
      expectCode(() => transitionMissionConfirmation(confirmation, status, { now: CONSUMED }),
        'confirmation_terminal');
    }
  }
});

test('rejects unknown statuses and incompatible lifecycle timestamps', () => {
  const unknown = copy(create());
  unknown.status = 'APPROVED';
  expectCode(() => validateMissionConfirmation(unknown), 'confirmation_status_invalid');

  const pendingWithConfirmation = copy(create());
  pendingWithConfirmation.confirmedAt = CONFIRMED;
  expectCode(() => validateMissionConfirmation(pendingWithConfirmation), 'confirmation_time_invalid');

  const confirmedWithoutTimestamp = copy(create());
  confirmedWithoutTimestamp.status = CONFIRMATION_STATUSES.CONFIRMED;
  expectCode(() => validateMissionConfirmation(confirmedWithoutTimestamp), 'confirmation_time_invalid');
});

test('validates independently reconstructed PENDING, CONFIRMED, CONSUMED, and REVOKED records', () => {
  const records = [
    reconstructed(),
    reconstructed({
      status: CONFIRMATION_STATUSES.CONFIRMED,
      version: 2,
      confirmedAt: CONFIRMED,
    }),
    reconstructed({
      status: CONFIRMATION_STATUSES.CONSUMED,
      version: 3,
      confirmedAt: CONFIRMED,
      consumedAt: CONSUMED,
    }),
    reconstructed({
      status: CONFIRMATION_STATUSES.REVOKED,
      version: 2,
      revokedAt: CONFIRMED,
    }),
  ];
  records.forEach((record) => {
    assert.equal(validateMissionConfirmation(record), record);
  });
});

test('validates confirmed, consumed, and revoked timestamp chronology', () => {
  const confirmedBeforeCreation = copy(create());
  confirmedBeforeCreation.status = CONFIRMATION_STATUSES.CONFIRMED;
  confirmedBeforeCreation.confirmedAt = '2026-08-02T09:59:59.999Z';
  expectCode(() => validateMissionConfirmation(confirmedBeforeCreation), 'confirmation_time_invalid');

  const consumedWithoutConfirmation = copy(create());
  consumedWithoutConfirmation.status = CONFIRMATION_STATUSES.CONSUMED;
  consumedWithoutConfirmation.consumedAt = CONSUMED;
  expectCode(() => validateMissionConfirmation(consumedWithoutConfirmation), 'confirmation_time_invalid');

  const consumedBeforeConfirmation = copy(create());
  consumedBeforeConfirmation.status = CONFIRMATION_STATUSES.CONSUMED;
  consumedBeforeConfirmation.confirmedAt = CONFIRMED;
  consumedBeforeConfirmation.consumedAt = CREATED;
  expectCode(() => validateMissionConfirmation(consumedBeforeConfirmation), 'confirmation_time_invalid');

  const revokedAndConsumed = copy(create());
  revokedAndConsumed.status = CONFIRMATION_STATUSES.REVOKED;
  revokedAndConsumed.revokedAt = CONSUMED;
  revokedAndConsumed.consumedAt = CONSUMED;
  expectCode(() => validateMissionConfirmation(revokedAndConsumed), 'confirmation_time_invalid');
});

test('rejects arbitrary or invalid versions', () => {
  for (const version of [undefined, 0, -1, 1.5, '1']) {
    const candidate = copy(create());
    candidate.version = version;
    expectCode(() => validateMissionConfirmation(candidate), 'confirmation_version_invalid');
  }
});

test('rejects backward transition time without mutating the original', () => {
  const confirmed = transitionMissionConfirmation(
    create(), CONFIRMATION_STATUSES.CONFIRMED, { now: CONFIRMED },
  );
  expectCode(() => transitionMissionConfirmation(
    confirmed, CONFIRMATION_STATUSES.CONSUMED, { now: CREATED },
  ), 'confirmation_time_invalid');
  assert.equal(confirmed.status, CONFIRMATION_STATUSES.CONFIRMED);
  assert.equal(confirmed.version, 2);
  assert.equal(confirmed.consumedAt, null);
});

test('does not confirm or consume an expired confirmation', () => {
  const pending = create();
  expectCode(() => transitionMissionConfirmation(
    pending, CONFIRMATION_STATUSES.CONFIRMED, { now: EXPIRES },
  ), 'confirmation_expired');

  const confirmed = transitionMissionConfirmation(
    pending, CONFIRMATION_STATUSES.CONFIRMED, { now: CONFIRMED },
  );
  expectCode(() => transitionMissionConfirmation(
    confirmed, CONFIRMATION_STATUSES.CONSUMED, { now: EXPIRES },
  ), 'confirmation_expired');
  assert.equal(pending.version, 1);
  assert.equal(confirmed.version, 2);
});

test('permits explicit revocation after expiration while preserving the record', () => {
  const revoked = transitionMissionConfirmation(
    create(), CONFIRMATION_STATUSES.REVOKED, { now: EXPIRES },
  );
  assert.equal(revoked.status, CONFIRMATION_STATUSES.REVOKED);
  assert.equal(revoked.revokedAt, EXPIRES);
});

test('protects against input and nested snapshot mutation by reference', () => {
  const sourcePlan = plan();
  const source = input({ planSnapshot: sourcePlan });
  const confirmation = createMissionConfirmation(source, { now: CREATED });
  source.confirmationId = 'confirmation-mutated';
  sourcePlan.title = 'Mutated title';
  sourcePlan.acceptanceCriteria[0].description = 'Mutated criterion';
  sourcePlan.acceptanceCriteria.push({ criterionId: 'criterion-new', description: 'new' });

  assert.equal(confirmation.confirmationId, 'confirmation-test-alpha');
  assert.equal(confirmation.planSnapshot.title, 'Synthetic Mission Confirmation');
  assert.equal(confirmation.planSnapshot.acceptanceCriteria.length, 1);
  assert.equal(
    confirmation.planSnapshot.acceptanceCriteria[0].description,
    'The pure contract remains deterministic',
  );
});

test('rejects direct mutation of the aggregate and all nested arrays', () => {
  const confirmation = create();
  assert.throws(() => { confirmation.status = CONFIRMATION_STATUSES.CONSUMED; }, TypeError);
  assert.throws(() => { confirmation.planSnapshot.title = 'mutated'; }, TypeError);
  assert.throws(() => { confirmation.planSnapshot.acceptanceCriteria.push({}); }, TypeError);
  assert.throws(() => {
    confirmation.planSnapshot.acceptanceCriteria[0].description = 'mutated';
  }, TypeError);
});

test('valid transitions increment exactly once and rejected transitions never increment', () => {
  const pending = create();
  const confirmed = transitionMissionConfirmation(
    pending, CONFIRMATION_STATUSES.CONFIRMED, { now: CONFIRMED },
  );
  assert.equal(confirmed.version, pending.version + 1);
  expectCode(() => transitionMissionConfirmation(
    confirmed, CONFIRMATION_STATUSES.PENDING, { now: CONSUMED },
  ), 'confirmation_transition_invalid');
  assert.equal(confirmed.version, 2);
});

test('validation rejects extra canonical, lease, repository, and authority fields', () => {
  for (const field of [
    'consumeLeaseId', 'consumeLeaseExpiresAt', 'repository', 'roles', 'capabilities', 'approvalId',
  ]) {
    const candidate = copy(create());
    candidate[field] = 'synthetic-only';
    expectCode(() => validateMissionConfirmation(candidate), 'confirmation_input_invalid');
  }
});

test('production contract remains pure and separate from Approval and Mission creation', () => {
  const source = fs.readFileSync(path.join(__dirname, 'mission-confirmation-contract.js'), 'utf8');
  assert.doesNotMatch(source,
    /process\.env|node:fs|filesystem|fetch|http|firebase|oauth|postgres|server|runtime|worker|timer/i);
  assert.doesNotMatch(source,
    /MissionService|MissionIntake|ApprovalQueue|ConfirmationService|Repository|Store|Orchestrator/);
  assert.doesNotMatch(source, /consumeLeaseId|consumeLeaseExpiresAt/);
  assert.doesNotMatch(source, /Date\.now|setTimeout|setInterval|randomUUID/);
});

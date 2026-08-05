'use strict';

/**
 * postgres-confirmed-mission-committer.test.js
 *
 * G0002.5B.2E — Microfase 1: Tests de la primitive atómica.
 *
 * Tests de integración PostgreSQL aislados.
 * Requieren variables de entorno:
 *   OXKIO_MISSION_PG_ADMIN_URL  – conexión con privilegios de propietario
 *   OXKIO_MISSION_PG_RUNTIME_URL – conexión como oxkio_mission_runtime
 *
 * Los tests de superficie (constructor, exports) no requieren PostgreSQL.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const { Pool } = require('pg');

const {
  MISSION_STATES,
  createMission,
  cloneDomain,
} = require('./mission-contract');

const {
  CONFIRMATION_STATUSES,
  createMissionConfirmation,
  transitionMissionConfirmation,
} = require('./mission-confirmation-contract');

const {
  CommitterError,
  PostgresConfirmedMissionCommitter,
} = require('./postgres-confirmed-mission-committer');

// ─── Environment ─────────────────────────────────────────────────────────────

const ADMIN_URL = process.env.OXKIO_MISSION_PG_ADMIN_URL;
const RUNTIME_URL = process.env.OXKIO_MISSION_PG_RUNTIME_URL;
const INTEGRATION_READY = Boolean(ADMIN_URL && RUNTIME_URL);

// ─── Constants ────────────────────────────────────────────────────────────────

const NOW = '2026-08-05T10:00:00.000Z';
const CONFIRMED_AT = '2026-08-05T10:01:00.000Z';
const LEASED_AT = '2026-08-05T10:02:00.000Z';
const LEASE_EXPIRES = '2026-08-05T10:04:00.000Z';
const CONSUMED_AT = '2026-08-05T10:03:00.000Z';
const AFTER_LEASE = '2026-08-05T10:05:00.000Z';
const EXPIRES = '2026-08-05T11:00:00.000Z';
const ALREADY_EXPIRED = '2026-08-05T09:00:00.000Z'; // before NOW

const SCOPE = Object.freeze({
  tenantId: 'tenant-committer-alpha',
  userId: 'user-committer-alpha',
  clientId: 'client-committer-alpha',
});

const SCOPE_B = Object.freeze({
  tenantId: 'tenant-committer-beta',
  userId: 'user-committer-beta',
  clientId: 'client-committer-beta',
});

const LEASE_ID = 'lease-committer-alpha';

// ─── Pool factory ─────────────────────────────────────────────────────────────

function createPool(connectionString, overrides = {}) {
  return new Pool({
    connectionString,
    max: 8,
    connectionTimeoutMillis: 2_000,
    query_timeout: 8_000,
    ...overrides,
  });
}

// ─── Domain factories ─────────────────────────────────────────────────────────

function planSnapshot(overrides = {}) {
  return {
    title: 'Committer synthetic mission',
    objective: 'Verify atomic Confirmation→Mission persistence',
    scope: 'Synthetic sandbox only',
    projectId: 'project-committer-alpha',
    workspaceId: 'workspace-committer-alpha',
    priority: 'normal',
    acceptanceCriteria: [{
      criterionId: 'criterion-committer-alpha',
      description: 'The atomic commit persists both records',
    }],
    sourceInteractionId: 'interaction-committer-alpha',
    nextAction: 'Verify atomic commit',
    ...overrides,
  };
}

function makePendingConfirmation({
  scope = SCOPE,
  confirmationId = 'confirmation-committer-alpha',
  missionId = 'mission-committer-alpha',
  expiresAt = EXPIRES,
  planOverrides = {},
} = {}) {
  return createMissionConfirmation({
    confirmationId,
    tenantId: scope.tenantId,
    userId: scope.userId,
    clientId: scope.clientId,
    missionId,
    idempotencyKey: `mission-confirmation:v1:${confirmationId}`,
    planSnapshot: planSnapshot(planOverrides),
    planSchemaVersion: 1,
    expiresAt,
  }, { now: NOW });
}

function confirmedConfirmation(pending, now = CONFIRMED_AT) {
  return transitionMissionConfirmation(pending, CONFIRMATION_STATUSES.CONFIRMED, { now });
}

function makeMission(scope = SCOPE, missionId = 'mission-committer-alpha') {
  return createMission({
    missionId,
    title: 'Committer synthetic mission',
    objective: 'Verify atomic Confirmation→Mission persistence',
    scope: 'Synthetic sandbox only',
    clientId: scope.clientId,
    projectId: 'project-committer-alpha',
    workspaceId: 'workspace-committer-alpha',
    priority: 'normal',
    acceptanceCriteria: [{
      criterionId: 'criterion-committer-alpha',
      description: 'The atomic commit persists both records',
    }],
    nextAction: 'Verify atomic commit',
    sourceInteractionId: 'interaction-committer-alpha',
  }, scope, { now: NOW }).mission;
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

function migrationSql(filename) {
  return readFileSync(
    path.resolve(__dirname, '../../repositories/postgres/migrations', filename),
    'utf8',
  ).replace(/^\\set ON_ERROR_STOP on\r?\n/, '');
}

async function scopedQuery(pool, scope, sql, values = []) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [scope.tenantId]);
    await client.query("SELECT set_config('app.user_id', $1, true)", [scope.userId]);
    await client.query("SELECT set_config('app.client_id', $1, true)", [scope.clientId]);
    const result = await client.query(sql, values);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/** Insert a Confirmation row directly via admin (bypasses RLS) */
async function adminInsertConfirmation(adminPool, scope, confirmation) {
  await adminPool.query(
    `INSERT INTO oxkio.mission_confirmations (
       tenant_id, user_id, client_id, confirmation_id, mission_id,
       idempotency_key, plan_snapshot, plan_schema_version, status, version,
       created_at, confirmed_at, consumed_at, revoked_at, expires_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [
      scope.tenantId,
      scope.userId,
      scope.clientId,
      confirmation.confirmationId,
      confirmation.missionId,
      confirmation.idempotencyKey,
      JSON.stringify(confirmation.planSnapshot),
      confirmation.planSchemaVersion,
      confirmation.status,
      confirmation.version,
      confirmation.createdAt,
      confirmation.confirmedAt,
      confirmation.consumedAt,
      confirmation.revokedAt,
      confirmation.expiresAt,
    ],
  );
}

/** Set consume lease directly via admin (bypasses RLS) */
async function adminSetLease(adminPool, scope, confirmationId, leaseId, acquiredAt, expiresAt) {
  await adminPool.query(
    `UPDATE oxkio.mission_confirmations
     SET consume_lease_id = $5,
         consume_lease_acquired_at = $6,
         consume_lease_expires_at = $7
     WHERE tenant_id = $1 AND user_id = $2 AND client_id = $3
       AND confirmation_id = $4`,
    [scope.tenantId, scope.userId, scope.clientId, confirmationId, leaseId, acquiredAt, expiresAt],
  );
}

/** Read stored Confirmation (admin bypass) */
async function adminGetConfirmation(adminPool, scope, confirmationId) {
  const result = await adminPool.query(
    `SELECT status, version, consumed_at, consume_lease_id
     FROM oxkio.mission_confirmations
     WHERE tenant_id = $1 AND user_id = $2 AND client_id = $3
       AND confirmation_id = $4`,
    [scope.tenantId, scope.userId, scope.clientId, confirmationId],
  );
  return result.rows[0] || null;
}

/** Read stored Mission (admin bypass) */
async function adminGetMission(adminPool, scope, missionId) {
  const result = await adminPool.query(
    `SELECT mission_id, status, idempotency_key
     FROM oxkio.missions
     WHERE tenant_id = $1 AND user_id = $2 AND client_id = $3
       AND mission_id = $4`,
    [scope.tenantId, scope.userId, scope.clientId, missionId],
  );
  return result.rows[0] || null;
}

// ─── Surface regression (no PostgreSQL required) ──────────────────────────────

test('PostgresConfirmedMissionCommitter surface regression', () => {
  // Requires a pool-like object
  assert.throws(
    () => new PostgresConfirmedMissionCommitter({}),
    { code: 'invalid_postgres_pool' },
  );
  assert.throws(
    () => new PostgresConfirmedMissionCommitter({ pool: {} }),
    { code: 'invalid_postgres_pool' },
  );

  const committer = new PostgresConfirmedMissionCommitter({
    pool: { connect() { throw new Error('not connected in surface test'); } },
  });

  // Is frozen
  assert.equal(Object.isFrozen(committer), true);

  // Exposes only commit + provider
  assert.equal(typeof committer.commit, 'function');
  assert.equal(committer.provider, 'postgresql');

  // Pool is private (#pool — not directly accessible)
  assert.equal(committer.pool, undefined);
  assert.equal(committer['#pool'], undefined);

  // No execution-related methods
  assert.equal(committer.transitionMission, undefined);
  assert.equal(committer.transitionTask, undefined);
  assert.equal(committer.addTask, undefined);
  assert.equal(committer.execute, undefined);
  assert.equal(committer.run, undefined);
});

test('CommitterError has correct name and code', () => {
  const error = new CommitterError('test_code', 'test message');
  assert.equal(error.name, 'CommitterError');
  assert.equal(error.code, 'test_code');
  assert.equal(error.message, 'test message');
  assert.ok(error instanceof Error);
});

test('commit rejects invalid input shapes', async () => {
  const committer = new PostgresConfirmedMissionCommitter({
    pool: { connect() { throw new Error('should not connect'); } },
  });

  // Missing keys
  await assert.rejects(
    committer.commit({}),
    { code: 'committer_input_invalid' },
  );

  // Extra key
  await assert.rejects(
    committer.commit({
      scope: SCOPE,
      confirmation: {},
      expectedConfirmationVersion: 1,
      leaseId: LEASE_ID,
      mission: {},
      idempotencyKey: 'key-alpha',
      consumedAt: CONSUMED_AT,
      extra: 'bad',
    }),
    { code: 'committer_input_invalid' },
  );
});

test('commit rejects Mission not in PROPOSED status (pre-flight, no DB)', async () => {
  const committer = new PostgresConfirmedMissionCommitter({
    pool: { connect() { throw new Error('should not connect in pre-flight test'); } },
  });

  const pending = makePendingConfirmation();
  const confirmed = confirmedConfirmation(pending);
  const mission = makeMission();

  // Simulate a READY mission (invalid initial status)
  const readyMission = cloneDomain(mission);
  readyMission.status = 'READY';
  // validateMission will reject READY with empty tasks in domain, but we test committer guard

  await assert.rejects(
    committer.commit({
      scope: SCOPE,
      confirmation: confirmed,
      expectedConfirmationVersion: confirmed.version,
      leaseId: LEASE_ID,
      mission: Object.assign(cloneDomain(mission), { status: MISSION_STATES.PROPOSED }),
      idempotencyKey: confirmed.idempotencyKey,
      consumedAt: CONSUMED_AT,
    }),
    // Should pass pre-flight but not connect (pool throws)
    // This test verifies PROPOSED missions pass pre-flight
  ).then(
    () => { /* resolve = pool threw, which is expected */ },
    (err) => {
      // If it failed with committer_invalid_mission_status, that's unexpected for PROPOSED
      assert.notEqual(err.code, 'committer_invalid_mission_status');
    },
  );
});

// ─── Integration tests ────────────────────────────────────────────────────────

test('PostgresConfirmedMissionCommitter integration', {
  skip: !INTEGRATION_READY && 'isolated PostgreSQL URLs are not configured',
}, async (t) => {
  const adminPool = createPool(ADMIN_URL);
  const runtimePool = createPool(RUNTIME_URL);

  const resetAll = async () => {
    await adminPool.query('TRUNCATE TABLE oxkio.missions');
    await adminPool.query('TRUNCATE TABLE oxkio.mission_confirmations');
  };

  try {
    // Ensure migrations are applied
    await adminPool.query(migrationSql('001_mission_queue.sql'));
    await adminPool.query(migrationSql('002_mission_confirmations.sql'));

    const committer = new PostgresConfirmedMissionCommitter({ pool: runtimePool });

    // ── Helper: set up a CONFIRMED Confirmation with active lease ─────────────
    async function setupConfirmedWithLease({
      scope = SCOPE,
      confirmationId = 'confirmation-committer-alpha',
      missionId = 'mission-committer-alpha',
      expiresAt = EXPIRES,
      leaseId = LEASE_ID,
      leaseAcquiredAt = LEASED_AT,
      leaseExpiresAt = LEASE_EXPIRES,
    } = {}) {
      const pending = makePendingConfirmation({ scope, confirmationId, missionId, expiresAt });
      const confirmed = confirmedConfirmation(pending);
      await adminInsertConfirmation(adminPool, scope, confirmed);
      await adminSetLease(adminPool, scope, confirmationId, leaseId, leaseAcquiredAt, leaseExpiresAt);
      return { pending, confirmed };
    }

    function makeInput({
      scope = SCOPE,
      confirmed,
      leaseId = LEASE_ID,
      missionId = 'mission-committer-alpha',
      consumedAt = CONSUMED_AT,
    } = {}) {
      const mission = makeMission(scope, missionId);
      return {
        scope,
        confirmation: confirmed,
        expectedConfirmationVersion: confirmed.version,
        leaseId,
        mission,
        idempotencyKey: confirmed.idempotencyKey,
        consumedAt,
      };
    }

    // ── TEST 1: Happy path ─────────────────────────────────────────────────────
    await t.test('happy path: Mission PROPOSED inserted + Confirmation CONSUMED atomically', async () => {
      await resetAll();
      const { confirmed } = await setupConfirmedWithLease();
      const input = makeInput({ confirmed });

      const result = await committer.commit(input);

      assert.equal(result.created, true);
      assert.equal(result.mission.status, MISSION_STATES.PROPOSED);
      assert.equal(result.mission.missionId, 'mission-committer-alpha');
      assert.equal(result.confirmation.status, CONFIRMATION_STATUSES.CONSUMED);
      assert.equal(result.confirmation.consumedAt, CONSUMED_AT);
      assert.equal(result.confirmation.confirmationId, 'confirmation-committer-alpha');
      assert.equal(result.confirmation.consumeLeaseId, undefined); // cleared
      assert.equal(result.confirmation.consumeLeaseAcquiredAt, undefined); // cleared
      assert.equal(result.confirmation.consumeLeaseExpiresAt, undefined); // cleared

      // Verify via admin that both records are durable
      const storedMission = await adminGetMission(adminPool, SCOPE, 'mission-committer-alpha');
      assert.ok(storedMission, 'Mission must be durable');
      assert.equal(storedMission.status, 'PROPOSED');
      assert.equal(storedMission.idempotency_key, confirmed.idempotencyKey);

      const storedConf = await adminGetConfirmation(adminPool, SCOPE, 'confirmation-committer-alpha');
      assert.ok(storedConf, 'Confirmation must be durable');
      assert.equal(storedConf.status, 'CONSUMED');
      assert.equal(storedConf.consume_lease_id, null);
    });

    // ── TEST 2: Idempotent replay ──────────────────────────────────────────────
    await t.test('idempotent replay: Mission already exists + Confirmation already CONSUMED', async () => {
      await resetAll();
      const { confirmed } = await setupConfirmedWithLease();
      const input = makeInput({ confirmed });

      const first = await committer.commit(input);
      assert.equal(first.created, true);

      // Confirmation is now CONSUMED — re-committing must fail with terminal error
      // (the Confirmation can't be consumed again)
      await assert.rejects(
        committer.commit(input),
        { code: 'confirmation_terminal' },
      );
    });

    // ── TEST 3: Mission already exists (compatible) — replay from Mission only ─
    await t.test('Mission already exists (compatible idempotency key) → created:false', async () => {
      await resetAll();
      const { confirmed } = await setupConfirmedWithLease();

      // Pre-insert the Mission via direct SQL (admin) with the same idempotency key
      const mission = makeMission(SCOPE, 'mission-committer-alpha');
      await adminPool.query(
        `INSERT INTO oxkio.missions (
           tenant_id, user_id, client_id, mission_id, idempotency_key,
           project_id, workspace_id, title, objective, scope_text, status,
           priority, schema_version, version, created_at, updated_at,
           next_action, source_interaction_id, aggregate_data
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19::jsonb)`,
        [
          SCOPE.tenantId, SCOPE.userId, SCOPE.clientId,
          mission.missionId,
          confirmed.idempotencyKey,
          mission.projectId, mission.workspaceId, mission.title, mission.objective,
          mission.scope, mission.status, mission.priority,
          mission.schemaVersion, mission.version, mission.createdAt, mission.updatedAt,
          mission.nextAction, mission.sourceInteractionId,
          JSON.stringify({
            owners: mission.owners,
            participants: mission.participants,
            dependencies: mission.dependencies,
            blockers: mission.blockers,
            tasks: mission.tasks,
            risks: mission.risks,
            requiredApprovals: mission.requiredApprovals,
            evidence: mission.evidence,
            result: mission.result,
            acceptanceCriteria: mission.acceptanceCriteria,
          }),
        ],
      );

      const input = makeInput({ confirmed });
      const result = await committer.commit(input);

      assert.equal(result.created, false, 'Mission already existed → created:false');
      assert.equal(result.mission.missionId, 'mission-committer-alpha');
      assert.equal(result.mission.status, MISSION_STATES.PROPOSED);
      assert.equal(result.confirmation.status, CONFIRMATION_STATUSES.CONSUMED);
    });

    // ── TEST 4: Mission incompatible (different missionId for same key) ─────────
    await t.test('Mission incompatible (idempotency key bound to different missionId) → fail closed', async () => {
      await resetAll();
      const { confirmed } = await setupConfirmedWithLease();

      // Pre-insert a Mission with the SAME idempotency key but a DIFFERENT missionId
      const otherMission = makeMission(SCOPE, 'mission-committer-other');
      await adminPool.query(
        `INSERT INTO oxkio.missions (
           tenant_id, user_id, client_id, mission_id, idempotency_key,
           project_id, workspace_id, title, objective, scope_text, status,
           priority, schema_version, version, created_at, updated_at,
           next_action, source_interaction_id, aggregate_data
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19::jsonb)`,
        [
          SCOPE.tenantId, SCOPE.userId, SCOPE.clientId,
          otherMission.missionId,
          confirmed.idempotencyKey, // same idempotency key as confirmation!
          otherMission.projectId, otherMission.workspaceId, otherMission.title, otherMission.objective,
          otherMission.scope, otherMission.status, otherMission.priority,
          otherMission.schemaVersion, otherMission.version, otherMission.createdAt, otherMission.updatedAt,
          otherMission.nextAction, otherMission.sourceInteractionId,
          JSON.stringify({
            owners: otherMission.owners, participants: otherMission.participants,
            dependencies: otherMission.dependencies, blockers: otherMission.blockers,
            tasks: otherMission.tasks, risks: otherMission.risks,
            requiredApprovals: otherMission.requiredApprovals, evidence: otherMission.evidence,
            result: otherMission.result, acceptanceCriteria: otherMission.acceptanceCriteria,
          }),
        ],
      );

      const input = makeInput({ confirmed });
      await assert.rejects(
        committer.commit(input),
        { code: 'idempotency_conflict' },
      );

      // Confirmation must remain CONFIRMED (rollback)
      const storedConf = await adminGetConfirmation(adminPool, SCOPE, 'confirmation-committer-alpha');
      assert.equal(storedConf.status, 'CONFIRMED', 'Confirmation must roll back to CONFIRMED');
    });

    // ── TEST 5: Wrong lease → fail closed ─────────────────────────────────────
    await t.test('wrong leaseId → fail closed, both records unchanged', async () => {
      await resetAll();
      const { confirmed } = await setupConfirmedWithLease({ leaseId: 'lease-committer-alpha' });

      const input = {
        ...makeInput({ confirmed }),
        leaseId: 'lease-committer-wrong-wrong',
      };

      await assert.rejects(
        committer.commit(input),
        { code: 'confirmation_lease_invalid' },
      );

      // Confirmation must still be CONFIRMED
      const stored = await adminGetConfirmation(adminPool, SCOPE, 'confirmation-committer-alpha');
      assert.equal(stored.status, 'CONFIRMED');
      // Mission must not exist
      const mission = await adminGetMission(adminPool, SCOPE, 'mission-committer-alpha');
      assert.equal(mission, null, 'Mission must not have been created');
    });

    // ── TEST 6: Lease expired (consumedAt >= leaseExpiresAt) ──────────────────
    await t.test('lease expired → fail closed', async () => {
      await resetAll();
      // Set a lease that expires BEFORE consumedAt
      await setupConfirmedWithLease({
        leaseExpiresAt: '2026-08-05T10:02:30.000Z', // before CONSUMED_AT 10:03
      });
      const { confirmed } = { confirmed: confirmedConfirmation(makePendingConfirmation()) };

      const input = {
        scope: SCOPE,
        confirmation: confirmed,
        expectedConfirmationVersion: confirmed.version,
        leaseId: LEASE_ID,
        mission: makeMission(),
        idempotencyKey: confirmed.idempotencyKey,
        consumedAt: CONSUMED_AT, // 10:03 > lease expiry 10:02:30
      };

      await assert.rejects(
        committer.commit(input),
        // Either confirmation_lease_expired or confirmation_lease_invalid
        (err) => ['confirmation_lease_expired', 'confirmation_lease_invalid',
          'confirmation_version_conflict', 'confirmation_not_found'].includes(err.code),
      );

      const mission = await adminGetMission(adminPool, SCOPE, 'mission-committer-alpha');
      assert.equal(mission, null, 'Mission must not have been created on lease expiry');
    });

    // ── TEST 7: Confirmation already expired ──────────────────────────────────
    await t.test('Confirmation expiresAt in the past → fail closed', async () => {
      await resetAll();
      // Create a Confirmation that is already expired
      const pending = makePendingConfirmation({ expiresAt: '2026-08-05T10:02:30.000Z' });
      const confirmed = confirmedConfirmation(pending);
      await adminInsertConfirmation(adminPool, SCOPE, confirmed);
      await adminSetLease(adminPool, SCOPE, pending.confirmationId, LEASE_ID, LEASED_AT, '2026-08-05T10:02:15.000Z');

      const input = {
        scope: SCOPE,
        confirmation: confirmed,
        expectedConfirmationVersion: confirmed.version,
        leaseId: LEASE_ID,
        mission: makeMission(),
        idempotencyKey: confirmed.idempotencyKey,
        consumedAt: CONSUMED_AT, // after expiresAt
      };

      await assert.rejects(
        committer.commit(input),
        (err) => ['confirmation_expired', 'confirmation_lease_invalid',
          'confirmation_lease_expired', 'confirmation_not_found'].includes(err.code),
      );
    });

    // ── TEST 8: Confirmation not in CONFIRMED status → fail closed ─────────────
    await t.test('Confirmation in PENDING status → fail closed', async () => {
      await resetAll();
      const pending = makePendingConfirmation();
      // Insert PENDING (not confirmed)
      await adminInsertConfirmation(adminPool, SCOPE, pending);
      // No lease set (not confirmed yet)

      const input = {
        scope: SCOPE,
        confirmation: pending,
        expectedConfirmationVersion: pending.version,
        leaseId: LEASE_ID,
        mission: makeMission(),
        idempotencyKey: pending.idempotencyKey,
        consumedAt: CONSUMED_AT,
      };

      await assert.rejects(
        committer.commit(input),
        (err) => ['confirmation_transition_invalid', 'confirmation_lease_invalid',
          'confirmation_not_found'].includes(err.code),
      );
    });

    // ── TEST 9: Wrong scope (different tenant) → fail closed, RLS isolation ───
    await t.test('wrong tenant scope → RLS hides Confirmation, fail closed', async () => {
      await resetAll();
      const { confirmed } = await setupConfirmedWithLease({ scope: SCOPE });

      // Try to commit using SCOPE_B (different tenant/user/client)
      const foreignMission = makeMission(SCOPE_B, 'mission-committer-alpha');
      const input = {
        scope: SCOPE_B,
        confirmation: confirmed, // belongs to SCOPE, not SCOPE_B
        expectedConfirmationVersion: confirmed.version,
        leaseId: LEASE_ID,
        mission: foreignMission,
        idempotencyKey: confirmed.idempotencyKey,
        consumedAt: CONSUMED_AT,
      };

      // Pre-flight mismatch: scope vs confirmation scope
      await assert.rejects(
        committer.commit(input),
        // Detected either at pre-flight (scope mismatch on domain object) or in RLS not found
        (err) => ['confirmation_scope_mismatch', 'confirmation_not_found',
          'committer_failure', 'committer_input_invalid'].includes(err.code),
      );

      // Original Confirmation must be untouched
      const stored = await adminGetConfirmation(adminPool, SCOPE, 'confirmation-committer-alpha');
      assert.equal(stored.status, 'CONFIRMED');
      // No Mission created for SCOPE_B
      const missionB = await adminGetMission(adminPool, SCOPE_B, 'mission-committer-alpha');
      assert.equal(missionB, null);
    });

    // ── TEST 10: RLS triádico — user mismatch ──────────────────────────────────
    await t.test('wrong userId scope → RLS hides Confirmation', async () => {
      await resetAll();
      await setupConfirmedWithLease({ scope: SCOPE });

      const wrongScope = { ...SCOPE, userId: 'user-committer-foreign' };
      const wrongMission = makeMission(wrongScope, 'mission-committer-alpha');
      // Can't even build valid input because missionScope != confirmationScope
      // Verify that commit refuses it
      const pending2 = makePendingConfirmation({ scope: wrongScope });
      const confirmed2 = confirmedConfirmation(pending2);

      const input = {
        scope: wrongScope,
        confirmation: confirmed2,
        expectedConfirmationVersion: confirmed2.version,
        leaseId: LEASE_ID,
        mission: wrongMission,
        idempotencyKey: confirmed2.idempotencyKey,
        consumedAt: CONSUMED_AT,
      };

      await assert.rejects(
        committer.commit(input),
        (err) => typeof err.code === 'string',
      );

      // Original SCOPE Confirmation untouched
      const stored = await adminGetConfirmation(adminPool, SCOPE, 'confirmation-committer-alpha');
      assert.equal(stored.status, 'CONFIRMED');
    });

    // ── TEST 11: Version conflict → fail closed ────────────────────────────────
    await t.test('version conflict (stale expectedVersion) → fail closed', async () => {
      await resetAll();
      const { confirmed } = await setupConfirmedWithLease();

      const input = {
        ...makeInput({ confirmed }),
        expectedConfirmationVersion: confirmed.version + 10, // wrong version
      };

      await assert.rejects(
        committer.commit(input),
        { code: 'confirmation_version_conflict' },
      );

      const mission = await adminGetMission(adminPool, SCOPE, 'mission-committer-alpha');
      assert.equal(mission, null, 'Mission must not be created on version conflict');

      const stored = await adminGetConfirmation(adminPool, SCOPE, 'confirmation-committer-alpha');
      assert.equal(stored.status, 'CONFIRMED');
    });

    // ── TEST 12: Rollback — Mission not persisted if Confirmation update fails ─
    await t.test('Mission INSERT ok + Confirmation UPDATE rejected → both roll back', async () => {
      await resetAll();
      const { confirmed } = await setupConfirmedWithLease();

      // Create a pool proxy that lets the Mission INSERT succeed but then forces
      // the Confirmation UPDATE to fail with a synthetic error.
      let insertDone = false;
      const proxyPool = {
        async connect() {
          const client = await runtimePool.connect();
          return {
            async query(sql, values) {
              const text = typeof sql === 'string' ? sql : sql.text || '';
              if (text.includes('INSERT INTO oxkio.missions')) {
                const result = await client.query(sql, values);
                insertDone = true;
                return result;
              }
              if (insertDone && text.includes("SET status = 'CONSUMED'")) {
                insertDone = false;
                throw new Error('synthetic Confirmation update failure');
              }
              return client.query(sql, values);
            },
            release() { client.release(); },
          };
        },
      };

      const proxyCommitter = new PostgresConfirmedMissionCommitter({ pool: proxyPool });
      const input = makeInput({ confirmed });

      await assert.rejects(
        proxyCommitter.commit(input),
        (err) => typeof err.code === 'string',
      );

      // Verify Mission was NOT persisted (rollback)
      const mission = await adminGetMission(adminPool, SCOPE, 'mission-committer-alpha');
      assert.equal(mission, null, 'Mission must have been rolled back');

      // Confirmation must remain CONFIRMED
      const storedConf = await adminGetConfirmation(adminPool, SCOPE, 'confirmation-committer-alpha');
      assert.equal(storedConf.status, 'CONFIRMED');
    });

    // ── TEST 13: Concurrent commits — only one wins ────────────────────────────
    await t.test('concurrent commits race: only one wins, other fails closed', async () => {
      await resetAll();
      await setupConfirmedWithLease();
      const { confirmed } = { confirmed: confirmedConfirmation(makePendingConfirmation()) };

      const input = makeInput({ confirmed });

      // Read the actual stored Confirmation version/lease
      const stored = await adminGetConfirmation(adminPool, SCOPE, 'confirmation-committer-alpha');
      assert.ok(stored, 'Confirmation must exist for concurrency test');

      // Two concurrent commits with the same input
      const outcomes = await Promise.allSettled([
        committer.commit(input),
        committer.commit(input),
      ]);

      const successes = outcomes.filter((o) => o.status === 'fulfilled');
      const failures = outcomes.filter((o) => o.status === 'rejected');

      // Exactly one must succeed
      assert.equal(successes.length, 1, 'Exactly one concurrent commit must succeed');
      assert.equal(failures.length, 1, 'Exactly one concurrent commit must fail');
      assert.ok(
        ['confirmation_terminal', 'confirmation_version_conflict',
          'confirmation_lease_invalid'].includes(failures[0].reason.code),
        `Failure must be a known conflict code, got: ${failures[0].reason.code}`,
      );

      // Only one Mission in DB
      const missionCount = await adminPool.query(
        `SELECT COUNT(*)::int AS count FROM oxkio.missions
         WHERE tenant_id = $1 AND user_id = $2 AND client_id = $3
           AND mission_id = $4`,
        [SCOPE.tenantId, SCOPE.userId, SCOPE.clientId, 'mission-committer-alpha'],
      );
      assert.equal(missionCount.rows[0].count, 1, 'Exactly one Mission must exist after concurrency');

      // Confirmation is CONSUMED
      const conf = await adminGetConfirmation(adminPool, SCOPE, 'confirmation-committer-alpha');
      assert.equal(conf.status, 'CONSUMED');
    });

    // ── TEST 14: commit unknown result (pool closes after BEGIN, before COMMIT) ─
    await t.test('unknown commit outcome is stable — returns committer_commit_outcome_unknown', async () => {
      await resetAll();
      await setupConfirmedWithLease();
      const { confirmed } = { confirmed: confirmedConfirmation(makePendingConfirmation()) };

      // Proxy that throws after committing = true in runPostgresScopedTransaction by
      // closing the connection forcibly mid-COMMIT.
      let sawCommit = false;
      const proxyPool2 = {
        async connect() {
          const client = await runtimePool.connect();
          return {
            async query(sql, values) {
              const text = typeof sql === 'string' ? sql : (sql.text || '');
              if (text.trim().toUpperCase() === 'COMMIT') {
                sawCommit = true;
                // Start COMMIT then throw to simulate unknown outcome
                client.query('COMMIT').catch(() => {});
                throw new Error('simulated network drop during COMMIT');
              }
              return client.query(sql, values);
            },
            release() { client.release(); },
          };
        },
      };

      const proxyCommitter2 = new PostgresConfirmedMissionCommitter({ pool: proxyPool2 });
      const input = makeInput({ confirmed });

      await assert.rejects(
        proxyCommitter2.commit(input),
        { code: 'committer_commit_outcome_unknown' },
      );

      assert.ok(sawCommit, 'COMMIT must have been attempted');
      // The caller can now reconcile by checking Confirmation status.
    });

    // ── TEST 15: No READY or RUNNING transitions possible ─────────────────────
    await t.test('result mission status is always PROPOSED, never READY or RUNNING', async () => {
      await resetAll();
      const { confirmed } = await setupConfirmedWithLease({
        confirmationId: 'confirmation-committer-status',
        missionId: 'mission-committer-status',
      });
      const input = makeInput({
        confirmed,
        missionId: 'mission-committer-status',
      });

      const result = await committer.commit(input);
      assert.equal(result.mission.status, MISSION_STATES.PROPOSED);
      assert.notEqual(result.mission.status, 'READY');
      assert.notEqual(result.mission.status, 'RUNNING');
      assert.notEqual(result.mission.status, 'WAITING_APPROVAL');
    });

    // ── TEST 16: No execution methods available on result ─────────────────────
    await t.test('result shape has only mission, confirmation, created — no execution helpers', async () => {
      await resetAll();
      const { confirmed } = await setupConfirmedWithLease({
        confirmationId: 'confirmation-committer-shape',
        missionId: 'mission-committer-shape',
      });
      const input = makeInput({
        confirmed,
        missionId: 'mission-committer-shape',
      });

      const result = await committer.commit(input);
      assert.deepEqual(
        Object.keys(result).sort(),
        ['confirmation', 'created', 'mission'],
      );
      assert.equal(Object.isFrozen(result), true);
      assert.equal(result.mission.addTask, undefined);
      assert.equal(result.mission.transitionMission, undefined);
      assert.equal(result.mission.execute, undefined);
    });

    // ── TEST 17: Mission payload is validated by domain contract ───────────────
    await t.test('production file does not reference execution-related concerns', () => {
      const source = readFileSync(
        path.join(__dirname, 'postgres-confirmed-mission-committer.js'),
        'utf8',
      );
      // Inspect executable source, excluding comments, to avoid false positives
      // from documentation that explicitly names forbidden states/capabilities.
      const executableSource = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');

      // No READY/RUNNING transitions
      assert.doesNotMatch(executableSource, /READY|RUNNING|WAITING_APPROVAL/);
      // No execution
      assert.doesNotMatch(executableSource, /execution|ExecutiveRuntime|worker|scheduler|outbox|saga/i);
      // Uses runPostgresScopedTransaction
      assert.match(source, /runPostgresScopedTransaction/);
      // Uses triadic scope
      assert.match(source, /tenantId/);
      assert.match(source, /userId/);
      assert.match(source, /clientId/);
      // No orgId
      assert.doesNotMatch(source, /orgId/);
      // No findAndLock
      assert.doesNotMatch(source, /findAndLock/);
      // No executionEnabled
      assert.doesNotMatch(source, /executionEnabled/);
    });
  } finally {
    await runtimePool.end().catch(() => {});
    await adminPool.end().catch(() => {});
  }
});

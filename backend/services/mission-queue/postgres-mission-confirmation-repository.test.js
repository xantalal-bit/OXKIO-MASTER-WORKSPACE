'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const { Pool } = require('pg');

const {
  CONFIRMATION_STATUSES,
  createMissionConfirmation,
  transitionMissionConfirmation,
} = require('./mission-confirmation-contract');
const {
  PostgresMissionConfirmationRepository,
} = require('./postgres-mission-confirmation-repository');

const ADMIN_URL = process.env.OXKIO_MISSION_PG_ADMIN_URL;
const RUNTIME_URL = process.env.OXKIO_MISSION_PG_RUNTIME_URL;
const INTEGRATION_READY = Boolean(ADMIN_URL && RUNTIME_URL);

const CREATED = '2026-08-03T08:00:00.000Z';
const CONFIRMED = '2026-08-03T08:01:00.000Z';
const LEASED = '2026-08-03T08:02:00.000Z';
const LEASE_EXPIRES = '2026-08-03T08:04:00.000Z';
const AFTER_LEASE = '2026-08-03T08:05:00.000Z';
const CONSUMED = '2026-08-03T08:03:00.000Z';
const EXPIRES = '2026-08-03T09:00:00.000Z';

const SCOPE = Object.freeze({
  tenantId: 'tenant-confirmation-alpha',
  userId: 'user-confirmation-alpha',
  clientId: 'client-confirmation-alpha',
});

function createPool(connectionString, overrides = {}) {
  return new Pool({
    connectionString,
    max: 8,
    connectionTimeoutMillis: 2_000,
    query_timeout: 5_000,
    ...overrides,
  });
}

function plan(overrides = {}) {
  return {
    title: 'Synthetic PostgreSQL Confirmation',
    objective: 'Verify isolated durable Confirmation persistence',
    scope: 'Synthetic sandbox only',
    projectId: 'project-confirmation-alpha',
    workspaceId: 'workspace-confirmation-alpha',
    priority: 'normal',
    acceptanceCriteria: [{
      criterionId: 'criterion-confirmation-alpha',
      description: 'Confirmation remains valid after persistence',
    }],
    sourceInteractionId: 'interaction-confirmation-alpha',
    nextAction: 'Verify the synthetic Confirmation',
    ...overrides,
  };
}

function confirmationFor({
  scope = SCOPE,
  confirmationId = 'confirmation-pg-alpha',
  missionId = 'mission-pg-alpha',
  planOverrides = {},
  expiresAt = EXPIRES,
  createdAt = CREATED,
} = {}) {
  return createMissionConfirmation({
    confirmationId,
    tenantId: scope.tenantId,
    userId: scope.userId,
    clientId: scope.clientId,
    missionId,
    idempotencyKey: `mission-confirmation:v1:${confirmationId}`,
    planSnapshot: plan(planOverrides),
    planSchemaVersion: 1,
    expiresAt,
  }, { now: createdAt });
}

function confirm(value, now = CONFIRMED) {
  return transitionMissionConfirmation(value, CONFIRMATION_STATUSES.CONFIRMED, { now });
}

function consume(value, now = CONSUMED) {
  return transitionMissionConfirmation(value, CONFIRMATION_STATUSES.CONSUMED, { now });
}

function revoke(value, now = CONSUMED) {
  return transitionMissionConfirmation(value, CONFIRMATION_STATUSES.REVOKED, { now });
}

function lease(leaseId = 'lease-pg-alpha', acquiredAt = LEASED, expiresAt = LEASE_EXPIRES) {
  return { leaseId, acquiredAt, expiresAt };
}

function proxyPool(pool, queryHandler) {
  return {
    async connect() {
      const client = await pool.connect();
      return {
        query(...args) {
          return queryHandler(client, ...args);
        },
        release() {
          client.release();
        },
      };
    },
  };
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

async function storedLease(pool, scope, confirmationId) {
  const result = await scopedQuery(
    pool,
    scope,
    `SELECT consume_lease_id AS "leaseId",
            consume_lease_acquired_at AS "acquiredAt",
            consume_lease_expires_at AS "expiresAt"
     FROM oxkio.mission_confirmations
     WHERE tenant_id = $1 AND user_id = $2 AND client_id = $3
       AND confirmation_id = $4`,
    [scope.tenantId, scope.userId, scope.clientId, confirmationId],
  );
  return result.rows[0];
}

test('exposes only the six frozen ConfirmationRepository operations', () => {
  const repository = new PostgresMissionConfirmationRepository({
    pool: { connect() { throw new Error('not used by surface regression'); } },
  });
  const operations = Object.getOwnPropertyNames(PostgresMissionConfirmationRepository.prototype)
    .filter((name) => name !== 'constructor')
    .sort();
  assert.deepEqual(operations, [
    'acquireConsumeLease',
    'consumeIfLeased',
    'create',
    'get',
    'releaseConsumeLease',
    'saveIfVersion',
  ]);
  assert.equal(repository.pool, undefined);
  assert.equal(repository.client, undefined);
  assert.equal(repository.withScope, undefined);
  assert.deepEqual(Reflect.ownKeys(repository), ['provider']);
});

test('PostgresMissionConfirmationRepository integration and Red Team', {
  skip: !INTEGRATION_READY && 'isolated PostgreSQL URLs are not configured',
}, async (t) => {
  const adminPool = createPool(ADMIN_URL);
  let runtimePool = createPool(RUNTIME_URL);
  const migrationPath = path.resolve(
    __dirname,
    '../../repositories/postgres/migrations/002_mission_confirmations.sql',
  );
  const migrationSql = readFileSync(migrationPath, 'utf8')
    .replace(/^\\set ON_ERROR_STOP on\r?\n/, '');
  const reset = () => adminPool.query('TRUNCATE TABLE oxkio.mission_confirmations');

  try {
    await t.test('migration is fresh, repeatable, constrained, least-privileged, and RLS-forced', async () => {
      await adminPool.query('DROP TABLE IF EXISTS oxkio.mission_confirmations');
      await adminPool.query(migrationSql);
      await adminPool.query(migrationSql);

      const table = await adminPool.query(
        `SELECT c.relrowsecurity, c.relforcerowsecurity, r.rolname AS owner
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_roles r ON r.oid = c.relowner
         WHERE n.nspname = 'oxkio' AND c.relname = 'mission_confirmations'`,
      );
      assert.deepEqual(table.rows, [{
        relrowsecurity: true,
        relforcerowsecurity: true,
        owner: 'oxkio_mission_owner',
      }]);

      const roles = await adminPool.query(
        `SELECT rolsuper, rolcreaterole, rolcreatedb, rolinherit, rolbypassrls
         FROM pg_roles WHERE rolname = 'oxkio_mission_runtime'`,
      );
      assert.deepEqual(roles.rows, [{
        rolsuper: false,
        rolcreaterole: false,
        rolcreatedb: false,
        rolinherit: false,
        rolbypassrls: false,
      }]);

      const privileges = await adminPool.query(
        `SELECT
           has_table_privilege('oxkio_mission_runtime',
             'oxkio.mission_confirmations', 'SELECT') AS can_select,
           has_table_privilege('oxkio_mission_runtime',
             'oxkio.mission_confirmations', 'INSERT') AS can_insert,
           has_table_privilege('oxkio_mission_runtime',
             'oxkio.mission_confirmations', 'DELETE') AS can_delete,
           has_column_privilege('oxkio_mission_runtime',
             'oxkio.mission_confirmations', 'tenant_id', 'UPDATE') AS can_update_scope,
           has_column_privilege('oxkio_mission_runtime',
             'oxkio.mission_confirmations', 'status', 'UPDATE') AS can_update_status`,
      );
      assert.deepEqual(privileges.rows, [{
        can_select: true,
        can_insert: true,
        can_delete: false,
        can_update_scope: false,
        can_update_status: true,
      }]);
    });

    await t.test('create is durable, compatible on replay, conflicting on changed intent, and scoped', async () => {
      await reset();
      const repository = new PostgresMissionConfirmationRepository({ pool: runtimePool });
      const expected = confirmationFor();
      const created = await repository.create(SCOPE, expected);
      assert.equal(created.created, true);
      assert.deepEqual(created.confirmation, expected);

      const replay = await repository.create(SCOPE, expected);
      assert.equal(replay.created, false);
      assert.deepEqual(replay.confirmation, expected);

      await assert.rejects(
        repository.create(SCOPE, confirmationFor({
          planOverrides: { objective: 'A changed incompatible objective' },
        })),
        { code: 'confirmation_conflict' },
      );
      await assert.rejects(
        repository.create(SCOPE, confirmationFor({
          confirmationId: 'confirmation-pg-other',
        })),
        { code: 'confirmation_mission_conflict' },
      );

      const independentScope = { ...SCOPE, tenantId: 'tenant-confirmation-other' };
      const independent = confirmationFor({ scope: independentScope });
      assert.equal((await repository.create(independentScope, independent)).created, true);
    });

    await t.test('concurrent creates have one winner and incompatible Mission ownership fails closed', async () => {
      await reset();
      const repository = new PostgresMissionConfirmationRepository({ pool: runtimePool });
      const expected = confirmationFor();
      const compatible = await Promise.all([
        repository.create(SCOPE, expected),
        repository.create(SCOPE, expected),
      ]);
      assert.deepEqual(compatible.map((result) => result.created).sort(), [false, true]);

      await reset();
      const candidates = [
        confirmationFor({ confirmationId: 'confirmation-race-one' }),
        confirmationFor({ confirmationId: 'confirmation-race-two' }),
      ];
      const incompatible = await Promise.allSettled(
        candidates.map((candidate) => repository.create(SCOPE, candidate)),
      );
      assert.equal(incompatible.filter((result) => result.status === 'fulfilled').length, 1);
      assert.equal(incompatible.filter((result) => result.status === 'rejected').length, 1);
      assert.equal(incompatible.find((result) => result.status === 'rejected').reason.code,
        'confirmation_mission_conflict');
    });

    await t.test('get and direct SQL isolate tenant, user, client, known IDs, and absent scope', async () => {
      await reset();
      const repository = new PostgresMissionConfirmationRepository({ pool: runtimePool });
      const expected = confirmationFor();
      await repository.create(SCOPE, expected);
      assert.deepEqual(await repository.get(SCOPE, expected.confirmationId), expected);

      for (const foreign of [
        { ...SCOPE, tenantId: 'tenant-confirmation-foreign' },
        { ...SCOPE, userId: 'user-confirmation-foreign' },
        { ...SCOPE, clientId: 'client-confirmation-foreign' },
      ]) {
        await assert.rejects(repository.get(foreign, expected.confirmationId), {
          code: 'confirmation_not_found',
        });
        const rows = await scopedQuery(
          runtimePool,
          foreign,
          `SELECT confirmation_id FROM oxkio.mission_confirmations
           WHERE confirmation_id = $1 OR mission_id = $2 OR idempotency_key = $3`,
          [expected.confirmationId, expected.missionId, expected.idempotencyKey],
        );
        assert.equal(rows.rows.length, 0);
      }

      const client = await runtimePool.connect();
      try {
        const noScope = await client.query('SELECT * FROM oxkio.mission_confirmations');
        assert.equal(noScope.rows.length, 0);
        await client.query('BEGIN');
        await client.query('SET LOCAL row_security = off');
        await assert.rejects(
          client.query('SELECT * FROM oxkio.mission_confirmations'),
          { code: '42501' },
        );
        await client.query('ROLLBACK');
        await client.query('BEGIN');
        await assert.rejects(client.query('SET LOCAL ROLE oxkio_mission_owner'), { code: '42501' });
        await client.query('ROLLBACK');
      } finally {
        client.release();
      }
    });

    await t.test('saveIfVersion provides real CAS and blocks active leases', async () => {
      await reset();
      const repository = new PostgresMissionConfirmationRepository({ pool: runtimePool });
      const initial = confirmationFor();
      await repository.create(SCOPE, initial);
      const confirmed = confirm(initial);
      assert.deepEqual(await repository.saveIfVersion(SCOPE, confirmed, 1, CONFIRMED), confirmed);
      await assert.rejects(
        repository.saveIfVersion(SCOPE, confirmed, 1, CONFIRMED),
        { code: 'confirmation_version_conflict' },
      );

      await reset();
      await repository.create(SCOPE, initial);
      const attempts = await Promise.allSettled([
        repository.saveIfVersion(SCOPE, confirmed, 1, CONFIRMED),
        repository.saveIfVersion(SCOPE, confirmed, 1, CONFIRMED),
      ]);
      assert.equal(attempts.filter((result) => result.status === 'fulfilled').length, 1);
      assert.equal(attempts.find((result) => result.status === 'rejected').reason.code,
        'confirmation_version_conflict');

      await repository.acquireConsumeLease(SCOPE, initial.confirmationId, 2, lease());
      await assert.rejects(
        repository.saveIfVersion(SCOPE, revoke(confirmed), 2, CONSUMED),
        { code: 'confirmation_lease_conflict' },
      );
      assert.deepEqual(
        await repository.saveIfVersion(SCOPE, revoke(confirmed, AFTER_LEASE), 2, AFTER_LEASE),
        revoke(confirmed, AFTER_LEASE),
      );
    });

    await t.test('lease acquisition has one winner, replaces expiry, and respects Confirmation lifetime', async () => {
      await reset();
      const repository = new PostgresMissionConfirmationRepository({ pool: runtimePool });
      const initial = confirmationFor();
      const confirmed = confirm(initial);
      await repository.create(SCOPE, initial);
      await repository.saveIfVersion(SCOPE, confirmed, 1, CONFIRMED);

      const attempts = await Promise.allSettled([
        repository.acquireConsumeLease(SCOPE, initial.confirmationId, 2, lease('lease-race-one')),
        repository.acquireConsumeLease(SCOPE, initial.confirmationId, 2, lease('lease-race-two')),
      ]);
      assert.equal(attempts.filter((result) => result.status === 'fulfilled').length, 1);
      assert.equal(attempts.find((result) => result.status === 'rejected').reason.code,
        'confirmation_lease_conflict');

      const replacement = lease(
        'lease-race-replacement',
        AFTER_LEASE,
        '2026-08-03T08:06:00.000Z',
      );
      assert.deepEqual(
        await repository.acquireConsumeLease(SCOPE, initial.confirmationId, 2, replacement),
        replacement,
      );
      await assert.rejects(
        repository.acquireConsumeLease(
          SCOPE,
          initial.confirmationId,
          2,
          lease('lease-too-long', AFTER_LEASE, '2026-08-03T10:00:00.000Z'),
        ),
        { code: 'confirmation_lease_invalid' },
      );
    });

    await t.test('release is exact, does not mutate aggregate, and rejects wrong or second release', async () => {
      await reset();
      const repository = new PostgresMissionConfirmationRepository({ pool: runtimePool });
      const initial = confirmationFor();
      const confirmed = confirm(initial);
      await repository.create(SCOPE, initial);
      await repository.saveIfVersion(SCOPE, confirmed, 1, CONFIRMED);
      await repository.acquireConsumeLease(SCOPE, initial.confirmationId, 2, lease());
      await assert.rejects(
        repository.releaseConsumeLease(SCOPE, initial.confirmationId, 'lease-pg-wrong'),
        { code: 'confirmation_lease_invalid' },
      );
      assert.deepEqual(
        await repository.releaseConsumeLease(SCOPE, initial.confirmationId, 'lease-pg-alpha'),
        { released: true },
      );
      assert.deepEqual(await repository.get(SCOPE, initial.confirmationId), confirmed);
      await assert.rejects(
        repository.releaseConsumeLease(SCOPE, initial.confirmationId, 'lease-pg-alpha'),
        { code: 'confirmation_lease_invalid' },
      );
    });

    await t.test('consumeIfLeased is atomic and leaves no reusable or orphaned lease', async () => {
      await reset();
      const repository = new PostgresMissionConfirmationRepository({ pool: runtimePool });
      const initial = confirmationFor();
      const confirmed = confirm(initial);
      const consumed = consume(confirmed);
      await repository.create(SCOPE, initial);
      await repository.saveIfVersion(SCOPE, confirmed, 1, CONFIRMED);
      await repository.acquireConsumeLease(SCOPE, initial.confirmationId, 2, lease());
      await assert.rejects(
        repository.consumeIfLeased(SCOPE, consumed, 2, 'lease-pg-wrong'),
        { code: 'confirmation_lease_invalid' },
      );
      assert.deepEqual(
        await repository.consumeIfLeased(SCOPE, consumed, 2, 'lease-pg-alpha'),
        consumed,
      );
      assert.deepEqual(await storedLease(runtimePool, SCOPE, initial.confirmationId), {
        leaseId: null,
        acquiredAt: null,
        expiresAt: null,
      });
      await assert.rejects(
        repository.releaseConsumeLease(SCOPE, initial.confirmationId, 'lease-pg-alpha'),
        { code: 'confirmation_lease_invalid' },
      );
      await assert.rejects(
        repository.acquireConsumeLease(SCOPE, initial.confirmationId, 3, lease('lease-after-consume')),
        { code: 'confirmation_terminal' },
      );
      await assert.rejects(
        repository.consumeIfLeased(SCOPE, consumed, 2, 'lease-pg-alpha'),
        { code: 'confirmation_version_conflict' },
      );
    });

    await t.test('consume/release and consume/revoke races permit one durable outcome', async () => {
      await reset();
      const repository = new PostgresMissionConfirmationRepository({ pool: runtimePool });
      const initial = confirmationFor();
      const confirmed = confirm(initial);
      const consumed = consume(confirmed);
      await repository.create(SCOPE, initial);
      await repository.saveIfVersion(SCOPE, confirmed, 1, CONFIRMED);
      await repository.acquireConsumeLease(SCOPE, initial.confirmationId, 2, lease());
      const releaseRace = await Promise.allSettled([
        repository.consumeIfLeased(SCOPE, consumed, 2, 'lease-pg-alpha'),
        repository.releaseConsumeLease(SCOPE, initial.confirmationId, 'lease-pg-alpha'),
      ]);
      assert.equal(releaseRace.filter((result) => result.status === 'fulfilled').length, 1);
      assert.equal((await storedLease(runtimePool, SCOPE, initial.confirmationId)).leaseId, null);

      await reset();
      await repository.create(SCOPE, initial);
      await repository.saveIfVersion(SCOPE, confirmed, 1, CONFIRMED);
      await repository.acquireConsumeLease(SCOPE, initial.confirmationId, 2, lease());
      const revokeRace = await Promise.allSettled([
        repository.consumeIfLeased(SCOPE, consumed, 2, 'lease-pg-alpha'),
        repository.saveIfVersion(SCOPE, revoke(confirmed), 2, CONSUMED),
      ]);
      assert.equal(revokeRace.filter((result) => result.status === 'fulfilled').length, 1);
      assert.equal((await repository.get(SCOPE, initial.confirmationId)).status,
        CONFIRMATION_STATUSES.CONSUMED);
    });

    await t.test('expiration and lease state survive pool closure and are evaluated after reopening', async () => {
      await reset();
      const initial = confirmationFor();
      const confirmed = confirm(initial);
      const firstPool = createPool(RUNTIME_URL);
      const first = new PostgresMissionConfirmationRepository({ pool: firstPool });
      await first.create(SCOPE, initial);
      await first.saveIfVersion(SCOPE, confirmed, 1, CONFIRMED);
      await first.acquireConsumeLease(SCOPE, initial.confirmationId, 2, lease());
      await firstPool.end();

      const reopenedPool = createPool(RUNTIME_URL);
      const reopened = new PostgresMissionConfirmationRepository({ pool: reopenedPool });
      assert.deepEqual(await reopened.get(SCOPE, initial.confirmationId), confirmed);
      assert.equal((await storedLease(reopenedPool, SCOPE, initial.confirmationId)).leaseId,
        'lease-pg-alpha');
      const replacement = lease(
        'lease-after-reopen',
        AFTER_LEASE,
        '2026-08-03T08:07:00.000Z',
      );
      assert.deepEqual(
        await reopened.acquireConsumeLease(SCOPE, initial.confirmationId, 2, replacement),
        replacement,
      );
      await reopenedPool.end();

      await reset();
      const expired = confirmationFor({
        confirmationId: 'confirmation-expired-pg',
        missionId: 'mission-expired-pg',
        expiresAt: '2026-08-03T08:01:30.000Z',
      });
      const expiredConfirmed = confirm(expired, '2026-08-03T08:01:00.000Z');
      await runtimePool.query('SELECT 1');
      const repository = new PostgresMissionConfirmationRepository({ pool: runtimePool });
      await repository.create(SCOPE, expired);
      await repository.saveIfVersion(SCOPE, expiredConfirmed, 1, '2026-08-03T08:01:00.000Z');
      await assert.rejects(
        repository.acquireConsumeLease(
          SCOPE,
          expired.confirmationId,
          2,
          lease('lease-expired-confirmation', LEASED, '2026-08-03T08:02:30.000Z'),
        ),
        { code: 'confirmation_expired' },
      );
    });

    await t.test('rollback, unavailable DB, and unknown commit fail closed without retry', async () => {
      await reset();
      const expected = confirmationFor();
      const repository = new PostgresMissionConfirmationRepository({ pool: runtimePool });
      const rollbackRepository = new PostgresMissionConfirmationRepository({
        pool: proxyPool(runtimePool, async (client, query, values) => {
          const result = await client.query(query, values);
          if (typeof query === 'string'
            && query.trimStart().startsWith('INSERT INTO oxkio.mission_confirmations')) {
            throw new Error('private induced rollback');
          }
          return result;
        }),
      });
      await assert.rejects(
        rollbackRepository.create(SCOPE, expected),
        { code: 'confirmation_repository_unavailable' },
      );
      await assert.rejects(repository.get(SCOPE, expected.confirmationId), {
        code: 'confirmation_not_found',
      });

      const unavailableUrl = new URL(RUNTIME_URL);
      unavailableUrl.port = '65432';
      const unavailablePool = createPool(unavailableUrl.toString(), {
        connectionTimeoutMillis: 300,
      });
      try {
        const unavailable = new PostgresMissionConfirmationRepository({ pool: unavailablePool });
        await assert.rejects(unavailable.get(SCOPE, expected.confirmationId), {
          code: 'confirmation_repository_unavailable',
        });
      } finally {
        await unavailablePool.end();
      }

      const uncertain = new PostgresMissionConfirmationRepository({
        pool: proxyPool(runtimePool, async (client, query, values) => {
          const result = await client.query(query, values);
          if (query === 'COMMIT') {
            const error = new Error('private disconnect after commit');
            error.code = 'ECONNRESET';
            throw error;
          }
          return result;
        }),
      });
      await assert.rejects(uncertain.create(SCOPE, expected), {
        code: 'confirmation_unknown_commit_result',
      });
      assert.equal((await repository.create(SCOPE, expected)).created, false);
    });

    await t.test('malformed rows, JSONB, and unsafe versions fail closed', async () => {
      await reset();
      const repository = new PostgresMissionConfirmationRepository({ pool: runtimePool });
      const expected = confirmationFor();
      await repository.create(SCOPE, expected);
      await adminPool.query(
        `UPDATE oxkio.mission_confirmations
         SET plan_schema_version = 99
         WHERE tenant_id = $1 AND user_id = $2 AND client_id = $3
           AND confirmation_id = $4`,
        [SCOPE.tenantId, SCOPE.userId, SCOPE.clientId, expected.confirmationId],
      );
      await assert.rejects(repository.get(SCOPE, expected.confirmationId), {
        code: 'confirmation_repository_unavailable',
      });

      await adminPool.query(
        `UPDATE oxkio.mission_confirmations
         SET plan_schema_version = 1,
             plan_snapshot = jsonb_set(plan_snapshot, '{title}', '7'::jsonb)
         WHERE tenant_id = $1 AND user_id = $2 AND client_id = $3
           AND confirmation_id = $4`,
        [SCOPE.tenantId, SCOPE.userId, SCOPE.clientId, expected.confirmationId],
      );
      await assert.rejects(repository.get(SCOPE, expected.confirmationId), {
        code: 'confirmation_repository_unavailable',
      });
      await assert.rejects(
        adminPool.query(
          `UPDATE oxkio.mission_confirmations SET version = 9007199254740992
           WHERE tenant_id = $1 AND user_id = $2 AND client_id = $3
             AND confirmation_id = $4`,
          [SCOPE.tenantId, SCOPE.userId, SCOPE.clientId, expected.confirmationId],
        ),
        { code: '23514' },
      );
    });

    await t.test('adapter is parameterized, pure, and cannot create or mutate Missions', async () => {
      const source = readFileSync(
        path.resolve(__dirname, 'postgres-mission-confirmation-repository.js'),
        'utf8',
      );
      assert.doesNotMatch(source, /require\(['"]node:fs['"]\)/);
      assert.doesNotMatch(source, /firebase|firestore|oauth|approval|mission-service|server|runtime|worker/i);
      assert.doesNotMatch(source, /process\.env|setTimeout|setInterval/);
      assert.doesNotMatch(source, /INSERT INTO oxkio\.missions|UPDATE oxkio\.missions/);
      assert.match(source, /\$1/);
      const repository = new PostgresMissionConfirmationRepository({ pool: runtimePool });
      for (const forbidden of [
        'delete', 'hardDelete', 'globalList', 'listAll', 'findAcrossTenants',
        'bypassScope', 'getByMissionId',
      ]) {
        assert.equal(typeof repository[forbidden], 'undefined');
      }
    });
  } finally {
    await runtimePool.end().catch(() => {});
    await adminPool.end().catch(() => {});
  }
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const { Pool } = require('pg');

const {
  MISSION_STATES,
  TASK_STATES,
  cloneDomain,
  createMission,
} = require('./mission-contract');
const {
  REQUIRED_TASK_CANCELLED,
  REQUIRED_TASK_CANCELLED_NEXT_ACTION,
  MissionService,
} = require('./mission-service');
const { PostgresMissionRepository } = require('./postgres-mission-repository');

const ADMIN_URL = process.env.OXKIO_MISSION_PG_ADMIN_URL;
const RUNTIME_URL = process.env.OXKIO_MISSION_PG_RUNTIME_URL;
const INTEGRATION_READY = Boolean(ADMIN_URL && RUNTIME_URL);
const NOW = '2026-08-02T10:00:00.000Z';
const LATER = '2026-08-02T10:10:00.000Z';
const SCOPE = Object.freeze({
  tenantId: 'tenant-alpha',
  userId: 'user-alpha',
  clientId: 'client-alpha',
});

function createPool(connectionString, overrides = {}) {
  return new Pool({
    connectionString,
    max: 4,
    connectionTimeoutMillis: 2_000,
    query_timeout: 5_000,
    ...overrides,
  });
}

function missionPayload(scope, missionId, overrides = {}) {
  return {
    missionId,
    title: `Mission ${missionId}`,
    objective: 'Verify durable PostgreSQL Mission persistence',
    scope: 'Synthetic isolated integration test',
    clientId: scope.clientId,
    projectId: 'project-alpha',
    workspaceId: 'workspace-alpha',
    priority: 'normal',
    acceptanceCriteria: [{
      criterionId: `criterion-${missionId}`,
      description: 'The synthetic persistence behavior is verified',
    }],
    nextAction: 'Persist the synthetic Mission',
    ...overrides,
  };
}

function missionFor(scope = SCOPE, missionId = 'mission-alpha', overrides = {}) {
  return createMission(
    missionPayload(scope, missionId, overrides),
    scope,
    { now: NOW, idFactory: (kind) => `${kind}-${missionId}` },
  ).mission;
}

function advanceMission(mission, version, nextAction) {
  const candidate = cloneDomain(mission);
  candidate.version = version;
  candidate.updatedAt = LATER;
  candidate.nextAction = nextAction;
  return candidate;
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

test('exposes only the four frozen MissionRepository operations', () => {
  const repository = new PostgresMissionRepository({
    pool: { connect() { throw new Error('not used by surface regression'); } },
  });
  const operations = Object.getOwnPropertyNames(PostgresMissionRepository.prototype)
    .filter((name) => name !== 'constructor')
    .sort();

  assert.deepEqual(operations, ['create', 'get', 'list', 'saveIfVersion']);
  assert.equal(repository.pool, undefined);
  assert.equal(repository.withScope, undefined);
  assert.deepEqual(Reflect.ownKeys(repository), ['provider']);
});

test('PostgresMissionRepository V1 integration and Red Team', {
  skip: !INTEGRATION_READY && 'isolated PostgreSQL URLs are not configured',
}, async (t) => {
  const adminPool = createPool(ADMIN_URL);
  let runtimePool = createPool(RUNTIME_URL);
  const migrationPath = path.resolve(
    __dirname,
    '../../repositories/postgres/migrations/001_mission_queue.sql',
  );
  const migrationSql = readFileSync(migrationPath, 'utf8')
    .replace(/^\\set ON_ERROR_STOP on\r?\n/, '');
  const reset = () => adminPool.query('TRUNCATE TABLE oxkio.missions');

  try {
    await t.test('migration is repeatable and installs the constrained RLS boundary', async () => {
      await adminPool.query(migrationSql);
      await adminPool.query(migrationSql);

      const table = await adminPool.query(
        `SELECT c.relrowsecurity, c.relforcerowsecurity, r.rolname AS owner
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_roles r ON r.oid = c.relowner
         WHERE n.nspname = 'oxkio' AND c.relname = 'missions'`,
      );
      assert.deepEqual(table.rows, [{
        relrowsecurity: true,
        relforcerowsecurity: true,
        owner: 'oxkio_mission_owner',
      }]);

      const runtimeRole = await adminPool.query(
        `SELECT rolsuper, rolcreaterole, rolcreatedb, rolcanlogin, rolinherit, rolbypassrls
         FROM pg_roles WHERE rolname = 'oxkio_mission_runtime'`,
      );
      assert.deepEqual(runtimeRole.rows, [{
        rolsuper: false,
        rolcreaterole: false,
        rolcreatedb: false,
        rolcanlogin: true,
        rolinherit: false,
        rolbypassrls: false,
      }]);

      const privileges = await adminPool.query(
        `SELECT
           has_table_privilege('oxkio_mission_runtime', 'oxkio.missions', 'SELECT') AS can_select,
           has_table_privilege('oxkio_mission_runtime', 'oxkio.missions', 'INSERT') AS can_insert,
           has_table_privilege('oxkio_mission_runtime', 'oxkio.missions', 'DELETE') AS can_delete`,
      );
      assert.deepEqual(privileges.rows, [{
        can_select: true,
        can_insert: true,
        can_delete: false,
      }]);

      const objects = await adminPool.query(
        `SELECT
           (SELECT count(*)::int FROM information_schema.tables
            WHERE table_schema = 'oxkio' AND table_name = 'missions') AS table_count,
           (SELECT count(*)::int FROM pg_policies
            WHERE schemaname = 'oxkio' AND tablename = 'missions') AS policy_count`,
      );
      assert.deepEqual(objects.rows, [{ table_count: 1, policy_count: 1 }]);
    });

    await t.test('create survives pool closure and idempotency survives reopening', async () => {
      await reset();
      const expected = missionFor();
      const firstPool = createPool(RUNTIME_URL);
      const firstRepository = new PostgresMissionRepository({ pool: firstPool });
      const created = await firstRepository.create(SCOPE, expected, 'create-alpha');
      assert.equal(created.created, true);
      assert.deepEqual(created.mission, expected);
      await firstPool.end();

      const reopenedPool = createPool(RUNTIME_URL);
      const reopened = new PostgresMissionRepository({ pool: reopenedPool });
      assert.deepEqual(await reopened.get(SCOPE, expected.missionId), expected);
      const replay = await reopened.create(SCOPE, expected, 'create-alpha');
      assert.equal(replay.created, false);
      assert.deepEqual(replay.mission, expected);
      await reopenedPool.end();
    });

    await t.test('concurrent create has one winner and idempotency remains scoped', async () => {
      await reset();
      const repository = new PostgresMissionRepository({ pool: runtimePool });
      const mission = missionFor();
      const outcomes = await Promise.all([
        repository.create(SCOPE, mission, 'concurrent-create'),
        repository.create(SCOPE, mission, 'concurrent-create'),
      ]);
      assert.equal(outcomes.filter((outcome) => outcome.created).length, 1);
      assert.equal(outcomes.filter((outcome) => !outcome.created).length, 1);
      assert.equal((await repository.list(SCOPE)).length, 1);

      await assert.rejects(
        repository.create(SCOPE, missionFor(SCOPE, 'mission-other'), 'concurrent-create'),
        { code: 'idempotency_conflict' },
      );
      await assert.rejects(
        repository.create(SCOPE, mission, 'different-key'),
        { code: 'mission_already_exists' },
      );

      const independentScope = { ...SCOPE, tenantId: 'tenant-independent' };
      const independent = await repository.create(
        independentScope,
        missionFor(independentScope, 'mission-independent'),
        'concurrent-create',
      );
      assert.equal(independent.created, true);
    });

    await t.test('CAS permits 1 to 4 and 4 to 7, then rejects stale, equal, and regressive writes', async () => {
      await reset();
      const repository = new PostgresMissionRepository({ pool: runtimePool });
      await repository.create(SCOPE, missionFor(), 'create-cas');

      const versionOne = await repository.get(SCOPE, 'mission-alpha');
      const versionFour = await repository.saveIfVersion(
        SCOPE,
        advanceMission(versionOne, 4, 'Advance atomically to version four'),
        1,
      );
      assert.equal(versionFour.version, 4);
      const versionSeven = await repository.saveIfVersion(
        SCOPE,
        advanceMission(versionFour, 7, 'Advance atomically to version seven'),
        4,
      );
      assert.equal(versionSeven.version, 7);

      const left = advanceMission(versionSeven, 8, 'Concurrent writer left');
      const right = advanceMission(versionSeven, 8, 'Concurrent writer right');
      const writers = await Promise.allSettled([
        repository.saveIfVersion(SCOPE, left, 7),
        repository.saveIfVersion(SCOPE, right, 7),
      ]);
      assert.equal(writers.filter((item) => item.status === 'fulfilled').length, 1);
      assert.equal(writers.filter((item) => item.status === 'rejected').length, 1);
      assert.equal(
        writers.find((item) => item.status === 'rejected').reason.code,
        'version_conflict',
      );

      const current = await repository.get(SCOPE, 'mission-alpha');
      await assert.rejects(
        repository.saveIfVersion(SCOPE, advanceMission(current, current.version, 'Equal version'), current.version),
        { code: 'invalid_version_advance' },
      );
      await assert.rejects(
        repository.saveIfVersion(SCOPE, advanceMission(current, current.version - 1, 'Regressive version'), current.version),
        { code: 'invalid_version_advance' },
      );
    });

    await t.test('application scope, RLS, direct SQL, and a reused pool connection isolate all dimensions', async () => {
      await reset();
      await runtimePool.end();
      runtimePool = createPool(RUNTIME_URL, { max: 1 });
      const repository = new PostgresMissionRepository({ pool: runtimePool });
      await repository.create(SCOPE, missionFor(), 'create-isolation');

      await assert.rejects(
        repository.create(undefined, missionFor(), 'missing-scope-create'),
        { code: 'invalid_scope' },
      );
      await assert.rejects(
        repository.get(undefined, 'mission-alpha'),
        { code: 'invalid_scope' },
      );
      await assert.rejects(repository.list(undefined), { code: 'invalid_scope' });
      await assert.rejects(
        repository.saveIfVersion(undefined, advanceMission(
          await repository.get(SCOPE, 'mission-alpha'),
          2,
          'Missing scope save',
        ), 1),
        { code: 'invalid_scope' },
      );

      for (const foreignScope of [
        { ...SCOPE, tenantId: 'tenant-foreign' },
        { ...SCOPE, userId: 'user-foreign' },
        { ...SCOPE, clientId: 'client-foreign' },
      ]) {
        await assert.rejects(
          repository.get(foreignScope, 'mission-alpha'),
          { code: 'mission_not_found' },
        );
        assert.deepEqual(await repository.list(foreignScope), []);
        const candidate = advanceMission(
          await repository.get(SCOPE, 'mission-alpha'),
          2,
          'Attempt a foreign scoped save',
        );
        await assert.rejects(
          repository.saveIfVersion(foreignScope, candidate, 1),
          { code: 'mission_not_found' },
        );
        const direct = await scopedQuery(
          runtimePool,
          foreignScope,
          'SELECT mission_id FROM oxkio.missions WHERE mission_id = $1',
          ['mission-alpha'],
        );
        assert.equal(direct.rows.length, 0);
      }

      assert.equal((await repository.list(SCOPE)).length, 1);
      const withoutScope = await runtimePool.query('SELECT mission_id FROM oxkio.missions');
      assert.equal(withoutScope.rows.length, 0);

      await assert.rejects(
        scopedQuery(
          runtimePool,
          SCOPE,
          `INSERT INTO oxkio.missions (
             tenant_id, user_id, client_id, mission_id, idempotency_key,
             project_id, workspace_id, title, objective, scope_text, status,
             priority, schema_version, version, created_at, updated_at,
             next_action, source_interaction_id, aggregate_data
           )
           SELECT $1, user_id, client_id, $2, $3, project_id, workspace_id,
             title, objective, scope_text, status, priority, schema_version,
             version, created_at, updated_at, next_action, source_interaction_id,
             aggregate_data
           FROM oxkio.missions WHERE mission_id = 'mission-alpha'`,
          ['tenant-cross-write', 'mission-cross-write', 'key-cross-write'],
        ),
        { code: '42501' },
      );

      const client = await runtimePool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.tenant_id', $1, true)", [SCOPE.tenantId]);
        await client.query("SELECT set_config('app.user_id', $1, true)", [SCOPE.userId]);
        await client.query("SELECT set_config('app.client_id', $1, true)", [SCOPE.clientId]);
        await client.query('SET LOCAL row_security = off');
        await assert.rejects(
          client.query('SELECT mission_id FROM oxkio.missions'),
          { code: '42501' },
        );
      } finally {
        await client.query('ROLLBACK').catch(() => {});
        client.release();
      }

      const escalationClient = await runtimePool.connect();
      try {
        await escalationClient.query('BEGIN');
        await assert.rejects(
          escalationClient.query('SET LOCAL ROLE oxkio_mission_owner'),
          { code: '42501' },
        );
      } finally {
        await escalationClient.query('ROLLBACK').catch(() => {});
        escalationClient.release();
      }
    });

    await t.test('list is scoped, filtered, null-aware, and deterministically ordered', async () => {
      await reset();
      const repository = new PostgresMissionRepository({ pool: runtimePool });
      await repository.create(
        SCOPE,
        missionFor(SCOPE, 'mission-charlie', { projectId: 'project-beta', workspaceId: null, priority: 'high' }),
        'create-charlie',
      );
      await repository.create(SCOPE, missionFor(SCOPE, 'mission-bravo'), 'create-bravo');
      await repository.create(SCOPE, missionFor(SCOPE, 'mission-alpha'), 'create-alpha');

      assert.deepEqual(
        (await repository.list(SCOPE)).map((mission) => mission.missionId),
        ['mission-alpha', 'mission-bravo', 'mission-charlie'],
      );
      assert.deepEqual(
        (await repository.list(SCOPE, { projectId: 'project-alpha' }))
          .map((mission) => mission.missionId),
        ['mission-alpha', 'mission-bravo'],
      );
      assert.deepEqual(
        (await repository.list(SCOPE, { workspaceId: null })).map((mission) => mission.missionId),
        ['mission-charlie'],
      );
      assert.equal((await repository.list(SCOPE, { status: MISSION_STATES.PROPOSED })).length, 3);
      assert.deepEqual(
        (await repository.list(SCOPE, { priority: 'high' })).map((mission) => mission.missionId),
        ['mission-charlie'],
      );
      await assert.rejects(
        repository.list(SCOPE, { tenantId: 'tenant-foreign' }),
        { code: 'unsupported_mission_filter' },
      );
    });

    await t.test('rollback, timeout, unavailable DB, and uncertain commit all fail closed', async () => {
      await reset();
      const repository = new PostgresMissionRepository({ pool: runtimePool });

      const rollbackRepository = new PostgresMissionRepository({
        pool: proxyPool(runtimePool, async (client, query, values) => {
          const result = await client.query(query, values);
          if (typeof query === 'string' && query.trimStart().startsWith('INSERT INTO oxkio.missions')) {
            const induced = new Error('induced failure after insert');
            induced.code = 'XX000';
            throw induced;
          }
          return result;
        }),
      });
      await assert.rejects(
        rollbackRepository.create(SCOPE, missionFor(), 'rollback-create'),
        { code: 'mission_repository_failure' },
      );
      await assert.rejects(repository.get(SCOPE, 'mission-alpha'), { code: 'mission_not_found' });

      await repository.create(SCOPE, missionFor(), 'create-timeout');
      const timeoutRepository = new PostgresMissionRepository({
        pool: proxyPool(runtimePool, async (client, query, values) => {
          if (typeof query === 'string' && query.includes('FROM oxkio.missions')) {
            const timeout = new Error('induced query timeout');
            timeout.code = '57014';
            throw timeout;
          }
          return client.query(query, values);
        }),
      });
      await assert.rejects(
        timeoutRepository.get(SCOPE, 'mission-alpha'),
        { code: 'mission_repository_timeout' },
      );

      const unavailableUrl = new URL(RUNTIME_URL);
      unavailableUrl.port = '65432';
      const unavailablePool = createPool(unavailableUrl.toString(), {
        connectionTimeoutMillis: 300,
      });
      try {
        const unavailable = new PostgresMissionRepository({ pool: unavailablePool });
        await assert.rejects(
          unavailable.get(SCOPE, 'mission-alpha'),
          { code: 'mission_repository_unavailable' },
        );
      } finally {
        await unavailablePool.end();
      }

      await reset();
      const uncertainRepository = new PostgresMissionRepository({
        pool: proxyPool(runtimePool, async (client, query, values) => {
          const result = await client.query(query, values);
          if (query === 'COMMIT') {
            const uncertain = new Error('induced disconnect after commit');
            uncertain.code = 'ECONNRESET';
            throw uncertain;
          }
          return result;
        }),
      });
      await assert.rejects(
        uncertainRepository.create(SCOPE, missionFor(), 'uncertain-create'),
        { code: 'mission_commit_outcome_unknown' },
      );
      const reconciled = await repository.create(SCOPE, missionFor(), 'uncertain-create');
      assert.equal(reconciled.created, false);

      const candidate = advanceMission(reconciled.mission, 4, 'Reconcile uncertain save by reading');
      await assert.rejects(
        uncertainRepository.saveIfVersion(SCOPE, candidate, 1),
        { code: 'mission_commit_outcome_unknown' },
      );
      assert.equal((await repository.get(SCOPE, 'mission-alpha')).version, 4);
    });

    await t.test('Task cancellation, blocker, nextAction, version, and terminal state survive reopening', async () => {
      await reset();
      const firstPool = createPool(RUNTIME_URL);
      const firstService = new MissionService({
        repository: new PostgresMissionRepository({ pool: firstPool }),
      });
      await firstService.createMission(SCOPE, missionPayload(SCOPE, 'mission-blocker'), {
        idempotencyKey: 'create-mission-blocker',
        now: NOW,
        idFactory: (kind) => `${kind}-create-blocker`,
      });
      await firstService.addTask(SCOPE, 'mission-blocker', {
        taskId: 'task-blocker',
        action: 'Exercise durable cancellation behavior',
        acceptanceCriteria: [{
          criterionId: 'criterion-task-blocker',
          description: 'The cancellation remains durable',
        }],
        nextAction: 'Prepare the synthetic Task',
      }, {
        expectedVersion: 1,
        now: '2026-08-02T10:01:00.000Z',
        idFactory: (kind) => `${kind}-add-task`,
      });
      await firstService.transitionTask(
        SCOPE,
        'mission-blocker',
        'task-blocker',
        TASK_STATES.READY,
        {
          expectedVersion: 2,
          now: '2026-08-02T10:02:00.000Z',
          idFactory: (kind) => `${kind}-task-ready`,
        },
      );
      const cancelled = await firstService.transitionTask(
        SCOPE,
        'mission-blocker',
        'task-blocker',
        TASK_STATES.CANCELLED,
        {
          expectedVersion: 3,
          now: '2026-08-02T10:03:00.000Z',
          idFactory: (kind) => `${kind}-task-cancelled`,
          blockerIdFactory: () => 'blocker-required-task-cancelled',
          result: { reason: 'synthetic-cancellation' },
        },
      );
      assert.equal(cancelled.mission.version, 5);
      await firstPool.end();

      const reopenedPool = createPool(RUNTIME_URL);
      const reopenedService = new MissionService({
        repository: new PostgresMissionRepository({ pool: reopenedPool }),
      });
      const restored = await reopenedService.getMission(SCOPE, 'mission-blocker');
      assert.equal(restored.status, MISSION_STATES.PROPOSED);
      assert.equal(restored.tasks[0].status, TASK_STATES.CANCELLED);
      assert.equal(restored.blockers[0].type, REQUIRED_TASK_CANCELLED);
      assert.equal(restored.blockers[0].status, 'active');
      assert.equal(restored.nextAction, REQUIRED_TASK_CANCELLED_NEXT_ACTION);
      assert.equal(restored.version, 5);
      await assert.rejects(
        reopenedService.transitionMission(SCOPE, 'mission-blocker', MISSION_STATES.READY, {
          expectedVersion: 5,
          now: '2026-08-02T10:04:00.000Z',
          idFactory: (kind) => `${kind}-rejected-ready`,
        }),
        { code: 'required_task_cancelled_blocker_active' },
      );

      await reopenedService.createMission(SCOPE, missionPayload(SCOPE, 'mission-terminal'), {
        idempotencyKey: 'create-mission-terminal',
        now: NOW,
        idFactory: (kind) => `${kind}-create-terminal`,
      });
      const terminal = await reopenedService.transitionMission(
        SCOPE,
        'mission-terminal',
        MISSION_STATES.CANCELLED,
        {
          expectedVersion: 1,
          now: '2026-08-02T10:05:00.000Z',
          idFactory: (kind) => `${kind}-terminal`,
          result: { reason: 'synthetic-terminal-state' },
        },
      );
      assert.equal(terminal.mission.status, MISSION_STATES.CANCELLED);
      await reopenedPool.end();

      const finalPool = createPool(RUNTIME_URL);
      const finalService = new MissionService({
        repository: new PostgresMissionRepository({ pool: finalPool }),
      });
      assert.equal(
        (await finalService.getMission(SCOPE, 'mission-terminal')).status,
        MISSION_STATES.CANCELLED,
      );
      await assert.rejects(
        finalService.addTask(SCOPE, 'mission-terminal', {
          taskId: 'task-after-terminal',
          action: 'Must not be accepted',
          acceptanceCriteria: ['Must remain immutable'],
          nextAction: 'Do not persist this Task',
        }, { expectedVersion: 2, now: LATER }),
        { code: 'terminal_mission_immutable' },
      );
      await finalPool.end();
    });

    await t.test('unknown schema and semantically corrupt aggregate fail closed', async () => {
      await reset();
      const repository = new PostgresMissionRepository({ pool: runtimePool });
      await repository.create(SCOPE, missionFor(), 'create-corruption');

      await adminPool.query(
        `UPDATE oxkio.missions SET schema_version = 99
         WHERE tenant_id = $1 AND user_id = $2 AND client_id = $3 AND mission_id = $4`,
        [SCOPE.tenantId, SCOPE.userId, SCOPE.clientId, 'mission-alpha'],
      );
      await assert.rejects(
        repository.get(SCOPE, 'mission-alpha'),
        { code: 'unsupported_mission_schema_version' },
      );

      await adminPool.query(
        `UPDATE oxkio.missions
         SET schema_version = 1,
             aggregate_data = jsonb_set(aggregate_data, '{owners}', '["x"]'::jsonb)
         WHERE tenant_id = $1 AND user_id = $2 AND client_id = $3 AND mission_id = $4`,
        [SCOPE.tenantId, SCOPE.userId, SCOPE.clientId, 'mission-alpha'],
      );
      await assert.rejects(
        repository.get(SCOPE, 'mission-alpha'),
        { code: 'mission_data_corrupt' },
      );

      await assert.rejects(
        adminPool.query(
          `UPDATE oxkio.missions
           SET aggregate_data = aggregate_data || '{"unexpected":[]}'::jsonb
           WHERE tenant_id = $1 AND user_id = $2 AND client_id = $3 AND mission_id = $4`,
          [SCOPE.tenantId, SCOPE.userId, SCOPE.clientId, 'mission-alpha'],
        ),
        { code: '23514' },
      );
    });

    await t.test('a reasonably large Mission is exact and the adapter has no alternate store', async () => {
      await reset();
      const repository = new PostgresMissionRepository({ pool: runtimePool });
      const largeMission = missionFor(SCOPE, 'mission-large', {
        participants: Array.from({ length: 120 }, (_, index) => `participant-${index + 100}`),
        risks: Array.from({ length: 250 }, (_, index) => ({
          riskId: `risk-${index + 100}`,
          description: `Synthetic risk ${index + 1}`,
        })),
        acceptanceCriteria: Array.from({ length: 80 }, (_, index) => ({
          criterionId: `criterion-large-${index + 100}`,
          description: `Verify synthetic criterion ${index + 1}`,
        })),
      });
      await repository.create(SCOPE, largeMission, 'create-large-mission');
      assert.deepEqual(await repository.get(SCOPE, 'mission-large'), largeMission);

      const source = readFileSync(
        path.resolve(__dirname, 'postgres-mission-repository.js'),
        'utf8',
      );
      assert.doesNotMatch(source, /require\(['"]node:fs['"]\)/);
      assert.doesNotMatch(source, /firebase|firestore|fallback/i);
      assert.equal(typeof repository.delete, 'undefined');
      assert.equal(typeof repository.hardDelete, 'undefined');
      assert.equal(typeof repository.globalList, 'undefined');
      assert.equal(typeof repository.findAcrossTenants, 'undefined');
    });
  } finally {
    await runtimePool.end().catch(() => {});
    await adminPool.end().catch(() => {});
  }
});

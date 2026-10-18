'use strict';

// Integracion REAL de PostgresApprovalRepository contra un PostgreSQL
// EFIMERO y aislado (B4.E sobre base desechable, nunca Neon/produccion).
//
// Se activa solo con dos URLs de prueba (credenciales sinteticas):
//   OXKIO_TEST_APPROVAL_PG_ADMIN_URL    superusuario del cluster efimero
//   OXKIO_TEST_APPROVAL_PG_RUNTIME_URL  oxkio_approval_runtime (password de prueba)
// Sin ellas: SKIP. Con un host que no sea loopback: falla cerrado sin
// conectar. Las URLs nunca se imprimen. Nombres distintos de
// OXKIO_APPROVAL_PG_RUNTIME_URL a proposito: este test crea roles, aplica
// migraciones y borra su base de datos, y nunca debe poder apuntar al
// secreto real.
//
// Cada ejecucion crea una base de datos nueva y vacia, aplica 001-004 tal
// cual (sin la linea \set de psql, mismo criterio que Mission Queue),
// reproduce la preparacion de infraestructura documentada en B4.A/B4.B/
// B4.B.2 (roles y grants que ninguna migracion crea) y la elimina al final.
// Reutiliza la suite de contrato ApprovalRepositoryV2 contra PostgreSQL real.

const assert = require('node:assert/strict');
const test = require('node:test');
const { before, after } = require('node:test');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { randomBytes, randomUUID } = require('node:crypto');

const { Pool } = require('pg');

const { PostgresApprovalRepository, PostgresApprovalRepositoryError } = require('./postgres-approval-repository');
const { runApprovalRepositoryV2ContractTests, SYNTHETIC_RECORD } = require('./approval-repository-v2-contract');

const ADMIN_URL = process.env.OXKIO_TEST_APPROVAL_PG_ADMIN_URL;
const RUNTIME_URL = process.env.OXKIO_TEST_APPROVAL_PG_RUNTIME_URL;
const INTEGRATION_READY = Boolean(ADMIN_URL && RUNTIME_URL);
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const MIGRATIONS = ['001_mission_queue.sql', '002_mission_confirmations.sql', '003_approval_items.sql', '004_approval_items_client_id_guard.sql'];
const RUNTIME_UPDATE_COLUMNS = [
  'status', 'approved_by', 'approved_at', 'rejected_at', 'resolved_at',
  'execution_id', 'execution_attempt_count', 'execution_started_at',
  'execution_lease_expires_at', 'execution_completed_at', 'execution_failed_at',
  'result', 'error', 'version', 'updated_at',
];
const SCOPE_A = Object.freeze({ clientId: 'cliente-cero' });
const SCOPE_B = Object.freeze({ clientId: 'cliente-b' });

function connectionOf(url, database) {
  const parsed = new URL(url);
  if (!LOOPBACK.has(parsed.hostname)) {
    throw new Error('Refusing a non-loopback PostgreSQL host: this test only runs against an ephemeral local instance.');
  }
  return {
    host: parsed.hostname.replace(/^\[|\]$/g, ''),
    port: parsed.port ? Number(parsed.port) : 5432,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: database || decodeURIComponent(parsed.pathname.replace(/^\/+/, '')) || 'postgres',
  };
}

function migration(name) {
  return readFileSync(path.resolve(__dirname, 'postgres/migrations', name), 'utf8')
    .replace(/^\\set ON_ERROR_STOP on\r?\n/, '');
}

async function codeOf(promise) {
  try { await promise; return 'ok'; } catch (error) { return error.code; }
}

if (!INTEGRATION_READY) {
  test('PostgresApprovalRepository real PostgreSQL/RLS integration', {
    skip: 'isolated PostgreSQL URLs are not configured',
  }, () => {});
} else {
  const database = `oxkio_approval_it_${randomBytes(6).toString('hex')}`;
  const pools = [];
  let serverAdmin;
  let admin;
  let runtimeConnection;

  const runtimePool = (max = 4) => {
    const pool = new Pool({ ...runtimeConnection, max, connectionTimeoutMillis: 5_000, query_timeout: 10_000 });
    pools.push(pool);
    return pool;
  };
  const repositoryFor = (scope, pool = runtimePool()) => new PostgresApprovalRepository({ pool, scope });

  // Raw transaction as oxkio_approval_runtime; scope fixed only if given. Always rolled back
  // unless commit is asked: a failing probe never leaves anything behind.
  async function asRuntime(pool, clientId, fn, { commit = false } = {}) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (clientId !== undefined) await client.query("SELECT set_config('app.client_id', $1, true)", [clientId]);
      const result = await fn(client);
      await client.query(commit ? 'COMMIT' : 'ROLLBACK');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  before(async () => {
    const serverConnection = connectionOf(ADMIN_URL);
    runtimeConnection = connectionOf(RUNTIME_URL, database);
    serverAdmin = new Pool({ ...serverConnection, max: 1 });
    // Roles are cluster-wide: created once, then verified (never silently altered).
    await serverAdmin.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'oxkio_mission_owner') THEN CREATE ROLE oxkio_mission_owner NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'oxkio_mission_runtime') THEN CREATE ROLE oxkio_mission_runtime NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'oxkio_approval_owner') THEN
        CREATE ROLE oxkio_approval_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'oxkio_approval_runtime') THEN
        CREATE ROLE oxkio_approval_runtime LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; END IF;
    END $$`);
    // Test password bound as a parameter and composed server-side (B4.A pattern); never logged.
    const { rows: [alter] } = await serverAdmin.query(
      "SELECT format('ALTER ROLE oxkio_approval_runtime PASSWORD %L', $1::text) AS sql",
      [runtimeConnection.password],
    );
    await serverAdmin.query(alter.sql);
    await serverAdmin.query(`CREATE DATABASE ${database}`);
    // Precondition of 001 (CREATE SCHEMA ... AUTHORIZATION under SET LOCAL ROLE oxkio_mission_owner).
    await serverAdmin.query(`GRANT CREATE ON DATABASE ${database} TO oxkio_mission_owner`);
    admin = new Pool({ ...serverConnection, database, max: 2 });
  });

  after(async () => {
    await Promise.allSettled(pools.map((pool) => pool.end()));
    if (admin) await admin.end();
    if (serverAdmin) {
      // pool.end() resolves once the pool forgets its clients, not once their
      // sockets close: a FORCE drop could still terminate one (57P01) and
      // surface as an uncaughtException. Wait until no backend is left.
      for (let i = 0; i < 200; i++) {
        const { rows: [left] } = await serverAdmin.query(
          'SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = $1', [database],
        );
        if (left.n === 0) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      await serverAdmin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
      await serverAdmin.end();
    }
  });

  test('A. migrations: empty database, documented infrastructure, 001-004, RLS ENABLED+FORCED, NULLIF policy, safe reruns', async () => {
    const before = await admin.query("SELECT count(*)::int AS n FROM pg_namespace WHERE nspname = 'oxkio'");
    assert.equal(before.rows[0].n, 0, 'the database starts empty');

    await admin.query(migration(MIGRATIONS[0]));
    await admin.query(migration(MIGRATIONS[1]));
    // B4.B (CREATE for the owner) and B4.B.2 (USAGE for owner and runtime), as documented.
    await admin.query(`BEGIN; SET LOCAL ROLE oxkio_mission_owner;
      GRANT CREATE ON SCHEMA oxkio TO oxkio_approval_owner;
      GRANT USAGE ON SCHEMA oxkio TO oxkio_approval_owner;
      GRANT USAGE ON SCHEMA oxkio TO oxkio_approval_runtime; COMMIT;`);

    await admin.query(migration(MIGRATIONS[2]));
    await admin.query(migration(MIGRATIONS[2])); // 003 is repeatable before 004
    await admin.query(migration(MIGRATIONS[3]));

    const table = await admin.query(`SELECT c.relrowsecurity, c.relforcerowsecurity, r.rolname AS owner
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_roles r ON r.oid = c.relowner
      WHERE n.nspname = 'oxkio' AND c.relname = 'approval_items'`);
    assert.deepEqual(table.rows, [{ relrowsecurity: true, relforcerowsecurity: true, owner: 'oxkio_approval_owner' }]);

    const expected = "(client_id = NULLIF(current_setting('app.client_id'::text, true), ''::text))";
    const policies = await admin.query(`SELECT policyname, permissive, roles::text[] AS roles, cmd, qual, with_check
      FROM pg_policies WHERE schemaname = 'oxkio' AND tablename = 'approval_items'`);
    assert.deepEqual(policies.rows, [{
      policyname: 'approval_items_scope_isolation', permissive: 'PERMISSIVE', roles: ['public'], cmd: 'ALL',
      qual: expected, with_check: expected,
    }]);
    const guard = await admin.query(`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conname = 'approval_items_client_id_nonempty_ck'`);
    assert.deepEqual(guard.rows, [{ def: "CHECK ((btrim(client_id) <> ''::text))" }]);

    // 004 is not repeatable by contract: a rerun fails whole (one transaction) and changes nothing.
    assert.equal(await codeOf(admin.query(migration(MIGRATIONS[3]))), '42710');
    const after = await admin.query(`SELECT qual, with_check FROM pg_policies WHERE tablename = 'approval_items'`);
    assert.deepEqual(after.rows, [{ qual: expected, with_check: expected }]);
  });

  test('B. isolation: A reads A; B neither reads nor updates A; A cannot touch B; missing or empty scope sees and writes nothing', async () => {
    const pool = runtimePool();
    const a = repositoryFor(SCOPE_A, pool);
    const b = repositoryFor(SCOPE_B, pool);
    const itemA = (await a.create(SYNTHETIC_RECORD, SCOPE_A)).item;
    const itemB = (await b.create(SYNTHETIC_RECORD, SCOPE_B)).item;

    assert.equal((await a.getById(itemA.id, SCOPE_A)).item.scope.clientId, 'cliente-cero');
    assert.deepEqual(await b.getById(itemA.id, SCOPE_B), { ok: false, code: 'not_found' });
    assert.ok(!(await b.listPending(SCOPE_B)).some((item) => item.id === itemA.id));
    assert.deepEqual(await b.approve(itemA.id, { expectedVersion: 1 }), { ok: false, code: 'not_found' });
    assert.deepEqual(await a.reject(itemB.id, { expectedVersion: 1 }), { ok: false, code: 'not_found' });
    const untouched = await admin.query('SELECT id, version::int, status FROM oxkio.approval_items WHERE id = ANY($1) ORDER BY client_id', [[itemA.id, itemB.id]]);
    assert.deepEqual(untouched.rows.map((row) => [row.version, row.status]), [[1, 'pending'], [1, 'pending']]);

    // Raw SQL as runtime: another scope's row is invisible to SELECT/UPDATE; WITH CHECK refuses a foreign client_id.
    const rawUpdate = await asRuntime(pool, 'cliente-b', (c) => c.query("UPDATE oxkio.approval_items SET status = 'rejected' WHERE id = $1", [itemA.id]));
    assert.equal(rawUpdate.rowCount, 0);
    assert.equal(await codeOf(asRuntime(pool, 'cliente-b', (c) => c.query(
      "INSERT INTO oxkio.approval_items (id, client_id, version, status, record, created_at, updated_at) VALUES ($1, 'cliente-cero', 1, 'pending', '{}', now(), now())",
      [randomUUID()],
    ))), '42501');

    // No scope, empty scope, and the post-COMMIT reset value '' on a reused connection (B4.D.1).
    for (const scope of [undefined, '', '   ']) {
      const seen = await asRuntime(pool, scope, (c) => c.query('SELECT count(*)::int AS n FROM oxkio.approval_items'));
      assert.equal(seen.rows[0].n, 0, `scope ${JSON.stringify(scope)} sees nothing`);
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN'); await client.query("SELECT set_config('app.client_id', 'cliente-cero', true)"); await client.query('COMMIT');
      const reset = await client.query("SELECT current_setting('app.client_id', true) AS v, (SELECT count(*)::int FROM oxkio.approval_items) AS n");
      assert.deepEqual(reset.rows, [{ v: '', n: 0 }]);
    } finally { client.release(); }
    assert.equal(await codeOf(asRuntime(pool, '', (c) => c.query(
      "INSERT INTO oxkio.approval_items (id, client_id, version, status, record, created_at, updated_at) VALUES ($1, '', 1, 'pending', '{}', now(), now())",
      [randomUUID()],
    ))), '42501');
    // The data guard holds even where RLS does not apply (superuser): no empty or blank client_id.
    assert.equal(await codeOf(admin.query(
      "INSERT INTO oxkio.approval_items (id, client_id, version, status, record, created_at, updated_at) VALUES ($1, '  ', 1, 'pending', '{}', now(), now())",
      [randomUUID()],
    )), '23514');
    // FORCE: even the table owner sees nothing without a scope.
    const owner = await admin.query("BEGIN; SET LOCAL ROLE oxkio_approval_owner; SELECT count(*)::int AS n FROM oxkio.approval_items; COMMIT;");
    assert.equal(owner[2].rows[0].n, 0);
    // The repository refuses a missing or empty scope before any connection.
    for (const scope of [undefined, { clientId: '' }, { clientId: '  ' }]) {
      assert.throws(() => new PostgresApprovalRepository({ pool, scope }), (e) => e instanceof PostgresApprovalRepositoryError && e.code === 'scope_required');
    }
  });

  test('C. privileges: runtime has no DELETE, TRUNCATE, ownership, DDL or Mission Queue access; UPDATE only on the authorized columns', async () => {
    const role = await admin.query(`SELECT rolsuper, rolcreaterole, rolcreatedb, rolcanlogin, rolinherit, rolbypassrls, rolreplication
      FROM pg_roles WHERE rolname = 'oxkio_approval_runtime'`);
    assert.deepEqual(role.rows, [{ rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolcanlogin: true, rolinherit: false, rolbypassrls: false, rolreplication: false }]);

    const table = await admin.query(`SELECT p AS privilege, has_table_privilege('oxkio_approval_runtime', 'oxkio.approval_items', p) AS granted
      FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS p`);
    assert.deepEqual(Object.fromEntries(table.rows.map((r) => [r.privilege, r.granted])), {
      SELECT: true, INSERT: true, UPDATE: false, DELETE: false, TRUNCATE: false, REFERENCES: false, TRIGGER: false,
    });
    const columns = await admin.query(`SELECT a.attname AS column, has_column_privilege('oxkio_approval_runtime', 'oxkio.approval_items', a.attname, 'UPDATE') AS granted
      FROM pg_attribute a WHERE a.attrelid = 'oxkio.approval_items'::regclass AND a.attnum > 0 AND NOT a.attisdropped`);
    assert.deepEqual(columns.rows.filter((r) => r.granted).map((r) => r.column).sort(), [...RUNTIME_UPDATE_COLUMNS].sort());

    const membership = await admin.query(`SELECT r AS role, pg_has_role('oxkio_approval_runtime', r, 'MEMBER') AS member
      FROM unnest(ARRAY['oxkio_approval_owner','oxkio_mission_owner','oxkio_mission_runtime']) AS r`);
    assert.ok(membership.rows.every((r) => r.member === false), JSON.stringify(membership.rows));
    const schema = await admin.query(`SELECT has_schema_privilege('oxkio_approval_runtime', 'oxkio', 'USAGE') AS usage,
      has_schema_privilege('oxkio_approval_runtime', 'oxkio', 'CREATE') AS oxkio_create,
      has_schema_privilege('oxkio_approval_runtime', 'public', 'CREATE') AS public_create,
      has_database_privilege('oxkio_approval_runtime', current_database(), 'CREATE') AS db_create`);
    assert.deepEqual(schema.rows, [{ usage: true, oxkio_create: false, public_create: false, db_create: false }]);
    const mission = await admin.query(`SELECT t, p, has_table_privilege('oxkio_approval_runtime', t, p) AS granted
      FROM unnest(ARRAY['oxkio.missions','oxkio.mission_confirmations']) AS t,
           unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS p`);
    assert.ok(mission.rows.every((r) => r.granted === false), 'no Mission Queue privilege');

    // The same, enforced: each probe as the real runtime login, in its own rolled-back transaction.
    const pool = runtimePool(1);
    const id = (await repositoryFor(SCOPE_A, pool).create(SYNTHETIC_RECORD, SCOPE_A)).item.id;
    const denied = {
      delete: ['DELETE FROM oxkio.approval_items WHERE id = $1', [id]],
      truncate: ['TRUNCATE oxkio.approval_items', []],
      update_record: ["UPDATE oxkio.approval_items SET record = '{}' WHERE id = $1", [id]],
      update_client_id: ["UPDATE oxkio.approval_items SET client_id = 'cliente-b' WHERE id = $1", [id]],
      update_id: ['UPDATE oxkio.approval_items SET id = gen_random_uuid() WHERE id = $1', [id]],
      update_created_at: ['UPDATE oxkio.approval_items SET created_at = now() WHERE id = $1', [id]],
      disable_rls: ['ALTER TABLE oxkio.approval_items DISABLE ROW LEVEL SECURITY', []],
      no_force_rls: ['ALTER TABLE oxkio.approval_items NO FORCE ROW LEVEL SECURITY', []],
      alter_policy: ['ALTER POLICY approval_items_scope_isolation ON oxkio.approval_items USING (true)', []],
      drop_table: ['DROP TABLE oxkio.approval_items', []],
      create_in_oxkio: ['CREATE TABLE oxkio.runtime_probe (x int)', []],
      create_in_public: ['CREATE TABLE public.runtime_probe (x int)', []],
      set_role_owner: ['SET ROLE oxkio_approval_owner', []],
      read_missions: ['SELECT 1 FROM oxkio.missions LIMIT 1', []],
      read_confirmations: ['SELECT 1 FROM oxkio.mission_confirmations LIMIT 1', []],
    };
    const codes = {};
    for (const [name, [sql, params]] of Object.entries(denied)) codes[name] = await codeOf(asRuntime(pool, 'cliente-cero', (c) => c.query(sql, params)));
    assert.deepEqual(codes, Object.fromEntries(Object.keys(denied).map((name) => [name, '42501'])));
    const still = await admin.query('SELECT version::int, status FROM oxkio.approval_items WHERE id = $1', [id]);
    assert.deepEqual(still.rows, [{ version: 1, status: 'pending' }]);
  });

  test('D1. lifecycle: reject, expire, approve, claimExecution, failExecution, completeExecution, reclaimExpiredExecutions, stale_version', async () => {
    const repo = repositoryFor(SCOPE_A);
    const create = async () => (await repo.create(SYNTHETIC_RECORD, SCOPE_A)).item;

    const rejected = await create();
    assert.equal((await repo.reject(rejected.id, { expectedVersion: 1 })).item.status, 'rejected');
    const expired = await create();
    assert.equal((await repo.expire(expired.id, { expectedVersion: 1, expectedStatus: 'pending' })).item.status, 'expired');

    const item = await create();
    assert.deepEqual(await repo.approve(item.id, { expectedVersion: 5 }), { ok: false, code: 'stale_version' });
    const approved = (await repo.approve(item.id, { expectedVersion: 1 })).item;
    const claim = (await repo.claimExecution(item.id, { expectedVersion: approved.version, expectedStatus: 'approved', executionId: 'exec-1', leaseTtlMs: 60_000 })).item;
    assert.deepEqual([claim.status, claim.executionId, claim.executionAttemptCount, claim.version], ['executing', 'exec-1', 1, 3]);
    const failed = (await repo.failExecution(item.id, { expectedVersion: claim.version, executionId: 'exec-1', error: { code: 'synthetic' } })).item;
    assert.deepEqual([failed.status, failed.error, failed.executionLeaseExpiresAt], ['execution_failed', { code: 'synthetic' }, null]);

    const leased = await create();
    const leasedApproved = (await repo.approve(leased.id, { expectedVersion: 1 })).item;
    const shortClaim = (await repo.claimExecution(leased.id, { expectedVersion: leasedApproved.version, expectedStatus: 'approved', executionId: 'exec-lease', leaseTtlMs: 1 })).item;
    const reclaimable = await repo.reclaimExpiredExecutions(SCOPE_A, Date.parse(shortClaim.executionLeaseExpiresAt) + 1);
    assert.deepEqual(reclaimable.map((i) => i.id), [leased.id]);
    assert.equal((await repo.getById(leased.id, SCOPE_A)).item.status, 'executing', 'reclaim only reports');
    const completed = (await repo.completeExecution(leased.id, { expectedVersion: shortClaim.version, executionId: 'exec-lease', result: { ok: 1 } })).item;
    assert.deepEqual([completed.status, completed.result], ['executed', { ok: 1 }]);
    assert.deepEqual((await repo.listHistory(SCOPE_A)).filter((i) => [rejected.id, expired.id, item.id, leased.id].includes(i.id)).map((i) => i.status).sort(),
      ['executed', 'execution_failed', 'expired', 'rejected']);
  });

  // DEFECT evidence (17/10/2026), not fixed in this phase: #classifyConflict compares
  // row.version (bigint, which pg returns as a string) with a number, so on real
  // PostgreSQL every conflict on an existing row reads as stale_version.
  test('D1b. conflict classification on an existing row: status_conflict and execution_id_mismatch, not stale_version', async () => {
    const repo = repositoryFor(SCOPE_A);
    const item = (await repo.create(SYNTHETIC_RECORD, SCOPE_A)).item;
    // Right version, wrong status: the row is still version 1.
    assert.deepEqual(await repo.expire(item.id, { expectedVersion: 1, expectedStatus: 'approved' }), { ok: false, code: 'status_conflict', currentStatus: 'pending' });
    const approved = (await repo.approve(item.id, { expectedVersion: 1 })).item;
    const claim = (await repo.claimExecution(item.id, { expectedVersion: approved.version, expectedStatus: 'approved', executionId: 'exec-1', leaseTtlMs: 60_000 })).item;
    // Right version and status, another execution.
    assert.deepEqual(await repo.failExecution(item.id, { expectedVersion: claim.version, executionId: 'exec-other', error: null }), { ok: false, code: 'execution_id_mismatch' });
  });

  test('D2. rollback: a statement PostgreSQL rejects commits nothing and leaves the pooled connection reusable', async () => {
    const pool = runtimePool(1);
    const repo = repositoryFor(SCOPE_A, pool);
    const pending = (await repo.listPending(SCOPE_A)).length;
    // jsonb refuses the NUL escape: the INSERT fails inside the scoped transaction.
    await assert.rejects(repo.create({ body: 'nul \u0000 char' }, SCOPE_A), (e) => e.code === 'approval_repository_failure');
    assert.equal((await repo.listPending(SCOPE_A)).length, pending, 'nothing persisted');
    const next = await repo.create(SYNTHETIC_RECORD, SCOPE_A);
    assert.equal(next.ok, true, 'the only pooled connection is clean again');
    const id = randomUUID();
    await assert.rejects(asRuntime(pool, 'cliente-cero', async (c) => {
      await c.query("INSERT INTO oxkio.approval_items (id, client_id, version, status, record, created_at, updated_at) VALUES ($1, 'cliente-cero', 1, 'pending', '{}', now(), now())", [id]);
      throw new Error('synthetic failure after the insert');
    }, { commit: true }), /synthetic failure/);
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM oxkio.approval_items WHERE id = $1', [id])).rows[0].n, 0);
  });

  test('D3. concurrency on two real connections: a blocked CAS waits for the lock holder and loses cleanly; races have exactly one winner', async () => {
    const holderPool = runtimePool(1);
    const repo = repositoryFor(SCOPE_A, runtimePool(1));
    const { id } = (await repo.create(SYNTHETIC_RECORD, SCOPE_A)).item;

    const holder = await holderPool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query("SELECT set_config('app.client_id', 'cliente-cero', true)");
      await holder.query('SELECT id FROM oxkio.approval_items WHERE id = $1 FOR UPDATE', [id]);
      const holderPid = (await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const contender = repo.approve(id, { expectedVersion: 1 });
      let waiting = [];
      for (let i = 0; i < 100 && waiting.length === 0; i++) {
        waiting = (await admin.query(`SELECT pid FROM pg_stat_activity WHERE usename = 'oxkio_approval_runtime'
          AND datname = current_database() AND wait_event_type = 'Lock' AND pid <> $1`, [holderPid])).rows;
        if (waiting.length === 0) await new Promise((r) => setTimeout(r, 20));
      }
      assert.equal(waiting.length, 1, 'the contender is blocked on the row lock, on another backend');
      await holder.query(`UPDATE oxkio.approval_items SET status = 'rejected', rejected_at = now(), resolved_at = now(), version = version + 1, updated_at = now()
        WHERE id = $1 AND version = 1 AND status = 'pending'`, [id]);
      await holder.query('COMMIT');
      assert.deepEqual(await contender, { ok: false, code: 'stale_version' });
    } finally { holder.release(); }
    const final = await admin.query('SELECT version::int, status FROM oxkio.approval_items WHERE id = $1', [id]);
    assert.deepEqual(final.rows, [{ version: 2, status: 'rejected' }]);

    const left = repositoryFor(SCOPE_A, runtimePool(2));
    const right = repositoryFor(SCOPE_A, runtimePool(2));
    for (let round = 0; round < 20; round++) {
      const race = (await left.create(SYNTHETIC_RECORD, SCOPE_A)).item;
      const outcomes = await Promise.all([
        left.approve(race.id, { expectedVersion: 1 }),
        right.reject(race.id, { expectedVersion: 1 }),
      ]);
      assert.equal(outcomes.filter((o) => o.ok).length, 1, `round ${round}: exactly one winner`);
      assert.deepEqual(outcomes.find((o) => !o.ok), { ok: false, code: 'stale_version' });
      const row = await admin.query('SELECT version::int FROM oxkio.approval_items WHERE id = $1', [race.id]);
      assert.equal(row.rows[0].version, 2);
    }
  });

  // The shared ApprovalRepositoryV2 contract, unchanged, against real PostgreSQL.
  runApprovalRepositoryV2ContractTests(async () => repositoryFor(SCOPE_A), { label: 'postgres real' });
}

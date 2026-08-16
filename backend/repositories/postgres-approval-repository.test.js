'use strict';

// Tests OFFLINE de PostgresApprovalRepository (diseno SCOPE-BOUND). Todo
// corre contra un pool/cliente FALSO (fakeApprovalPostgres), sin PostgreSQL
// real, sin Neon, sin credenciales, sin conexion real.
//
// El doble simula, ademas, aislamiento tipo-RLS: cada "conexion" (cada
// llamada a pool.connect()) recuerda el ultimo valor fijado via
// set_config('app.client_id', ...) y SOLO ve filas cuyo client_id coincide
// con ese valor de sesion — igual que una politica RLS `USING (client_id =
// current_setting('app.client_id', true))` con ENABLE+FORCE. Antes de que
// se fije el scope de sesion, nada es visible (fail-closed por defecto,
// igual que el precedente de Mission Queue). Esto permite probar la
// PROPIEDAD ("una instancia scope A no puede tocar filas de scope B") sin
// afirmar que se demuestra RLS real de PostgreSQL — solo que el patron de
// llamadas del adaptador seria compatible con esa RLS si existiera.
//
// Estos tests demuestran: SQL emitido, mapeo fila<->item, CAS, clasificacion
// de conflictos, scope fail-closed/scope-bound, BEGIN/COMMIT/ROLLBACK.
// NUNCA demuestran: concurrencia real de PostgreSQL, RLS real, ni
// comportamiento de Neon.

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  PostgresApprovalRepository,
  PostgresApprovalRepositoryError,
} = require('./postgres-approval-repository');
const { runApprovalRepositoryV2ContractTests } = require('./approval-repository-v2-contract');

const SCOPE = Object.freeze({ clientId: 'cliente-cero' });

// ── Doble sintetico de PostgreSQL con aislamiento por sesion (tipo RLS) ──
function createFakeApprovalPostgres() {
  const rows = [];
  const calls = [];
  let connectCount = 0;

  function normalize(sql) {
    return sql.replace(/\s+/g, ' ').trim();
  }

  function cloneRow(row) {
    return { ...row };
  }

  function byCreatedThenId(a, b) {
    const diff = a.createdAt.getTime() - b.createdAt.getTime();
    return diff !== 0 ? diff : (a.id < b.id ? -1 : 1);
  }

  const pool = {
    connect: async () => {
      connectCount += 1;
      let sessionClientId = null; // nada visible hasta set_config('app.client_id', ...)

      function visible() {
        if (sessionClientId === null) return [];
        return rows.filter((r) => r.clientId === sessionClientId);
      }

      async function query(sql, params = []) {
        calls.push({ sql, params });
        const text = normalize(sql);

        if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
          return { rows: [] };
        }
        if (text.startsWith("SELECT set_config('app.client_id'")) {
          sessionClientId = params[0];
          return { rows: [] };
        }

        if (text.startsWith('INSERT INTO oxkio.approval_items')) {
          const [id, clientId, recordJson, now] = params;
          if (sessionClientId !== null && clientId !== sessionClientId) {
            throw new Error('fakeApprovalPostgres: RLS would reject this insert (clientId != app.client_id)');
          }
          const row = {
            id,
            clientId,
            version: 1,
            status: 'pending',
            record: recordJson === null ? null : JSON.parse(recordJson),
            approvedBy: null,
            approvedAt: null,
            rejectedAt: null,
            resolvedAt: null,
            executionId: null,
            executionAttemptCount: 0,
            executionStartedAt: null,
            executionLeaseExpiresAt: null,
            executionCompletedAt: null,
            executionFailedAt: null,
            result: null,
            error: null,
            createdAt: new Date(now),
            updatedAt: new Date(now),
          };
          rows.push(row);
          return { rows: [cloneRow(row)] };
        }

        if (text.includes('FROM oxkio.approval_items WHERE id = $1 AND client_id = $2')) {
          const [id, clientId] = params;
          const row = visible().find((r) => r.id === id && r.clientId === clientId);
          return { rows: row ? [cloneRow(row)] : [] };
        }

        if (text.includes("WHERE client_id = $1 AND status = 'pending'")) {
          const [clientId] = params;
          return {
            rows: visible().filter((r) => r.clientId === clientId && r.status === 'pending')
              .sort(byCreatedThenId).map(cloneRow),
          };
        }

        if (text.includes("WHERE client_id = $1 AND status <> 'pending'")) {
          const [clientId] = params;
          return {
            rows: visible().filter((r) => r.clientId === clientId && r.status !== 'pending')
              .sort(byCreatedThenId).map(cloneRow),
          };
        }

        if (text.includes("status = 'executing' AND execution_lease_expires_at <= $2")) {
          const [clientId, reference] = params;
          const referenceTime = Date.parse(reference);
          return {
            rows: visible().filter((r) => r.clientId === clientId
              && r.status === 'executing'
              && r.executionLeaseExpiresAt
              && new Date(r.executionLeaseExpiresAt).getTime() <= referenceTime)
              .sort((a, b) => new Date(a.executionLeaseExpiresAt) - new Date(b.executionLeaseExpiresAt))
              .map(cloneRow),
          };
        }

        if (text.startsWith('SELECT version, status, execution_id')) {
          const [id] = params;
          const row = visible().find((r) => r.id === id);
          return { rows: row ? [{ version: row.version, status: row.status, executionId: row.executionId }] : [] };
        }

        if (text.includes("SET status = 'approved'")) {
          const [id, expectedVersion, expectedStatus, approvedByJson, now] = params;
          const row = visible().find((r) => r.id === id);
          if (!row || row.version !== expectedVersion || row.status !== expectedStatus) return { rows: [] };
          row.status = 'approved';
          row.approvedBy = approvedByJson === null ? null : JSON.parse(approvedByJson);
          row.approvedAt = now;
          row.resolvedAt = now;
          row.version += 1;
          row.updatedAt = now;
          return { rows: [cloneRow(row)] };
        }

        if (text.includes("SET status = 'rejected'")) {
          const [id, expectedVersion, expectedStatus, now] = params;
          const row = visible().find((r) => r.id === id);
          if (!row || row.version !== expectedVersion || row.status !== expectedStatus) return { rows: [] };
          row.status = 'rejected';
          row.rejectedAt = now;
          row.resolvedAt = now;
          row.version += 1;
          row.updatedAt = now;
          return { rows: [cloneRow(row)] };
        }

        if (text.includes("SET status = 'executing'")) {
          const [id, expectedVersion, expectedStatus, executionId, startedAt, leaseExpiresAt] = params;
          const row = visible().find((r) => r.id === id);
          if (!row || row.version !== expectedVersion || row.status !== expectedStatus) return { rows: [] };
          row.status = 'executing';
          row.executionId = executionId;
          row.executionAttemptCount += 1;
          row.executionStartedAt = startedAt;
          row.executionLeaseExpiresAt = leaseExpiresAt;
          row.executionCompletedAt = null;
          row.executionFailedAt = null;
          row.result = null;
          row.error = null;
          row.version += 1;
          row.updatedAt = startedAt;
          return { rows: [cloneRow(row)] };
        }

        if (text.includes("SET status = 'executed'")) {
          const [id, expectedVersion, executionId, resultJson, now] = params;
          const row = visible().find((r) => r.id === id);
          if (!row || row.version !== expectedVersion || row.status !== 'executing' || row.executionId !== executionId) {
            return { rows: [] };
          }
          row.status = 'executed';
          row.result = resultJson === null ? null : JSON.parse(resultJson);
          row.executionCompletedAt = now;
          row.executionLeaseExpiresAt = null;
          row.version += 1;
          row.updatedAt = now;
          return { rows: [cloneRow(row)] };
        }

        if (text.includes("SET status = 'execution_failed'")) {
          const [id, expectedVersion, executionId, errorJson, now] = params;
          const row = visible().find((r) => r.id === id);
          if (!row || row.version !== expectedVersion || row.status !== 'executing' || row.executionId !== executionId) {
            return { rows: [] };
          }
          row.status = 'execution_failed';
          row.error = errorJson === null ? null : JSON.parse(errorJson);
          row.executionFailedAt = now;
          row.executionLeaseExpiresAt = null;
          row.version += 1;
          row.updatedAt = now;
          return { rows: [cloneRow(row)] };
        }

        if (text.includes("SET status = 'expired'")) {
          const [id, expectedVersion, expectedStatus, now] = params;
          const row = visible().find((r) => r.id === id);
          if (!row || row.version !== expectedVersion || row.status !== expectedStatus) return { rows: [] };
          row.status = 'expired';
          row.resolvedAt = now;
          row.version += 1;
          row.updatedAt = now;
          return { rows: [cloneRow(row)] };
        }

        throw new Error(`fakeApprovalPostgres: unrecognized query: ${text}`);
      }

      return { query, release: () => {} };
    },
  };

  return {
    pool,
    calls,
    rows,
    get connectCount() { return connectCount; },
  };
}

function createRepository(scope = SCOPE) {
  const fake = createFakeApprovalPostgres();
  return { repository: new PostgresApprovalRepository({ pool: fake.pool, scope }), fake };
}

// ── 1. Suite compartida del contrato (mismo scope que SYNTHETIC_SCOPE, sin mismatch) ──
runApprovalRepositoryV2ContractTests(
  async () => createRepository({ clientId: 'cliente-cero' }).repository,
  { label: 'postgres scope-bound (fake pool)' },
);

// ── 2. Construccion scope-bound: fail closed ────────────────────────────
test('constructor requires an injected pool', () => {
  assert.throws(
    () => new PostgresApprovalRepository({ scope: SCOPE }),
    (error) => error instanceof PostgresApprovalRepositoryError && error.code === 'invalid_postgres_pool',
  );
});

test('constructor is fail-closed when scope.clientId is missing, empty or invalid', () => {
  const { pool } = createFakeApprovalPostgres();
  for (const scope of [undefined, null, {}, { clientId: '' }, { clientId: '   ' }, { clientId: 42 }]) {
    assert.throws(
      () => new PostgresApprovalRepository({ pool, scope }),
      (error) => error instanceof PostgresApprovalRepositoryError && error.code === 'scope_required',
    );
  }
});

// ── 3. Los 5 metodos con scope por argumento: scope ausente/invalido O distinto ──
test('create/getById/listPending/listHistory/reclaimExpiredExecutions reject a missing/invalid scope argument (scope_required)', async () => {
  const { repository } = createRepository();
  for (const badScope of [undefined, null, {}, { clientId: '' }]) {
    await assert.rejects(
      () => repository.create({ type: 'email_draft' }, badScope),
      (error) => error instanceof PostgresApprovalRepositoryError && error.code === 'scope_required',
    );
    await assert.rejects(
      () => repository.getById('00000000-0000-4000-8000-000000000000', badScope),
      (error) => error instanceof PostgresApprovalRepositoryError && error.code === 'scope_required',
    );
    await assert.rejects(
      () => repository.listPending(badScope),
      (error) => error instanceof PostgresApprovalRepositoryError && error.code === 'scope_required',
    );
    await assert.rejects(
      () => repository.listHistory(badScope),
      (error) => error instanceof PostgresApprovalRepositoryError && error.code === 'scope_required',
    );
    await assert.rejects(
      () => repository.reclaimExpiredExecutions(badScope, Date.now()),
      (error) => error instanceof PostgresApprovalRepositoryError && error.code === 'scope_required',
    );
  }
});

test('create/getById/listPending/listHistory/reclaimExpiredExecutions reject a scope that differs from the bound scope (scope_mismatch)', async () => {
  const { repository } = createRepository({ clientId: 'cliente-cero' });
  const otherScope = { clientId: 'otro-cliente' };
  await assert.rejects(
    () => repository.create({ type: 'email_draft' }, otherScope),
    (error) => error instanceof PostgresApprovalRepositoryError && error.code === 'scope_mismatch',
  );
  await assert.rejects(
    () => repository.getById('00000000-0000-4000-8000-000000000000', otherScope),
    (error) => error instanceof PostgresApprovalRepositoryError && error.code === 'scope_mismatch',
  );
  await assert.rejects(
    () => repository.listPending(otherScope),
    (error) => error instanceof PostgresApprovalRepositoryError && error.code === 'scope_mismatch',
  );
  await assert.rejects(
    () => repository.listHistory(otherScope),
    (error) => error instanceof PostgresApprovalRepositoryError && error.code === 'scope_mismatch',
  );
  await assert.rejects(
    () => repository.reclaimExpiredExecutions(otherScope, Date.now()),
    (error) => error instanceof PostgresApprovalRepositoryError && error.code === 'scope_mismatch',
  );
});

test('scope_required and scope_mismatch never call pool.connect() (no SQL, no network)', async () => {
  const { repository, fake } = createRepository();
  await assert.rejects(() => repository.getById('any-id', null));
  await assert.rejects(() => repository.getById('any-id', { clientId: 'otro-cliente' }));
  assert.equal(fake.connectCount, 0);
  assert.equal(fake.calls.length, 0);
});

// ── 4. Los 6 mutadores: sin scope por argumento, pero SI dentro de la transaccion con app.client_id ──
test('the 6 mutators run inside a transaction that fixes app.client_id before the business UPDATE', async () => {
  const { repository, fake } = createRepository();
  const created = await repository.create({ type: 'email_draft' }, SCOPE);

  const scenarios = [];
  fake.calls.length = 0;
  const approved = await repository.approve(created.item.id, { expectedVersion: created.item.version });
  scenarios.push(['approve', fake.calls.slice()]);

  fake.calls.length = 0;
  const claim = await repository.claimExecution(created.item.id, {
    expectedVersion: approved.item.version,
    expectedStatus: 'approved',
    executionId: 'exec-1',
    leaseTtlMs: 60000,
  });
  scenarios.push(['claimExecution', fake.calls.slice()]);

  fake.calls.length = 0;
  await repository.completeExecution(created.item.id, {
    expectedVersion: claim.item.version,
    executionId: 'exec-1',
    result: { ok: true },
  });
  scenarios.push(['completeExecution', fake.calls.slice()]);

  for (const [method, calls] of scenarios) {
    const setConfigIndex = calls.findIndex((c) => c.sql.includes("SELECT set_config('app.client_id'"));
    const businessIndex = calls.findIndex((c) => c.sql.includes('UPDATE oxkio.approval_items'));
    assert.ok(setConfigIndex !== -1, `${method}: set_config not called`);
    assert.ok(businessIndex !== -1, `${method}: business UPDATE not called`);
    assert.ok(setConfigIndex < businessIndex, `${method}: set_config must precede the business UPDATE`);
    assert.equal(calls[setConfigIndex].params[0], SCOPE.clientId, `${method}: wrong app.client_id value`);
  }
});

test('all 11 methods issue set_config app.client_id exactly once per call, using the bound scope', async () => {
  const { repository, fake } = createRepository();

  async function assertScoped(label, fn) {
    fake.calls.length = 0;
    await fn();
    const setConfigCalls = fake.calls.filter((c) => c.sql.includes("SELECT set_config('app.client_id'"));
    assert.equal(setConfigCalls.length, 1, `${label}: expected exactly one set_config call`);
    assert.equal(setConfigCalls[0].params[0], SCOPE.clientId, `${label}: wrong app.client_id`);
  }

  let created;
  await assertScoped('create', async () => { created = await repository.create({ type: 'task_proposal' }, SCOPE); });
  await assertScoped('getById', () => repository.getById(created.item.id, SCOPE));
  await assertScoped('listPending', () => repository.listPending(SCOPE));
  await assertScoped('listHistory', () => repository.listHistory(SCOPE));

  let approved;
  await assertScoped('approve', async () => { approved = await repository.approve(created.item.id, { expectedVersion: created.item.version }); });

  let claim;
  await assertScoped('claimExecution', async () => {
    claim = await repository.claimExecution(created.item.id, {
      expectedVersion: approved.item.version,
      expectedStatus: 'approved',
      executionId: 'exec-1',
      leaseTtlMs: 60000,
    });
  });

  await assertScoped('reclaimExpiredExecutions', () => repository.reclaimExpiredExecutions(SCOPE, Date.now()));

  await assertScoped('completeExecution', () => repository.completeExecution(created.item.id, {
    expectedVersion: claim.item.version,
    executionId: 'exec-1',
    result: {},
  }));

  // Segundo item independiente para probar reject/failExecution/expire sin chocar con el estado ya resuelto.
  const secondCreated = await repository.create({ type: 'meeting_proposal' }, SCOPE);
  await assertScoped('reject', () => repository.reject(secondCreated.item.id, { expectedVersion: secondCreated.item.version }));

  const thirdCreated = await repository.create({ type: 'meeting_proposal' }, SCOPE);
  const thirdApproved = await repository.approve(thirdCreated.item.id, { expectedVersion: thirdCreated.item.version });
  const thirdClaim = await repository.claimExecution(thirdCreated.item.id, {
    expectedVersion: thirdApproved.item.version,
    expectedStatus: 'approved',
    executionId: 'exec-2',
    leaseTtlMs: 60000,
  });
  await assertScoped('failExecution', () => repository.failExecution(thirdCreated.item.id, {
    expectedVersion: thirdClaim.item.version,
    executionId: 'exec-2',
    error: { code: 'boom' },
  }));

  const fourthCreated = await repository.create({ type: 'meeting_proposal' }, SCOPE);
  await assertScoped('expire', () => repository.expire(fourthCreated.item.id, {
    expectedVersion: fourthCreated.item.version,
    expectedStatus: 'pending',
  }));
});

// ── 5. Aislamiento cross-scope entre instancias (doble comparte "base de datos") ──
test('a repository bound to scope A cannot read or mutate an item created under scope B', async () => {
  const fake = createFakeApprovalPostgres();
  const repoA = new PostgresApprovalRepository({ pool: fake.pool, scope: { clientId: 'cliente-a' } });
  const repoB = new PostgresApprovalRepository({ pool: fake.pool, scope: { clientId: 'cliente-b' } });

  const createdB = await repoB.create({ type: 'task_proposal' }, { clientId: 'cliente-b' });

  const crossGet = await repoA.getById(createdB.item.id, { clientId: 'cliente-a' });
  assert.equal(crossGet.ok, false);
  assert.equal(crossGet.code, 'not_found');

  const crossList = await repoA.listPending({ clientId: 'cliente-a' });
  assert.equal(crossList.some((item) => item.id === createdB.item.id), false);

  // repoA no puede mutar el id de B aunque conozca su id y su version exacta.
  const crossApprove = await repoA.approve(createdB.item.id, { expectedVersion: createdB.item.version });
  assert.equal(crossApprove.ok, false);
  assert.equal(crossApprove.code, 'not_found');

  const stillB = await repoB.getById(createdB.item.id, { clientId: 'cliente-b' });
  assert.equal(stillB.item.status, 'pending');
  assert.equal(stillB.item.version, createdB.item.version);
});

test('two repositories with different bound scopes do not share mutable state', async () => {
  const { pool } = createFakeApprovalPostgres();
  const repoA = new PostgresApprovalRepository({ pool, scope: { clientId: 'cliente-a' } });
  const repoB = new PostgresApprovalRepository({ pool, scope: { clientId: 'cliente-b' } });

  await repoA.create({ type: 'task_proposal' }, { clientId: 'cliente-a' });
  await repoA.create({ type: 'task_proposal' }, { clientId: 'cliente-a' });
  await repoB.create({ type: 'task_proposal' }, { clientId: 'cliente-b' });

  const pendingA = await repoA.listPending({ clientId: 'cliente-a' });
  const pendingB = await repoB.listPending({ clientId: 'cliente-b' });
  assert.equal(pendingA.length, 2);
  assert.equal(pendingB.length, 1);
  // Bound scopes son campos privados de instancia (#scope): construirlas con
  // el mismo pool no hace que compartan ni fusionen su ambito.
  assert.equal(pendingA.every((item) => item.scope.clientId === 'cliente-a'), true);
  assert.equal(pendingB.every((item) => item.scope.clientId === 'cliente-b'), true);
});

// ── 6. CAS, execution_id en WHERE, lease, BEGIN/COMMIT/ROLLBACK intactos ──
test('CAS: a second claim on the same version is rejected (status_conflict or stale_version)', async () => {
  const { repository } = createRepository();
  const created = await repository.create({ type: 'email_draft' }, SCOPE);
  const approved = await repository.approve(created.item.id, { expectedVersion: created.item.version });

  const first = await repository.claimExecution(created.item.id, {
    expectedVersion: approved.item.version,
    expectedStatus: 'approved',
    executionId: 'exec-1',
    leaseTtlMs: 60000,
  });
  assert.equal(first.ok, true);

  const second = await repository.claimExecution(created.item.id, {
    expectedVersion: approved.item.version,
    expectedStatus: 'approved',
    executionId: 'exec-2',
    leaseTtlMs: 60000,
  });
  assert.equal(second.ok, false);
  assert.ok(['stale_version', 'status_conflict'].includes(second.code));
});

test('execution_id is embedded directly in the WHERE clause for completeExecution/failExecution', async () => {
  const { repository, fake } = createRepository();
  const created = await repository.create({ type: 'email_draft' }, SCOPE);
  const approved = await repository.approve(created.item.id, { expectedVersion: created.item.version });
  const claim = await repository.claimExecution(created.item.id, {
    expectedVersion: approved.item.version,
    expectedStatus: 'approved',
    executionId: 'exec-1',
    leaseTtlMs: 60000,
  });

  await repository.completeExecution(created.item.id, {
    expectedVersion: claim.item.version,
    executionId: 'exec-1',
    result: { ok: true },
  });
  const call = fake.calls.find((c) => c.sql.includes("SET status = 'executed'"));
  assert.ok(call.sql.includes('AND execution_id = $3'));
});

test('version conflict is classified before execution_id_mismatch (matches JSON backend precedence)', async () => {
  const { repository } = createRepository();
  const created = await repository.create({ type: 'email_draft' }, SCOPE);
  const approved = await repository.approve(created.item.id, { expectedVersion: created.item.version });
  const claim = await repository.claimExecution(created.item.id, {
    expectedVersion: approved.item.version,
    expectedStatus: 'approved',
    executionId: 'exec-1',
    leaseTtlMs: 60000,
  });

  const result = await repository.completeExecution(created.item.id, {
    expectedVersion: claim.item.version - 1,
    executionId: 'exec-wrong',
    result: {},
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'stale_version');
});

test('claimExecution lease timestamps come from the application clock, not the fake driver', async () => {
  const { repository } = createRepository();
  const created = await repository.create({ type: 'meeting_proposal' }, SCOPE);
  const approved = await repository.approve(created.item.id, { expectedVersion: created.item.version });
  const before = Date.now();
  const claim = await repository.claimExecution(created.item.id, {
    expectedVersion: approved.item.version,
    expectedStatus: 'approved',
    executionId: 'exec-1',
    leaseTtlMs: 5000,
  });
  const after = Date.now();
  const started = Date.parse(claim.item.executionStartedAt);
  const leaseExpires = Date.parse(claim.item.executionLeaseExpiresAt);
  assert.ok(started >= before && started <= after);
  assert.equal(leaseExpires - started, 5000);
});

test('reclaimExpiredExecutions only reads, never mutates, and respects the bound scope', async () => {
  const { repository } = createRepository();
  const created = await repository.create({ type: 'task_proposal' }, SCOPE);
  const approved = await repository.approve(created.item.id, { expectedVersion: created.item.version });
  await repository.claimExecution(created.item.id, {
    expectedVersion: approved.item.version,
    expectedStatus: 'approved',
    executionId: 'exec-1',
    leaseTtlMs: 1,
  });

  const reclaimable = await repository.reclaimExpiredExecutions(SCOPE, Date.now() + 10);
  assert.equal(reclaimable.some((item) => item.id === created.item.id), true);

  const stillThere = await repository.getById(created.item.id, SCOPE);
  assert.equal(stillThere.item.status, 'executing');
});

test('BEGIN/COMMIT are issued around a successful mutation, in order', async () => {
  const { repository, fake } = createRepository();
  const created = await repository.create({ type: 'task_proposal' }, SCOPE);
  fake.calls.length = 0;
  await repository.approve(created.item.id, { expectedVersion: created.item.version });
  const sequence = fake.calls.map((call) => call.sql.trim().split('\n')[0].trim());
  assert.equal(sequence[0], 'BEGIN');
  assert.equal(sequence[sequence.length - 1], 'COMMIT');
});

test('ROLLBACK is issued when the operation throws mid-transaction (create)', async () => {
  const fake = createFakeApprovalPostgres();
  const failingPool = {
    connect: async () => {
      const real = await fake.pool.connect();
      return {
        query: async (sql, params) => {
          const text = sql.trim();
          if (text.startsWith('INSERT INTO oxkio.approval_items')) {
            throw new Error('synthetic failure inside transaction');
          }
          return real.query(sql, params);
        },
        release: real.release,
      };
    },
  };
  const repository = new PostgresApprovalRepository({ pool: failingPool, scope: SCOPE });
  await assert.rejects(() => repository.create({ type: 'email_draft' }, SCOPE));
  const sequence = fake.calls.map((call) => call.sql.trim().split('\n')[0].trim());
  assert.ok(sequence.includes('ROLLBACK'));
  assert.equal(sequence.includes('COMMIT'), false);
});

// ── 7. SQL parametrizado, sin secretos, sin conexion real ────────────────
test('SQL is parametrized: no untrusted value is interpolated into the query text', async () => {
  const { repository, fake } = createRepository();
  const maliciousRecord = { type: "email_draft'; DROP TABLE oxkio.approval_items; --" };
  await repository.create(maliciousRecord, SCOPE);
  for (const call of fake.calls) {
    assert.equal(call.sql.includes('DROP TABLE'), false, 'malicious value leaked into SQL text');
    assert.equal(call.sql.includes("'; --"), false);
  }
});

test('no connectionString is ever embedded and no secrets are read from the environment', () => {
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, 'postgres-approval-repository.js'),
    'utf8',
  );
  assert.equal(source.includes('connectionString'), false);
  assert.equal(/process\.env\.[A-Z_]*(SECRET|PASSWORD|TOKEN|KEY)/i.test(source), false);
  assert.equal(source.includes('new Pool('), false);
});

test('row-to-item mapping reconstructs the exact ApprovalRepositoryV2 item shape', async () => {
  const { repository } = createRepository();
  const created = await repository.create({ type: 'task_proposal', title: 'demo' }, SCOPE);
  assert.deepEqual(Object.keys(created.item).sort(), [
    'approvedAt', 'approvedBy', 'createdAt', 'error', 'executionAttemptCount',
    'executionCompletedAt', 'executionFailedAt', 'executionId', 'executionLeaseExpiresAt',
    'executionStartedAt', 'id', 'record', 'rejectedAt', 'resolvedAt', 'result',
    'scope', 'status', 'updatedAt', 'version',
  ].sort());
  assert.deepEqual(created.item.scope, { clientId: 'cliente-cero' });
  assert.deepEqual(created.item.record, { type: 'task_proposal', title: 'demo' });
});

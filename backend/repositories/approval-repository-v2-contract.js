'use strict';

// Suite de contrato reutilizable para ApprovalRepositoryV2. Pensada para
// ejecutarse contra CUALQUIER backend que satisfaga el contrato (hoy:
// JsonApprovalRepositoryV2; en FASE B: PostgresApprovalRepository) mediante
// una factory `createRepository()` inyectada por quien la invoque.
//
// Todos los tests de este fichero estan etiquetados [backend-contract]: son
// deterministas, no dependen de dos procesos reales ni de temporización de
// red, y deben pasar igual en JSON que en Postgres.
//
// Tests que este fichero DELIBERADAMENTE NO intenta simular (quedan para
// FASE B, marcados alli como [postgres-concurrency-only]):
//   - dos conexiones de red reales compitiendo por el mismo UPDATE ... WHERE
//     version=$N (aqui solo se prueba la semantica CAS de forma secuencial,
//     nunca concurrencia interproceso real);
//   - aislamiento RLS real contra Neon;
//   - comportamiento bajo fallo transaccional/rollback de PostgreSQL;
//   - latencia/timing real de red durante un lease.

const assert = require('node:assert/strict');
const test = require('node:test');
const { CONTRACTS } = require('./repository-contracts');

const SYNTHETIC_RECORD = Object.freeze({
  type: 'email_draft',
  to: 'demo@example.invalid',
  subject: 'Contract fixture',
  body: 'Synthetic fixture body for ApprovalRepositoryV2 contract tests.',
});

const SYNTHETIC_SCOPE = Object.freeze({ clientId: 'cliente-cero' });

function runApprovalRepositoryV2ContractTests(createRepository, { label } = {}) {
  const suffix = label ? ` (${label})` : '';
  const name = (title) => `ApprovalRepositoryV2${suffix}: ${title} [backend-contract]`;

  test(name('satisfies the declared method contract'), async () => {
    const repo = await createRepository();
    CONTRACTS.ApprovalRepositoryV2.forEach((method) => {
      assert.equal(typeof repo[method], 'function', `missing method: ${method}`);
    });
  });

  test(name('create returns version 1, pending status and a UUID id'), async () => {
    const repo = await createRepository();
    const created = await repo.create(SYNTHETIC_RECORD, SYNTHETIC_SCOPE);
    assert.equal(created.ok, true);
    assert.equal(created.item.version, 1);
    assert.equal(created.item.status, 'pending');
    assert.match(
      created.item.id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  test(name('getById/listPending/listHistory reflect stored state'), async () => {
    const repo = await createRepository();
    const created = await repo.create(SYNTHETIC_RECORD, SYNTHETIC_SCOPE);

    const fetched = await repo.getById(created.item.id, SYNTHETIC_SCOPE);
    assert.equal(fetched.ok, true);
    assert.deepEqual(fetched.item.record, SYNTHETIC_RECORD);

    const pending = await repo.listPending(SYNTHETIC_SCOPE);
    assert.equal(pending.some((item) => item.id === created.item.id), true);

    const history = await repo.listHistory(SYNTHETIC_SCOPE);
    assert.equal(history.some((item) => item.id === created.item.id), false);
  });

  test(name('getById returns not_found for an unknown id'), async () => {
    const repo = await createRepository();
    const result = await repo.getById('00000000-0000-4000-8000-000000000000', SYNTHETIC_SCOPE);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'not_found');
  });

  test(name('approve with the correct expectedVersion succeeds and bumps version'), async () => {
    const repo = await createRepository();
    const created = await repo.create(SYNTHETIC_RECORD, SYNTHETIC_SCOPE);
    const approved = await repo.approve(created.item.id, {
      expectedVersion: created.item.version,
      approvedBy: { clientId: 'cliente-cero', userId: 'synthetic-admin' },
    });
    assert.equal(approved.ok, true);
    assert.equal(approved.item.status, 'approved');
    assert.equal(approved.item.version, created.item.version + 1);
    assert.deepEqual(approved.item.approvedBy, { clientId: 'cliente-cero', userId: 'synthetic-admin' });
  });

  test(name('approve with a stale expectedVersion is rejected without mutating state'), async () => {
    const repo = await createRepository();
    const created = await repo.create(SYNTHETIC_RECORD, SYNTHETIC_SCOPE);
    await repo.approve(created.item.id, { expectedVersion: created.item.version });

    const stale = await repo.approve(created.item.id, { expectedVersion: created.item.version });
    assert.equal(stale.ok, false);
    assert.equal(stale.code, 'stale_version');

    const current = await repo.getById(created.item.id, SYNTHETIC_SCOPE);
    assert.equal(current.item.status, 'approved');
    assert.equal(current.item.version, created.item.version + 1);
  });

  test(name('approve then reject on the same version — only the first transition wins'), async () => {
    const repo = await createRepository();
    const created = await repo.create(SYNTHETIC_RECORD, SYNTHETIC_SCOPE);

    const approved = await repo.approve(created.item.id, { expectedVersion: created.item.version });
    assert.equal(approved.ok, true);

    const rejected = await repo.reject(created.item.id, { expectedVersion: created.item.version });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.code, 'stale_version');

    const current = await repo.getById(created.item.id, SYNTHETIC_SCOPE);
    assert.equal(current.item.status, 'approved');
  });

  test(name('claimExecution rejects a second claim on the same version (status_conflict or stale_version)'), async () => {
    const repo = await createRepository();
    const created = await repo.create(SYNTHETIC_RECORD, SYNTHETIC_SCOPE);
    const approved = await repo.approve(created.item.id, { expectedVersion: created.item.version });

    const claim = await repo.claimExecution(created.item.id, {
      expectedVersion: approved.item.version,
      expectedStatus: 'approved',
      executionId: 'exec-1',
      leaseTtlMs: 60000,
    });
    assert.equal(claim.ok, true);
    assert.equal(claim.item.status, 'executing');
    assert.equal(claim.item.executionId, 'exec-1');
    assert.equal(typeof claim.item.executionLeaseExpiresAt, 'string');

    const secondClaim = await repo.claimExecution(created.item.id, {
      expectedVersion: approved.item.version,
      expectedStatus: 'approved',
      executionId: 'exec-2',
      leaseTtlMs: 60000,
    });
    assert.equal(secondClaim.ok, false);
    assert.ok(['stale_version', 'status_conflict'].includes(secondClaim.code));
  });

  test(name('completeExecution rejects a mismatched executionId'), async () => {
    const repo = await createRepository();
    const created = await repo.create(SYNTHETIC_RECORD, SYNTHETIC_SCOPE);
    const approved = await repo.approve(created.item.id, { expectedVersion: created.item.version });
    const claim = await repo.claimExecution(created.item.id, {
      expectedVersion: approved.item.version,
      expectedStatus: 'approved',
      executionId: 'exec-1',
      leaseTtlMs: 60000,
    });

    const mismatched = await repo.completeExecution(created.item.id, {
      expectedVersion: claim.item.version,
      executionId: 'exec-wrong',
      result: { type: 'email_draft' },
    });
    assert.equal(mismatched.ok, false);
    assert.equal(mismatched.code, 'execution_id_mismatch');

    const completed = await repo.completeExecution(created.item.id, {
      expectedVersion: claim.item.version,
      executionId: 'exec-1',
      result: { type: 'email_draft', externalId: 'draft-synthetic-1' },
    });
    assert.equal(completed.ok, true);
    assert.equal(completed.item.status, 'executed');
    assert.equal(completed.item.executionLeaseExpiresAt, null);
  });

  test(name('failExecution on an already-completed item is stale, not a silent success'), async () => {
    const repo = await createRepository();
    const created = await repo.create(SYNTHETIC_RECORD, SYNTHETIC_SCOPE);
    const approved = await repo.approve(created.item.id, { expectedVersion: created.item.version });
    const claim = await repo.claimExecution(created.item.id, {
      expectedVersion: approved.item.version,
      expectedStatus: 'approved',
      executionId: 'exec-1',
      leaseTtlMs: 60000,
    });
    const completed = await repo.completeExecution(created.item.id, {
      expectedVersion: claim.item.version,
      executionId: 'exec-1',
      result: { type: 'email_draft' },
    });
    assert.equal(completed.ok, true);

    const lateFailure = await repo.failExecution(created.item.id, {
      expectedVersion: claim.item.version,
      executionId: 'exec-1',
      error: { code: 'execution_provider_error', retryable: false },
    });
    assert.equal(lateFailure.ok, false);
    assert.equal(lateFailure.code, 'stale_version');
  });

  test(name('expire on an already-resolved item is stale, not a silent success'), async () => {
    const repo = await createRepository();
    const created = await repo.create(SYNTHETIC_RECORD, SYNTHETIC_SCOPE);
    const rejected = await repo.reject(created.item.id, { expectedVersion: created.item.version });
    assert.equal(rejected.ok, true);

    const expired = await repo.expire(created.item.id, {
      expectedVersion: created.item.version,
      expectedStatus: 'pending',
    });
    assert.equal(expired.ok, false);
    assert.equal(expired.code, 'stale_version');
  });

  test(name('reclaimExpiredExecutions only reports expired leases, never mutates them'), async () => {
    const repo = await createRepository();
    const created = await repo.create(SYNTHETIC_RECORD, SYNTHETIC_SCOPE);
    const approved = await repo.approve(created.item.id, { expectedVersion: created.item.version });
    const claim = await repo.claimExecution(created.item.id, {
      expectedVersion: approved.item.version,
      expectedStatus: 'approved',
      executionId: 'exec-1',
      leaseTtlMs: 1,
    });

    await new Promise((resolve) => setTimeout(resolve, 5));
    const reclaimable = await repo.reclaimExpiredExecutions(SYNTHETIC_SCOPE, Date.now());
    assert.equal(reclaimable.some((item) => item.id === created.item.id), true);

    const stillExecuting = await repo.getById(created.item.id, SYNTHETIC_SCOPE);
    assert.equal(stillExecuting.item.status, 'executing');
    assert.equal(stillExecuting.item.version, claim.item.version);
  });
}

module.exports = { runApprovalRepositoryV2ContractTests, SYNTHETIC_RECORD, SYNTHETIC_SCOPE };

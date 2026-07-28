'use strict';

const { performance } = require('node:perf_hooks');
const { assertPocAdapter } = require('./persistence-poc-contract');
const { SYNTHETIC_DATASET } = require('./synthetic-dataset');

function assert(condition, message) {
  if (!condition) throw new Error(`POC assertion failed: ${message}`);
}

async function measure(name, operation, measurements) {
  const started = performance.now();
  const value = await operation();
  measurements.push({
    operation: name,
    durationMs: Number((performance.now() - started).toFixed(3)),
  });
  return value;
}

async function runComparablePoc(adapter, dataset = SYNTHETIC_DATASET) {
  assertPocAdapter(adapter);
  const measurements = [];
  const { scope, restoreScope, approval, operation, memory, audit, query } = dataset;

  await measure('initialize_scope', () => adapter.initializeScope(scope), measurements);

  const createdApproval = await measure(
    'create_approval',
    () => adapter.createApproval({ ...scope, ...approval }),
    measurements,
  );
  assert(createdApproval.status === 'pending', 'approval must start pending');
  assert(createdApproval.executionEnabled === false, 'executionEnabled must remain false');

  const approved = await measure(
    'approve_transactionally',
    () => adapter.approveApproval({
      ...scope,
      approvalId: approval.approvalId,
      approvedAt: '2026-07-28T10:00:30.000Z',
    }),
    measurements,
  );
  assert(approved.status === 'approved', 'approval must transition once');

  const reservations = await measure(
    'reserve_idempotency_key',
    () => Promise.all([
      adapter.reserveOperation({ ...scope, ...operation }),
      adapter.reserveOperation({ ...scope, ...operation }),
    ]),
    measurements,
  );
  const createdReservations = reservations.filter((entry) => entry.created === true);
  const duplicateReservations = reservations.filter((entry) => entry.duplicate === true);
  assert(createdReservations.length === 1, 'concurrent reservation must create exactly once');
  assert(duplicateReservations.length === 1, 'concurrent reservation must block one duplicate');

  const started = await measure(
    'start_operation',
    () => adapter.startOperation({
      ...scope,
      idempotencyKey: operation.idempotencyKey,
      startedAt: operation.startedAt,
    }),
    measurements,
  );
  assert(started.state === 'executing', 'reserved operation must become executing');

  const completed = await measure(
    'complete_operation',
    () => adapter.completeOperation({
      ...scope,
      idempotencyKey: operation.idempotencyKey,
      completedAt: operation.completedAt,
      result: operation.result,
    }),
    measurements,
  );
  assert(completed.state === 'succeeded', 'operation must reach succeeded');
  assert(completed.result.mode === 'SAFE_DRAFT_ONLY', 'SAFE_DRAFT_ONLY must remain intact');

  const duplicate = await measure(
    'block_duplicate',
    () => adapter.reserveOperation({ ...scope, ...operation }),
    measurements,
  );
  assert(duplicate.created === false && duplicate.duplicate === true, 'duplicate must be blocked');
  assert(duplicate.operation.state === 'succeeded', 'duplicate must return canonical terminal state');

  await measure(
    'save_memory',
    () => adapter.saveMemory({ ...scope, ...memory }),
    measurements,
  );
  const [memoryResults, foreignUserMemoryResults] = await measure(
    'search_memory',
    () => Promise.all([
      adapter.searchMemory({ ...scope, query: query.memoryText }),
      adapter.searchMemory({
        ...scope,
        userId: 'user-poc-foreign',
        query: query.memoryText,
      }),
    ]),
    measurements,
  );
  assert(memoryResults.length === 1, 'memory search must remain tenant/user scoped');
  assert(foreignUserMemoryResults.length === 0, 'foreign user must not see memory');

  await measure(
    'append_audit',
    () => adapter.appendAudit({ ...scope, ...audit }),
    measurements,
  );
  const [auditResults, foreignTenantAuditResults] = await measure(
    'query_audit_by_tenant_date',
    () => Promise.all([
      adapter.queryAuditByTenantAndDate({
        tenantId: scope.tenantId,
        from: query.from,
        to: query.to,
      }),
      adapter.queryAuditByTenantAndDate({
        tenantId: restoreScope.tenantId,
        from: query.from,
        to: query.to,
      }),
    ]),
    measurements,
  );
  assert(auditResults.length === 1, 'audit query must remain tenant scoped');
  assert(foreignTenantAuditResults.length === 0, 'foreign tenant must not see audit');

  const exported = await measure(
    'export_tenant',
    () => adapter.exportTenant({
      tenantId: scope.tenantId,
      exportedAt: '2026-07-28T10:06:00.000Z',
    }),
    measurements,
  );
  assert(exported.operations.length === 1, 'export must contain the canonical operation');

  await measure(
    'restore_isolated_tenant',
    () => adapter.restoreTenant({
      ...restoreScope,
      dataset: exported,
    }),
    measurements,
  );
  const restored = await adapter.exportTenant({
    tenantId: restoreScope.tenantId,
    exportedAt: '2026-07-28T10:07:00.000Z',
  });
  assert(restored.operations.length === exported.operations.length, 'restore must preserve operations');
  assert(restored.memories.length === exported.memories.length, 'restore must preserve memory');
  assert(restored.audit.length === exported.audit.length, 'restore must preserve audit');

  return {
    provider: adapter.provider || 'unknown',
    status: 'COMPLETED_SYNTHETIC',
    dataset: 'synthetic-only',
    productionDataTouched: false,
    invariants: {
      executionEnabled: false,
      mode: 'SAFE_DRAFT_ONLY',
      duplicateBlocked: true,
      concurrentReservationExercised: true,
      tenantIsolationExercised: true,
      exportRestoreExercised: true,
    },
    measurements,
    metrics: {
      ...adapter.getMetrics(),
      neutralExportBytes: Buffer.byteLength(JSON.stringify(exported), 'utf8'),
    },
  };
}

module.exports = { runComparablePoc };

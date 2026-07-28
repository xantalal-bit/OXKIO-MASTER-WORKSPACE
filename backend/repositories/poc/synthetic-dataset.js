'use strict';

const SYNTHETIC_DATASET = Object.freeze({
  scope: Object.freeze({
    tenantId: 'tenant-poc-alpha',
    userId: 'user-poc-alpha',
    role: 'owner',
  }),
  restoreScope: Object.freeze({
    tenantId: 'tenant-poc-restored',
    userId: 'user-poc-restored',
    role: 'owner',
  }),
  approval: Object.freeze({
    approvalId: 'approval-poc-0001',
    actionType: 'email_draft',
    mode: 'SAFE_DRAFT_ONLY',
    executionEnabled: false,
    createdAt: '2026-07-28T10:00:00.000Z',
  }),
  operation: Object.freeze({
    operationId: 'operation-poc-0001',
    idempotencyKey: 'tenant-poc-alpha:email-draft:0001',
    operationType: 'email_draft',
    createdAt: '2026-07-28T10:01:00.000Z',
    startedAt: '2026-07-28T10:02:00.000Z',
    completedAt: '2026-07-28T10:03:00.000Z',
    result: Object.freeze({
      type: 'email_draft',
      mode: 'SAFE_DRAFT_ONLY',
      externalId: 'synthetic-draft-0001',
    }),
  }),
  memory: Object.freeze({
    memoryId: 'memory-poc-0001',
    kind: 'executive_note',
    content: 'Reunión sintética de planificación del Cliente Cero.',
    createdAt: '2026-07-28T10:04:00.000Z',
  }),
  audit: Object.freeze({
    eventId: 'audit-poc-0001',
    actorId: 'user-poc-alpha',
    action: 'poc_completed',
    createdAt: '2026-07-28T10:05:00.000Z',
    metadata: Object.freeze({
      executionEnabled: false,
      mode: 'SAFE_DRAFT_ONLY',
    }),
  }),
  query: Object.freeze({
    memoryText: 'reunión',
    from: '2026-07-28T00:00:00.000Z',
    to: '2026-07-29T00:00:00.000Z',
  }),
});

module.exports = { SYNTHETIC_DATASET };

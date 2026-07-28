'use strict';

const {
  clone,
  validateIdentifier,
  validateIdempotencyKey,
  validateScope,
} = require('./persistence-poc-contract');

function key(tenantId, id) {
  return `${tenantId}\u0000${id}`;
}

function normalizeSearch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

class SyntheticReferenceAdapter {
  constructor() {
    this.provider = 'synthetic_reference';
    this.scopes = new Map();
    this.approvals = new Map();
    this.operations = new Map();
    this.memories = new Map();
    this.audit = new Map();
    this.metrics = {
      logicalReads: 0,
      logicalWrites: 0,
      transactions: 0,
      queries: 0,
      indexes: 4,
    };
  }

  write(count = 1) {
    this.metrics.logicalWrites += count;
  }

  read(count = 1) {
    this.metrics.logicalReads += count;
  }

  transaction() {
    this.metrics.transactions += 1;
  }

  query() {
    this.metrics.queries += 1;
  }

  async initializeScope(input) {
    const scope = validateScope(input);
    const role = validateIdentifier(input.role, 'role');
    this.scopes.set(scope.tenantId, { ...scope, role });
    this.write(2);
    return clone({ ...scope, role });
  }

  async createApproval(input) {
    const scope = validateScope(input);
    const approvalId = validateIdentifier(input.approvalId, 'approvalId');
    const approvalKey = key(scope.tenantId, approvalId);
    this.transaction();
    this.read();
    if (this.approvals.has(approvalKey)) throw new Error('approval_already_exists');
    const approval = {
      ...scope,
      approvalId,
      status: 'pending',
      actionType: input.actionType,
      mode: input.mode,
      executionEnabled: input.executionEnabled === true,
      createdAt: input.createdAt,
      approvedAt: null,
      approvedBy: null,
    };
    this.approvals.set(approvalKey, approval);
    this.write();
    return clone(approval);
  }

  async approveApproval(input) {
    const scope = validateScope(input);
    const approvalKey = key(
      scope.tenantId,
      validateIdentifier(input.approvalId, 'approvalId'),
    );
    this.transaction();
    this.read();
    const approval = this.approvals.get(approvalKey);
    if (!approval || approval.status !== 'pending') throw new Error('approval_not_pending');
    approval.status = 'approved';
    approval.approvedAt = input.approvedAt;
    approval.approvedBy = scope.userId;
    this.write();
    return clone(approval);
  }

  async reserveOperation(input) {
    const scope = validateScope(input);
    const idempotencyKey = validateIdempotencyKey(input.idempotencyKey);
    const operationKey = key(scope.tenantId, idempotencyKey);
    this.transaction();
    this.read();
    const existing = this.operations.get(operationKey);
    if (existing) return { created: false, duplicate: true, operation: clone(existing) };
    const operation = {
      ...scope,
      operationId: validateIdentifier(input.operationId, 'operationId'),
      idempotencyKey,
      operationType: input.operationType,
      state: 'reserved',
      createdAt: input.createdAt,
      startedAt: null,
      completedAt: null,
      result: null,
    };
    this.operations.set(operationKey, operation);
    this.write();
    return { created: true, duplicate: false, operation: clone(operation) };
  }

  async startOperation(input) {
    const scope = validateScope(input);
    const operationKey = key(
      scope.tenantId,
      validateIdempotencyKey(input.idempotencyKey),
    );
    this.transaction();
    this.read();
    const operation = this.operations.get(operationKey);
    if (!operation || operation.state !== 'reserved') throw new Error('operation_not_reserved');
    operation.state = 'executing';
    operation.startedAt = input.startedAt;
    this.write();
    return clone(operation);
  }

  async completeOperation(input) {
    const scope = validateScope(input);
    const operationKey = key(
      scope.tenantId,
      validateIdempotencyKey(input.idempotencyKey),
    );
    this.transaction();
    this.read();
    const operation = this.operations.get(operationKey);
    if (!operation || operation.state !== 'executing') throw new Error('operation_not_executing');
    operation.state = 'succeeded';
    operation.completedAt = input.completedAt;
    operation.result = clone(input.result);
    this.write();
    return clone(operation);
  }

  async saveMemory(input) {
    const scope = validateScope(input);
    const memoryId = validateIdentifier(input.memoryId, 'memoryId');
    const memory = {
      ...scope,
      memoryId,
      kind: input.kind,
      content: String(input.content || ''),
      createdAt: input.createdAt,
    };
    this.memories.set(key(scope.tenantId, memoryId), memory);
    this.write();
    return clone(memory);
  }

  async searchMemory(input) {
    const scope = validateScope(input);
    const query = normalizeSearch(input.query);
    this.query();
    const values = [...this.memories.values()].filter(
      (memory) => memory.tenantId === scope.tenantId
        && memory.userId === scope.userId
        && normalizeSearch(memory.content).includes(query),
    );
    this.read(values.length);
    return clone(values);
  }

  async appendAudit(input) {
    const scope = validateScope(input);
    const eventId = validateIdentifier(input.eventId, 'eventId');
    const auditKey = key(scope.tenantId, eventId);
    if (this.audit.has(auditKey)) throw new Error('audit_event_already_exists');
    const event = {
      ...scope,
      eventId,
      actorId: validateIdentifier(input.actorId, 'actorId'),
      action: input.action,
      createdAt: input.createdAt,
      metadata: clone(input.metadata || {}),
    };
    this.audit.set(auditKey, event);
    this.write();
    return clone(event);
  }

  async queryAuditByTenantAndDate(input) {
    const tenantId = validateIdentifier(input.tenantId, 'tenantId');
    this.query();
    const values = [...this.audit.values()]
      .filter((event) => event.tenantId === tenantId
        && event.createdAt >= input.from
        && event.createdAt < input.to)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    this.read(values.length);
    return clone(values);
  }

  async exportTenant(input) {
    const tenantId = validateIdentifier(input.tenantId, 'tenantId');
    this.transaction();
    const filter = (values) => [...values].filter((entry) => entry.tenantId === tenantId);
    const dataset = {
      version: '1.0',
      tenantId,
      exportedAt: input.exportedAt,
      approvals: filter(this.approvals.values()),
      operations: filter(this.operations.values()),
      memories: filter(this.memories.values()),
      audit: filter(this.audit.values()),
    };
    this.read(
      dataset.approvals.length
      + dataset.operations.length
      + dataset.memories.length
      + dataset.audit.length,
    );
    return clone(dataset);
  }

  async restoreTenant(input) {
    const target = validateScope(input);
    const dataset = clone(input.dataset);
    const existing = [
      ...this.approvals.values(),
      ...this.operations.values(),
      ...this.memories.values(),
      ...this.audit.values(),
    ].some((entry) => entry.tenantId === target.tenantId);
    if (existing) throw new Error('restore_target_not_empty');
    await this.initializeScope({ ...target, role: input.role || 'owner' });

    const restore = (entries, destination, idField) => {
      entries.forEach((entry) => {
        const restored = { ...entry, ...target };
        destination.set(key(target.tenantId, restored[idField]), restored);
      });
      this.write(entries.length);
    };
    this.transaction();
    restore(dataset.approvals || [], this.approvals, 'approvalId');
    restore(dataset.operations || [], this.operations, 'idempotencyKey');
    restore(dataset.memories || [], this.memories, 'memoryId');
    restore(dataset.audit || [], this.audit, 'eventId');
    return { restored: true, tenantId: target.tenantId };
  }

  getMetrics() {
    return clone(this.metrics);
  }
}

module.exports = { SyntheticReferenceAdapter };

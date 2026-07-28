'use strict';

const crypto = require('node:crypto');
const {
  clone,
  validateIdentifier,
  validateIdempotencyKey,
  validateScope,
} = require('./persistence-poc-contract');

const ROOT_COLLECTION = 'oxkioPocTenants';
const DATA_COLLECTIONS = Object.freeze(['approvals', 'operations', 'memories', 'audit']);

function normalizeSearch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function searchTokens(value) {
  return [...new Set(normalizeSearch(value).split(/\s+/).filter(Boolean))].slice(0, 40);
}

function operationDocumentId(idempotencyKey) {
  return crypto.createHash('sha256').update(idempotencyKey).digest('hex');
}

function snapshotData(snapshot) {
  return snapshot && snapshot.exists ? clone(snapshot.data()) : null;
}

class FirestorePocAdapter {
  constructor({ db } = {}) {
    if (!db || typeof db.runTransaction !== 'function') {
      const error = new Error('Firestore POC requires an injected emulator Firestore client.');
      error.code = 'POC_ENVIRONMENT_BLOCKED';
      throw error;
    }
    this.db = db;
    this.provider = 'firestore_emulator';
    this.metrics = {
      logicalReads: 0,
      logicalWrites: 0,
      transactions: 0,
      queries: 0,
      indexes: 'unknown_until_emulator',
    };
  }

  tenantRef(tenantId) {
    return this.db.collection(ROOT_COLLECTION).doc(validateIdentifier(tenantId, 'tenantId'));
  }

  collection(tenantId, name) {
    if (!DATA_COLLECTIONS.includes(name) && name !== 'memberships') {
      throw new Error(`Unsupported Firestore POC collection: ${name}.`);
    }
    return this.tenantRef(tenantId).collection(name);
  }

  read(count = 1) {
    this.metrics.logicalReads += count;
  }

  write(count = 1) {
    this.metrics.logicalWrites += count;
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
    const batch = this.db.batch();
    batch.set(this.tenantRef(scope.tenantId), {
      tenantId: scope.tenantId,
      status: 'poc_only',
    }, { merge: false });
    batch.set(this.collection(scope.tenantId, 'memberships').doc(scope.userId), {
      ...scope,
      role,
      status: 'active',
    }, { merge: false });
    await batch.commit();
    this.write(2);
    return { ...scope, role };
  }

  async createApproval(input) {
    const scope = validateScope(input);
    const approvalId = validateIdentifier(input.approvalId, 'approvalId');
    const ref = this.collection(scope.tenantId, 'approvals').doc(approvalId);
    this.transaction();
    return this.db.runTransaction(async (tx) => {
      const existing = await tx.get(ref);
      this.read();
      if (existing.exists) throw new Error('approval_already_exists');
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
      tx.create(ref, approval);
      this.write();
      return clone(approval);
    });
  }

  async approveApproval(input) {
    const scope = validateScope(input);
    const approvalId = validateIdentifier(input.approvalId, 'approvalId');
    const ref = this.collection(scope.tenantId, 'approvals').doc(approvalId);
    this.transaction();
    return this.db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      this.read();
      const approval = snapshotData(snapshot);
      if (!approval || approval.status !== 'pending' || approval.userId !== scope.userId) {
        throw new Error('approval_not_pending');
      }
      const update = {
        status: 'approved',
        approvedAt: input.approvedAt,
        approvedBy: scope.userId,
      };
      tx.update(ref, update);
      this.write();
      return { ...approval, ...update };
    });
  }

  async reserveOperation(input) {
    const scope = validateScope(input);
    const idempotencyKey = validateIdempotencyKey(input.idempotencyKey);
    const ref = this.collection(scope.tenantId, 'operations')
      .doc(operationDocumentId(idempotencyKey));
    this.transaction();
    return this.db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      this.read();
      const existing = snapshotData(snapshot);
      if (existing) {
        return { created: false, duplicate: true, operation: existing };
      }
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
      tx.create(ref, operation);
      this.write();
      return { created: true, duplicate: false, operation: clone(operation) };
    });
  }

  async transitionOperation(input, fromState, toState, update) {
    const scope = validateScope(input);
    const idempotencyKey = validateIdempotencyKey(input.idempotencyKey);
    const ref = this.collection(scope.tenantId, 'operations')
      .doc(operationDocumentId(idempotencyKey));
    this.transaction();
    return this.db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      this.read();
      const operation = snapshotData(snapshot);
      if (!operation || operation.state !== fromState || operation.userId !== scope.userId) {
        throw new Error(`operation_not_${fromState}`);
      }
      tx.update(ref, { state: toState, ...update });
      this.write();
      return { ...operation, state: toState, ...clone(update) };
    });
  }

  async startOperation(input) {
    return this.transitionOperation(input, 'reserved', 'executing', {
      startedAt: input.startedAt,
    });
  }

  async completeOperation(input) {
    return this.transitionOperation(input, 'executing', 'succeeded', {
      completedAt: input.completedAt,
      result: clone(input.result),
    });
  }

  async saveMemory(input) {
    const scope = validateScope(input);
    const memoryId = validateIdentifier(input.memoryId, 'memoryId');
    const memory = {
      ...scope,
      memoryId,
      kind: input.kind,
      content: String(input.content || ''),
      searchTokens: searchTokens(input.content),
      createdAt: input.createdAt,
    };
    await this.collection(scope.tenantId, 'memories').doc(memoryId).create(memory);
    this.write();
    return clone(memory);
  }

  async searchMemory(input) {
    const scope = validateScope(input);
    const normalized = normalizeSearch(input.query);
    const token = searchTokens(normalized)[0];
    if (!token) return [];
    this.query();
    const snapshot = await this.collection(scope.tenantId, 'memories')
      .where('userId', '==', scope.userId)
      .where('searchTokens', 'array-contains', token)
      .get();
    this.read(snapshot.size);
    return snapshot.docs
      .map((document) => snapshotData(document))
      .filter((memory) => normalizeSearch(memory.content).includes(normalized))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async appendAudit(input) {
    const scope = validateScope(input);
    const eventId = validateIdentifier(input.eventId, 'eventId');
    const event = {
      ...scope,
      eventId,
      actorId: validateIdentifier(input.actorId, 'actorId'),
      action: input.action,
      createdAt: input.createdAt,
      metadata: clone(input.metadata || {}),
    };
    await this.collection(scope.tenantId, 'audit').doc(eventId).create(event);
    this.write();
    return clone(event);
  }

  async queryAuditByTenantAndDate(input) {
    const tenantId = validateIdentifier(input.tenantId, 'tenantId');
    this.query();
    const snapshot = await this.collection(tenantId, 'audit')
      .where('createdAt', '>=', input.from)
      .where('createdAt', '<', input.to)
      .orderBy('createdAt', 'asc')
      .get();
    this.read(snapshot.size);
    return snapshot.docs.map((document) => snapshotData(document));
  }

  async exportTenant(input) {
    const tenantId = validateIdentifier(input.tenantId, 'tenantId');
    const result = {
      version: '1.0',
      tenantId,
      exportedAt: input.exportedAt,
      approvals: [],
      operations: [],
      memories: [],
      audit: [],
    };
    for (const name of DATA_COLLECTIONS) {
      const snapshot = await this.collection(tenantId, name).get();
      this.query();
      this.read(snapshot.size);
      result[name] = snapshot.docs
        .map((document) => snapshotData(document))
        .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
    }
    return result;
  }

  async restoreTenant(input) {
    const target = validateScope(input);
    const dataset = clone(input.dataset);
    for (const name of DATA_COLLECTIONS) {
      const snapshot = await this.collection(target.tenantId, name).limit(1).get();
      this.query();
      this.read(snapshot.size);
      if (!snapshot.empty) throw new Error('restore_target_not_empty');
    }
    await this.initializeScope({ ...target, role: input.role || 'owner' });

    const writes = [];
    const documentId = {
      approvals: (entry) => entry.approvalId,
      operations: (entry) => operationDocumentId(entry.idempotencyKey),
      memories: (entry) => entry.memoryId,
      audit: (entry) => entry.eventId,
    };
    for (const name of DATA_COLLECTIONS) {
      for (const entry of dataset[name] || []) {
        const restored = { ...entry, ...target };
        writes.push({
          ref: this.collection(target.tenantId, name).doc(documentId[name](restored)),
          value: restored,
        });
      }
    }
    for (let offset = 0; offset < writes.length; offset += 400) {
      const batch = this.db.batch();
      const chunk = writes.slice(offset, offset + 400);
      chunk.forEach(({ ref, value }) => batch.create(ref, value));
      await batch.commit();
      this.write(chunk.length);
    }
    return { restored: true, tenantId: target.tenantId };
  }

  getMetrics() {
    return clone(this.metrics);
  }
}

function describeFirestoreEnvironment({
  env = process.env,
  modulePresent = true,
} = {}) {
  const emulator = typeof env.FIRESTORE_EMULATOR_HOST === 'string'
    && Boolean(env.FIRESTORE_EMULATOR_HOST.trim());
  return Object.freeze({
    provider: 'firestore',
    status: emulator && modulePresent ? 'READY_FOR_EMULATOR' : 'BLOCKED_BY_ENVIRONMENT',
    productionAllowed: false,
    emulatorConfigured: emulator,
    sdkPresent: modulePresent,
    blockers: Object.freeze([
      ...(emulator ? [] : ['FIRESTORE_EMULATOR_HOST is absent']),
      ...(modulePresent ? [] : ['firebase-admin is absent']),
    ]),
  });
}

module.exports = {
  FirestorePocAdapter,
  ROOT_COLLECTION,
  describeFirestoreEnvironment,
  normalizeSearch,
  operationDocumentId,
  searchTokens,
};

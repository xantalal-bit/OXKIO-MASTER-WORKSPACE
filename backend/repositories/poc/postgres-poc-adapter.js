'use strict';

const {
  clone,
  validateIdentifier,
  validateIdempotencyKey,
  validateScope,
} = require('./persistence-poc-contract');

function rows(result) {
  return result && Array.isArray(result.rows) ? result.rows : [];
}

class PostgresPocAdapter {
  constructor({ pool } = {}) {
    if (!pool || typeof pool.connect !== 'function') {
      const error = new Error('PostgreSQL POC requires an injected isolated PostgreSQL pool.');
      error.code = 'POC_ENVIRONMENT_BLOCKED';
      throw error;
    }
    this.pool = pool;
    this.provider = 'postgresql_isolated';
    this.metrics = {
      logicalReads: 0,
      logicalWrites: 0,
      transactions: 0,
      queries: 0,
      indexes: 11,
    };
  }

  read(count = 1) {
    this.metrics.logicalReads += count;
  }

  write(count = 1) {
    this.metrics.logicalWrites += count;
  }

  query(count = 1) {
    this.metrics.queries += count;
  }

  async withTransaction(tenantId, callback, { repeatableRead = false } = {}) {
    const validatedTenantId = validateIdentifier(tenantId, 'tenantId');
    const client = await this.pool.connect();
    this.metrics.transactions += 1;
    try {
      await client.query('BEGIN');
      if (repeatableRead) {
        await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
      }
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [validatedTenantId]);
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async initializeScope(input) {
    const scope = validateScope(input);
    const role = validateIdentifier(input.role, 'role');
    await this.withTransaction(scope.tenantId, async (client) => {
      await client.query(
        `INSERT INTO oxkio_poc.tenants (tenant_id, status)
         VALUES ($1, 'poc_only')
         ON CONFLICT (tenant_id) DO NOTHING`,
        [scope.tenantId],
      );
      await client.query(
        `INSERT INTO oxkio_poc.scopes (tenant_id, user_id, role, status)
         VALUES ($1, $2, $3, 'active')
         ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
        [scope.tenantId, scope.userId, role],
      );
      this.write(2);
    });
    return { ...scope, role };
  }

  async createApproval(input) {
    const scope = validateScope(input);
    const approvalId = validateIdentifier(input.approvalId, 'approvalId');
    return this.withTransaction(scope.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO oxkio_poc.approvals (
           tenant_id, approval_id, user_id, status, action_type, mode,
           execution_enabled, created_at
         ) VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7)
         RETURNING tenant_id AS "tenantId", approval_id AS "approvalId",
           user_id AS "userId", status, action_type AS "actionType", mode,
           execution_enabled AS "executionEnabled", created_at AS "createdAt",
           approved_at AS "approvedAt", approved_by AS "approvedBy"`,
        [
          scope.tenantId,
          approvalId,
          scope.userId,
          input.actionType,
          input.mode,
          input.executionEnabled === true,
          input.createdAt,
        ],
      );
      this.write();
      return clone(rows(result)[0]);
    });
  }

  async approveApproval(input) {
    const scope = validateScope(input);
    const approvalId = validateIdentifier(input.approvalId, 'approvalId');
    return this.withTransaction(scope.tenantId, async (client) => {
      const result = await client.query(
        `UPDATE oxkio_poc.approvals
         SET status = 'approved', approved_at = $4, approved_by = $3
         WHERE tenant_id = $1 AND approval_id = $2 AND user_id = $3
           AND status = 'pending'
         RETURNING tenant_id AS "tenantId", approval_id AS "approvalId",
           user_id AS "userId", status, action_type AS "actionType", mode,
           execution_enabled AS "executionEnabled", created_at AS "createdAt",
           approved_at AS "approvedAt", approved_by AS "approvedBy"`,
        [scope.tenantId, approvalId, scope.userId, input.approvedAt],
      );
      this.read();
      if (rows(result).length !== 1) throw new Error('approval_not_pending');
      this.write();
      return clone(rows(result)[0]);
    });
  }

  async reserveOperation(input) {
    const scope = validateScope(input);
    const operationId = validateIdentifier(input.operationId, 'operationId');
    const idempotencyKey = validateIdempotencyKey(input.idempotencyKey);
    return this.withTransaction(scope.tenantId, async (client) => {
      const inserted = await client.query(
        `INSERT INTO oxkio_poc.operations (
           tenant_id, operation_id, user_id, idempotency_key,
           operation_type, state, created_at
         ) VALUES ($1, $2, $3, $4, $5, 'reserved', $6)
         ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
         RETURNING tenant_id AS "tenantId", operation_id AS "operationId",
           user_id AS "userId", idempotency_key AS "idempotencyKey",
           operation_type AS "operationType", state, created_at AS "createdAt",
           started_at AS "startedAt", completed_at AS "completedAt", result`,
        [
          scope.tenantId,
          operationId,
          scope.userId,
          idempotencyKey,
          input.operationType,
          input.createdAt,
        ],
      );
      if (rows(inserted).length === 1) {
        this.write();
        return { created: true, duplicate: false, operation: clone(rows(inserted)[0]) };
      }
      const existing = await client.query(
        `SELECT tenant_id AS "tenantId", operation_id AS "operationId",
           user_id AS "userId", idempotency_key AS "idempotencyKey",
           operation_type AS "operationType", state, created_at AS "createdAt",
           started_at AS "startedAt", completed_at AS "completedAt", result
         FROM oxkio_poc.operations
         WHERE tenant_id = $1 AND idempotency_key = $2`,
        [scope.tenantId, idempotencyKey],
      );
      this.read();
      return { created: false, duplicate: true, operation: clone(rows(existing)[0]) };
    });
  }

  async transitionOperation(input, fromState, toState, fields) {
    const scope = validateScope(input);
    const idempotencyKey = validateIdempotencyKey(input.idempotencyKey);
    return this.withTransaction(scope.tenantId, async (client) => {
      const result = await client.query(
        `UPDATE oxkio_poc.operations
         SET state = $4, started_at = COALESCE($5, started_at),
           completed_at = COALESCE($6, completed_at),
           result = COALESCE($7::jsonb, result)
         WHERE tenant_id = $1 AND idempotency_key = $2 AND user_id = $3
           AND state = $8
         RETURNING tenant_id AS "tenantId", operation_id AS "operationId",
           user_id AS "userId", idempotency_key AS "idempotencyKey",
           operation_type AS "operationType", state, created_at AS "createdAt",
           started_at AS "startedAt", completed_at AS "completedAt", result`,
        [
          scope.tenantId,
          idempotencyKey,
          scope.userId,
          toState,
          fields.startedAt || null,
          fields.completedAt || null,
          fields.result ? JSON.stringify(fields.result) : null,
          fromState,
        ],
      );
      this.read();
      if (rows(result).length !== 1) throw new Error(`operation_not_${fromState}`);
      this.write();
      return clone(rows(result)[0]);
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
      result: input.result,
    });
  }

  async saveMemory(input) {
    const scope = validateScope(input);
    const memoryId = validateIdentifier(input.memoryId, 'memoryId');
    return this.withTransaction(scope.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO oxkio_poc.memories (
           tenant_id, memory_id, user_id, kind, content, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING tenant_id AS "tenantId", memory_id AS "memoryId",
           user_id AS "userId", kind, content, created_at AS "createdAt"`,
        [scope.tenantId, memoryId, scope.userId, input.kind, input.content, input.createdAt],
      );
      this.write();
      return clone(rows(result)[0]);
    });
  }

  async searchMemory(input) {
    const scope = validateScope(input);
    return this.withTransaction(scope.tenantId, async (client) => {
      const result = await client.query(
        `SELECT tenant_id AS "tenantId", memory_id AS "memoryId",
           user_id AS "userId", kind, content, created_at AS "createdAt"
         FROM oxkio_poc.memories
         WHERE tenant_id = $1 AND user_id = $2
           AND search_vector @@ websearch_to_tsquery('simple', $3)
         ORDER BY created_at ASC`,
        [scope.tenantId, scope.userId, input.query],
      );
      this.query();
      this.read(rows(result).length);
      return clone(rows(result));
    });
  }

  async appendAudit(input) {
    const scope = validateScope(input);
    const eventId = validateIdentifier(input.eventId, 'eventId');
    return this.withTransaction(scope.tenantId, async (client) => {
      const result = await client.query(
        `INSERT INTO oxkio_poc.audit_events (
           tenant_id, event_id, user_id, actor_id, action, created_at, metadata
         ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
         RETURNING tenant_id AS "tenantId", event_id AS "eventId",
           user_id AS "userId", actor_id AS "actorId", action,
           created_at AS "createdAt", metadata`,
        [
          scope.tenantId,
          eventId,
          scope.userId,
          validateIdentifier(input.actorId, 'actorId'),
          input.action,
          input.createdAt,
          JSON.stringify(input.metadata || {}),
        ],
      );
      this.write();
      return clone(rows(result)[0]);
    });
  }

  async queryAuditByTenantAndDate(input) {
    const tenantId = validateIdentifier(input.tenantId, 'tenantId');
    return this.withTransaction(tenantId, async (client) => {
      const result = await client.query(
        `SELECT tenant_id AS "tenantId", event_id AS "eventId",
           user_id AS "userId", actor_id AS "actorId", action,
           created_at AS "createdAt", metadata
         FROM oxkio_poc.audit_events
         WHERE tenant_id = $1 AND created_at >= $2 AND created_at < $3
         ORDER BY created_at ASC`,
        [tenantId, input.from, input.to],
      );
      this.query();
      this.read(rows(result).length);
      return clone(rows(result));
    });
  }

  async exportTenant(input) {
    const tenantId = validateIdentifier(input.tenantId, 'tenantId');
    return this.withTransaction(tenantId, async (client) => {
      const definitions = {
        approvals: `SELECT tenant_id AS "tenantId", approval_id AS "approvalId",
          user_id AS "userId", status, action_type AS "actionType", mode,
          execution_enabled AS "executionEnabled", created_at AS "createdAt",
          approved_at AS "approvedAt", approved_by AS "approvedBy"
          FROM oxkio_poc.approvals WHERE tenant_id = $1 ORDER BY approval_id`,
        operations: `SELECT tenant_id AS "tenantId", operation_id AS "operationId",
          user_id AS "userId", idempotency_key AS "idempotencyKey",
          operation_type AS "operationType", state, created_at AS "createdAt",
          started_at AS "startedAt", completed_at AS "completedAt", result
          FROM oxkio_poc.operations WHERE tenant_id = $1 ORDER BY operation_id`,
        memories: `SELECT tenant_id AS "tenantId", memory_id AS "memoryId",
          user_id AS "userId", kind, content, created_at AS "createdAt"
          FROM oxkio_poc.memories WHERE tenant_id = $1 ORDER BY memory_id`,
        audit: `SELECT tenant_id AS "tenantId", event_id AS "eventId",
          user_id AS "userId", actor_id AS "actorId", action,
          created_at AS "createdAt", metadata
          FROM oxkio_poc.audit_events WHERE tenant_id = $1 ORDER BY event_id`,
      };
      const dataset = {
        version: '1.0',
        tenantId,
        exportedAt: input.exportedAt,
      };
      for (const [name, sql] of Object.entries(definitions)) {
        const result = await client.query(sql, [tenantId]);
        dataset[name] = clone(rows(result));
        this.query();
        this.read(rows(result).length);
      }
      return dataset;
    }, { repeatableRead: true });
  }

  async restoreTenant(input) {
    const target = validateScope(input);
    const dataset = clone(input.dataset);
    return this.withTransaction(target.tenantId, async (client) => {
      for (const table of ['approvals', 'operations', 'memories', 'audit_events']) {
        const result = await client.query(
          `SELECT 1 FROM oxkio_poc.${table} WHERE tenant_id = $1 LIMIT 1`,
          [target.tenantId],
        );
        this.read(rows(result).length);
        if (rows(result).length > 0) throw new Error('restore_target_not_empty');
      }
      await client.query(
        `INSERT INTO oxkio_poc.tenants (tenant_id, status)
         VALUES ($1, 'poc_restore')`,
        [target.tenantId],
      );
      await client.query(
        `INSERT INTO oxkio_poc.scopes (tenant_id, user_id, role, status)
         VALUES ($1, $2, $3, 'active')`,
        [target.tenantId, target.userId, input.role || 'owner'],
      );
      this.write(2);

      for (const entry of dataset.approvals || []) {
        await client.query(
          `INSERT INTO oxkio_poc.approvals (
             tenant_id, approval_id, user_id, status, action_type, mode,
             execution_enabled, created_at, approved_at, approved_by
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            target.tenantId, entry.approvalId, target.userId, entry.status,
            entry.actionType, entry.mode, entry.executionEnabled, entry.createdAt,
            entry.approvedAt, entry.approvedBy ? target.userId : null,
          ],
        );
        this.write();
      }
      for (const entry of dataset.operations || []) {
        await client.query(
          `INSERT INTO oxkio_poc.operations (
             tenant_id, operation_id, user_id, idempotency_key, operation_type,
             state, created_at, started_at, completed_at, result
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
          [
            target.tenantId, entry.operationId, target.userId, entry.idempotencyKey,
            entry.operationType, entry.state, entry.createdAt, entry.startedAt,
            entry.completedAt, JSON.stringify(entry.result),
          ],
        );
        this.write();
      }
      for (const entry of dataset.memories || []) {
        await client.query(
          `INSERT INTO oxkio_poc.memories (
             tenant_id, memory_id, user_id, kind, content, created_at
           ) VALUES ($1,$2,$3,$4,$5,$6)`,
          [
            target.tenantId, entry.memoryId, target.userId,
            entry.kind, entry.content, entry.createdAt,
          ],
        );
        this.write();
      }
      for (const entry of dataset.audit || []) {
        await client.query(
          `INSERT INTO oxkio_poc.audit_events (
             tenant_id, event_id, user_id, actor_id, action, created_at, metadata
           ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
          [
            target.tenantId, entry.eventId, target.userId, target.userId,
            entry.action, entry.createdAt, JSON.stringify(entry.metadata || {}),
          ],
        );
        this.write();
      }
      return { restored: true, tenantId: target.tenantId };
    });
  }

  getMetrics() {
    return clone(this.metrics);
  }
}

function describePostgresEnvironment({
  env = process.env,
  modulePresent = false,
} = {}) {
  const connectionConfigured = typeof env.OXKIO_POC_POSTGRES_URL === 'string'
    && Boolean(env.OXKIO_POC_POSTGRES_URL.trim());
  return Object.freeze({
    provider: 'postgresql',
    status: connectionConfigured && modulePresent
      ? 'READY_FOR_ISOLATED_DATABASE'
      : 'BLOCKED_BY_ENVIRONMENT',
    productionAllowed: false,
    connectionConfigured,
    driverPresent: modulePresent,
    blockers: Object.freeze([
      ...(connectionConfigured ? [] : ['OXKIO_POC_POSTGRES_URL is absent']),
      ...(modulePresent ? [] : ['pg driver is absent']),
    ]),
  });
}

module.exports = {
  PostgresPocAdapter,
  describePostgresEnvironment,
};

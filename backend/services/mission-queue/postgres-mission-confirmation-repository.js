'use strict';

const { isDeepStrictEqual } = require('node:util');

const {
  runPostgresScopedTransaction,
} = require('../../repositories/postgres/postgres-scoped-transaction');
const {
  CONFIRMATION_STATUSES,
  ConfirmationContractError,
  validateMissionConfirmation,
} = require('./mission-confirmation-contract');
const {
  ConfirmationRepositoryError,
  assertConfirmationScope,
  assertConfirmationUpdate,
  normalizeConfirmationId,
  normalizeConfirmationScope,
  normalizeConsumeLease,
  normalizeExpectedVersion,
  normalizeLeaseId,
  normalizeOperationTime,
  repositoryFail,
} = require('./mission-confirmation-repository-contract');

const CREATE_INTENT_FIELDS = Object.freeze([
  'confirmationId',
  'tenantId',
  'userId',
  'clientId',
  'missionId',
  'idempotencyKey',
  'planSnapshot',
  'planSchemaVersion',
  'expiresAt',
]);

const SELECT_FIELDS = `
  tenant_id AS "tenantId",
  user_id AS "userId",
  client_id AS "clientId",
  confirmation_id AS "confirmationId",
  mission_id AS "missionId",
  idempotency_key AS "idempotencyKey",
  plan_snapshot AS "planSnapshot",
  plan_schema_version AS "planSchemaVersion",
  status,
  version,
  created_at AS "createdAt",
  confirmed_at AS "confirmedAt",
  consumed_at AS "consumedAt",
  revoked_at AS "revokedAt",
  expires_at AS "expiresAt",
  consume_lease_id AS "consumeLeaseId",
  consume_lease_acquired_at AS "consumeLeaseAcquiredAt",
  consume_lease_expires_at AS "consumeLeaseExpiresAt"`;

function repositoryError(code, message) {
  return new ConfirmationRepositoryError(code, message);
}

function sanitizeDatabaseError(error) {
  if (error instanceof ConfirmationRepositoryError || error instanceof ConfirmationContractError) {
    return error;
  }
  return repositoryError(
    'confirmation_repository_unavailable',
    'PostgreSQL could not complete the Confirmation operation.',
  );
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function asSafePositiveInteger(value, fieldName) {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw repositoryError(
      'confirmation_repository_unavailable',
      `Stored Confirmation ${fieldName} is invalid.`,
    );
  }
  return number;
}

function asIsoTimestamp(value, fieldName) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw repositoryError(
      'confirmation_repository_unavailable',
      `Stored Confirmation ${fieldName} is invalid.`,
    );
  }
  return date.toISOString();
}

function asNullableIsoTimestamp(value, fieldName) {
  return value === null || value === undefined ? null : asIsoTimestamp(value, fieldName);
}

function confirmationFromRow(row) {
  try {
    const confirmation = {
      confirmationId: row.confirmationId,
      tenantId: row.tenantId,
      userId: row.userId,
      clientId: row.clientId,
      missionId: row.missionId,
      idempotencyKey: row.idempotencyKey,
      planSnapshot: cloneJson(row.planSnapshot),
      planSchemaVersion: asSafePositiveInteger(row.planSchemaVersion, 'planSchemaVersion'),
      status: row.status,
      version: asSafePositiveInteger(row.version, 'version'),
      createdAt: asIsoTimestamp(row.createdAt, 'createdAt'),
      confirmedAt: asNullableIsoTimestamp(row.confirmedAt, 'confirmedAt'),
      consumedAt: asNullableIsoTimestamp(row.consumedAt, 'consumedAt'),
      revokedAt: asNullableIsoTimestamp(row.revokedAt, 'revokedAt'),
      expiresAt: asIsoTimestamp(row.expiresAt, 'expiresAt'),
    };
    validateMissionConfirmation(confirmation);
    return cloneJson(confirmation);
  } catch (error) {
    if (error instanceof ConfirmationRepositoryError) throw error;
    throw repositoryError(
      'confirmation_repository_unavailable',
      'Stored Confirmation failed validation.',
    );
  }
}

function leaseFromRow(row) {
  return normalizeConsumeLease({
    leaseId: row.consumeLeaseId,
    acquiredAt: asIsoTimestamp(row.consumeLeaseAcquiredAt, 'consumeLeaseAcquiredAt'),
    expiresAt: asIsoTimestamp(row.consumeLeaseExpiresAt, 'consumeLeaseExpiresAt'),
  });
}

function persistenceRecord(scope, confirmation) {
  assertConfirmationScope(confirmation, scope);
  return {
    tenantId: scope.tenantId,
    userId: scope.userId,
    clientId: scope.clientId,
    confirmationId: confirmation.confirmationId,
    missionId: confirmation.missionId,
    idempotencyKey: confirmation.idempotencyKey,
    planSnapshot: cloneJson(confirmation.planSnapshot),
    planSchemaVersion: confirmation.planSchemaVersion,
    status: confirmation.status,
    version: confirmation.version,
    createdAt: confirmation.createdAt,
    confirmedAt: confirmation.confirmedAt,
    consumedAt: confirmation.consumedAt,
    revokedAt: confirmation.revokedAt,
    expiresAt: confirmation.expiresAt,
  };
}

function sameCreateIntent(left, right) {
  return CREATE_INTENT_FIELDS.every((field) => (field === 'planSnapshot'
    ? isDeepStrictEqual(left[field], right[field])
    : left[field] === right[field]));
}

function insertParameters(record) {
  return [
    record.tenantId,
    record.userId,
    record.clientId,
    record.confirmationId,
    record.missionId,
    record.idempotencyKey,
    JSON.stringify(record.planSnapshot),
    record.planSchemaVersion,
    record.status,
    record.version,
    record.createdAt,
    record.confirmedAt,
    record.consumedAt,
    record.revokedAt,
    record.expiresAt,
  ];
}

class PostgresMissionConfirmationRepository {
  #pool;

  constructor({ pool } = {}) {
    if (!pool || typeof pool.connect !== 'function') {
      repositoryFail(
        'invalid_postgres_pool',
        'PostgresMissionConfirmationRepository requires an injected PostgreSQL pool.',
      );
    }
    this.#pool = pool;
    this.provider = 'postgresql';
  }

  async #withScope(rawScope, operation) {
    return runPostgresScopedTransaction({
      pool: this.#pool,
      rawScope,
      normalizeScope: normalizeConfirmationScope,
      operation,
      sanitizeError: sanitizeDatabaseError,
      commitUnknownError: () => repositoryError(
        'confirmation_unknown_commit_result',
        'PostgreSQL commit outcome is unknown; reconcile before another mutation.',
      ),
    });
  }

  async create(rawScope, confirmation) {
    const scope = normalizeConfirmationScope(rawScope);
    const record = persistenceRecord(scope, confirmation);
    return this.#withScope(scope, async (client) => {
      const inserted = await client.query(
        `INSERT INTO oxkio.mission_confirmations (
           tenant_id, user_id, client_id, confirmation_id, mission_id,
           idempotency_key, plan_snapshot, plan_schema_version, status, version,
           created_at, confirmed_at, consumed_at, revoked_at, expires_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10,
           $11, $12, $13, $14, $15
         )
         ON CONFLICT DO NOTHING
         RETURNING ${SELECT_FIELDS}`,
        insertParameters(record),
      );
      if (inserted.rows.length === 1) {
        return { confirmation: confirmationFromRow(inserted.rows[0]), created: true };
      }

      const byId = await client.query(
        `SELECT ${SELECT_FIELDS}
         FROM oxkio.mission_confirmations
         WHERE tenant_id = $1 AND user_id = $2 AND client_id = $3
           AND confirmation_id = $4`,
        [scope.tenantId, scope.userId, scope.clientId, record.confirmationId],
      );
      if (byId.rows.length === 1) {
        const existing = confirmationFromRow(byId.rows[0]);
        if (!sameCreateIntent(existing, confirmation)) {
          repositoryFail('confirmation_conflict', 'Confirmation identity conflict.');
        }
        return { confirmation: existing, created: false };
      }

      const byMission = await client.query(
        `SELECT confirmation_id
         FROM oxkio.mission_confirmations
         WHERE tenant_id = $1 AND user_id = $2 AND client_id = $3
           AND mission_id = $4`,
        [scope.tenantId, scope.userId, scope.clientId, record.missionId],
      );
      if (byMission.rows.length === 1) {
        repositoryFail('confirmation_mission_conflict', 'Mission Confirmation conflict.');
      }

      const byKey = await client.query(
        `SELECT confirmation_id
         FROM oxkio.mission_confirmations
         WHERE tenant_id = $1 AND user_id = $2 AND client_id = $3
           AND idempotency_key = $4`,
        [scope.tenantId, scope.userId, scope.clientId, record.idempotencyKey],
      );
      if (byKey.rows.length === 1) {
        repositoryFail('confirmation_conflict', 'Confirmation idempotency conflict.');
      }
      repositoryFail(
        'confirmation_conflict',
        'PostgreSQL reported a scoped Confirmation conflict.',
      );
    });
  }

  async get(rawScope, rawConfirmationId) {
    const scope = normalizeConfirmationScope(rawScope);
    const confirmationId = normalizeConfirmationId(rawConfirmationId);
    return this.#withScope(scope, async (client) => {
      const result = await client.query(
        `SELECT ${SELECT_FIELDS}
         FROM oxkio.mission_confirmations
         WHERE tenant_id = $1 AND user_id = $2 AND client_id = $3
           AND confirmation_id = $4`,
        [scope.tenantId, scope.userId, scope.clientId, confirmationId],
      );
      if (result.rows.length !== 1) {
        repositoryFail('confirmation_not_found', 'Confirmation was not found.');
      }
      return confirmationFromRow(result.rows[0]);
    });
  }

  async saveIfVersion(rawScope, confirmation, rawExpectedVersion, rawOperationTime) {
    const scope = normalizeConfirmationScope(rawScope);
    const expectedVersion = normalizeExpectedVersion(rawExpectedVersion);
    const operationTime = normalizeOperationTime(rawOperationTime);
    const record = persistenceRecord(scope, confirmation);
    if (record.version <= expectedVersion) {
      repositoryFail(
        'confirmation_update_invalid',
        'Confirmation version must advance beyond expectedVersion.',
      );
    }

    return this.#withScope(scope, async (client) => {
      const result = await client.query(
        `UPDATE oxkio.mission_confirmations
         SET status = $6,
             version = $7,
             confirmed_at = $8,
             consumed_at = $9,
             revoked_at = $10,
             consume_lease_id = NULL,
             consume_lease_acquired_at = NULL,
             consume_lease_expires_at = NULL
         WHERE tenant_id = $1 AND user_id = $2 AND client_id = $3
           AND confirmation_id = $4 AND version = $5
           AND (consume_lease_expires_at IS NULL OR consume_lease_expires_at <= $11)
           AND mission_id = $12
           AND idempotency_key = $13
           AND plan_snapshot = $14::jsonb
           AND plan_schema_version = $15
           AND created_at = $16
           AND expires_at = $17
         RETURNING ${SELECT_FIELDS}`,
        [
          scope.tenantId,
          scope.userId,
          scope.clientId,
          record.confirmationId,
          expectedVersion,
          record.status,
          record.version,
          record.confirmedAt,
          record.consumedAt,
          record.revokedAt,
          operationTime,
          record.missionId,
          record.idempotencyKey,
          JSON.stringify(record.planSnapshot),
          record.planSchemaVersion,
          record.createdAt,
          record.expiresAt,
        ],
      );
      if (result.rows.length === 1) return confirmationFromRow(result.rows[0]);

      const currentResult = await client.query(
        `SELECT ${SELECT_FIELDS}
         FROM oxkio.mission_confirmations
         WHERE tenant_id = $1 AND user_id = $2 AND client_id = $3
           AND confirmation_id = $4`,
        [scope.tenantId, scope.userId, scope.clientId, record.confirmationId],
      );
      if (currentResult.rows.length === 0) {
        repositoryFail('confirmation_not_found', 'Confirmation was not found.');
      }
      const currentRow = currentResult.rows[0];
      const current = confirmationFromRow(currentRow);
      if (current.version !== expectedVersion) {
        repositoryFail('confirmation_version_conflict', 'Confirmation version conflict.');
      }
      if (currentRow.consumeLeaseExpiresAt
        && Date.parse(asIsoTimestamp(currentRow.consumeLeaseExpiresAt, 'consumeLeaseExpiresAt'))
          > Date.parse(operationTime)) {
        repositoryFail('confirmation_lease_conflict', 'Consume lease is active.');
      }
      assertConfirmationUpdate(current, confirmation);
      repositoryFail('confirmation_repository_unavailable', 'Confirmation update was rejected.');
    });
  }

  async acquireConsumeLease(rawScope, rawConfirmationId, rawExpectedVersion, rawLease) {
    const scope = normalizeConfirmationScope(rawScope);
    const confirmationId = normalizeConfirmationId(rawConfirmationId);
    const expectedVersion = normalizeExpectedVersion(rawExpectedVersion);
    const lease = normalizeConsumeLease(rawLease);
    return this.#withScope(scope, async (client) => {
      const result = await client.query(
        `UPDATE oxkio.mission_confirmations
         SET consume_lease_id = $6,
             consume_lease_acquired_at = $7,
             consume_lease_expires_at = $8
         WHERE tenant_id = $1 AND user_id = $2 AND client_id = $3
           AND confirmation_id = $4 AND version = $5
           AND status = 'CONFIRMED'
           AND expires_at > $7
           AND $8 <= expires_at
           AND (consume_lease_expires_at IS NULL OR consume_lease_expires_at <= $7)
         RETURNING consume_lease_id AS "consumeLeaseId",
                   consume_lease_acquired_at AS "consumeLeaseAcquiredAt",
                   consume_lease_expires_at AS "consumeLeaseExpiresAt"`,
        [
          scope.tenantId,
          scope.userId,
          scope.clientId,
          confirmationId,
          expectedVersion,
          lease.leaseId,
          lease.acquiredAt,
          lease.expiresAt,
        ],
      );
      if (result.rows.length === 1) return leaseFromRow(result.rows[0]);

      const currentResult = await client.query(
        `SELECT ${SELECT_FIELDS}
         FROM oxkio.mission_confirmations
         WHERE tenant_id = $1 AND user_id = $2 AND client_id = $3
           AND confirmation_id = $4`,
        [scope.tenantId, scope.userId, scope.clientId, confirmationId],
      );
      if (currentResult.rows.length === 0) {
        repositoryFail('confirmation_not_found', 'Confirmation was not found.');
      }
      const row = currentResult.rows[0];
      const current = confirmationFromRow(row);
      if (current.version !== expectedVersion) {
        repositoryFail('confirmation_version_conflict', 'Confirmation version conflict.');
      }
      if ([CONFIRMATION_STATUSES.CONSUMED, CONFIRMATION_STATUSES.REVOKED]
        .includes(current.status)) {
        repositoryFail('confirmation_terminal', 'Terminal Confirmation cannot be leased.');
      }
      if (current.status !== CONFIRMATION_STATUSES.CONFIRMED) {
        repositoryFail('confirmation_transition_invalid', 'Confirmation is not ready for consumption.');
      }
      if (Date.parse(current.expiresAt) <= Date.parse(lease.acquiredAt)) {
        repositoryFail('confirmation_expired', 'Mission Confirmation has expired.');
      }
      if (Date.parse(lease.expiresAt) > Date.parse(current.expiresAt)) {
        repositoryFail('confirmation_lease_invalid', 'Consume lease exceeds Confirmation lifetime.');
      }
      if (row.consumeLeaseExpiresAt
        && Date.parse(asIsoTimestamp(row.consumeLeaseExpiresAt, 'consumeLeaseExpiresAt'))
          > Date.parse(lease.acquiredAt)) {
        repositoryFail('confirmation_lease_conflict', 'Consume lease is active.');
      }
      repositoryFail('confirmation_repository_unavailable', 'Consume lease acquisition was rejected.');
    });
  }

  async releaseConsumeLease(rawScope, rawConfirmationId, rawLeaseId) {
    const scope = normalizeConfirmationScope(rawScope);
    const confirmationId = normalizeConfirmationId(rawConfirmationId);
    const leaseId = normalizeLeaseId(rawLeaseId);
    return this.#withScope(scope, async (client) => {
      const result = await client.query(
        `UPDATE oxkio.mission_confirmations
         SET consume_lease_id = NULL,
             consume_lease_acquired_at = NULL,
             consume_lease_expires_at = NULL
         WHERE tenant_id = $1 AND user_id = $2 AND client_id = $3
           AND confirmation_id = $4 AND consume_lease_id = $5
         RETURNING confirmation_id`,
        [scope.tenantId, scope.userId, scope.clientId, confirmationId, leaseId],
      );
      if (result.rows.length === 1) return { released: true };

      const visible = await client.query(
        `SELECT confirmation_id
         FROM oxkio.mission_confirmations
         WHERE tenant_id = $1 AND user_id = $2 AND client_id = $3
           AND confirmation_id = $4`,
        [scope.tenantId, scope.userId, scope.clientId, confirmationId],
      );
      if (visible.rows.length === 0) {
        repositoryFail('confirmation_not_found', 'Confirmation was not found.');
      }
      repositoryFail('confirmation_lease_invalid', 'Consume lease is invalid.');
    });
  }

  async consumeIfLeased(
    rawScope,
    confirmation,
    rawExpectedVersion,
    rawLeaseId,
  ) {
    const scope = normalizeConfirmationScope(rawScope);
    const expectedVersion = normalizeExpectedVersion(rawExpectedVersion);
    const leaseId = normalizeLeaseId(rawLeaseId);
    const record = persistenceRecord(scope, confirmation);
    if (record.status !== CONFIRMATION_STATUSES.CONSUMED || !record.consumedAt) {
      repositoryFail('confirmation_update_invalid', 'Consumed Confirmation is required.');
    }
    if (record.version <= expectedVersion) {
      repositoryFail(
        'confirmation_update_invalid',
        'Confirmation version must advance beyond expectedVersion.',
      );
    }

    return this.#withScope(scope, async (client) => {
      const result = await client.query(
        `UPDATE oxkio.mission_confirmations
         SET status = $6,
             version = $7,
             confirmed_at = $8,
             consumed_at = $9,
             revoked_at = $10,
             consume_lease_id = NULL,
             consume_lease_acquired_at = NULL,
             consume_lease_expires_at = NULL
         WHERE tenant_id = $1 AND user_id = $2 AND client_id = $3
           AND confirmation_id = $4 AND version = $5
           AND status = 'CONFIRMED'
           AND consume_lease_id = $11
           AND consume_lease_expires_at > $9
           AND expires_at > $9
           AND mission_id = $12
           AND idempotency_key = $13
           AND plan_snapshot = $14::jsonb
           AND plan_schema_version = $15
           AND created_at = $16
           AND expires_at = $17
         RETURNING ${SELECT_FIELDS}`,
        [
          scope.tenantId,
          scope.userId,
          scope.clientId,
          record.confirmationId,
          expectedVersion,
          record.status,
          record.version,
          record.confirmedAt,
          record.consumedAt,
          record.revokedAt,
          leaseId,
          record.missionId,
          record.idempotencyKey,
          JSON.stringify(record.planSnapshot),
          record.planSchemaVersion,
          record.createdAt,
          record.expiresAt,
        ],
      );
      if (result.rows.length === 1) return confirmationFromRow(result.rows[0]);

      const currentResult = await client.query(
        `SELECT ${SELECT_FIELDS}
         FROM oxkio.mission_confirmations
         WHERE tenant_id = $1 AND user_id = $2 AND client_id = $3
           AND confirmation_id = $4`,
        [scope.tenantId, scope.userId, scope.clientId, record.confirmationId],
      );
      if (currentResult.rows.length === 0) {
        repositoryFail('confirmation_not_found', 'Confirmation was not found.');
      }
      const row = currentResult.rows[0];
      const current = confirmationFromRow(row);
      if (current.version !== expectedVersion) {
        repositoryFail('confirmation_version_conflict', 'Confirmation version conflict.');
      }
      if ([CONFIRMATION_STATUSES.CONSUMED, CONFIRMATION_STATUSES.REVOKED]
        .includes(current.status)) {
        repositoryFail('confirmation_terminal', 'Terminal Confirmation cannot be consumed.');
      }
      if (current.status !== CONFIRMATION_STATUSES.CONFIRMED) {
        repositoryFail('confirmation_transition_invalid', 'Confirmation is not ready for consumption.');
      }
      assertConfirmationUpdate(current, confirmation);
      if (Date.parse(current.expiresAt) <= Date.parse(record.consumedAt)) {
        repositoryFail('confirmation_expired', 'Mission Confirmation has expired.');
      }
      if (!row.consumeLeaseId || row.consumeLeaseId !== leaseId
        || Date.parse(asIsoTimestamp(row.consumeLeaseExpiresAt, 'consumeLeaseExpiresAt'))
          <= Date.parse(record.consumedAt)) {
        repositoryFail('confirmation_lease_invalid', 'Consume lease is invalid.');
      }
      repositoryFail('confirmation_repository_unavailable', 'Confirmation consumption was rejected.');
    });
  }
}

module.exports = {
  PostgresMissionConfirmationRepository,
};

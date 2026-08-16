'use strict';

// PostgresApprovalRepository — adaptador ApprovalRepositoryV2 sobre
// PostgreSQL (oxkio.approval_items). B1 (5C.7B.3F).
//
// Este repositorio demuestra: SQL parametrizado, CAS por version(+status,
// +execution_id), clasificacion segura de conflictos (not_found /
// stale_version / status_conflict / execution_id_mismatch) via lectura de
// desambiguacion en la misma transaccion, scope client_id-only fail-closed
// en los metodos que reciben scope (create/getById/listPending/listHistory/
// reclaimExpiredExecutions), reloj de aplicacion (nunca NOW() de PostgreSQL)
// para timestamps y leases, y pool/cliente SIEMPRE inyectado (nunca
// construye una conexion real).
//
// Este repositorio NO demuestra ni debe presentarse como: PostgreSQL real,
// RLS real, CAS concurrente entre conexiones reales, comportamiento de Neon,
// TLS, privilegios/grants reales, ni concurrencia multiinstancia real. Los
// tests de este fichero usan un pool/cliente FALSO inyectado y solo prueban
// la logica del adaptador, no PostgreSQL. Esas garantias pertenecen a
// microfases posteriores con puerta humana propia.
//
// Nota de diseno — SCOPE-BOUND (correccion pre-commit sobre el primer
// borrador de B1): los metodos mutadores del contrato ApprovalRepositoryV2
// (approve/reject/claimExecution/completeExecution/failExecution/expire)
// NO reciben `scope` en su firma — asi los invoca ApprovalQueue hoy, y asi
// los implementa JsonApprovalRepositoryV2. El contrato NO se amplia para
// arreglar esto (fuera de alcance). En su lugar, el REPOSITORIO completo
// queda ligado a un unico scope, fijado en el constructor
// (`new PostgresApprovalRepository({pool, scope: {clientId}})`) y validado
// fail-closed alli mismo. TODAS las operaciones — incluidos los 6
// mutadores, que no tienen forma de recibir un scope por argumento — corren
// dentro de una transaccion que fija `app.client_id = <scope ligado>` via
// runApprovalScopedTransaction(). Los 5 metodos que SI reciben un scope por
// argumento (create/getById/listPending/listHistory/
// reclaimExpiredExecutions) comprueban que ese scope coincide EXACTAMENTE
// con el scope ligado al repositorio antes de tocar el pool; si no
// coincide, fallan cerrado con `scope_mismatch` sin llamar a
// pool.connect(), sin SQL y sin red. Esto permite que los 11 metodos
// compartan el MISMO contexto RLS (`app.client_id`) sin cambiar
// ApprovalQueue, sin cambiar el contrato V2 y sin inventar tenantId/userId.

const { randomUUID } = require('node:crypto');
const { runApprovalScopedTransaction } = require('./postgres/run-approval-scoped-transaction');
const {
  APPROVAL_REPOSITORY_V2_STATUSES: STATUSES,
  APPROVAL_REPOSITORY_V2_ERROR_CODES: ERROR_CODES,
} = require('./json-approval-repository-v2');

const SELECT_FIELDS = `
  id,
  client_id AS "clientId",
  version,
  status,
  record,
  approved_by AS "approvedBy",
  approved_at AS "approvedAt",
  rejected_at AS "rejectedAt",
  resolved_at AS "resolvedAt",
  execution_id AS "executionId",
  execution_attempt_count AS "executionAttemptCount",
  execution_started_at AS "executionStartedAt",
  execution_lease_expires_at AS "executionLeaseExpiresAt",
  execution_completed_at AS "executionCompletedAt",
  execution_failed_at AS "executionFailedAt",
  result,
  error,
  created_at AS "createdAt",
  updated_at AS "updatedAt"`;

class PostgresApprovalRepositoryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PostgresApprovalRepositoryError';
    this.code = code;
  }
}

function repositoryError(code, message) {
  return new PostgresApprovalRepositoryError(code, message);
}

function sanitizeDatabaseError(error) {
  if (error instanceof PostgresApprovalRepositoryError) return error;
  const code = error && (error.code || error.errno);
  if (code === '57014' || code === 'ETIMEDOUT') {
    return repositoryError(
      'approval_repository_timeout',
      'PostgreSQL did not complete the Approval operation in time.',
    );
  }
  if (
    (typeof code === 'string' && code.startsWith('08'))
    || ['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EHOSTUNREACH', '57P01', '57P02', '57P03'].includes(code)
  ) {
    return repositoryError(
      'approval_repository_unavailable',
      'PostgreSQL is unavailable for the Approval operation.',
    );
  }
  return repositoryError('approval_repository_failure', 'PostgreSQL rejected the Approval operation.');
}

function ok(item) {
  return { ok: true, item };
}

function conflict(code, extra = {}) {
  return { ok: false, code, ...extra };
}

function assertNonEmptyString(value, fieldName) {
  if (typeof value !== 'string' || !value) {
    throw repositoryError('invalid_argument', `${fieldName} must be a non-empty string.`);
  }
  return value;
}

function assertExpectedVersion(expectedVersion) {
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw repositoryError('invalid_argument', 'expectedVersion must be a positive integer.');
  }
}

function assertKnownStatus(status, fieldName) {
  if (typeof status !== 'string' || !STATUSES.includes(status)) {
    throw repositoryError('invalid_argument', `${fieldName} must be a known status.`);
  }
  return status;
}

// Fail-closed (Punto 13/5 de la auditoria PRE-B1): a diferencia de
// JsonApprovalRepositoryV2 (que trata un scope.clientId ausente/vacio como
// "sin restriccion"), este adaptador RECHAZA la operacion antes de tocar el
// pool. No se degrada este comportamiento para imitar al backend JSON.
function normalizeApprovalScope(rawScope) {
  const clientId = rawScope && typeof rawScope.clientId === 'string' ? rawScope.clientId.trim() : '';
  if (!clientId) {
    throw repositoryError(
      'scope_required',
      'PostgresApprovalRepository requires a non-empty scope.clientId (fail-closed).',
    );
  }
  return { clientId };
}

function asPositiveInteger(value, fieldName) {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw repositoryError('approval_data_corrupt', `Stored ${fieldName} is invalid.`);
  }
  return number;
}

function asNonNegativeInteger(value, fieldName) {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw repositoryError('approval_data_corrupt', `Stored ${fieldName} is invalid.`);
  }
  return number;
}

function asIsoTimestamp(value, fieldName) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw repositoryError('approval_data_corrupt', `Stored ${fieldName} is invalid.`);
  }
  return date.toISOString();
}

function asNullableIsoTimestamp(value, fieldName) {
  if (value === null || value === undefined) return null;
  return asIsoTimestamp(value, fieldName);
}

function itemFromRow(row) {
  return {
    id: row.id,
    version: asPositiveInteger(row.version, 'version'),
    status: assertKnownStatus(row.status, 'status'),
    scope: { clientId: row.clientId },
    record: row.record === undefined ? null : row.record,
    approvedBy: row.approvedBy === undefined ? null : row.approvedBy,
    approvedAt: asNullableIsoTimestamp(row.approvedAt, 'approvedAt'),
    rejectedAt: asNullableIsoTimestamp(row.rejectedAt, 'rejectedAt'),
    resolvedAt: asNullableIsoTimestamp(row.resolvedAt, 'resolvedAt'),
    executionId: row.executionId === undefined ? null : row.executionId,
    executionAttemptCount: asNonNegativeInteger(row.executionAttemptCount, 'executionAttemptCount'),
    executionStartedAt: asNullableIsoTimestamp(row.executionStartedAt, 'executionStartedAt'),
    executionLeaseExpiresAt: asNullableIsoTimestamp(row.executionLeaseExpiresAt, 'executionLeaseExpiresAt'),
    executionCompletedAt: asNullableIsoTimestamp(row.executionCompletedAt, 'executionCompletedAt'),
    executionFailedAt: asNullableIsoTimestamp(row.executionFailedAt, 'executionFailedAt'),
    result: row.result === undefined ? null : row.result,
    error: row.error === undefined ? null : row.error,
    createdAt: asIsoTimestamp(row.createdAt, 'createdAt'),
    updatedAt: asIsoTimestamp(row.updatedAt, 'updatedAt'),
  };
}

class PostgresApprovalRepository {
  #pool;

  #scope;

  constructor({ pool, scope } = {}) {
    if (!pool || typeof pool.connect !== 'function') {
      throw repositoryError(
        'invalid_postgres_pool',
        'PostgresApprovalRepository requires an injected PostgreSQL pool.',
      );
    }
    // Fail-closed en construccion: un repositorio sin scope.clientId valido
    // no puede existir. Esto es lo que hace al repositorio "scope-bound".
    this.#scope = normalizeApprovalScope(scope);
    this.#pool = pool;
    this.persistence = 'postgresql';
  }

  // TODAS las operaciones (los 11 metodos) corren aqui: fija
  // app.client_id = <scope ligado al repositorio> antes de cualquier SQL de
  // negocio, incluidos los 6 mutadores que no reciben scope por argumento.
  async #withScope(operation) {
    return runApprovalScopedTransaction({
      pool: this.#pool,
      rawScope: this.#scope,
      normalizeScope: (value) => value, // ya normalizado en el constructor
      operation,
      sanitizeError: sanitizeDatabaseError,
      commitUnknownError: () => repositoryError(
        'approval_commit_outcome_unknown',
        'PostgreSQL commit outcome is unknown; reconcile before another mutation.',
      ),
    });
  }

  // Usado por los 5 metodos que SI reciben un scope por argumento
  // (create/getById/listPending/listHistory/reclaimExpiredExecutions).
  // Fail-closed ANTES de tocar el pool: normaliza el scope recibido (lanza
  // scope_required si falta/es invalido) y lo compara con el scope ligado
  // al repositorio (lanza scope_mismatch si difiere). Ninguna de las dos
  // ramas de fallo llega a pool.connect().
  #assertScopeMatches(rawScope) {
    const requested = normalizeApprovalScope(rawScope);
    if (requested.clientId !== this.#scope.clientId) {
      throw repositoryError(
        'scope_mismatch',
        "scope.clientId does not match this repository's bound scope.",
      );
    }
  }

  // Desambiguacion "0 filas afectadas" en la MISMA transaccion. Orden de
  // clasificacion identico al de JsonApprovalRepositoryV2._transition():
  // not_found -> stale_version -> status_conflict -> execution_id_mismatch
  // (execution_id solo se comprueba si version+status ya coincidian).
  async #classifyConflict(client, id, { expectedVersion, expectedStatus, executionId }) {
    const current = await client.query(
      'SELECT version, status, execution_id AS "executionId" FROM oxkio.approval_items WHERE id = $1',
      [id],
    );
    if (current.rows.length === 0) return conflict(ERROR_CODES.NOT_FOUND);
    const row = current.rows[0];
    if (row.version !== expectedVersion) return conflict(ERROR_CODES.STALE_VERSION);
    if (expectedStatus !== undefined && row.status !== expectedStatus) {
      return conflict(ERROR_CODES.STATUS_CONFLICT, { currentStatus: row.status });
    }
    if (executionId !== undefined && row.executionId !== executionId) {
      return conflict(ERROR_CODES.EXECUTION_ID_MISMATCH);
    }
    // version+status(+executionId) coinciden pero el UPDATE afecto 0 filas:
    // no deberia ocurrir en operacion normal. Se reporta como conflicto,
    // nunca como exito silencioso.
    return conflict(ERROR_CODES.STATUS_CONFLICT, { currentStatus: row.status });
  }

  async create(record, rawScope) {
    this.#assertScopeMatches(rawScope);
    const id = randomUUID();
    const now = new Date().toISOString();
    return this.#withScope(async (client) => {
      const inserted = await client.query(
        `INSERT INTO oxkio.approval_items (
           id, client_id, version, status, record, approved_by, approved_at,
           rejected_at, resolved_at, execution_id, execution_attempt_count,
           execution_started_at, execution_lease_expires_at,
           execution_completed_at, execution_failed_at, result, error,
           created_at, updated_at
         ) VALUES (
           $1, $2, 1, 'pending', $3::jsonb, NULL, NULL, NULL, NULL, NULL, 0,
           NULL, NULL, NULL, NULL, NULL, NULL, $4, $4
         )
         RETURNING ${SELECT_FIELDS}`,
        [id, this.#scope.clientId, JSON.stringify(record === undefined ? null : record), now],
      );
      return ok(itemFromRow(inserted.rows[0]));
    });
  }

  async getById(rawId, rawScope) {
    const id = assertNonEmptyString(rawId, 'id');
    this.#assertScopeMatches(rawScope);
    return this.#withScope(async (client) => {
      const result = await client.query(
        `SELECT ${SELECT_FIELDS} FROM oxkio.approval_items WHERE id = $1 AND client_id = $2`,
        [id, this.#scope.clientId],
      );
      if (result.rows.length !== 1) return conflict(ERROR_CODES.NOT_FOUND);
      return ok(itemFromRow(result.rows[0]));
    });
  }

  async listPending(rawScope) {
    this.#assertScopeMatches(rawScope);
    return this.#withScope(async (client) => {
      const result = await client.query(
        `SELECT ${SELECT_FIELDS} FROM oxkio.approval_items
         WHERE client_id = $1 AND status = 'pending'
         ORDER BY created_at ASC, id ASC`,
        [this.#scope.clientId],
      );
      return result.rows.map(itemFromRow);
    });
  }

  async listHistory(rawScope) {
    this.#assertScopeMatches(rawScope);
    return this.#withScope(async (client) => {
      const result = await client.query(
        `SELECT ${SELECT_FIELDS} FROM oxkio.approval_items
         WHERE client_id = $1 AND status <> 'pending'
         ORDER BY created_at ASC, id ASC`,
        [this.#scope.clientId],
      );
      return result.rows.map(itemFromRow);
    });
  }

  async approve(rawId, { expectedVersion, expectedStatus = 'pending', approvedBy = null } = {}) {
    const id = assertNonEmptyString(rawId, 'id');
    assertExpectedVersion(expectedVersion);
    assertKnownStatus(expectedStatus, 'expectedStatus');
    const now = new Date().toISOString();
    return this.#withScope(async (client) => {
      const result = await client.query(
        `UPDATE oxkio.approval_items
         SET status = 'approved', approved_by = $4::jsonb, approved_at = $5,
             resolved_at = $5, version = version + 1, updated_at = $5
         WHERE id = $1 AND version = $2 AND status = $3
         RETURNING ${SELECT_FIELDS}`,
        [id, expectedVersion, expectedStatus, JSON.stringify(approvedBy === undefined ? null : approvedBy), now],
      );
      if (result.rows.length === 1) return ok(itemFromRow(result.rows[0]));
      return this.#classifyConflict(client, id, { expectedVersion, expectedStatus });
    });
  }

  async reject(rawId, { expectedVersion, expectedStatus = 'pending' } = {}) {
    const id = assertNonEmptyString(rawId, 'id');
    assertExpectedVersion(expectedVersion);
    assertKnownStatus(expectedStatus, 'expectedStatus');
    const now = new Date().toISOString();
    return this.#withScope(async (client) => {
      const result = await client.query(
        `UPDATE oxkio.approval_items
         SET status = 'rejected', rejected_at = $4, resolved_at = $4,
             version = version + 1, updated_at = $4
         WHERE id = $1 AND version = $2 AND status = $3
         RETURNING ${SELECT_FIELDS}`,
        [id, expectedVersion, expectedStatus, now],
      );
      if (result.rows.length === 1) return ok(itemFromRow(result.rows[0]));
      return this.#classifyConflict(client, id, { expectedVersion, expectedStatus });
    });
  }

  async claimExecution(rawId, { expectedVersion, expectedStatus, executionId, leaseTtlMs } = {}) {
    const id = assertNonEmptyString(rawId, 'id');
    assertExpectedVersion(expectedVersion);
    assertKnownStatus(expectedStatus, 'expectedStatus');
    if (typeof executionId !== 'string' || !executionId) {
      throw repositoryError('execution_id_required', 'claimExecution requires an executionId.');
    }
    if (!Number.isInteger(leaseTtlMs) || leaseTtlMs <= 0) {
      throw repositoryError('invalid_lease_ttl', 'claimExecution requires a positive leaseTtlMs.');
    }
    // Reloj de aplicacion, nunca NOW() de PostgreSQL — mismo precedente que
    // acquireConsumeLease() de Mission Queue.
    const nowMs = Date.now();
    const startedAt = new Date(nowMs).toISOString();
    const leaseExpiresAt = new Date(nowMs + leaseTtlMs).toISOString();
    return this.#withScope(async (client) => {
      const result = await client.query(
        `UPDATE oxkio.approval_items
         SET status = 'executing', execution_id = $4,
             execution_attempt_count = execution_attempt_count + 1,
             execution_started_at = $5, execution_lease_expires_at = $6,
             execution_completed_at = NULL, execution_failed_at = NULL,
             result = NULL, error = NULL,
             version = version + 1, updated_at = $5
         WHERE id = $1 AND version = $2 AND status = $3
         RETURNING ${SELECT_FIELDS}`,
        [id, expectedVersion, expectedStatus, executionId, startedAt, leaseExpiresAt],
      );
      if (result.rows.length === 1) return ok(itemFromRow(result.rows[0]));
      return this.#classifyConflict(client, id, { expectedVersion, expectedStatus });
    });
  }

  async completeExecution(rawId, { expectedVersion, executionId, result = null } = {}) {
    const id = assertNonEmptyString(rawId, 'id');
    assertExpectedVersion(expectedVersion);
    if (typeof executionId !== 'string' || !executionId) {
      throw repositoryError('execution_id_required', 'completeExecution requires an executionId.');
    }
    const now = new Date().toISOString();
    return this.#withScope(async (client) => {
      const updated = await client.query(
        `UPDATE oxkio.approval_items
         SET status = 'executed', result = $4::jsonb, execution_completed_at = $5,
             execution_lease_expires_at = NULL, version = version + 1, updated_at = $5
         WHERE id = $1 AND version = $2 AND status = 'executing' AND execution_id = $3
         RETURNING ${SELECT_FIELDS}`,
        [id, expectedVersion, executionId, JSON.stringify(result === undefined ? null : result), now],
      );
      if (updated.rows.length === 1) return ok(itemFromRow(updated.rows[0]));
      return this.#classifyConflict(client, id, { expectedVersion, expectedStatus: 'executing', executionId });
    });
  }

  async failExecution(rawId, { expectedVersion, executionId, error = null } = {}) {
    const id = assertNonEmptyString(rawId, 'id');
    assertExpectedVersion(expectedVersion);
    if (typeof executionId !== 'string' || !executionId) {
      throw repositoryError('execution_id_required', 'failExecution requires an executionId.');
    }
    const now = new Date().toISOString();
    return this.#withScope(async (client) => {
      const updated = await client.query(
        `UPDATE oxkio.approval_items
         SET status = 'execution_failed', error = $4::jsonb, execution_failed_at = $5,
             execution_lease_expires_at = NULL, version = version + 1, updated_at = $5
         WHERE id = $1 AND version = $2 AND status = 'executing' AND execution_id = $3
         RETURNING ${SELECT_FIELDS}`,
        [id, expectedVersion, executionId, JSON.stringify(error === undefined ? null : error), now],
      );
      if (updated.rows.length === 1) return ok(itemFromRow(updated.rows[0]));
      return this.#classifyConflict(client, id, { expectedVersion, expectedStatus: 'executing', executionId });
    });
  }

  async expire(rawId, { expectedVersion, expectedStatus } = {}) {
    const id = assertNonEmptyString(rawId, 'id');
    assertExpectedVersion(expectedVersion);
    assertKnownStatus(expectedStatus, 'expectedStatus');
    const now = new Date().toISOString();
    return this.#withScope(async (client) => {
      const result = await client.query(
        `UPDATE oxkio.approval_items
         SET status = 'expired', resolved_at = $4, version = version + 1, updated_at = $4
         WHERE id = $1 AND version = $2 AND status = $3
         RETURNING ${SELECT_FIELDS}`,
        [id, expectedVersion, expectedStatus, now],
      );
      if (result.rows.length === 1) return ok(itemFromRow(result.rows[0]));
      return this.#classifyConflict(client, id, { expectedVersion, expectedStatus });
    });
  }

  // Solo CONSULTA — igual que en JsonApprovalRepositoryV2: localiza
  // ejecuciones con lease vencido, no decide ni ejecuta reintentos.
  async reclaimExpiredExecutions(rawScope, now = Date.now()) {
    this.#assertScopeMatches(rawScope);
    const reference = now instanceof Date ? now.getTime() : Number(now);
    return this.#withScope(async (client) => {
      const result = await client.query(
        `SELECT ${SELECT_FIELDS} FROM oxkio.approval_items
         WHERE client_id = $1 AND status = 'executing' AND execution_lease_expires_at <= $2
         ORDER BY execution_lease_expires_at ASC`,
        [this.#scope.clientId, new Date(reference).toISOString()],
      );
      return result.rows.map(itemFromRow);
    });
  }
}

module.exports = {
  PostgresApprovalRepository,
  PostgresApprovalRepositoryError,
  normalizeApprovalScope,
};

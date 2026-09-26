'use strict';

// PostgresQualityIncidentRepository — QualityIncidentRepository
// (loadSnapshot/saveSnapshot) over oxkio.quality_incidents
// (migration 005_quality_incidents.sql).
//
// Reuses the already-provisioned Approval PostgreSQL connection (same pool,
// same OXKIO_APPROVAL_PG_RUNTIME_URL secret, same oxkio_approval_runtime
// role) instead of introducing a new database, role or secret. The pool is
// always injected; this module never builds a connection.
//
// Scope-bound like PostgresApprovalRepository: every query runs inside
// runApprovalScopedTransaction(), which sets app.client_id so RLS
// (client_id = NULLIF(current_setting('app.client_id', true), '')) applies.
// Incidents are operator-level quality metadata, stored under the operator
// scope (cliente-cero); they never carry a family member's identity.
//
// Tests of this file use a FAKE pool: they prove the adapter logic only, not
// real PostgreSQL, RLS, grants or Neon behaviour.

const { runApprovalScopedTransaction } = require('./postgres/run-approval-scoped-transaction');

class PostgresQualityIncidentRepositoryError extends Error {
  constructor(code) {
    super('Quality incident repository operation failed.');
    this.name = 'PostgresQualityIncidentRepositoryError';
    this.code = code;
  }
}

function sanitizeDatabaseError(error) {
  if (error instanceof PostgresQualityIncidentRepositoryError) return error;
  const code = error && (error.code || error.errno);
  if (code === '57014' || code === 'ETIMEDOUT') return new PostgresQualityIncidentRepositoryError('quality_repository_timeout');
  if ((typeof code === 'string' && code.startsWith('08'))
    || ['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EHOSTUNREACH', '57P01', '57P02', '57P03'].includes(code)) {
    return new PostgresQualityIncidentRepositoryError('quality_repository_unavailable');
  }
  return new PostgresQualityIncidentRepositoryError('quality_repository_failure');
}

function normalizeScope(rawScope) {
  const clientId = rawScope && typeof rawScope.clientId === 'string' ? rawScope.clientId.trim() : '';
  if (!clientId) throw new PostgresQualityIncidentRepositoryError('scope_required');
  return { clientId };
}

const LOAD_SQL = `
  SELECT record
  FROM oxkio.quality_incidents
  WHERE client_id = $1
  ORDER BY last_seen_at ASC, id ASC`;

// One statement per write, whatever the number of changed incidents.
const UPSERT_SQL = `
  INSERT INTO oxkio.quality_incidents (
    client_id, id, fingerprint, type, priority, status, record,
    first_seen_at, last_seen_at, created_at, updated_at
  )
  SELECT $1, x.id, x.fingerprint, x.type, x.priority, x.status, x.record,
    x.first_seen_at, x.last_seen_at, $3::timestamptz, $3::timestamptz
  FROM jsonb_to_recordset($2::jsonb) AS x(
    id text, fingerprint text, type text, priority text, status text, record jsonb,
    first_seen_at timestamptz, last_seen_at timestamptz
  )
  ON CONFLICT (client_id, id) DO UPDATE SET
    priority = EXCLUDED.priority,
    status = EXCLUDED.status,
    record = EXCLUDED.record,
    last_seen_at = EXCLUDED.last_seen_at,
    updated_at = EXCLUDED.updated_at`;

class PostgresQualityIncidentRepository {
  #pool;
  #scope;
  #now;

  constructor({ pool, scope, now = () => new Date().toISOString() } = {}) {
    if (!pool || typeof pool.connect !== 'function') throw new PostgresQualityIncidentRepositoryError('pool_required');
    this.#pool = pool;
    this.#scope = normalizeScope(scope);
    this.#now = now;
    this.persistence = 'postgresql';
  }

  #transaction(operation) {
    return runApprovalScopedTransaction({
      pool: this.#pool,
      rawScope: this.#scope,
      normalizeScope,
      operation,
      sanitizeError: sanitizeDatabaseError,
      commitUnknownError: () => new PostgresQualityIncidentRepositoryError('quality_repository_commit_unknown'),
    });
  }

  async loadSnapshot() {
    return this.#transaction(async (client, scope) => {
      const result = await client.query(LOAD_SQL, [scope.clientId]);
      const incidents = (result && Array.isArray(result.rows) ? result.rows : [])
        .map((row) => row && row.record)
        .filter((record) => record && typeof record === 'object');
      return { incidents };
    });
  }

  async saveSnapshot(snapshot) {
    const incidents = snapshot && Array.isArray(snapshot.incidents) ? snapshot.incidents : [];
    if (incidents.length === 0) return;
    const rows = incidents.map((incident) => ({
      id: incident.id,
      fingerprint: incident.fingerprint,
      type: incident.type,
      priority: incident.priority,
      status: incident.status,
      record: incident,
      first_seen_at: incident.firstSeenAt,
      last_seen_at: incident.lastSeenAt,
    }));
    await this.#transaction(async (client, scope) => {
      await client.query(UPSERT_SQL, [scope.clientId, JSON.stringify(rows), this.#now()]);
    });
  }
}

module.exports = {
  PostgresQualityIncidentRepository,
  PostgresQualityIncidentRepositoryError,
};

'use strict';

const {
  runPostgresScopedTransaction,
} = require('../../repositories/postgres/postgres-scoped-transaction');

const {
  MissionDomainError,
  SCHEMA_VERSION,
  assertMissionScope,
  cloneDomain,
  validateIdentifier,
  validateMission,
} = require('./mission-contract');
const {
  MissionRepositoryError,
  normalizeExpectedVersion,
  normalizeIdempotencyKey,
  normalizeMissionFilters,
  normalizeRepositoryScope,
  repositoryFail,
} = require('./mission-repository-contract');

const AGGREGATE_FIELDS = Object.freeze([
  'owners',
  'participants',
  'dependencies',
  'blockers',
  'tasks',
  'risks',
  'requiredApprovals',
  'evidence',
  'result',
  'acceptanceCriteria',
]);

const SELECT_FIELDS = `
  tenant_id AS "tenantId",
  user_id AS "userId",
  client_id AS "clientId",
  mission_id AS "missionId",
  idempotency_key AS "idempotencyKey",
  project_id AS "projectId",
  workspace_id AS "workspaceId",
  title,
  objective,
  scope_text AS "scope",
  status,
  priority,
  schema_version AS "schemaVersion",
  version,
  created_at AS "createdAt",
  updated_at AS "updatedAt",
  next_action AS "nextAction",
  source_interaction_id AS "sourceInteractionId",
  aggregate_data AS "aggregateData"`;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function repositoryError(code, message) {
  return new MissionRepositoryError(code, message);
}

function sanitizeDatabaseError(error) {
  if (error instanceof MissionRepositoryError || error instanceof MissionDomainError) return error;
  const code = error && (error.code || error.errno);
  if (code === '57014' || code === 'ETIMEDOUT') {
    return repositoryError('mission_repository_timeout', 'PostgreSQL did not complete the Mission operation in time.');
  }
  if ((typeof code === 'string' && code.startsWith('08'))
    || ['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EHOSTUNREACH', '57P01', '57P02', '57P03']
      .includes(code)) {
    return repositoryError('mission_repository_unavailable', 'PostgreSQL is unavailable for the Mission operation.');
  }
  return repositoryError('mission_repository_failure', 'PostgreSQL rejected the Mission operation.');
}

function asSafePositiveInteger(value, fieldName) {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw repositoryError('mission_data_corrupt', `Stored ${fieldName} is invalid.`);
  }
  return number;
}

function asIsoTimestamp(value, fieldName) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw repositoryError('mission_data_corrupt', `Stored ${fieldName} is invalid.`);
  }
  return date.toISOString();
}

function aggregateFor(mission) {
  return Object.fromEntries(AGGREGATE_FIELDS.map((field) => [field, cloneDomain(mission[field])]));
}

function persistenceRecord(scope, mission, idempotencyKey = undefined, assertScope = true) {
  validateMission(mission);
  if (assertScope) assertMissionScope(mission, scope);
  return {
    tenantId: scope.tenantId,
    userId: scope.userId,
    clientId: scope.clientId,
    missionId: mission.missionId,
    idempotencyKey,
    projectId: mission.projectId,
    workspaceId: mission.workspaceId,
    title: mission.title,
    objective: mission.objective,
    scopeText: mission.scope,
    status: mission.status,
    priority: mission.priority,
    schemaVersion: mission.schemaVersion,
    version: mission.version,
    createdAt: mission.createdAt,
    updatedAt: mission.updatedAt,
    nextAction: mission.nextAction,
    sourceInteractionId: mission.sourceInteractionId,
    aggregateData: aggregateFor(mission),
  };
}

function missionFromRow(row) {
  const schemaVersion = asSafePositiveInteger(row.schemaVersion, 'schemaVersion');
  if (schemaVersion !== SCHEMA_VERSION) {
    throw repositoryError(
      'unsupported_mission_schema_version',
      'Stored Mission schemaVersion is not supported by this repository.',
    );
  }
  if (!isPlainObject(row.aggregateData)
    || Object.keys(row.aggregateData).length !== AGGREGATE_FIELDS.length
    || AGGREGATE_FIELDS.some((field) => !Object.hasOwn(row.aggregateData, field))) {
    throw repositoryError('mission_data_corrupt', 'Stored Mission aggregateData has an invalid shape.');
  }

  try {
    const mission = {
      missionId: row.missionId,
      title: row.title,
      objective: row.objective,
      scope: row.scope,
      requester: row.userId,
      clientId: row.clientId,
      projectId: row.projectId,
      workspaceId: row.workspaceId,
      priority: row.priority,
      status: row.status,
      ...cloneDomain(row.aggregateData),
      createdAt: asIsoTimestamp(row.createdAt, 'createdAt'),
      updatedAt: asIsoTimestamp(row.updatedAt, 'updatedAt'),
      nextAction: row.nextAction,
      schemaVersion,
      version: asSafePositiveInteger(row.version, 'version'),
      sourceInteractionId: row.sourceInteractionId,
    };
    validateMission(mission);
    return cloneDomain(mission);
  } catch (error) {
    if (error instanceof MissionRepositoryError) throw error;
    throw repositoryError('mission_data_corrupt', 'Stored Mission failed domain validation.');
  }
}

function insertParameters(record) {
  return [
    record.tenantId,
    record.userId,
    record.clientId,
    record.missionId,
    record.idempotencyKey,
    record.projectId,
    record.workspaceId,
    record.title,
    record.objective,
    record.scopeText,
    record.status,
    record.priority,
    record.schemaVersion,
    record.version,
    record.createdAt,
    record.updatedAt,
    record.nextAction,
    record.sourceInteractionId,
    JSON.stringify(record.aggregateData),
  ];
}

class PostgresMissionRepository {
  #pool;

  constructor({ pool } = {}) {
    if (!pool || typeof pool.connect !== 'function') {
      repositoryFail(
        'invalid_postgres_pool',
        'PostgresMissionRepository requires an injected PostgreSQL pool.',
      );
    }
    this.#pool = pool;
    this.provider = 'postgresql';
  }

  async #withScope(rawScope, operation) {
    return runPostgresScopedTransaction({
      pool: this.#pool,
      rawScope,
      normalizeScope: normalizeRepositoryScope,
      operation,
      sanitizeError: sanitizeDatabaseError,
      commitUnknownError: () => repositoryError(
        'mission_commit_outcome_unknown',
        'PostgreSQL commit outcome is unknown; reconcile before another mutation.',
      ),
    });
  }

  async create(rawScope, mission, rawIdempotencyKey) {
    const scope = normalizeRepositoryScope(rawScope);
    const idempotencyKey = normalizeIdempotencyKey(rawIdempotencyKey);
    const record = persistenceRecord(scope, mission, idempotencyKey);

    return this.#withScope(scope, async (client) => {
      const inserted = await client.query(
        `INSERT INTO oxkio.missions (
           tenant_id, user_id, client_id, mission_id, idempotency_key,
           project_id, workspace_id, title, objective, scope_text, status,
           priority, schema_version, version, created_at, updated_at,
           next_action, source_interaction_id, aggregate_data
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
           $14, $15, $16, $17, $18, $19::jsonb
         )
         ON CONFLICT DO NOTHING
         RETURNING ${SELECT_FIELDS}`,
        insertParameters(record),
      );
      if (inserted.rows.length === 1) {
        return { mission: missionFromRow(inserted.rows[0]), created: true };
      }

      const byKey = await client.query(
        `SELECT ${SELECT_FIELDS}
         FROM oxkio.missions
         WHERE tenant_id = $1 AND user_id = $2 AND client_id = $3
           AND idempotency_key = $4`,
        [scope.tenantId, scope.userId, scope.clientId, idempotencyKey],
      );
      if (byKey.rows.length === 1) {
        if (byKey.rows[0].missionId !== mission.missionId) {
          repositoryFail(
            'idempotency_conflict',
            'idempotencyKey is already bound to another Mission in this scope.',
          );
        }
        return { mission: missionFromRow(byKey.rows[0]), created: false };
      }

      const byMission = await client.query(
        `SELECT mission_id AS "missionId"
         FROM oxkio.missions
         WHERE tenant_id = $1 AND user_id = $2 AND client_id = $3
           AND mission_id = $4`,
        [scope.tenantId, scope.userId, scope.clientId, mission.missionId],
      );
      if (byMission.rows.length === 1) {
        repositoryFail('mission_already_exists', 'Mission already exists in this scope.');
      }
      repositoryFail(
        'mission_repository_conflict_unresolved',
        'PostgreSQL reported a scoped conflict that could not be reconciled.',
      );
    });
  }

  async get(rawScope, rawMissionId) {
    const scope = normalizeRepositoryScope(rawScope);
    const missionId = validateIdentifier(rawMissionId, 'missionId');
    return this.#withScope(scope, async (client) => {
      const result = await client.query(
        `SELECT ${SELECT_FIELDS}
         FROM oxkio.missions
         WHERE tenant_id = $1 AND user_id = $2 AND client_id = $3
           AND mission_id = $4`,
        [scope.tenantId, scope.userId, scope.clientId, missionId],
      );
      if (result.rows.length !== 1) {
        repositoryFail('mission_not_found', 'Mission was not found.');
      }
      return missionFromRow(result.rows[0]);
    });
  }

  async list(rawScope, rawFilters = {}) {
    const scope = normalizeRepositoryScope(rawScope);
    const filters = normalizeMissionFilters(rawFilters);
    return this.#withScope(scope, async (client) => {
      const values = [scope.tenantId, scope.userId, scope.clientId];
      const clauses = [
        'tenant_id = $1',
        'user_id = $2',
        'client_id = $3',
      ];
      const addFilter = (column, value) => {
        values.push(value);
        clauses.push(`${column} = $${values.length}`);
      };
      if (Object.hasOwn(filters, 'projectId')) addFilter('project_id', filters.projectId);
      if (Object.hasOwn(filters, 'workspaceId')) {
        if (filters.workspaceId === null) clauses.push('workspace_id IS NULL');
        else addFilter('workspace_id', filters.workspaceId);
      }
      if (Object.hasOwn(filters, 'status')) addFilter('status', filters.status);
      if (Object.hasOwn(filters, 'priority')) addFilter('priority', filters.priority);

      const result = await client.query(
        `SELECT ${SELECT_FIELDS}
         FROM oxkio.missions
         WHERE ${clauses.join(' AND ')}
         ORDER BY created_at ASC, mission_id ASC`,
        values,
      );
      return result.rows.map(missionFromRow);
    });
  }

  async saveIfVersion(rawScope, mission, rawExpectedVersion) {
    const scope = normalizeRepositoryScope(rawScope);
    const expectedVersion = normalizeExpectedVersion(rawExpectedVersion);
    const record = persistenceRecord(scope, mission, undefined, false);
    if (record.version <= expectedVersion) {
      repositoryFail(
        'invalid_version_advance',
        'Saved Mission version must be greater than expectedVersion.',
      );
    }

    return this.#withScope(scope, async (client) => {
      const visible = await client.query(
        `SELECT version
         FROM oxkio.missions
         WHERE tenant_id = $1 AND user_id = $2 AND client_id = $3
           AND mission_id = $4`,
        [scope.tenantId, scope.userId, scope.clientId, record.missionId],
      );
      if (visible.rows.length === 0) {
        repositoryFail('mission_not_found', 'Mission was not found.');
      }
      assertMissionScope(mission, scope);

      const result = await client.query(
        `UPDATE oxkio.missions
         SET project_id = $6,
             workspace_id = $7,
             title = $8,
             objective = $9,
             scope_text = $10,
             status = $11,
             priority = $12,
             schema_version = $13,
             version = $14,
             updated_at = $15,
             next_action = $16,
             source_interaction_id = $17,
             aggregate_data = $18::jsonb
         WHERE tenant_id = $1 AND user_id = $2 AND client_id = $3
           AND mission_id = $4 AND version = $5
         RETURNING ${SELECT_FIELDS}`,
        [
          scope.tenantId,
          scope.userId,
          scope.clientId,
          record.missionId,
          expectedVersion,
          record.projectId,
          record.workspaceId,
          record.title,
          record.objective,
          record.scopeText,
          record.status,
          record.priority,
          record.schemaVersion,
          record.version,
          record.updatedAt,
          record.nextAction,
          record.sourceInteractionId,
          JSON.stringify(record.aggregateData),
        ],
      );
      if (result.rows.length === 1) return missionFromRow(result.rows[0]);

      const current = await client.query(
        `SELECT version
         FROM oxkio.missions
         WHERE tenant_id = $1 AND user_id = $2 AND client_id = $3
           AND mission_id = $4`,
        [scope.tenantId, scope.userId, scope.clientId, record.missionId],
      );
      if (current.rows.length === 0) {
        repositoryFail('mission_not_found', 'Mission was not found.');
      }
      repositoryFail('version_conflict', 'Mission version does not match expectedVersion.');
    });
  }
}

module.exports = {
  AGGREGATE_FIELDS,
  PostgresMissionRepository,
};

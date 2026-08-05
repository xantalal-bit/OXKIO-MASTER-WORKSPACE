'use strict';

/**
 * postgres-confirmed-mission-committer.js
 *
 * G0002.5B.2E â€” Microfase 1.
 *
 * Primitive PostgreSQL atÃ³mica que persiste una Mission PROPOSED y marca
 * la Confirmation correspondiente como CONSUMED dentro de UNA ÃšNICA
 * transacciÃ³n PostgreSQL.
 *
 * Responsabilidades de esta capa:
 *   - Validar que la Confirmation concreta sigue en scope triÃ¡dico correcto,
 *     en estado CONFIRMED, con el lease esperado, y no expirada.
 *   - Insertar o reconciliar la Mission PROPOSED con su idempotency key.
 *   - Marcar la Confirmation CONSUMED en el mismo COMMIT.
 *   - Ante cualquier fallo previo al COMMIT â†’ ROLLBACK automÃ¡tico de ambas.
 *   - Ante resultado de COMMIT desconocido â†’ error estable para reconciliaciÃ³n.
 *
 * NO en esta capa:
 *   - ResoluciÃ³n de membership, capability, project.
 *   - EmisiÃ³n de eventos de dominio.
 *   - Wiring con composiciÃ³n de Cliente Cero.
 *   - Cualquier transiciÃ³n READY/RUNNING/ejecuciÃ³n.
 */

const {
  runPostgresScopedTransaction,
} = require('../../repositories/postgres/postgres-scoped-transaction');

const {
  SCHEMA_VERSION,
  MISSION_STATES,
  MissionDomainError,
  assertMissionScope,
  cloneDomain,
  validateIdentifier,
  validateMission,
} = require('./mission-contract');

const {
  MissionRepositoryError,
  normalizeRepositoryScope,
  repositoryFail: missionRepositoryFail,
} = require('./mission-repository-contract');

const {
  CONFIRMATION_STATUSES,
  ConfirmationContractError,
  validateMissionConfirmation,
} = require('./mission-confirmation-contract');

const {
  ConfirmationRepositoryError,
  normalizeConfirmationScope,
  normalizeLeaseId,
  normalizeExpectedVersion: normalizeConfirmationExpectedVersion,
  normalizeOperationTime,
  repositoryFail: confirmationRepositoryFail,
} = require('./mission-confirmation-repository-contract');

// â”€â”€â”€ Error type â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

class CommitterError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CommitterError';
    this.code = code;
  }
}

function committerFail(code, message) {
  throw new CommitterError(code, message);
}

// â”€â”€â”€ Input normalisation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const INPUT_KEYS = Object.freeze([
  'scope',
  'confirmation',
  'expectedConfirmationVersion',
  'leaseId',
  'mission',
  'idempotencyKey',
  'consumedAt',
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length
    && actual.every((key) => keys.includes(key))
    && keys.every((key) => Object.hasOwn(value, key));
}

function normalizeInput(raw) {
  if (!hasExactKeys(raw, INPUT_KEYS)) {
    committerFail(
      'committer_input_invalid',
      'PostgresConfirmedMissionCommitter input must have exactly the expected keys.',
    );
  }
  return raw;
}

// â”€â”€â”€ Error classification â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function sanitizeError(error) {
  if (error instanceof CommitterError
    || error instanceof MissionRepositoryError
    || error instanceof ConfirmationRepositoryError
    || error instanceof MissionDomainError
    || error instanceof ConfirmationContractError) {
    return error;
  }
  const code = error && (error.code || error.errno);
  if (code === '57014' || code === 'ETIMEDOUT') {
    return new CommitterError(
      'committer_timeout',
      'PostgreSQL did not complete the atomic Mission/Confirmation commit in time.',
    );
  }
  if (
    (typeof code === 'string' && code.startsWith('08'))
    || ['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EHOSTUNREACH', '57P01', '57P02', '57P03']
      .includes(code)
  ) {
    return new CommitterError(
      'committer_unavailable',
      'PostgreSQL is unavailable for the atomic Mission/Confirmation commit.',
    );
  }
  return new CommitterError(
    'committer_failure',
    'PostgreSQL rejected the atomic Mission/Confirmation commit.',
  );
}

function commitUnknownError() {
  return new CommitterError(
    'committer_commit_outcome_unknown',
    'PostgreSQL commit outcome is unknown. '
    + 'Reconcile by checking Confirmation status before any retry. '
    + 'Do not generate new IDs or keys.',
  );
}

// â”€â”€â”€ Mission SELECT fields (mirrors postgres-mission-repository.js) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

const MISSION_SELECT = `
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

// â”€â”€â”€ Confirmation SELECT fields (mirrors postgres-mission-confirmation-repository.js) â”€

const CONFIRMATION_SELECT = `
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

// â”€â”€â”€ Row mappers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function asSafePositiveInteger(value, fieldName) {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    committerFail('committer_data_corrupt', `Stored ${fieldName} is invalid.`);
  }
  return number;
}

function asIsoTimestamp(value, fieldName) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    committerFail('committer_data_corrupt', `Stored ${fieldName} is invalid.`);
  }
  return date.toISOString();
}

function asNullableIsoTimestamp(value, fieldName) {
  return value === null || value === undefined ? null : asIsoTimestamp(value, fieldName);
}

function missionFromRow(row) {
  const schemaVersion = asSafePositiveInteger(row.schemaVersion, 'schemaVersion');
  if (schemaVersion !== SCHEMA_VERSION) {
    committerFail(
      'committer_data_corrupt',
      'Stored Mission schemaVersion is not supported.',
    );
  }
  if (
    !isPlainObject(row.aggregateData)
    || Object.keys(row.aggregateData).length !== AGGREGATE_FIELDS.length
    || AGGREGATE_FIELDS.some((field) => !Object.hasOwn(row.aggregateData, field))
  ) {
    committerFail('committer_data_corrupt', 'Stored Mission aggregateData has an invalid shape.');
  }
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
}

function confirmationFromRow(row) {
  const confirmation = {
    confirmationId: row.confirmationId,
    tenantId: row.tenantId,
    userId: row.userId,
    clientId: row.clientId,
    missionId: row.missionId,
    idempotencyKey: row.idempotencyKey,
    planSnapshot: JSON.parse(JSON.stringify(row.planSnapshot)),
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
  return JSON.parse(JSON.stringify(confirmation));
}

// â”€â”€â”€ Mission insert parameters (mirrors postgres-mission-repository.js) â”€â”€â”€â”€â”€â”€â”€â”€

function aggregateFor(mission) {
  return Object.fromEntries(AGGREGATE_FIELDS.map((field) => [field, cloneDomain(mission[field])]));
}

function missionInsertParams(scope, mission, idempotencyKey) {
  return [
    scope.tenantId,          // $1
    scope.userId,             // $2
    scope.clientId,           // $3
    mission.missionId,        // $4
    idempotencyKey,           // $5
    mission.projectId,        // $6
    mission.workspaceId,      // $7
    mission.title,            // $8
    mission.objective,        // $9
    mission.scope,            // $10
    mission.status,           // $11
    mission.priority,         // $12
    mission.schemaVersion,    // $13
    mission.version,          // $14
    mission.createdAt,        // $15
    mission.updatedAt,        // $16
    mission.nextAction,       // $17
    mission.sourceInteractionId,  // $18
    JSON.stringify(aggregateFor(mission)), // $19
  ];
}

// â”€â”€â”€ Confirmation validation inside the transaction â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/**
 * Validates the stored Confirmation matches the caller's expectations AFTER
 * RLS is set. This is the guard inside the transaction that prevents acting
 * on a Confirmation that has drifted between the lease acquisition and COMMIT.
 */
function assertConfirmationIntegrity(stored, expected, lease, leaseId, consumedAt) {
  if (!stored) {
    confirmationRepositoryFail('confirmation_not_found', 'Confirmation was not found in scope.');
  }
  validateMissionConfirmation(stored);

  if (stored.tenantId !== expected.tenantId
    || stored.userId !== expected.userId
    || stored.clientId !== expected.clientId) {
    confirmationRepositoryFail('confirmation_scope_mismatch', 'Confirmation scope mismatch.');
  }
  if (stored.confirmationId !== expected.confirmationId) {
    confirmationRepositoryFail('confirmation_not_found', 'Confirmation was not found.');
  }
  if (stored.missionId !== expected.missionId) {
    confirmationRepositoryFail(
      'confirmation_mission_mismatch',
      'Confirmation missionId does not match the expected Mission.',
    );
  }
  if (stored.idempotencyKey !== expected.idempotencyKey) {
    confirmationRepositoryFail(
      'confirmation_idempotency_mismatch',
      'Confirmation idempotencyKey does not match.',
    );
  }
  if (stored.status === CONFIRMATION_STATUSES.CONSUMED) {
    confirmationRepositoryFail(
      'confirmation_terminal',
      'Confirmation is already CONSUMED.',
    );
  }
  if (stored.status === CONFIRMATION_STATUSES.REVOKED) {
    confirmationRepositoryFail(
      'confirmation_terminal',
      'Confirmation has been REVOKED.',
    );
  }
  if (stored.status !== CONFIRMATION_STATUSES.CONFIRMED) {
    confirmationRepositoryFail(
      'confirmation_transition_invalid',
      'Confirmation is not in CONFIRMED status.',
    );
  }
  if (Date.parse(consumedAt) >= Date.parse(stored.expiresAt)) {
    confirmationRepositoryFail('confirmation_expired', 'Confirmation has expired.');
  }
  if (!lease.leaseId || lease.leaseId !== leaseId) {
    confirmationRepositoryFail(
      'confirmation_lease_invalid',
      'Consume lease does not match the active lease on this Confirmation.',
    );
  }
  if (!lease.expiresAt || Date.parse(consumedAt) >= Date.parse(lease.expiresAt)) {
    confirmationRepositoryFail('confirmation_lease_expired', 'Consume lease has expired.');
  }
}

// â”€â”€â”€ Main committer â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

class PostgresConfirmedMissionCommitter {
  #pool;

  constructor({ pool } = {}) {
    if (!pool || typeof pool.connect !== 'function') {
      committerFail(
        'invalid_postgres_pool',
        'PostgresConfirmedMissionCommitter requires an injected PostgreSQL pool.',
      );
    }
    this.#pool = pool;
    this.provider = 'postgresql';
    Object.freeze(this);
  }

  /**
   * commit(rawInput) â†’ { mission, confirmation, created }
   *
   * rawInput shape:
   *   scope                        â€“ { tenantId, userId, clientId }
   *   confirmation                 â€“ domain Confirmation (CONFIRMED, with lease)
   *   expectedConfirmationVersion  â€“ bigint, current version before CONSUMED
   *   leaseId                      â€“ active consume lease id
   *   mission                      â€“ domain Mission (PROPOSED, version=1)
   *   idempotencyKey               â€“ idempotency key for Mission INSERT
   *   consumedAt                   â€“ ISO timestamp for Confirmation consumed_at
   *
   * Returns:
   *   { mission, confirmation, created }
   *   created = true  â†’ Mission was newly inserted
   *   created = false â†’ Mission already existed (idempotent replay)
   */
  async commit(rawInput) {
    const input = normalizeInput(rawInput);

    // Normalise scope â€” both tables use the same triadic scope
    const scope = normalizeRepositoryScope(input.scope);
    const confirmationScope = normalizeConfirmationScope(input.scope);

    // Validate domain objects
    validateMission(input.mission);
    assertMissionScope(input.mission, scope);
    validateMissionConfirmation(input.confirmation);

    const expectedVersion = normalizeConfirmationExpectedVersion(
      input.expectedConfirmationVersion,
    );
    const leaseId = normalizeLeaseId(input.leaseId);
    const idempotencyKey = validateIdentifier(input.idempotencyKey, 'idempotencyKey');
    const consumedAt = normalizeOperationTime(input.consumedAt);

    // Verify initial consistency before opening the transaction
    if (input.confirmation.missionId !== input.mission.missionId) {
      committerFail(
        'committer_mission_confirmation_mismatch',
        'Confirmation missionId does not match the Mission missionId.',
      );
    }
    if (input.confirmation.idempotencyKey !== idempotencyKey) {
      committerFail(
        'committer_idempotency_mismatch',
        'Confirmation idempotencyKey does not match the provided idempotencyKey.',
      );
    }
    if (input.mission.status !== MISSION_STATES.PROPOSED) {
      committerFail(
        'committer_invalid_mission_status',
        'Only PROPOSED missions may be committed via this primitive.',
      );
    }

    return runPostgresScopedTransaction({
      pool: this.#pool,
      rawScope: scope,
      normalizeScope: normalizeRepositoryScope,
      sanitizeError,
      commitUnknownError,
      operation: async (client) => {
        // â”€â”€ Step 1: Read the current Confirmation inside the transaction â”€â”€â”€â”€â”€â”€
        const confResult = await client.query(
          `SELECT ${CONFIRMATION_SELECT}
           FROM oxkio.mission_confirmations
           WHERE tenant_id = $1 AND user_id = $2 AND client_id = $3
             AND confirmation_id = $4
           FOR UPDATE`,
          [
            confirmationScope.tenantId,
            confirmationScope.userId,
            confirmationScope.clientId,
            input.confirmation.confirmationId,
          ],
        );

        const storedConf = confResult.rows.length === 1
          ? confirmationFromRow(confResult.rows[0])
          : null;

        // Lease metadata stays outside the Confirmation domain object.
        const storedConfRow = confResult.rows[0] || null;
        const storedLease = storedConfRow
          ? {
            leaseId: storedConfRow.consumeLeaseId,
            expiresAt: storedConfRow.consumeLeaseExpiresAt
              ? asIsoTimestamp(storedConfRow.consumeLeaseExpiresAt, 'consumeLeaseExpiresAt')
              : null,
          }
          : { leaseId: null, expiresAt: null };

        assertConfirmationIntegrity(
          storedConf,
          {
            tenantId: confirmationScope.tenantId,
            userId: confirmationScope.userId,
            clientId: confirmationScope.clientId,
            confirmationId: input.confirmation.confirmationId,
            missionId: input.mission.missionId,
            idempotencyKey,
          },
          storedLease,
          leaseId,
          consumedAt,
        );

        // Version must still match what the caller observed
        if (storedConf.version !== expectedVersion) {
          confirmationRepositoryFail(
            'confirmation_version_conflict',
            'Confirmation version does not match expectedConfirmationVersion.',
          );
        }

        // â”€â”€ Step 2: INSERT Mission (ON CONFLICT DO NOTHING) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        const insertedMission = await client.query(
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
           RETURNING ${MISSION_SELECT}`,
          missionInsertParams(scope, input.mission, idempotencyKey),
        );

        let mission;
        let created;

        if (insertedMission.rows.length === 1) {
          // New insert succeeded
          mission = missionFromRow(insertedMission.rows[0]);
          created = true;
        } else {
          // Conflict â€” check idempotency key to find existing Mission
          const byKey = await client.query(
            `SELECT ${MISSION_SELECT}
             FROM oxkio.missions
             WHERE tenant_id = $1 AND user_id = $2 AND client_id = $3
               AND idempotency_key = $4`,
            [scope.tenantId, scope.userId, scope.clientId, idempotencyKey],
          );
          if (byKey.rows.length === 1) {
            const existing = missionFromRow(byKey.rows[0]);
            // Fail closed if the key belongs to a different missionId
            if (existing.missionId !== input.mission.missionId) {
              missionRepositoryFail(
                'idempotency_conflict',
                'idempotencyKey is already bound to a different Mission in this scope.',
              );
            }
            mission = existing;
            created = false;
          } else {
            // Key not found â€” check if the missionId itself exists
            const byId = await client.query(
              `SELECT mission_id AS "missionId"
               FROM oxkio.missions
               WHERE tenant_id = $1 AND user_id = $2 AND client_id = $3
                 AND mission_id = $4`,
              [scope.tenantId, scope.userId, scope.clientId, input.mission.missionId],
            );
            if (byId.rows.length === 1) {
              missionRepositoryFail(
                'mission_already_exists',
                'Mission already exists with a different idempotency key.',
              );
            }
            missionRepositoryFail(
              'committer_conflict_unresolved',
              'INSERT conflict could not be reconciled.',
            );
          }
        }

        // Invariant: mission must be PROPOSED
        if (mission.status !== MISSION_STATES.PROPOSED) {
          missionRepositoryFail(
            'committer_invalid_mission_status',
            'Existing Mission is not PROPOSED.',
          );
        }

        // â”€â”€ Step 3: UPDATE Confirmation â†’ CONSUMED â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        //
        // The UPDATE WHERE clause re-checks every guard atomically:
        //   - status = CONFIRMED
        //   - version = expected (optimistic lock)
        //   - consume_lease_id = our lease (prevents two callers acting on same lease)
        //   - consume_lease_expires_at > consumedAt (lease still valid)
        //   - expires_at > consumedAt (confirmation itself not expired)
        //   - missionId, idempotencyKey, planSnapshot, etc. (immutable guards)
        //
        const newVersion = expectedVersion + 1;

        const updatedConf = await client.query(
          `UPDATE oxkio.mission_confirmations
           SET status = 'CONSUMED',
               version = $6,
               consumed_at = $7,
               consume_lease_id = NULL,
               consume_lease_acquired_at = NULL,
               consume_lease_expires_at = NULL
           WHERE tenant_id = $1 AND user_id = $2 AND client_id = $3
             AND confirmation_id = $4 AND version = $5
             AND status = 'CONFIRMED'
             AND consume_lease_id = $8
             AND consume_lease_expires_at > $7
             AND expires_at > $7
             AND mission_id = $9
             AND idempotency_key = $10
             AND plan_snapshot = $11::jsonb
             AND plan_schema_version = $12
             AND created_at = $13
             AND expires_at = $14
           RETURNING ${CONFIRMATION_SELECT}`,
          [
            confirmationScope.tenantId,   // $1
            confirmationScope.userId,     // $2
            confirmationScope.clientId,   // $3
            storedConf.confirmationId,    // $4
            expectedVersion,              // $5
            newVersion,                   // $6
            consumedAt,                   // $7
            leaseId,                      // $8
            storedConf.missionId,         // $9
            storedConf.idempotencyKey,    // $10
            JSON.stringify(storedConf.planSnapshot), // $11
            storedConf.planSchemaVersion, // $12
            storedConf.createdAt,         // $13
            storedConf.expiresAt,         // $14
          ],
        );

        if (updatedConf.rows.length !== 1) {
          // The UPDATE failed â€” diagnose
          const currentConf = await client.query(
            `SELECT ${CONFIRMATION_SELECT}
             FROM oxkio.mission_confirmations
             WHERE tenant_id = $1 AND user_id = $2 AND client_id = $3
               AND confirmation_id = $4`,
            [
              confirmationScope.tenantId,
              confirmationScope.userId,
              confirmationScope.clientId,
              storedConf.confirmationId,
            ],
          );
          if (currentConf.rows.length === 0) {
            confirmationRepositoryFail('confirmation_not_found', 'Confirmation disappeared during commit.');
          }
          const currentRow = currentConf.rows[0];
          const current = confirmationFromRow(currentRow);
          if (current.version !== expectedVersion) {
            confirmationRepositoryFail('confirmation_version_conflict', 'Confirmation version conflict during commit.');
          }
          if (current.status !== CONFIRMATION_STATUSES.CONFIRMED) {
            confirmationRepositoryFail('confirmation_terminal', 'Confirmation is no longer CONFIRMED.');
          }
          const leaseExpiresAt = currentRow.consumeLeaseExpiresAt
            ? asIsoTimestamp(currentRow.consumeLeaseExpiresAt, 'consumeLeaseExpiresAt')
            : null;
          if (!currentRow.consumeLeaseId || currentRow.consumeLeaseId !== leaseId
            || !leaseExpiresAt || Date.parse(leaseExpiresAt) <= Date.parse(consumedAt)) {
            confirmationRepositoryFail('confirmation_lease_invalid', 'Consume lease is no longer valid.');
          }
          if (Date.parse(current.expiresAt) <= Date.parse(consumedAt)) {
            confirmationRepositoryFail('confirmation_expired', 'Confirmation expired during commit.');
          }
          confirmationRepositoryFail(
            'confirmation_repository_unavailable',
            'Confirmation CONSUMED update was rejected by PostgreSQL.',
          );
        }

        const confirmation = confirmationFromRow(updatedConf.rows[0]);

        // â”€â”€ Return both durable results â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
        return Object.freeze({
          mission: Object.freeze(mission),
          confirmation: Object.freeze(confirmation),
          created,
        });
      },
    });
  }
}

module.exports = {
  CommitterError,
  PostgresConfirmedMissionCommitter,
};

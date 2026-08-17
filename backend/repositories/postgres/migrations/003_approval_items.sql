\set ON_ERROR_STOP on

BEGIN;

-- Esquema oxkio ya existe y ya es propiedad de oxkio_mission_owner (001).
-- B2 (ba6b7c8) decidio una identidad RUNTIME propia para Approval
-- (oxkio_approval_runtime) para no compartir privilegios de ejecucion con
-- Mission Queue, pero no decidio un owner de esquema separado. Siguiendo
-- exactamente el precedente de 001/002 (el owner ejecuta el DDL sobre el
-- esquema compartido; los GRANTS de ejecucion son lo que se aisla por
-- dominio), esta migracion reutiliza SET LOCAL ROLE oxkio_mission_owner
-- solo para crear la tabla en el esquema ya existente. No crea ningun rol,
-- no toca Secret Manager/IAM y no se ejecuta contra ninguna instancia real
-- desde este repositorio.
SET LOCAL ROLE oxkio_mission_owner;

-- oxkio.approval_items — persistencia definitiva de ApprovalQueue/
-- ApprovalRepository (5C.7B.3F / B3). Columnas derivadas exclusivamente de
-- SELECT_FIELDS y de los INSERT/UPDATE reales en
-- backend/repositories/postgres-approval-repository.js (B1, a721285).
-- Scope client_id-only (B2): sin tenant_id, sin user_id, sin fusion con
-- oxkio.missions / oxkio.mission_confirmations.
CREATE TABLE IF NOT EXISTS oxkio.approval_items (
  id uuid NOT NULL,
  client_id text NOT NULL,
  version bigint NOT NULL,
  status text NOT NULL,
  record jsonb NOT NULL,
  approved_by jsonb,
  approved_at timestamptz,
  rejected_at timestamptz,
  resolved_at timestamptz,
  execution_id text,
  execution_attempt_count integer NOT NULL DEFAULT 0,
  execution_started_at timestamptz,
  execution_lease_expires_at timestamptz,
  execution_completed_at timestamptz,
  execution_failed_at timestamptz,
  result jsonb,
  error jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT approval_items_pk PRIMARY KEY (id),
  -- Exactamente los 7 estados reales de APPROVAL_REPOSITORY_V2_STATUSES
  -- (backend/repositories/json-approval-repository-v2.js). No se inventan
  -- estados adicionales.
  CONSTRAINT approval_items_status_ck CHECK (status IN (
    'pending', 'approved', 'rejected', 'executing', 'executed',
    'execution_failed', 'expired'
  )),
  -- Solicitado explicitamente en B2/B3: version > 0.
  CONSTRAINT approval_items_version_ck CHECK (version > 0),
  -- Solicitado explicitamente en B2/B3: execution_attempt_count >= 0.
  CONSTRAINT approval_items_execution_attempt_count_ck
    CHECK (execution_attempt_count >= 0),
  -- Mismo precedente que missions_timestamps_ck (001): updated_at nunca
  -- antes que created_at. Se cumple en todo el codigo de B1 (cada mutacion
  -- fija updated_at = now de aplicacion).
  CONSTRAINT approval_items_timestamps_ck CHECK (updated_at >= created_at)
);

-- Indices derivados EXCLUSIVAMENTE de los accesos reales de
-- PostgresApprovalRepository (B1):
--
-- listPending: WHERE client_id = $1 AND status = 'pending'
--              ORDER BY created_at ASC, id ASC
-- listHistory: WHERE client_id = $1 AND status <> 'pending'
--              ORDER BY created_at ASC, id ASC
-- Ambos metodos comparten client_id + status + orden por created_at/id.
CREATE INDEX IF NOT EXISTS approval_items_client_status_created_idx
  ON oxkio.approval_items (client_id, status, created_at, id);

-- reclaimExpiredExecutions: WHERE client_id = $1 AND status = 'executing'
--   AND execution_lease_expires_at <= $2
--   ORDER BY execution_lease_expires_at ASC
CREATE INDEX IF NOT EXISTS approval_items_client_status_lease_idx
  ON oxkio.approval_items (client_id, status, execution_lease_expires_at);

-- getById (WHERE id = $1 AND client_id = $2) y todos los mutadores
-- (WHERE id = $1 AND version = $2 AND status = $3 [AND execution_id = $4])
-- resuelven por id, ya cubierto por la PRIMARY KEY: no requieren indice
-- adicional.

ALTER TABLE oxkio.approval_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE oxkio.approval_items FORCE ROW LEVEL SECURITY;

-- Aislamiento exclusivamente por client_id (B2): sin tenant_id/user_id.
-- current_setting(..., true) con el flag "missing_ok" hace que, si
-- app.client_id no esta establecido en la sesion/transaccion, la
-- comparacion sea contra NULL y la politica de RLS deniegue todo acceso
-- (fail-closed) en vez de lanzar un error de configuracion faltante.
DROP POLICY IF EXISTS approval_items_scope_isolation ON oxkio.approval_items;
CREATE POLICY approval_items_scope_isolation ON oxkio.approval_items
  USING (client_id = current_setting('app.client_id', true))
  WITH CHECK (client_id = current_setting('app.client_id', true));

-- Grants minimos para oxkio_approval_runtime (identidad futura decidida en
-- B2; el rol en si NO se crea aqui ni en ninguna parte de esta migracion).
-- Mismo patron exacto que 001/002: REVOKE ALL primero, despues conceder
-- solo lo necesario; UPDATE acotado a columnas realmente mutables; sin
-- DELETE, sin TRUNCATE, sin privilegios owner/admin para runtime.
REVOKE ALL ON TABLE oxkio.approval_items FROM PUBLIC;
REVOKE ALL ON TABLE oxkio.approval_items FROM oxkio_approval_runtime;
GRANT SELECT, INSERT ON TABLE oxkio.approval_items TO oxkio_approval_runtime;
GRANT UPDATE (
  status, approved_by, approved_at, rejected_at, resolved_at,
  execution_id, execution_attempt_count, execution_started_at,
  execution_lease_expires_at, execution_completed_at, execution_failed_at,
  result, error, version, updated_at
) ON TABLE oxkio.approval_items TO oxkio_approval_runtime;

COMMIT;

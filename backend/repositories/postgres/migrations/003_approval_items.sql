\set ON_ERROR_STOP on

BEGIN;

-- Esquema oxkio ya existe y ya es propiedad de oxkio_mission_owner (001).
-- Esta migracion NO cambia esa propiedad y NO la toca: el esquema sigue
-- siendo de oxkio_mission_owner, exactamente como en 001/002.
--
-- B3.1 (correctiva, ratificada por Direccion tras B2/ba6b7c8): Approval
-- mantiene identidad administrativa propia y separada de Mission Queue, no
-- solo en runtime sino tambien en ownership:
--   owner:   oxkio_approval_owner    (esta migracion)
--   runtime: oxkio_approval_runtime  (decidido en B2)
-- oxkio_mission_owner NO se usa en ningun punto de esta migracion y no
-- conserva ningun poder permanente sobre oxkio.approval_items: la tabla se
-- crea directamente bajo oxkio_approval_owner, no bajo mission_owner con
-- una transferencia posterior.
--
-- PRECONDICION (fuera de esta migracion, no incluida aqui): oxkio_approval_owner
-- debe existir y debe tener CREATE en el schema oxkio (p.ej.
-- "GRANT CREATE ON SCHEMA oxkio TO oxkio_approval_owner;", otorgado por el
-- propietario del schema o por una identidad con privilegio suficiente)
-- antes de poder ejecutar esta migracion. Ni esa concesion ni el propio rol
-- se crean aqui, ni en ninguna otra migracion de este repositorio; son
-- responsabilidad de una futura preparacion de infraestructura anterior a
-- B4, con su propia puerta humana. Sin esa precondicion satisfecha, esta
-- migracion fallara cerrada (permission denied) al intentar
-- SET LOCAL ROLE, nunca se ejecutara con un owner incorrecto.
--
-- Esta migracion no crea ningun rol, no toca Secret Manager/IAM y no se
-- ejecuta contra ninguna instancia real desde este repositorio.
SET LOCAL ROLE oxkio_approval_owner;

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

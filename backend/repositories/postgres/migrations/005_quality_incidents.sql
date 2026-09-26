\set ON_ERROR_STOP on

BEGIN;

-- oxkio.quality_incidents — persistencia durable de QualityIncidentRegistry
-- (Quality Loop V2, 26/09/2026), via PostgresQualityIncidentRepository.
--
-- Reutiliza la base e identidades ya provisionadas para Approval:
--   owner:   oxkio_approval_owner
--   runtime: oxkio_approval_runtime (misma URL/secreto
--            OXKIO_APPROVAL_PG_RUNTIME_URL; ningun secreto ni rol nuevo)
-- oxkio_mission_owner / oxkio_mission_runtime NO se usan: Quality Incidents
-- no reutiliza Mission Queue ni como almacen ni como identidad.
--
-- Esta migracion no crea ningun rol, no toca Secret Manager/IAM y no se
-- ejecuta contra ninguna instancia real desde este repositorio. Su
-- aplicacion es una puerta humana, igual que 003/004.
SET LOCAL ROLE oxkio_approval_owner;

-- Columnas derivadas exclusivamente de UPSERT_SQL/LOAD_SQL en
-- backend/repositories/postgres-quality-incident-repository.js. record es el
-- Quality Incident compacto ya validado por el registro (sin prompts,
-- conversaciones, emails, tokens ni stack traces).
CREATE TABLE IF NOT EXISTS oxkio.quality_incidents (
  client_id text NOT NULL,
  id text NOT NULL,
  fingerprint text NOT NULL,
  type text NOT NULL,
  priority text NOT NULL,
  status text NOT NULL,
  record jsonb NOT NULL,
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  CONSTRAINT quality_incidents_pk PRIMARY KEY (client_id, id),
  CONSTRAINT quality_incidents_client_id_ck CHECK (btrim(client_id) <> ''),
  CONSTRAINT quality_incidents_id_ck CHECK (id ~ '^QI-[0-9]{1,9}$'),
  -- Exactamente los enums de quality-incident-registry.js.
  CONSTRAINT quality_incidents_type_ck CHECK (type IN (
    'TECHNICAL_BUG', 'RUNTIME_FAILURE', 'CAPABILITY_MISMATCH', 'WRONG_RESPONSE',
    'USER_COMPLAINT', 'UX_FRICTION', 'INTEGRATION_FAILURE', 'REGRESSION',
    'POLICY_GAP', 'REPAIR_FAILURE', 'OTHER'
  )),
  CONSTRAINT quality_incidents_priority_ck CHECK (priority IN ('P0', 'P1', 'P2', 'P3')),
  CONSTRAINT quality_incidents_status_ck CHECK (status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'WONT_FIX')),
  CONSTRAINT quality_incidents_seen_ck CHECK (last_seen_at >= first_seen_at),
  CONSTRAINT quality_incidents_timestamps_ck CHECK (updated_at >= created_at)
);

-- LOAD_SQL: WHERE client_id = $1 ORDER BY last_seen_at ASC, id ASC.
CREATE INDEX IF NOT EXISTS quality_incidents_client_seen_idx
  ON oxkio.quality_incidents (client_id, last_seen_at, id);

ALTER TABLE oxkio.quality_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE oxkio.quality_incidents FORCE ROW LEVEL SECURITY;

-- Misma forma endurecida que 004 (NULLIF): sin scope explicito no hay acceso.
DROP POLICY IF EXISTS quality_incidents_scope_isolation ON oxkio.quality_incidents;
CREATE POLICY quality_incidents_scope_isolation ON oxkio.quality_incidents
  USING (client_id = NULLIF(current_setting('app.client_id', true), ''))
  WITH CHECK (client_id = NULLIF(current_setting('app.client_id', true), ''));

-- Grants minimos: SELECT/INSERT y UPDATE solo de columnas mutables. Sin
-- DELETE, sin TRUNCATE, sin privilegios owner/admin para runtime.
REVOKE ALL ON TABLE oxkio.quality_incidents FROM PUBLIC;
REVOKE ALL ON TABLE oxkio.quality_incidents FROM oxkio_approval_runtime;
GRANT SELECT, INSERT ON TABLE oxkio.quality_incidents TO oxkio_approval_runtime;
GRANT UPDATE (priority, status, record, last_seen_at, updated_at)
  ON TABLE oxkio.quality_incidents TO oxkio_approval_runtime;

COMMIT;

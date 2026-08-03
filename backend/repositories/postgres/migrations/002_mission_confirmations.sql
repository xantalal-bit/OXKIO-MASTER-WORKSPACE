\set ON_ERROR_STOP on

BEGIN;

SET LOCAL ROLE oxkio_mission_owner;

CREATE TABLE IF NOT EXISTS oxkio.mission_confirmations (
  tenant_id text NOT NULL,
  user_id text NOT NULL,
  client_id text NOT NULL,
  confirmation_id text NOT NULL,
  mission_id text NOT NULL,
  idempotency_key text NOT NULL,
  plan_snapshot jsonb NOT NULL,
  plan_schema_version integer NOT NULL,
  status text NOT NULL,
  version bigint NOT NULL,
  created_at timestamptz NOT NULL,
  confirmed_at timestamptz,
  consumed_at timestamptz,
  revoked_at timestamptz,
  expires_at timestamptz NOT NULL,
  consume_lease_id text,
  consume_lease_acquired_at timestamptz,
  consume_lease_expires_at timestamptz,
  CONSTRAINT mission_confirmations_pk
    PRIMARY KEY (tenant_id, user_id, client_id, confirmation_id),
  CONSTRAINT mission_confirmations_mission_uq
    UNIQUE (tenant_id, user_id, client_id, mission_id),
  CONSTRAINT mission_confirmations_idempotency_uq
    UNIQUE (tenant_id, user_id, client_id, idempotency_key),
  CONSTRAINT mission_confirmations_idempotency_ck CHECK (
    idempotency_key = 'mission-confirmation:v1:' || confirmation_id
  ),
  CONSTRAINT mission_confirmations_plan_schema_version_ck CHECK (plan_schema_version > 0),
  CONSTRAINT mission_confirmations_version_ck CHECK (
    version > 0 AND version <= 9007199254740991
  ),
  CONSTRAINT mission_confirmations_status_ck CHECK (
    status IN ('PENDING', 'CONFIRMED', 'CONSUMED', 'REVOKED')
  ),
  CONSTRAINT mission_confirmations_expiration_ck CHECK (expires_at > created_at),
  CONSTRAINT mission_confirmations_plan_object_ck CHECK (
    jsonb_typeof(plan_snapshot) = 'object'
  ),
  CONSTRAINT mission_confirmations_plan_shape_ck CHECK (
    plan_snapshot ?& ARRAY[
      'title', 'objective', 'scope', 'projectId', 'workspaceId', 'priority',
      'acceptanceCriteria', 'sourceInteractionId', 'nextAction'
    ]
    AND plan_snapshot - ARRAY[
      'title', 'objective', 'scope', 'projectId', 'workspaceId', 'priority',
      'acceptanceCriteria', 'sourceInteractionId', 'nextAction'
    ] = '{}'::jsonb
    AND jsonb_typeof(plan_snapshot -> 'acceptanceCriteria') = 'array'
  ),
  CONSTRAINT mission_confirmations_status_timestamps_ck CHECK (
    (status = 'PENDING'
      AND confirmed_at IS NULL AND consumed_at IS NULL AND revoked_at IS NULL)
    OR (status = 'CONFIRMED'
      AND confirmed_at IS NOT NULL AND consumed_at IS NULL AND revoked_at IS NULL)
    OR (status = 'CONSUMED'
      AND confirmed_at IS NOT NULL AND consumed_at IS NOT NULL AND revoked_at IS NULL)
    OR (status = 'REVOKED'
      AND revoked_at IS NOT NULL AND consumed_at IS NULL)
  ),
  CONSTRAINT mission_confirmations_timestamp_order_ck CHECK (
    (confirmed_at IS NULL OR confirmed_at >= created_at)
    AND (consumed_at IS NULL OR (confirmed_at IS NOT NULL AND consumed_at >= confirmed_at))
    AND (revoked_at IS NULL OR revoked_at >= COALESCE(confirmed_at, created_at))
  ),
  CONSTRAINT mission_confirmations_lease_shape_ck CHECK (
    (consume_lease_id IS NULL
      AND consume_lease_acquired_at IS NULL
      AND consume_lease_expires_at IS NULL)
    OR (consume_lease_id IS NOT NULL
      AND consume_lease_acquired_at IS NOT NULL
      AND consume_lease_expires_at IS NOT NULL
      AND status = 'CONFIRMED'
      AND consume_lease_expires_at > consume_lease_acquired_at
      AND consume_lease_expires_at <= expires_at)
  )
);

CREATE INDEX IF NOT EXISTS mission_confirmations_scope_created_idx
  ON oxkio.mission_confirmations (
    tenant_id, user_id, client_id, created_at, confirmation_id
  );

CREATE INDEX IF NOT EXISTS mission_confirmations_scope_status_idx
  ON oxkio.mission_confirmations (
    tenant_id, user_id, client_id, status, created_at, confirmation_id
  );

ALTER TABLE oxkio.mission_confirmations ENABLE ROW LEVEL SECURITY;
ALTER TABLE oxkio.mission_confirmations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mission_confirmations_scope_isolation
  ON oxkio.mission_confirmations;
CREATE POLICY mission_confirmations_scope_isolation
  ON oxkio.mission_confirmations
  USING (
    tenant_id = current_setting('app.tenant_id', true)
    AND user_id = current_setting('app.user_id', true)
    AND client_id = current_setting('app.client_id', true)
  )
  WITH CHECK (
    tenant_id = current_setting('app.tenant_id', true)
    AND user_id = current_setting('app.user_id', true)
    AND client_id = current_setting('app.client_id', true)
  );

REVOKE ALL ON TABLE oxkio.mission_confirmations FROM PUBLIC;
REVOKE ALL ON TABLE oxkio.mission_confirmations FROM oxkio_mission_runtime;
GRANT SELECT, INSERT ON TABLE oxkio.mission_confirmations TO oxkio_mission_runtime;
GRANT UPDATE (
  status, version, confirmed_at, consumed_at, revoked_at,
  consume_lease_id, consume_lease_acquired_at, consume_lease_expires_at
) ON TABLE oxkio.mission_confirmations TO oxkio_mission_runtime;

COMMIT;

-- 5C.7B.2 POC ONLY.
-- Synthetic isolated schema. It is not a production migration.

CREATE SCHEMA IF NOT EXISTS oxkio_poc;

CREATE TABLE IF NOT EXISTS oxkio_poc.tenants (
  tenant_id text PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('poc_only', 'poc_restore'))
);

CREATE TABLE IF NOT EXISTS oxkio_poc.scopes (
  tenant_id text NOT NULL REFERENCES oxkio_poc.tenants (tenant_id) ON DELETE CASCADE,
  user_id text NOT NULL,
  role text NOT NULL,
  status text NOT NULL CHECK (status = 'active'),
  PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS oxkio_poc.approvals (
  tenant_id text NOT NULL,
  approval_id text NOT NULL,
  user_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'approved')),
  action_type text NOT NULL,
  mode text NOT NULL CHECK (mode = 'SAFE_DRAFT_ONLY'),
  execution_enabled boolean NOT NULL DEFAULT false CHECK (execution_enabled = false),
  created_at timestamptz NOT NULL,
  approved_at timestamptz,
  approved_by text,
  PRIMARY KEY (tenant_id, approval_id),
  FOREIGN KEY (tenant_id, user_id)
    REFERENCES oxkio_poc.scopes (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS oxkio_poc.operations (
  tenant_id text NOT NULL,
  operation_id text NOT NULL,
  user_id text NOT NULL,
  idempotency_key text NOT NULL,
  operation_type text NOT NULL,
  state text NOT NULL CHECK (
    state IN (
      'reserved', 'executing', 'succeeded', 'failed_retryable',
      'failed_terminal', 'external_effect_unknown'
    )
  ),
  created_at timestamptz NOT NULL,
  started_at timestamptz,
  completed_at timestamptz,
  result jsonb,
  PRIMARY KEY (tenant_id, operation_id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (tenant_id, user_id)
    REFERENCES oxkio_poc.scopes (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS oxkio_poc.memories (
  tenant_id text NOT NULL,
  memory_id text NOT NULL,
  user_id text NOT NULL,
  kind text NOT NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL,
  search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector('simple', content)
  ) STORED,
  PRIMARY KEY (tenant_id, memory_id),
  FOREIGN KEY (tenant_id, user_id)
    REFERENCES oxkio_poc.scopes (tenant_id, user_id)
);

CREATE TABLE IF NOT EXISTS oxkio_poc.audit_events (
  tenant_id text NOT NULL,
  event_id text NOT NULL,
  user_id text NOT NULL,
  actor_id text NOT NULL,
  action text NOT NULL,
  created_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (tenant_id, event_id),
  FOREIGN KEY (tenant_id, user_id)
    REFERENCES oxkio_poc.scopes (tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS approvals_tenant_status_created_idx
  ON oxkio_poc.approvals (tenant_id, status, created_at);

CREATE INDEX IF NOT EXISTS operations_tenant_state_created_idx
  ON oxkio_poc.operations (tenant_id, state, created_at);

CREATE INDEX IF NOT EXISTS memories_search_idx
  ON oxkio_poc.memories USING gin (search_vector);

CREATE INDEX IF NOT EXISTS audit_tenant_created_idx
  ON oxkio_poc.audit_events (tenant_id, created_at);

CREATE OR REPLACE FUNCTION oxkio_poc.reject_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$;

DROP TRIGGER IF EXISTS audit_events_append_only ON oxkio_poc.audit_events;
CREATE TRIGGER audit_events_append_only
BEFORE UPDATE OR DELETE ON oxkio_poc.audit_events
FOR EACH ROW EXECUTE FUNCTION oxkio_poc.reject_audit_mutation();

ALTER TABLE oxkio_poc.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE oxkio_poc.tenants FORCE ROW LEVEL SECURITY;
ALTER TABLE oxkio_poc.scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE oxkio_poc.scopes FORCE ROW LEVEL SECURITY;
ALTER TABLE oxkio_poc.approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE oxkio_poc.approvals FORCE ROW LEVEL SECURITY;
ALTER TABLE oxkio_poc.operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE oxkio_poc.operations FORCE ROW LEVEL SECURITY;
ALTER TABLE oxkio_poc.memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE oxkio_poc.memories FORCE ROW LEVEL SECURITY;
ALTER TABLE oxkio_poc.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE oxkio_poc.audit_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenants_isolation ON oxkio_poc.tenants;
CREATE POLICY tenants_isolation ON oxkio_poc.tenants
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS scopes_isolation ON oxkio_poc.scopes;
CREATE POLICY scopes_isolation ON oxkio_poc.scopes
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS approvals_isolation ON oxkio_poc.approvals;
CREATE POLICY approvals_isolation ON oxkio_poc.approvals
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS operations_isolation ON oxkio_poc.operations;
CREATE POLICY operations_isolation ON oxkio_poc.operations
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS memories_isolation ON oxkio_poc.memories;
CREATE POLICY memories_isolation ON oxkio_poc.memories
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DROP POLICY IF EXISTS audit_isolation ON oxkio_poc.audit_events;
CREATE POLICY audit_isolation ON oxkio_poc.audit_events
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

\set ON_ERROR_STOP on

BEGIN;

SET LOCAL ROLE oxkio_mission_owner;

CREATE SCHEMA IF NOT EXISTS oxkio AUTHORIZATION oxkio_mission_owner;
REVOKE ALL ON SCHEMA oxkio FROM PUBLIC;
GRANT USAGE ON SCHEMA oxkio TO oxkio_mission_runtime;

CREATE TABLE IF NOT EXISTS oxkio.missions (
  tenant_id text NOT NULL,
  user_id text NOT NULL,
  client_id text NOT NULL,
  mission_id text NOT NULL,
  idempotency_key text NOT NULL,
  project_id text NOT NULL,
  workspace_id text,
  title text NOT NULL,
  objective text NOT NULL,
  scope_text text NOT NULL,
  status text NOT NULL,
  priority text NOT NULL,
  schema_version integer NOT NULL,
  version bigint NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  next_action text NOT NULL,
  source_interaction_id text,
  aggregate_data jsonb NOT NULL,
  CONSTRAINT missions_pk PRIMARY KEY (tenant_id, user_id, client_id, mission_id),
  CONSTRAINT missions_idempotency_uq
    UNIQUE (tenant_id, user_id, client_id, idempotency_key),
  CONSTRAINT missions_status_ck CHECK (status IN (
    'PROPOSED', 'READY', 'WAITING_APPROVAL', 'RUNNING', 'BLOCKED',
    'UNDER_REVIEW', 'COMPLETED', 'FAILED', 'CANCELLED'
  )),
  CONSTRAINT missions_priority_ck CHECK (priority IN ('normal', 'medium', 'high')),
  CONSTRAINT missions_schema_version_ck CHECK (schema_version > 0),
  CONSTRAINT missions_version_ck CHECK (version > 0),
  CONSTRAINT missions_timestamps_ck CHECK (updated_at >= created_at),
  CONSTRAINT missions_title_ck CHECK (char_length(title) BETWEEN 1 AND 200),
  CONSTRAINT missions_objective_ck CHECK (char_length(objective) BETWEEN 1 AND 500),
  CONSTRAINT missions_scope_text_ck CHECK (char_length(scope_text) BETWEEN 1 AND 500),
  CONSTRAINT missions_next_action_ck CHECK (char_length(next_action) BETWEEN 1 AND 300),
  CONSTRAINT missions_aggregate_object_ck CHECK (jsonb_typeof(aggregate_data) = 'object'),
  CONSTRAINT missions_aggregate_shape_ck CHECK (
    aggregate_data ?& ARRAY[
      'owners', 'participants', 'dependencies', 'blockers', 'tasks', 'risks',
      'requiredApprovals', 'evidence', 'result', 'acceptanceCriteria'
    ]
    AND aggregate_data - ARRAY[
      'owners', 'participants', 'dependencies', 'blockers', 'tasks', 'risks',
      'requiredApprovals', 'evidence', 'result', 'acceptanceCriteria'
    ] = '{}'::jsonb
  ),
  CONSTRAINT missions_aggregate_arrays_ck CHECK (
    jsonb_typeof(aggregate_data -> 'owners') = 'array'
    AND jsonb_typeof(aggregate_data -> 'participants') = 'array'
    AND jsonb_typeof(aggregate_data -> 'dependencies') = 'array'
    AND jsonb_typeof(aggregate_data -> 'blockers') = 'array'
    AND jsonb_typeof(aggregate_data -> 'tasks') = 'array'
    AND jsonb_typeof(aggregate_data -> 'risks') = 'array'
    AND jsonb_typeof(aggregate_data -> 'requiredApprovals') = 'array'
    AND jsonb_typeof(aggregate_data -> 'evidence') = 'array'
    AND jsonb_typeof(aggregate_data -> 'acceptanceCriteria') = 'array'
  )
);

CREATE INDEX IF NOT EXISTS missions_scope_created_idx
  ON oxkio.missions (tenant_id, user_id, client_id, created_at, mission_id);

CREATE INDEX IF NOT EXISTS missions_scope_project_idx
  ON oxkio.missions (tenant_id, user_id, client_id, project_id, created_at, mission_id);

CREATE INDEX IF NOT EXISTS missions_scope_status_idx
  ON oxkio.missions (tenant_id, user_id, client_id, status, created_at, mission_id);

ALTER TABLE oxkio.missions ENABLE ROW LEVEL SECURITY;
ALTER TABLE oxkio.missions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS missions_scope_isolation ON oxkio.missions;
CREATE POLICY missions_scope_isolation ON oxkio.missions
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

REVOKE ALL ON TABLE oxkio.missions FROM PUBLIC;
REVOKE ALL ON TABLE oxkio.missions FROM oxkio_mission_runtime;
GRANT SELECT, INSERT ON TABLE oxkio.missions TO oxkio_mission_runtime;
GRANT UPDATE (
  project_id, workspace_id, title, objective, scope_text, status, priority,
  schema_version, version, updated_at, next_action, source_interaction_id,
  aggregate_data
) ON TABLE oxkio.missions TO oxkio_mission_runtime;

COMMIT;

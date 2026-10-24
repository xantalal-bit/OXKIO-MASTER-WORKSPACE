-- V3 owner snapshots: the SQL backend replaces filesystem snapshots. No data
-- import, automatic migration, grants or role creation occurs at runtime.
-- json (not jsonb) preserves object key order used by the existing HMAC
-- contract. Reordering JSON properties invalidates those established seals.
CREATE SCHEMA IF NOT EXISTS oxkio_v3;
CREATE TABLE oxkio_v3.memory_snapshots (
 tenant_id text NOT NULL,
 client_id text NOT NULL,
 user_id text NOT NULL,
 records json NOT NULL CHECK (json_typeof(records)='array'),
 PRIMARY KEY (tenant_id,client_id,user_id)
);
ALTER TABLE oxkio_v3.memory_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE oxkio_v3.memory_snapshots FORCE ROW LEVEL SECURITY;
CREATE POLICY memory_owner_scope ON oxkio_v3.memory_snapshots
 USING (tenant_id=current_setting('app.tenant_id',true) AND client_id=current_setting('app.client_id',true) AND user_id=current_setting('app.user_id',true))
 WITH CHECK (tenant_id=current_setting('app.tenant_id',true) AND client_id=current_setting('app.client_id',true) AND user_id=current_setting('app.user_id',true));

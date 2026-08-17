'use strict';

// Tests OFFLINE/estaticos de 003_approval_items.sql (5C.7B.3F / B3).
// Ninguno de estos tests importa `pg`, crea un Pool o abre una conexion.
// Solo leen el texto de la migracion y del adaptador B1 ya publicado y
// comprueban propiedades textuales/estructurales.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MIGRATION_PATH = path.join(__dirname, '003_approval_items.sql');
const REPOSITORY_PATH = path.join(__dirname, '..', '..', 'postgres-approval-repository.js');

const migrationSql = fs.readFileSync(MIGRATION_PATH, 'utf8');
const repositorySource = fs.readFileSync(REPOSITORY_PATH, 'utf8');

const REAL_STATUSES = Object.freeze([
  'pending', 'approved', 'rejected', 'executing', 'executed',
  'execution_failed', 'expired',
]);

function stripSqlComments(sql) {
  return sql.replace(/--[^\n]*/g, '');
}

// Splits the CREATE TABLE body into its top-level comma-separated clauses
// (column defs and table CONSTRAINTs), respecting parenthesis nesting so a
// CHECK(...) with an internal comma isn't split apart, and so a CONSTRAINT
// clause that wraps onto a second line is treated as one clause.
function splitTopLevelClauses(body) {
  const clauses = [];
  let depth = 0;
  let current = '';
  for (const char of body) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      clauses.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) clauses.push(current);
  return clauses;
}

function extractTableColumns(sql) {
  const clean = stripSqlComments(sql);
  const start = clean.indexOf('CREATE TABLE IF NOT EXISTS oxkio.approval_items (');
  assert.ok(start >= 0, 'CREATE TABLE oxkio.approval_items not found');
  const openParenIndex = clean.indexOf('(', start);
  let depth = 0;
  let endIndex = -1;
  for (let i = openParenIndex; i < clean.length; i += 1) {
    if (clean[i] === '(') depth += 1;
    if (clean[i] === ')') {
      depth -= 1;
      if (depth === 0) { endIndex = i; break; }
    }
  }
  assert.ok(endIndex > openParenIndex, 'unbalanced parentheses in CREATE TABLE');
  const body = clean.slice(openParenIndex + 1, endIndex);

  const columns = [];
  for (const rawClause of splitTopLevelClauses(body)) {
    const clause = rawClause.replace(/\s+/g, ' ').trim();
    if (!clause) continue;
    if (/^CONSTRAINT\b/i.test(clause)) continue;
    const match = clause.match(/^([a-z_][a-z0-9_]*)\s+/i);
    if (match) columns.push(match[1]);
  }
  return columns;
}

function extractSelectFieldColumns(source) {
  const match = source.match(/const SELECT_FIELDS = `([\s\S]*?)`;/);
  assert.ok(match, 'SELECT_FIELDS template not found in postgres-approval-repository.js');
  return match[1]
    .split(',')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => segment.split(/\s+AS\s+/i)[0].trim());
}

test('003_approval_items.sql defines oxkio.approval_items with exactly the columns B1 reads/writes', () => {
  const migrationColumns = new Set(extractTableColumns(migrationSql));
  const repositoryColumns = new Set(extractSelectFieldColumns(repositorySource));

  for (const column of repositoryColumns) {
    assert.ok(
      migrationColumns.has(column),
      `column "${column}" used by PostgresApprovalRepository is missing from the migration`,
    );
  }
  for (const column of migrationColumns) {
    assert.ok(
      repositoryColumns.has(column),
      `column "${column}" in the migration is not read/written by PostgresApprovalRepository`,
    );
  }
});

test('required columns are present with the expected minimal set', () => {
  const columns = new Set(extractTableColumns(migrationSql));
  const required = [
    'id', 'client_id', 'version', 'status', 'record', 'approved_by',
    'approved_at', 'rejected_at', 'resolved_at', 'execution_id',
    'execution_attempt_count', 'execution_started_at',
    'execution_lease_expires_at', 'execution_completed_at',
    'execution_failed_at', 'result', 'error', 'created_at', 'updated_at',
  ];
  for (const column of required) {
    assert.ok(columns.has(column), `missing required column "${column}"`);
  }
  assert.equal(columns.size, required.length, 'unexpected extra or missing columns');
});

test('status CHECK constraint lists exactly the 7 real ApprovalRepositoryV2 statuses, no more, no less', () => {
  const match = migrationSql.match(/approval_items_status_ck CHECK \(status IN \(([\s\S]*?)\)\)/);
  assert.ok(match, 'approval_items_status_ck not found');
  const listed = match[1]
    .split(',')
    .map((s) => s.trim().replace(/^'|'$/g, ''))
    .filter(Boolean);
  assert.deepEqual(listed.sort(), [...REAL_STATUSES].sort());
});

test('version and execution_attempt_count have the constraints requested in B2/B3', () => {
  assert.match(migrationSql, /CHECK \(version > 0\)/);
  assert.match(migrationSql, /CHECK \(execution_attempt_count >= 0\)/);
});

test('id is UUID and the primary key', () => {
  assert.match(migrationSql, /id uuid NOT NULL/);
  assert.match(migrationSql, /CONSTRAINT approval_items_pk PRIMARY KEY \(id\)/);
});

test('RLS is enabled and forced, never left implicit', () => {
  assert.match(migrationSql, /ALTER TABLE oxkio\.approval_items ENABLE ROW LEVEL SECURITY;/);
  assert.match(migrationSql, /ALTER TABLE oxkio\.approval_items FORCE ROW LEVEL SECURITY;/);
});

test('the RLS policy isolates exclusively by client_id via current_setting', () => {
  const match = migrationSql.match(
    /CREATE POLICY approval_items_scope_isolation ON oxkio\.approval_items\s*\n\s*USING \(([\s\S]*?)\)\s*\n\s*WITH CHECK \(([\s\S]*?)\);/,
  );
  assert.ok(match, 'approval_items_scope_isolation policy not found');
  const using = match[1].trim();
  const withCheck = match[2].trim();
  assert.equal(using, "client_id = current_setting('app.client_id', true)");
  assert.equal(withCheck, "client_id = current_setting('app.client_id', true)");
});

test('no tenant_id or user_id column, index, or policy predicate is introduced', () => {
  // Comments deliberately explain the client_id-only decision using these
  // words; only the executable SQL (comments stripped) must never use them.
  const executable = stripSqlComments(migrationSql);
  assert.doesNotMatch(executable, /\btenant_id\b/);
  assert.doesNotMatch(executable, /\buser_id\b/);
});

test('approval_items is never merged with missions or mission_confirmations', () => {
  // Comments deliberately reference oxkio.missions/mission_confirmations to
  // explain precedent and the deliberate non-merge; only executable SQL
  // (comments stripped) must never reference those tables.
  const executable = stripSqlComments(migrationSql);
  assert.doesNotMatch(executable, /\bmissions\b/);
  assert.doesNotMatch(executable, /\bmission_confirmations\b/);
});

test('runtime grants never include DELETE, TRUNCATE, or blanket privileges', () => {
  assert.doesNotMatch(migrationSql, /GRANT[^;]*\bDELETE\b/i);
  assert.doesNotMatch(migrationSql, /GRANT[^;]*\bTRUNCATE\b/i);
  assert.doesNotMatch(migrationSql, /GRANT ALL[^;]*oxkio_approval_runtime/i);
  assert.match(migrationSql, /REVOKE ALL ON TABLE oxkio\.approval_items FROM PUBLIC;/);
  assert.match(migrationSql, /REVOKE ALL ON TABLE oxkio\.approval_items FROM oxkio_approval_runtime;/);
  assert.match(migrationSql, /GRANT SELECT, INSERT ON TABLE oxkio\.approval_items TO oxkio_approval_runtime;/);
});

test('the runtime UPDATE grant never includes id, client_id, created_at, or record', () => {
  const match = migrationSql.match(
    /GRANT UPDATE \(([\s\S]*?)\) ON TABLE oxkio\.approval_items TO oxkio_approval_runtime;/,
  );
  assert.ok(match, 'GRANT UPDATE (...) for oxkio_approval_runtime not found');
  const updatable = match[1].split(',').map((s) => s.trim());
  for (const immutable of ['id', 'client_id', 'created_at', 'record']) {
    assert.ok(!updatable.includes(immutable), `"${immutable}" must not be UPDATE-grantable to runtime`);
  }
});

test('the migration never creates a role, secret, or credential', () => {
  assert.doesNotMatch(migrationSql, /CREATE ROLE/i);
  assert.doesNotMatch(migrationSql, /CREATE USER/i);
  assert.doesNotMatch(migrationSql, /PASSWORD/i);
  assert.doesNotMatch(migrationSql, /ALTER ROLE/i);
});

test('the migration is idempotent-shaped: guarded DDL and a single explicit transaction', () => {
  assert.match(migrationSql, /^\\set ON_ERROR_STOP on/);
  assert.match(migrationSql, /^BEGIN;/m);
  assert.match(migrationSql, /^COMMIT;/m);
  assert.match(migrationSql, /CREATE TABLE IF NOT EXISTS oxkio\.approval_items/);
  assert.match(migrationSql, /DROP POLICY IF EXISTS approval_items_scope_isolation/);
  assert.match(migrationSql, /CREATE INDEX IF NOT EXISTS approval_items_client_status_created_idx/);
  assert.match(migrationSql, /CREATE INDEX IF NOT EXISTS approval_items_client_status_lease_idx/);
});

test('no PostgreSQL/Neon connection, secret, or pg client appears anywhere in the migration', () => {
  assert.doesNotMatch(migrationSql, /connectionString/i);
  assert.doesNotMatch(migrationSql, /sslmode/i);
  assert.doesNotMatch(migrationSql, /neon\.tech/i);
  assert.doesNotMatch(migrationSql, /OXKIO_APPROVAL_PG_RUNTIME_URL/);
  assert.doesNotMatch(migrationSql, /require\(['"]pg['"]\)/);
});

test('this test file itself never imports pg or opens a connection', () => {
  const selfSource = fs.readFileSync(__filename, 'utf8');
  assert.doesNotMatch(selfSource, /require\(['"]pg['"]\)/);
  assert.doesNotMatch(selfSource, /new Pool\(/);
});

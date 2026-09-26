'use strict';

// Tests OFFLINE/estaticos de 005_quality_incidents.sql: solo leen el texto
// de la migracion. No importan `pg`, no crean Pool ni abren conexiones.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { INCIDENT_TYPES, PRIORITIES, STATUSES } = require('../../../services/runtime/quality-incident-registry');

const migrationSql = fs.readFileSync(path.join(__dirname, '005_quality_incidents.sql'), 'utf8');
const repositorySource = fs.readFileSync(
  path.join(__dirname, '..', '..', 'postgres-quality-incident-repository.js'),
  'utf8',
);
const executable = migrationSql.replace(/--[^\n]*/g, '');

test('003 remains untouched (frozen hash)', () => {
  const hash = (name) => crypto.createHash('sha256')
    .update(fs.readFileSync(path.join(__dirname, name), 'utf8'), 'utf8').digest('hex');
  assert.equal(hash('003_approval_items.sql'), '45e1b076947fdf9bea2bd8e54d959b105fdf1b24bfb7487a9cd9cb16678b32c2');
});

test('005 is one explicit transaction with ON_ERROR_STOP', () => {
  assert.match(migrationSql, /^\\set ON_ERROR_STOP on/);
  assert.match(migrationSql, /^BEGIN;/m);
  assert.match(migrationSql, /^COMMIT;/m);
});

test('005 runs as oxkio_approval_owner and never touches Mission Queue identities or tables', () => {
  const roles = executable.match(/SET\s+LOCAL\s+ROLE\s+([a-z_][a-z0-9_]*)/gi) || [];
  assert.deepEqual(roles, ['SET LOCAL ROLE oxkio_approval_owner']);
  assert.doesNotMatch(executable, /oxkio_mission_(owner|runtime)/);
  assert.doesNotMatch(executable, /oxkio\.missions|mission_confirmations|approval_items/);
  assert.doesNotMatch(executable, /CREATE\s+ROLE|ALTER\s+ROLE|GRANT\s+\w+\s+TO\s+oxkio_approval_owner/i);
});

test('CHECK constraints match the registry enums exactly', () => {
  const listIn = (constraint) => {
    const match = executable.match(new RegExp(`${constraint} CHECK \\(\\w+ IN \\(([\\s\\S]*?)\\)\\)`));
    assert.ok(match, constraint);
    return match[1].match(/'([A-Z0-9_]+)'/g).map((value) => value.slice(1, -1));
  };
  assert.deepEqual(listIn('quality_incidents_type_ck'), Object.keys(INCIDENT_TYPES));
  assert.deepEqual(listIn('quality_incidents_priority_ck'), PRIORITIES);
  assert.deepEqual(listIn('quality_incidents_status_ck'), Object.keys(STATUSES));
});

test('RLS is forced and uses the hardened NULLIF scope form from 004', () => {
  assert.match(executable, /ALTER TABLE oxkio\.quality_incidents ENABLE ROW LEVEL SECURITY;/);
  assert.match(executable, /ALTER TABLE oxkio\.quality_incidents FORCE ROW LEVEL SECURITY;/);
  assert.match(executable, /USING \(client_id = NULLIF\(current_setting\('app\.client_id', true\), ''\)\)/);
  assert.match(executable, /WITH CHECK \(client_id = NULLIF\(current_setting\('app\.client_id', true\), ''\)\)/);
  assert.match(executable, /CHECK \(btrim\(client_id\) <> ''\)/);
});

test('runtime grants are minimal: no DELETE/TRUNCATE, UPDATE only on mutable columns used by the upsert', () => {
  assert.match(executable, /REVOKE ALL ON TABLE oxkio\.quality_incidents FROM PUBLIC;/);
  assert.match(executable, /GRANT SELECT, INSERT ON TABLE oxkio\.quality_incidents TO oxkio_approval_runtime;/);
  assert.doesNotMatch(executable, /GRANT[^;]*(DELETE|TRUNCATE|ALL)/i);
  const grant = executable.match(/GRANT UPDATE \(([^)]*)\)\s+ON TABLE oxkio\.quality_incidents TO oxkio_approval_runtime;/);
  assert.ok(grant);
  const granted = grant[1].split(',').map((column) => column.trim()).sort();
  const upsert = repositorySource.match(/DO UPDATE SET([\s\S]*?)`/)[1];
  const updated = [...upsert.matchAll(/(\w+) = EXCLUDED/g)].map((match) => match[1]).sort();
  assert.deepEqual(granted, updated);
});

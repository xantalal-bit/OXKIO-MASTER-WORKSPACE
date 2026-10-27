'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { v3MemoryRuntimeOptions } = require('./v3-memory-runtime-config');

// A source-level contract check prevents a future server refactor from silently
// dropping the PG selector. No network, secret provider or database is used.
test('HTTP server forwards the reviewed V3 memory selector to composition', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../api/server.js'), 'utf8');
  assert.match(source, /require\(["']\.\.\/services\/supervised-operation\/v3-memory-runtime-config["']\)/);
  const composition = source.match(/v3Chat\s*=\s*createServerComposition\(\{([\s\S]*?)\n\s*\}\);/);
  assert.ok(composition, 'V3 server composition must be locatable');
  assert.match(composition[1], /\.\.\.v3MemoryRuntimeOptions\(process\.env,\s*getSecret\)/);
  assert.match(composition[1], /memoryRoot:\s*process\.env\.OXKIO_V3_MEMORY_ROOT/);
});

test('V3 memory selection remains local without explicit enabled PostgreSQL opt-in', () => {
  let requested = 0;
  const secret = () => { requested++; throw Error('secret read forbidden'); };
  assert.deepEqual(v3MemoryRuntimeOptions({}, secret), { memoryBackend: 'local' });
  assert.deepEqual(v3MemoryRuntimeOptions({ OXKIO_V3_ENABLED: 'true' }, secret), { memoryBackend: 'local' });
  assert.deepEqual(v3MemoryRuntimeOptions({ OXKIO_V3_ENABLED: 'false', OXKIO_V3_MEMORY_BACKEND: 'postgres' }, secret), { memoryBackend: 'local' });
  assert.equal(requested, 0);
});

test('enabled PostgreSQL cannot start without explicit connection and dedicated secret', () => {
  assert.throws(() => v3MemoryRuntimeOptions({ OXKIO_V3_ENABLED: 'true', OXKIO_V3_MEMORY_BACKEND: 'postgres' }, () => 'fixture'), { code: 'postgres_connection_required' });
  const env = { OXKIO_V3_ENABLED: 'true', OXKIO_V3_MEMORY_BACKEND: 'postgres', OXKIO_V3_PG_HOST: 'pg.example', OXKIO_V3_PG_DATABASE: 'oxkio_v3', OXKIO_V3_PG_USER: 'runtime' };
  assert.throws(() => v3MemoryRuntimeOptions(env, () => ''), { code: 'postgres_credentials_required' });
  assert.throws(() => v3MemoryRuntimeOptions({ ...env, OXKIO_V3_PG_SSL: 'false' }, () => 'synthetic-test-only'), { code: 'postgres_tls_required' });
});

test('HTTP server forwards the V3 approval selector with the Approval PostgreSQL pool', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../api/server.js'), 'utf8');
  const composition = source.match(/v3Chat\s*=\s*createServerComposition\(\{([\s\S]*?)\n\s*\}\);/);
  assert.match(composition[1], /approvalPool:\s*v3ApprovalPool\(process\.env,\s*approvalPersistence\.postgresPool\)/);
});

test('V3 approvals stay local unless PostgreSQL is selected, and never fall back silently', () => {
  const { v3ApprovalPool } = require('./v3-memory-runtime-config');
  const pool = { query: async () => ({ rows: [] }) };
  assert.equal(v3ApprovalPool({}, pool), null);
  assert.equal(v3ApprovalPool({ OXKIO_V3_ENABLED: 'true' }, pool), null);
  assert.equal(v3ApprovalPool({ OXKIO_V3_ENABLED: 'false', OXKIO_V3_APPROVAL_BACKEND: 'postgres' }, null), null);
  assert.equal(v3ApprovalPool({ OXKIO_V3_ENABLED: 'true', OXKIO_V3_APPROVAL_BACKEND: 'postgres' }, pool), pool);
  assert.throws(() => v3ApprovalPool({ OXKIO_V3_ENABLED: 'true', OXKIO_V3_APPROVAL_BACKEND: 'postgres' }, null), { code: 'approval_postgres_required' });
  assert.throws(() => v3ApprovalPool({ OXKIO_V3_ENABLED: 'true', OXKIO_V3_APPROVAL_BACKEND: 'files' }, pool), { code: 'approval_backend_invalid' });
});

test('scoped approval factory gives each V3 owner its own opaque durable client_id', async () => {
  const { createScopedApprovalFactory } = require('./approval-factory');
  const pool = { query: async () => ({ rows: [] }), connect: async () => { throw Error('not used'); } };
  const factory = createScopedApprovalFactory({ pool });
  const a = await factory({ tenantId: 't', clientId: 'cliente-cero', userId: 'uid-a' });
  const b = await factory({ tenantId: 't', clientId: 'cliente-cero', userId: 'uid-b' });
  assert.match(a.queue.scope.clientId, /^v3-owner-[0-9a-f]{64}$/);
  assert.notEqual(a.queue.scope.clientId, b.queue.scope.clientId);
  assert.notEqual(a.queue.scope.clientId, 'cliente-cero');
  assert.equal(await factory({ tenantId: 't', clientId: 'cliente-cero', userId: 'uid-a' }).then(x => x.queue), a.queue);
  assert.deepEqual(a.scope, { tenantId: 't', clientId: 'cliente-cero', userId: 'uid-a' });
  assert.throws(() => createScopedApprovalFactory({}), { code: 'approval_root_invalid' });
});

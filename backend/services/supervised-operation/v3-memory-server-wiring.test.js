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

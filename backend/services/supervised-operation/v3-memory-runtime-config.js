'use strict';
// Explicit runtime selection. The default remains the existing local store.
// This module never creates database credentials, schemas, roles or grants.
function v3MemoryRuntimeOptions(env, readSecret) {
  if (env.OXKIO_V3_ENABLED !== 'true') return { memoryBackend: 'local' };
  const backend = env.OXKIO_V3_MEMORY_BACKEND || 'local';
  if (backend === 'local') return { memoryBackend: 'local' };
  if (backend !== 'postgres') throw Object.assign(new Error('memory_backend_invalid'), { code: 'memory_backend_invalid' });
  const host = env.OXKIO_V3_PG_HOST;
  const database = env.OXKIO_V3_PG_DATABASE;
  const user = env.OXKIO_V3_PG_USER;
  const port = Number(env.OXKIO_V3_PG_PORT || 5432);
  if (![host, database, user].every(x => typeof x === 'string' && /^[a-zA-Z0-9_.-]{1,128}$/.test(x))
      || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw Object.assign(new Error('postgres_connection_required'), { code: 'postgres_connection_required' });
  }
  // No plaintext password env variable, no Approval DB credential fallback.
  if (typeof readSecret !== 'function') throw Object.assign(new Error('postgres_credentials_required'), { code: 'postgres_credentials_required' });
  const password = readSecret('OXKIO_V3_PG_PASSWORD');
  if (typeof password !== 'string' || !password.length) throw Object.assign(new Error('postgres_credentials_required'), { code: 'postgres_credentials_required' });
  // Remote PostgreSQL must validate the server certificate; loopback-only
  // ephemeral integration runners may explicitly disable TLS.
  const loopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  if (!loopback && env.OXKIO_V3_PG_SSL === 'false') throw Object.assign(new Error('postgres_tls_required'), { code: 'postgres_tls_required' });
  return { memoryBackend: 'postgres', postgresMemoryConnection: {
    host, port, database, user, password, ssl: loopback && env.OXKIO_V3_PG_SSL === 'false'
      ? false : { rejectUnauthorized: true }
  }};
}
module.exports = { v3MemoryRuntimeOptions };

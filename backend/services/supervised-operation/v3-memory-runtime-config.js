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
  const port = env.OXKIO_V3_PG_PORT === undefined || env.OXKIO_V3_PG_PORT === '' ? 5432 : Number(env.OXKIO_V3_PG_PORT);
  const validHost = typeof host === 'string' && (host === '::1' || /^[a-zA-Z0-9_.-]{1,128}$/.test(host));
  if (!validHost || ![database, user].every(x => typeof x === 'string' && /^[a-zA-Z0-9_.-]{1,128}$/.test(x))
      || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw Object.assign(new Error('postgres_connection_required'), { code: 'postgres_connection_required' });
  }
  // Dedicated registered V3 secret identifier; no Approval DB credential fallback.
  // The current secret-runtime provider reads process.env; launcher custody and
  // deployment are deliberately separate approval-gated phases.
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
// V3 approvals: explicit selection, reusing the Approval PostgreSQL pool
// (same secret and role). Never a silent fallback to ephemeral files.
function v3ApprovalPool(env, approvalPool) {
  const backend = env.OXKIO_V3_APPROVAL_BACKEND || 'local';
  if (env.OXKIO_V3_ENABLED !== 'true' || backend === 'local') return null;
  if (backend !== 'postgres') throw Object.assign(new Error('approval_backend_invalid'), { code: 'approval_backend_invalid' });
  if (!approvalPool) throw Object.assign(new Error('approval_postgres_required'), { code: 'approval_postgres_required' });
  return approvalPool;
}
module.exports.v3ApprovalPool = v3ApprovalPool;

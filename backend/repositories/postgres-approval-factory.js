'use strict';

const { Pool } = require('pg');
const { PostgresApprovalRepository } = require('./postgres-approval-repository');

const DEFAULT_APPROVAL_SCOPE = Object.freeze({ clientId: 'cliente-cero' });

function invalidRuntimeUrl() {
  const error = new Error('Approval PostgreSQL runtime URL is invalid.');
  error.code = 'invalid_approval_postgres_runtime_url';
  return error;
}

function decodeUrlPart(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw invalidRuntimeUrl();
  }
}

function parseApprovalPostgresRuntimeUrl(raw) {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw invalidRuntimeUrl();
  }

  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    throw invalidRuntimeUrl();
  }

  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') {
    throw invalidRuntimeUrl();
  }

  // Contrato B2/3D.3:
  // el secreto productivo no puede transportar parámetros capaces de
  // modificar o esconder la política TLS fijada por composición.
  if (url.search || url.hash) {
    throw invalidRuntimeUrl();
  }

  const user = decodeUrlPart(url.username);
  const password = decodeUrlPart(url.password);
  const host = url.hostname;
  const database = decodeUrlPart(url.pathname.replace(/^\/+/, ''));

  if (!user || !password || !host || !database) {
    throw invalidRuntimeUrl();
  }

  if (database.includes('/')) {
    throw invalidRuntimeUrl();
  }

  const port = url.port ? Number(url.port) : 5432;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw invalidRuntimeUrl();
  }

  return Object.freeze({
    host,
    port,
    user,
    password,
    database,
  });
}

function createPostgresApprovalComposition({
  runtimeUrl,
  scope = DEFAULT_APPROVAL_SCOPE,
  PoolClass = Pool,
} = {}) {
  if (typeof PoolClass !== 'function') {
    const error = new Error('Approval PostgreSQL Pool implementation is invalid.');
    error.code = 'invalid_approval_postgres_pool_class';
    throw error;
  }

  const connection = parseApprovalPostgresRuntimeUrl(runtimeUrl);

  const pool = new PoolClass({
    host: connection.host,
    port: connection.port,
    user: connection.user,
    password: connection.password,
    database: connection.database,
    ssl: {
      rejectUnauthorized: true,
    },
    enableChannelBinding: true,
  });

  const repository = new PostgresApprovalRepository({
    pool,
    scope,
  });

  let cleaned = false;

  async function cleanup() {
    if (cleaned) return;
    cleaned = true;

    if (pool && typeof pool.end === 'function') {
      await pool.end();
    }
  }

  return Object.freeze({
    repository,
    pool,
    cleanup,
  });
}

module.exports = {
  DEFAULT_APPROVAL_SCOPE,
  createPostgresApprovalComposition,
  parseApprovalPostgresRuntimeUrl,
};

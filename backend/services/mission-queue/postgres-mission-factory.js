'use strict';

// OXKIO CANONICAL RUNTIME CONSOLIDATION (22/09/2026), FASE 5: MISSION QUEUE
// — PREPARACION, NO ACTIVACION.
//
// Este fichero solo construye el Pool y los 3 repositorios Postgres de
// Mission Queue a partir de una runtime URL ya validada — mismo patron que
// backend/repositories/postgres-approval-factory.js. Nada en este fichero
// se ejecuta salvo que alguien lo requiera y llame explicitamente a
// createPostgresMissionComposition(): no esta importado desde server.js ni
// desde ningun otro punto de entrada de produccion. Sin este cambio, no
// habia ningun fichero que supiera construir un Pool desde
// OXKIO_MISSION_PG_RUNTIME_URL (los 3 repositorios reciben {pool} ya
// construido) — ese hueco de codigo es lo unico que cierra este fichero.
//
// NO crea el secreto OXKIO_MISSION_PG_RUNTIME_URL (sigue sin provisionar,
// ver backend/config/environment-contract.js). NO ejecuta ninguna migracion.
// NO crea tablas ni roles. NO conecta Mission Queue al chat. Resultado
// esperado de esta fase: CODE_READY / RUNTIME_DISABLED.

const { Pool } = require('pg');
const { PostgresMissionRepository } = require('./postgres-mission-repository');
const { PostgresMissionConfirmationRepository } = require('./postgres-mission-confirmation-repository');
const { PostgresConfirmedMissionCommitter } = require('./postgres-confirmed-mission-committer');

function invalidRuntimeUrl() {
  const error = new Error('Mission PostgreSQL runtime URL is invalid.');
  error.code = 'invalid_mission_postgres_runtime_url';
  return error;
}

function decodeUrlPart(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw invalidRuntimeUrl();
  }
}

// Mismo contrato que parseApprovalPostgresRuntimeUrl() en
// postgres-approval-factory.js (decision B2, 17/08/2026: Mission usa su
// propia variable de entorno, nunca reutiliza el secreto de Approval, pero
// la forma de la URL y sus validaciones son identicas).
function parseMissionPostgresRuntimeUrl(raw) {
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

  // Contrato B2/3D.3: el secreto productivo no puede transportar parametros
  // capaces de modificar o esconder la politica TLS fijada por composicion.
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

// Un unico Pool compartido por los 3 repositorios de Mission Queue: viven en
// la misma base de datos (mismo directorio de migraciones:
// backend/repositories/postgres/migrations/001_mission_queue.sql,
// 002_mission_confirmations.sql), igual que ApprovalRepository comparte un
// unico Pool con su propio secreto.
function createPostgresMissionComposition({
  runtimeUrl,
  PoolClass = Pool,
} = {}) {
  if (typeof PoolClass !== 'function') {
    const error = new Error('Mission PostgreSQL Pool implementation is invalid.');
    error.code = 'invalid_mission_postgres_pool_class';
    throw error;
  }

  const connection = parseMissionPostgresRuntimeUrl(runtimeUrl);

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

  const missionRepository = new PostgresMissionRepository({ pool });
  const missionConfirmationRepository = new PostgresMissionConfirmationRepository({ pool });
  const confirmedMissionCommitter = new PostgresConfirmedMissionCommitter({ pool });

  let cleaned = false;

  async function cleanup() {
    if (cleaned) return;
    cleaned = true;

    if (pool && typeof pool.end === 'function') {
      await pool.end();
    }
  }

  return Object.freeze({
    missionRepository,
    missionConfirmationRepository,
    confirmedMissionCommitter,
    pool,
    cleanup,
  });
}

module.exports = {
  createPostgresMissionComposition,
  parseMissionPostgresRuntimeUrl,
};

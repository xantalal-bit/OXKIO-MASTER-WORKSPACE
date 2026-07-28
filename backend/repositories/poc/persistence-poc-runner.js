'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  deleteApp,
  initializeApp,
} = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const {
  FirestorePocAdapter,
  ROOT_COLLECTION,
} = require('./firestore-poc-adapter');
const { runComparablePoc } = require('./persistence-poc-harness');
const { PostgresPocAdapter } = require('./postgres-poc-adapter');

const FIRESTORE_PROJECT_ID = 'demo-oxkio-poc';
const FIRESTORE_ENDPOINT = Object.freeze({
  hostname: '127.0.0.1',
  port: 8088,
});
const POSTGRES_ENDPOINT = Object.freeze({
  hostname: '127.0.0.1',
  port: 55432,
  database: 'oxkio_poc',
  username: 'oxkio_poc_owner',
});
const FORBIDDEN_POSTGRES_CREDENTIAL_ENV = Object.freeze([
  'DATABASE_URL',
  'POSTGRES_URL',
  'POSTGRES_PRISMA_URL',
  'POSTGRES_URL_NON_POOLING',
  'SUPABASE_DB_URL',
  'NEON_DATABASE_URL',
  'PGHOST',
  'PGPORT',
  'PGDATABASE',
  'PGUSER',
  'PGPASSWORD',
  'PGSERVICE',
  'PGSERVICEFILE',
  'PGPASSFILE',
]);
const FORBIDDEN_FIREBASE_CREDENTIAL_ENV = Object.freeze([
  'FIREBASE_TOKEN',
  'GCLOUD_ACCESS_TOKEN',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_APPLICATION_CREDENTIALS_JSON',
  'GOOGLE_OAUTH_ACCESS_TOKEN',
]);

function blocked(message) {
  const error = new Error(message);
  error.code = 'POC_ENVIRONMENT_BLOCKED';
  return error;
}

function parseHostPort(value, fieldName) {
  const raw = String(value || '').trim();
  if (!raw) throw blocked(`${fieldName} is absent.`);
  let endpoint;
  try {
    endpoint = new URL(raw.includes('://') ? raw : `http://${raw}`);
  } catch {
    throw blocked(`${fieldName} is invalid.`);
  }
  return {
    hostname: endpoint.hostname.replace(/^\[|\]$/g, ''),
    port: Number(endpoint.port),
  };
}

function validateFirestoreEnvironment(env = process.env) {
  const credentialVariables = FORBIDDEN_FIREBASE_CREDENTIAL_ENV.filter(
    (name) => typeof env[name] === 'string' && Boolean(env[name].trim()),
  );
  if (credentialVariables.length > 0) {
    throw blocked(
      `Firestore POC refuses credential variables: ${credentialVariables.join(', ')}.`,
    );
  }
  const endpoint = parseHostPort(
    env.FIRESTORE_EMULATOR_HOST,
    'FIRESTORE_EMULATOR_HOST',
  );
  if (
    endpoint.hostname !== FIRESTORE_ENDPOINT.hostname
    || endpoint.port !== FIRESTORE_ENDPOINT.port
  ) {
    throw blocked('Firestore POC must target 127.0.0.1:8088.');
  }
  const projectId = String(env.GCLOUD_PROJECT || FIRESTORE_PROJECT_ID).trim();
  if (projectId !== FIRESTORE_PROJECT_ID || !projectId.startsWith('demo-')) {
    throw blocked(`Firestore POC must use demo project ${FIRESTORE_PROJECT_ID}.`);
  }
  if (
    typeof env.GOOGLE_CLOUD_PROJECT === 'string'
    && env.GOOGLE_CLOUD_PROJECT.trim()
    && env.GOOGLE_CLOUD_PROJECT.trim() !== FIRESTORE_PROJECT_ID
  ) {
    throw blocked(`GOOGLE_CLOUD_PROJECT must be ${FIRESTORE_PROJECT_ID}.`);
  }
  if (typeof env.FIREBASE_CONFIG === 'string' && env.FIREBASE_CONFIG.trim()) {
    let firebaseConfig;
    try {
      firebaseConfig = JSON.parse(env.FIREBASE_CONFIG);
    } catch {
      throw blocked('FIREBASE_CONFIG must be valid JSON for the demo project.');
    }
    if (
      firebaseConfig.projectId
      && firebaseConfig.projectId !== FIRESTORE_PROJECT_ID
    ) {
      throw blocked(`FIREBASE_CONFIG must use ${FIRESTORE_PROJECT_ID}.`);
    }
  }
  return Object.freeze({ ...endpoint, projectId });
}

function validatePostgresEnvironment(env = process.env) {
  const credentialVariables = FORBIDDEN_POSTGRES_CREDENTIAL_ENV.filter(
    (name) => typeof env[name] === 'string' && Boolean(env[name].trim()),
  );
  if (credentialVariables.length > 0) {
    throw blocked(
      `PostgreSQL POC refuses alternate credential variables: ${credentialVariables.join(', ')}.`,
    );
  }
  const raw = String(env.OXKIO_POC_POSTGRES_URL || '').trim();
  if (!raw) throw blocked('OXKIO_POC_POSTGRES_URL is absent.');
  let connection;
  try {
    connection = new URL(raw);
  } catch {
    throw blocked('OXKIO_POC_POSTGRES_URL is invalid.');
  }
  const database = decodeURIComponent(connection.pathname.replace(/^\//, ''));
  const port = Number(connection.port);
  if (
    connection.protocol !== 'postgresql:'
    || connection.hostname !== POSTGRES_ENDPOINT.hostname
    || port !== POSTGRES_ENDPOINT.port
    || database !== POSTGRES_ENDPOINT.database
    || decodeURIComponent(connection.username) !== POSTGRES_ENDPOINT.username
    || !connection.password
  ) {
    throw blocked(
      'PostgreSQL POC must target oxkio_poc_owner@127.0.0.1:55432/oxkio_poc.',
    );
  }
  if (connection.search || connection.hash) {
    throw blocked('PostgreSQL POC URL must not contain options or fragments.');
  }
  return Object.freeze({
    connectionString: raw,
    hostname: connection.hostname,
    port,
    database,
    username: decodeURIComponent(connection.username),
  });
}

async function runFirestorePoc({ env = process.env } = {}) {
  const target = validateFirestoreEnvironment(env);
  const appName = `oxkio-poc-${process.pid}-${Date.now()}`;
  const app = initializeApp({ projectId: target.projectId }, appName);
  const db = getFirestore(app);
  try {
    await db.recursiveDelete(db.collection(ROOT_COLLECTION));
    const result = await runComparablePoc(new FirestorePocAdapter({ db }));
    return {
      ...result,
      environment: {
        kind: 'emulator',
        host: target.hostname,
        port: target.port,
        projectId: target.projectId,
      },
    };
  } finally {
    await deleteApp(app);
  }
}

async function inspectFirestorePoc({ env = process.env } = {}) {
  const target = validateFirestoreEnvironment(env);
  const appName = `oxkio-poc-inspect-${process.pid}-${Date.now()}`;
  const app = initializeApp({ projectId: target.projectId }, appName);
  const db = getFirestore(app);
  try {
    const tenantSnapshot = await db.collection(ROOT_COLLECTION).get();
    const collections = {
      memberships: 0,
      approvals: 0,
      operations: 0,
      memories: 0,
      audit: 0,
    };
    for (const tenant of tenantSnapshot.docs) {
      for (const name of Object.keys(collections)) {
        const snapshot = await tenant.ref.collection(name).get();
        collections[name] += snapshot.size;
      }
    }
    return {
      provider: 'firestore_emulator',
      tenantDocuments: tenantSnapshot.size,
      collections,
      environment: {
        kind: 'emulator',
        host: target.hostname,
        port: target.port,
        projectId: target.projectId,
      },
    };
  } finally {
    await deleteApp(app);
  }
}

function loadPg() {
  try {
    return require('pg');
  } catch {
    throw blocked('pg driver is absent.');
  }
}

async function resetPostgresSchema(pool) {
  const schema = fs.readFileSync(
    path.join(__dirname, 'postgres-poc-schema.sql'),
    'utf8',
  );
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DROP SCHEMA IF EXISTS oxkio_poc CASCADE');
    await client.query(schema);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function runPostgresPoc({ env = process.env } = {}) {
  const target = validatePostgresEnvironment(env);
  const { Pool } = loadPg();
  const pool = new Pool({
    connectionString: target.connectionString,
    max: 4,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 1000,
  });
  let peakConnections = 0;
  pool.on('connect', () => {
    peakConnections = Math.max(peakConnections, pool.totalCount);
  });
  try {
    const identity = await pool.query(
      `SELECT current_database() AS database,
         current_user AS username,
         host(inet_server_addr()) AS host,
         inet_server_port() AS port`,
    );
    const actual = identity.rows[0] || {};
    if (
      actual.database !== target.database
      || actual.username !== target.username
      || actual.host !== target.hostname
      || Number(actual.port) !== target.port
    ) {
      throw blocked('Connected PostgreSQL instance is not the approved local POC target.');
    }
    await resetPostgresSchema(pool);
    const result = await runComparablePoc(new PostgresPocAdapter({ pool }));
    return {
      ...result,
      metrics: {
        ...result.metrics,
        configuredMaxConnections: 4,
        peakConnections,
      },
      environment: {
        kind: 'isolated_local_cluster',
        host: target.hostname,
        port: target.port,
        database: target.database,
        username: target.username,
      },
    };
  } finally {
    await pool.end();
  }
}

function safeMessage(error, env = process.env) {
  let message = error instanceof Error ? error.message : String(error);
  const secretBearingValues = [
    env.OXKIO_POC_POSTGRES_URL,
    env.PGPASSWORD,
  ].filter(Boolean);
  for (const value of secretBearingValues) {
    message = message.replaceAll(String(value), '[REDACTED]');
  }
  return message;
}

async function main() {
  const provider = process.argv[2];
  const runners = {
    firestore: runFirestorePoc,
    'firestore-inspect': inspectFirestorePoc,
    postgres: runPostgresPoc,
  };
  if (!runners[provider]) {
    throw new Error(
      'Usage: node persistence-poc-runner.js <firestore|firestore-inspect|postgres>',
    );
  }
  const result = await runners[provider]();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`POC failed: ${safeMessage(error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  FIRESTORE_ENDPOINT,
  FIRESTORE_PROJECT_ID,
  FORBIDDEN_FIREBASE_CREDENTIAL_ENV,
  FORBIDDEN_POSTGRES_CREDENTIAL_ENV,
  POSTGRES_ENDPOINT,
  inspectFirestorePoc,
  runFirestorePoc,
  runPostgresPoc,
  safeMessage,
  validateFirestoreEnvironment,
  validatePostgresEnvironment,
};

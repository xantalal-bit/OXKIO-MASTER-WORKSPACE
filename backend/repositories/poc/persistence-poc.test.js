'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  REQUIRED_METHODS,
  assertPocAdapter,
  validateIdempotencyKey,
  validateScope,
} = require('./persistence-poc-contract');
const {
  describeFirestoreEnvironment,
  normalizeSearch,
  operationDocumentId,
  searchTokens,
} = require('./firestore-poc-adapter');
const { describePostgresEnvironment } = require('./postgres-poc-adapter');
const { runComparablePoc } = require('./persistence-poc-harness');
const {
  runFirestorePoc,
  runPostgresPoc,
  safeMessage,
  validateFirestoreEnvironment,
  validatePostgresEnvironment,
} = require('./persistence-poc-runner');
const { SyntheticReferenceAdapter } = require('./synthetic-reference-adapter');

test('synthetic reference executes the complete provider-neutral POC contract', async () => {
  const adapter = assertPocAdapter(new SyntheticReferenceAdapter());
  const result = await runComparablePoc(adapter);

  assert.equal(result.status, 'COMPLETED_SYNTHETIC');
  assert.equal(result.productionDataTouched, false);
  assert.equal(result.invariants.executionEnabled, false);
  assert.equal(result.invariants.mode, 'SAFE_DRAFT_ONLY');
  assert.equal(result.invariants.duplicateBlocked, true);
  assert.equal(result.invariants.concurrentReservationExercised, true);
  assert.equal(result.invariants.tenantIsolationExercised, true);
  assert.equal(result.invariants.exportRestoreExercised, true);
  assert.equal(result.measurements.length, 13);
  assert.ok(result.measurements.every((entry) => entry.durationMs >= 0));
  assert.ok(result.metrics.transactions >= 9);
  assert.ok(result.metrics.logicalWrites > 0);
  assert.ok(result.metrics.logicalReads > 0);
  assert.ok(result.metrics.neutralExportBytes > 0);
});

test('the neutral contract rejects incomplete adapters and unsafe identifiers', () => {
  assert.deepEqual(REQUIRED_METHODS.includes('reserveOperation'), true);
  assert.throws(() => assertPocAdapter({}), /missing/);
  assert.throws(
    () => validateScope({ tenantId: '../tenant', userId: 'user-valid' }),
    /portable identifier/,
  );
  assert.throws(() => validateIdempotencyKey('short'), /portable idempotency key/);
});

test('synthetic reference keeps memory and audit isolated by tenant', async () => {
  const adapter = new SyntheticReferenceAdapter();
  await adapter.initializeScope({
    tenantId: 'tenant-isolation-a',
    userId: 'user-isolation-a',
    role: 'owner',
  });
  await adapter.initializeScope({
    tenantId: 'tenant-isolation-b',
    userId: 'user-isolation-b',
    role: 'owner',
  });
  await adapter.saveMemory({
    tenantId: 'tenant-isolation-a',
    userId: 'user-isolation-a',
    memoryId: 'memory-isolation-a',
    kind: 'note',
    content: 'private synthetic alpha',
    createdAt: '2026-07-28T00:00:00.000Z',
  });
  await adapter.appendAudit({
    tenantId: 'tenant-isolation-a',
    userId: 'user-isolation-a',
    eventId: 'audit-isolation-a',
    actorId: 'user-isolation-a',
    action: 'synthetic',
    createdAt: '2026-07-28T00:00:00.000Z',
  });

  assert.deepEqual(await adapter.searchMemory({
    tenantId: 'tenant-isolation-b',
    userId: 'user-isolation-b',
    query: 'private',
  }), []);
  assert.deepEqual(await adapter.queryAuditByTenantAndDate({
    tenantId: 'tenant-isolation-b',
    from: '2026-07-27T00:00:00.000Z',
    to: '2026-07-29T00:00:00.000Z',
  }), []);
});

test('Firestore adapter planning is deterministic and production-safe by default', () => {
  const descriptor = describeFirestoreEnvironment({
    env: {},
    modulePresent: true,
  });
  assert.equal(descriptor.status, 'BLOCKED_BY_ENVIRONMENT');
  assert.equal(descriptor.productionAllowed, false);
  assert.deepEqual(searchTokens('Reunión reunión Cliente Cero'), [
    'reunion', 'cliente', 'cero',
  ]);
  assert.equal(normalizeSearch('  Reunión  '), 'reunion');
  assert.match(operationDocumentId('tenant-alpha:operation:0001'), /^[a-f0-9]{64}$/);
});

test('PostgreSQL adapter planning is blocked without isolated connection and driver', () => {
  const descriptor = describePostgresEnvironment({
    env: {},
    modulePresent: false,
  });
  assert.equal(descriptor.status, 'BLOCKED_BY_ENVIRONMENT');
  assert.equal(descriptor.productionAllowed, false);
  assert.deepEqual(descriptor.blockers, [
    'OXKIO_POC_POSTGRES_URL is absent',
    'pg driver is absent',
  ]);
});

test('PostgreSQL POC schema encodes tenant isolation, idempotency and append-only audit', () => {
  const schema = fs.readFileSync(
    path.join(__dirname, 'postgres-poc-schema.sql'),
    'utf8',
  );
  assert.match(schema, /UNIQUE \(tenant_id, idempotency_key\)/);
  assert.match(schema, /CHECK \(execution_enabled = false\)/);
  assert.match(schema, /CHECK \(mode = 'SAFE_DRAFT_ONLY'\)/);
  assert.match(schema, /ENABLE ROW LEVEL SECURITY/g);
  assert.match(schema, /FORCE ROW LEVEL SECURITY/g);
  assert.match(schema, /current_setting\('app\.tenant_id', true\)/);
  assert.match(schema, /audit_events is append-only/);
  assert.match(schema, /USING gin \(search_vector\)/);
});

test('POC runners reject every endpoint outside the approved local isolation', () => {
  assert.deepEqual(validateFirestoreEnvironment({
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:8088',
  }), {
    hostname: '127.0.0.1',
    port: 8088,
    projectId: 'demo-oxkio-poc',
  });
  assert.throws(
    () => validateFirestoreEnvironment({
      FIRESTORE_EMULATOR_HOST: 'firestore.googleapis.com:443',
    }),
    /127\.0\.0\.1:8088/,
  );
  assert.throws(
    () => validateFirestoreEnvironment({
      FIRESTORE_EMULATOR_HOST: '127.0.0.1:8088',
      GOOGLE_APPLICATION_CREDENTIALS: 'synthetic-forbidden-path.json',
    }),
    /refuses credential variables: GOOGLE_APPLICATION_CREDENTIALS/,
  );
  assert.throws(
    () => validateFirestoreEnvironment({
      FIRESTORE_EMULATOR_HOST: '127.0.0.1:8088',
      FIREBASE_CONFIG: JSON.stringify({ projectId: 'real-project-forbidden' }),
    }),
    /FIREBASE_CONFIG must use demo-oxkio-poc/,
  );
  assert.deepEqual(validatePostgresEnvironment({
    OXKIO_POC_POSTGRES_URL:
      'postgresql://oxkio_poc_owner:synthetic-local-only@127.0.0.1:55432/oxkio_poc',
  }), {
    connectionString:
      'postgresql://oxkio_poc_owner:synthetic-local-only@127.0.0.1:55432/oxkio_poc',
    hostname: '127.0.0.1',
    port: 55432,
    database: 'oxkio_poc',
    username: 'oxkio_poc_owner',
  });
  assert.throws(
    () => validatePostgresEnvironment({
      OXKIO_POC_POSTGRES_URL:
        'postgresql://oxkio_poc_owner:synthetic-local-only@database.example:5432/oxkio_poc',
    }),
    /127\.0\.0\.1:55432/,
  );
  assert.throws(
    () => validatePostgresEnvironment({
      OXKIO_POC_POSTGRES_URL:
        'postgresql://oxkio_poc_owner:synthetic-local-only@127.0.0.1:55432/oxkio_poc',
      DATABASE_URL: 'postgresql://real.example.invalid/production',
    }),
    /refuses alternate credential variables: DATABASE_URL/,
  );
  assert.equal(
    safeMessage(new Error('failed with local-password'), {
      PGPASSWORD: 'local-password',
    }),
    'failed with [REDACTED]',
  );
});

test('POC source cannot reference real runtime stores or OAuth token files', () => {
  const sources = fs.readdirSync(__dirname)
    .filter((name) => /\.(?:js|sql)$/.test(name) && !name.endsWith('.test.js'))
    .map((name) => fs.readFileSync(path.join(__dirname, name), 'utf8'))
    .join('\n');
  [
    'backend/core/approvalQueue.json',
    'backend/core/executionLog.json',
    'backend/memory/memory.json',
    'backend/auth/googleTokens.json',
  ].forEach((forbidden) => assert.equal(sources.includes(forbidden), false));
  assert.equal(sources.includes('executionEnabled: true'), false);
});

const firestoreReady = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

test('Firestore engine executes the common POC when the emulator is available', {
  skip: firestoreReady
    ? false
    : 'BLOQUEADA POR ENTORNO: FIRESTORE_EMULATOR_HOST/Firebase Emulator no disponibles.',
}, async () => {
  const result = await runFirestorePoc();
  assert.equal(result.provider, 'firestore_emulator');
  assert.equal(result.measurements.length, 13);
  assert.equal(result.invariants.concurrentReservationExercised, true);
});

let postgresDriverPresent = true;
try {
  require.resolve('pg');
} catch {
  postgresDriverPresent = false;
}
const postgresReady = Boolean(process.env.OXKIO_POC_POSTGRES_URL)
  && postgresDriverPresent;

test('PostgreSQL engine executes the common POC when the isolated cluster is available', {
  skip: postgresReady
    ? false
    : 'BLOQUEADA POR ENTORNO: servidor PostgreSQL, OXKIO_POC_POSTGRES_URL y pg no disponibles.',
}, async () => {
  const result = await runPostgresPoc();
  assert.equal(result.provider, 'postgresql_isolated');
  assert.equal(result.measurements.length, 13);
  assert.equal(result.invariants.concurrentReservationExercised, true);
});

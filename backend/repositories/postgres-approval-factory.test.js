'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const {
  createPostgresApprovalComposition,
  parseApprovalPostgresRuntimeUrl,
} = require('./postgres-approval-factory');

class FakePool {
  static instances = [];

  constructor(options) {
    this.options = options;
    this.connectCalls = 0;
    this.endCalls = 0;
    FakePool.instances.push(this);
  }

  async connect() {
    this.connectCalls += 1;
    throw new Error('FakePool.connect must not be called during composition.');
  }

  async end() {
    this.endCalls += 1;
  }
}

test.beforeEach(() => {
  FakePool.instances.length = 0;
});

test('parses the Approval runtime URL into explicit connection fields', () => {
  const parsed = parseApprovalPostgresRuntimeUrl(
    'postgresql://approval_user:s3cret@db.example.test:5433/approval_db'
  );

  assert.deepEqual(parsed, {
    host: 'db.example.test',
    port: 5433,
    user: 'approval_user',
    password: 's3cret',
    database: 'approval_db',
  });
});

test('decodes encoded credentials without exposing them through a raw connection string', () => {
  const parsed = parseApprovalPostgresRuntimeUrl(
    'postgresql://approval%40user:p%23ss@db.example.test/neondb'
  );

  assert.equal(parsed.user, 'approval@user');
  assert.equal(parsed.password, 'p#ss');
});

test('defaults PostgreSQL port to 5432', () => {
  const parsed = parseApprovalPostgresRuntimeUrl(
    'postgresql://approval_user:s3cret@db.example.test/neondb'
  );

  assert.equal(parsed.port, 5432);
});

test('rejects missing or malformed runtime URLs fail-closed', () => {
  for (const value of [
    undefined,
    '',
    'not-a-url',
    'https://user:pass@example.test/db',
    'postgresql://db.example.test/neondb',
    'postgresql://user@db.example.test/neondb',
    'postgresql://user:pass@db.example.test/',
  ]) {
    assert.throws(
      () => parseApprovalPostgresRuntimeUrl(value),
      error => error && error.code === 'invalid_approval_postgres_runtime_url'
    );
  }
});

test('rejects every query string or fragment so URL data cannot weaken TLS policy', () => {
  for (const value of [
    'postgresql://user:pass@db.example.test/neondb?sslmode=require',
    'postgresql://user:pass@db.example.test/neondb?sslmode=disable',
    'postgresql://user:pass@db.example.test/neondb?application_name=oxkio',
    'postgresql://user:pass@db.example.test/neondb#fragment',
  ]) {
    assert.throws(
      () => parseApprovalPostgresRuntimeUrl(value),
      error => error && error.code === 'invalid_approval_postgres_runtime_url'
    );
  }
});

test('builds Pool from explicit fields with strict TLS and channel binding', () => {
  const composition = createPostgresApprovalComposition({
    runtimeUrl: 'postgresql://approval_user:s3cret@db.example.test/neondb',
    scope: { clientId: 'cliente-cero' },
    PoolClass: FakePool,
  });

  assert.equal(FakePool.instances.length, 1);

  const pool = FakePool.instances[0];

  assert.deepEqual(pool.options, {
    host: 'db.example.test',
    port: 5432,
    user: 'approval_user',
    password: 's3cret',
    database: 'neondb',
    ssl: {
      rejectUnauthorized: true,
    },
    enableChannelBinding: true,
  });

  assert.equal(pool.connectCalls, 0);
  assert.equal(composition.pool, pool);
  assert.ok(composition.repository);
  assert.equal(typeof composition.cleanup, 'function');
});

test('composition itself performs no network connection', () => {
  createPostgresApprovalComposition({
    runtimeUrl: 'postgresql://approval_user:s3cret@db.example.test/neondb',
    PoolClass: FakePool,
  });

  assert.equal(FakePool.instances[0].connectCalls, 0);
});

test('cleanup closes the pool exactly once', async () => {
  const composition = createPostgresApprovalComposition({
    runtimeUrl: 'postgresql://approval_user:s3cret@db.example.test/neondb',
    PoolClass: FakePool,
  });

  await composition.cleanup();
  await composition.cleanup();

  assert.equal(FakePool.instances[0].endCalls, 1);
});

test('factory source never reads process.env and never delegates TLS policy to a raw connection option', () => {
  const source = fs.readFileSync(
    require.resolve('./postgres-approval-factory'),
    'utf8'
  );

  assert.equal(source.includes('process.env'), false);

  // Keep the forbidden option assembled so the factory source itself
  // contains no usable occurrence of that option name.
  const forbidden = ['connection', 'String'].join('');
  assert.equal(source.includes(forbidden), false);
});

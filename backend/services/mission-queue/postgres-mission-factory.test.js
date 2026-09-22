'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const {
  createPostgresMissionComposition,
  parseMissionPostgresRuntimeUrl,
} = require('./postgres-mission-factory');

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

test('parses the Mission runtime URL into explicit connection fields', () => {
  const parsed = parseMissionPostgresRuntimeUrl(
    'postgresql://mission_user:s3cret@db.example.test:5433/mission_db'
  );

  assert.deepEqual(parsed, {
    host: 'db.example.test',
    port: 5433,
    user: 'mission_user',
    password: 's3cret',
    database: 'mission_db',
  });
});

test('decodes encoded credentials without exposing them through a raw connection string', () => {
  const parsed = parseMissionPostgresRuntimeUrl(
    'postgresql://mission%40user:p%23ss@db.example.test/neondb'
  );

  assert.equal(parsed.user, 'mission@user');
  assert.equal(parsed.password, 'p#ss');
});

test('defaults PostgreSQL port to 5432', () => {
  const parsed = parseMissionPostgresRuntimeUrl(
    'postgresql://mission_user:s3cret@db.example.test/neondb'
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
      () => parseMissionPostgresRuntimeUrl(value),
      error => error && error.code === 'invalid_mission_postgres_runtime_url'
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
      () => parseMissionPostgresRuntimeUrl(value),
      error => error && error.code === 'invalid_mission_postgres_runtime_url'
    );
  }
});

test('builds one shared Pool for the 3 mission repositories, with strict TLS and channel binding', () => {
  const composition = createPostgresMissionComposition({
    runtimeUrl: 'postgresql://mission_user:s3cret@db.example.test/neondb',
    PoolClass: FakePool,
  });

  assert.equal(FakePool.instances.length, 1);

  const pool = FakePool.instances[0];

  assert.deepEqual(pool.options, {
    host: 'db.example.test',
    port: 5432,
    user: 'mission_user',
    password: 's3cret',
    database: 'neondb',
    ssl: {
      rejectUnauthorized: true,
    },
    enableChannelBinding: true,
  });

  assert.equal(pool.connectCalls, 0);
  assert.equal(composition.pool, pool);
  assert.ok(composition.missionRepository);
  assert.ok(composition.missionConfirmationRepository);
  assert.ok(composition.confirmedMissionCommitter);
  assert.equal(typeof composition.cleanup, 'function');
});

test('composition itself performs no network connection', () => {
  createPostgresMissionComposition({
    runtimeUrl: 'postgresql://mission_user:s3cret@db.example.test/neondb',
    PoolClass: FakePool,
  });

  assert.equal(FakePool.instances[0].connectCalls, 0);
});

test('cleanup closes the pool exactly once', async () => {
  const composition = createPostgresMissionComposition({
    runtimeUrl: 'postgresql://mission_user:s3cret@db.example.test/neondb',
    PoolClass: FakePool,
  });

  await composition.cleanup();
  await composition.cleanup();

  assert.equal(FakePool.instances[0].endCalls, 1);
});

test('factory source never reads process.env and never delegates TLS policy to a raw connection option', () => {
  const source = fs.readFileSync(
    require.resolve('./postgres-mission-factory'),
    'utf8'
  );

  assert.equal(source.includes('process.env'), false);

  const forbidden = ['connection', 'String'].join('');
  assert.equal(source.includes(forbidden), false);
});

// FASE 5+6+11 TEST F: the mission runtime stays disabled without any
// composition wired into server.js — this factory can be built/configured
// standalone (as proven by the tests above, with no real secret), but
// nothing in the live runtime calls it.
test('server.js does not wire Mission Queue into the live runtime yet', () => {
  const serverSource = fs.readFileSync(
    require.resolve('../../api/server.js'),
    'utf8'
  );

  assert.equal(serverSource.includes('mission-queue'), false);
  assert.equal(serverSource.includes('postgres-mission-factory'), false);
});

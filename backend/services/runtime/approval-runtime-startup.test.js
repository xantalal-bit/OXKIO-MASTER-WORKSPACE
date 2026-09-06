'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  readRuntimeConfig,
} = require('../../runtime/cloud-ready-contract');

const {
  createApprovalRuntimeComposition,
} = require('./approval-runtime-composition');

class FakePool {
  static instances = [];

  constructor(options) {
    this.options = options;
    this.endCalls = 0;
    FakePool.instances.push(this);
  }

  connect() {
    throw new Error('NETWORK_FORBIDDEN_IN_B5_3');
  }

  async end() {
    this.endCalls += 1;
  }
}

function resetFakePool() {
  FakePool.instances.length = 0;
}

test('JSON default startup needs no Approval PostgreSQL secret and creates no Pool', async () => {
  resetFakePool();

  const env = {};
  const runtimeConfig = readRuntimeConfig(env, { requiredScopes: [] });

  assert.equal(runtimeConfig.approvalRepositoryBackend, 'json');

  const composition = createApprovalRuntimeComposition({
    backend: runtimeConfig.approvalRepositoryBackend,
    runtimeUrl: env.OXKIO_APPROVAL_PG_RUNTIME_URL,
    PoolClass: FakePool,
  });

  assert.equal(composition.backend, 'json');
  assert.equal(FakePool.instances.length, 0);

  await composition.cleanup();

  assert.equal(FakePool.instances.length, 0);
});

test('postgres startup fails closed at environment contract when Approval secret is absent', () => {
  resetFakePool();

  assert.throws(
    () => readRuntimeConfig(
      {
        OXKIO_APPROVAL_REPOSITORY_BACKEND: 'postgres',
      },
      { requiredScopes: [] }
    ),
    /OXKIO_APPROVAL_PG_RUNTIME_URL/
  );

  assert.equal(FakePool.instances.length, 0);
});

test('postgres startup composes real Approval repository path with FakePool and zero network', async () => {
  resetFakePool();

  const env = {
    OXKIO_APPROVAL_REPOSITORY_BACKEND: 'postgres',
    OXKIO_APPROVAL_PG_RUNTIME_URL:
      'postgresql://synthetic:synthetic@example.invalid/neondb',
  };

  const runtimeConfig = readRuntimeConfig(env, { requiredScopes: [] });

  assert.equal(runtimeConfig.approvalRepositoryBackend, 'postgres');

  const composition = createApprovalRuntimeComposition({
    backend: runtimeConfig.approvalRepositoryBackend,
    runtimeUrl: env.OXKIO_APPROVAL_PG_RUNTIME_URL,
    PoolClass: FakePool,
  });

  assert.equal(composition.backend, 'postgres');
  assert.ok(composition.approvalQueue);

  assert.equal(FakePool.instances.length, 1);

  const [pool] = FakePool.instances;

  assert.equal(pool.options.host, 'example.invalid');
  assert.equal(pool.options.port, 5432);
  assert.equal(pool.options.user, 'synthetic');
  assert.equal(pool.options.password, 'synthetic');
  assert.equal(pool.options.database, 'neondb');

  assert.deepEqual(pool.options.ssl, {
    rejectUnauthorized: true,
  });

  assert.equal(pool.options.enableChannelBinding, true);

  /*
   * Si cualquier componente intentara conectar durante composición,
   * FakePool.connect() lanzaría NETWORK_FORBIDDEN_IN_B5_3.
   */
  assert.equal(pool.endCalls, 0);

  await composition.cleanup();
  await composition.cleanup();

  assert.equal(pool.endCalls, 1);
});

test('unsupported backend still fails closed before any Pool exists', () => {
  resetFakePool();

  assert.throws(
    () => readRuntimeConfig(
      {
        OXKIO_APPROVAL_REPOSITORY_BACKEND: 'memory',
      },
      { requiredScopes: [] }
    ),
    /OXKIO_APPROVAL_REPOSITORY_BACKEND/
  );

  assert.equal(FakePool.instances.length, 0);
});

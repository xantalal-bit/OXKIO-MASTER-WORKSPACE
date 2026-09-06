'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const {
  createRuntimeReadiness,
  createShutdownController,
  getRuntimeProbe,
  readRuntimeConfig,
} = require('./cloud-ready-contract');

test('runtime configuration uses dynamic PORT, portable host and fail-closed invariants', () => {
  assert.deepEqual(readRuntimeConfig({ PORT: '0' }), {
    port: 0,
    host: '0.0.0.0',
    filesystem: 'ephemeral',
    executionEnabled: false,
    safeDraftOnly: true,
    approvalRepositoryBackend: 'json',
  });
  assert.equal(readRuntimeConfig({}).port, 3000);
  assert.throws(() => readRuntimeConfig({ PORT: 'invalid' }), /PORT/);
  assert.throws(() => readRuntimeConfig({ PORT: '70000' }), /PORT/);
  assert.throws(() => readRuntimeConfig({ OXKIO_FILESYSTEM_MODE: 'persistent' }), /OXKIO_FILESYSTEM_MODE/);
  assert.throws(() => readRuntimeConfig({ NODE_ENV: 'unknown' }), /NODE_ENV/);
  assert.equal(
    readRuntimeConfig({ OXKIO_APPROVAL_REPOSITORY_BACKEND: 'postgres' }).approvalRepositoryBackend,
    'postgres'
  );
  assert.throws(
    () => readRuntimeConfig({ OXKIO_APPROVAL_REPOSITORY_BACKEND: 'memory' }),
    /OXKIO_APPROVAL_REPOSITORY_BACKEND/
  );
});

test('development and test modes stay exactly as permissive as before', () => {
  assert.equal(readRuntimeConfig({ NODE_ENV: 'development' }).port, 3000);
  assert.equal(readRuntimeConfig({ NODE_ENV: 'test' }).port, 3000);
  assert.equal(readRuntimeConfig({}).port, 3000);
});

test('production fails closed without the firebase and authorization scopes', () => {
  assert.throws(
    () => readRuntimeConfig({ NODE_ENV: 'production' }),
    /FIREBASE_PROJECT_ID/,
  );
  assert.throws(
    () => readRuntimeConfig({
      NODE_ENV: 'production',
      FIREBASE_PROJECT_ID: 'oxkio-synthetic-project',
    }),
    /OXKIO_ADMIN_FIREBASE_UIDS/,
  );
  assert.throws(
    () => readRuntimeConfig({
      NODE_ENV: 'production',
      OXKIO_ADMIN_FIREBASE_UIDS: 'synthetic-uid',
    }),
    /FIREBASE_PROJECT_ID/,
  );
});

test('production passes once firebase and authorization are satisfied, without requiring postgres, google_oauth or filesystem mode yet', () => {
  const config = readRuntimeConfig({
    NODE_ENV: 'production',
    FIREBASE_PROJECT_ID: 'oxkio-synthetic-project',
    OXKIO_ADMIN_FIREBASE_UIDS: 'synthetic-uid',
    // OXKIO_MISSION_PG_RUNTIME_URL, GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI and
    // OXKIO_FILESYSTEM_MODE deliberately absent: none of them belong to the
    // scopes required today.
  });
  assert.equal(config.port, 3000);
});

test('production failures never leak secret-classified values in the error message', () => {
  const secret = 'sintetico-no-real-firebase-private-key';
  assert.throws(
    () => readRuntimeConfig({
      NODE_ENV: 'production',
      FIREBASE_PROJECT_ID: 'oxkio-synthetic-project',
      FIREBASE_PRIVATE_KEY: secret,
    }),
    (error) => {
      assert.match(error.message, /OXKIO_ADMIN_FIREBASE_UIDS/);
      assert.doesNotMatch(error.message, new RegExp(secret));
      return true;
    },
  );
});

test('an explicit requiredScopes argument always overrides the NODE_ENV default', () => {
  assert.throws(
    () => readRuntimeConfig({}, { requiredScopes: ['authorization'] }),
    /OXKIO_ADMIN_FIREBASE_UIDS/,
  );
  assert.equal(
    readRuntimeConfig({ NODE_ENV: 'production' }, { requiredScopes: [] }).port,
    3000,
  );
});

test('health is live while readiness follows runtime lifecycle', () => {
  const readiness = createRuntimeReadiness();
  const config = readRuntimeConfig({});
  assert.deepEqual(getRuntimeProbe('/health', 'GET', readiness, config), {
    statusCode: 200,
    payload: { ok: true, status: 'healthy', filesystem: 'ephemeral' },
  });
  assert.equal(getRuntimeProbe('/ready', 'GET', readiness, config).statusCode, 503);
  readiness.markReady();
  assert.equal(getRuntimeProbe('/ready', 'GET', readiness, config).statusCode, 200);
  assert.equal(getRuntimeProbe('/health', 'POST', readiness, config), null);
});

test('shutdown marks readiness false, closes once and cleans up in order', async () => {
  const events = [];
  const processRef = new EventEmitter();
  processRef.exitCode = null;
  const readiness = createRuntimeReadiness();
  readiness.markReady();
  const server = {
    close(callback) {
      events.push(`close:${readiness.isReady()}`);
      callback();
    },
  };
  const controller = createShutdownController({
    server,
    readiness,
    processRef,
    cleanup: () => events.push('cleanup'),
  });

  const first = controller.shutdown('SIGTERM');
  const second = controller.shutdown('SIGINT');
  assert.equal(first, second);
  assert.deepEqual(await first, { ok: true, signal: 'SIGTERM' });
  assert.deepEqual(events, ['close:false', 'cleanup']);
});

test('signal handlers are installable and removable without process exit', async () => {
  const processRef = new EventEmitter();
  processRef.exitCode = null;
  const readiness = createRuntimeReadiness();
  const server = { close: (callback) => callback() };
  const controller = createShutdownController({ server, readiness, processRef });
  controller.install();
  assert.equal(processRef.listenerCount('SIGTERM'), 1);
  processRef.emit('SIGTERM');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(processRef.exitCode, 0);
  controller.uninstall();
  assert.equal(processRef.listenerCount('SIGINT'), 0);
});

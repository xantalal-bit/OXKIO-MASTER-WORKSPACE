'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  APPROVAL_BACKEND_JSON,
  APPROVAL_BACKEND_POSTGRES,
  createApprovalRuntimeComposition,
} = require('./approval-runtime-composition');

test('defaults to JSON and preserves the existing ApprovalQueue fallback', () => {
  const calls = [];

  const result = createApprovalRuntimeComposition({
    createApprovalQueue(options) {
      calls.push(options);
      return { kind: 'queue' };
    },
  });

  assert.equal(result.backend, APPROVAL_BACKEND_JSON);
  assert.deepEqual(calls, [undefined]);
  assert.deepEqual(result.approvalQueue, { kind: 'queue' });
});

test('JSON mode never constructs PostgreSQL composition', () => {
  let postgresCalls = 0;

  createApprovalRuntimeComposition({
    backend: 'json',
    runtimeUrl: 'must-not-be-consumed',
    createApprovalQueue: () => ({}),
    createPostgresComposition() {
      postgresCalls += 1;
      throw new Error('must not run');
    },
  });

  assert.equal(postgresCalls, 0);
});

test('postgres mode injects exactly the Postgres repository into ApprovalQueue', () => {
  const repository = { kind: 'postgres-repository' };
  let receivedPostgresOptions;
  let receivedQueueOptions;

  const result = createApprovalRuntimeComposition({
    backend: APPROVAL_BACKEND_POSTGRES,
    runtimeUrl: 'postgresql://synthetic:synthetic@example.invalid/neondb',
    createPostgresComposition(options) {
      receivedPostgresOptions = options;
      return {
        repository,
        async cleanup() {},
      };
    },
    createApprovalQueue(options) {
      receivedQueueOptions = options;
      return { kind: 'queue' };
    },
  });

  assert.equal(receivedPostgresOptions.runtimeUrl,
    'postgresql://synthetic:synthetic@example.invalid/neondb');
  assert.deepEqual(receivedQueueOptions, { repository });
  assert.equal(result.backend, APPROVAL_BACKEND_POSTGRES);
});

test('postgres mode propagates fail-closed composition errors', () => {
  const expected = Object.assign(new Error('invalid runtime URL'), {
    code: 'invalid_approval_postgres_runtime_url',
  });

  assert.throws(
    () => createApprovalRuntimeComposition({
      backend: 'postgres',
      createPostgresComposition() {
        throw expected;
      },
    }),
    error => error === expected
  );
});

test('unsupported backend fails closed before queue construction', () => {
  let queueCalls = 0;

  assert.throws(
    () => createApprovalRuntimeComposition({
      backend: 'memory',
      createApprovalQueue() {
        queueCalls += 1;
        return {};
      },
    }),
    error => error && error.code === 'invalid_approval_repository_backend'
  );

  assert.equal(queueCalls, 0);
});

test('postgres cleanup delegates exactly once', async () => {
  let cleanupCalls = 0;

  const result = createApprovalRuntimeComposition({
    backend: 'postgres',
    runtimeUrl: 'postgresql://synthetic:synthetic@example.invalid/neondb',
    createPostgresComposition() {
      return {
        repository: {},
        async cleanup() {
          cleanupCalls += 1;
        },
      };
    },
    createApprovalQueue() {
      return {};
    },
  });

  await result.cleanup();
  await result.cleanup();

  assert.equal(cleanupCalls, 1);
});

test('JSON cleanup is safe and performs no PostgreSQL work', async () => {
  const result = createApprovalRuntimeComposition({
    createApprovalQueue: () => ({}),
  });

  await result.cleanup();
  await result.cleanup();
});

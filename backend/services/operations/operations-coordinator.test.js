'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  validateRunInput,
  createOperationsCoordinator,
} = require('./operations-coordinator');

const OPERATION_TYPE = 'business-analysis-readonly';

const IDENTITY = Object.freeze({
  clientId: 'cliente-cero',
  expectedClientId: 'cliente-cero',
  authorization: { status: 'granted' },
});

function workerResult(options, overrides = {}) {
  return {
    operationId: options.operationId,
    interactionId: options.interactionId,
    worker: 'business-hunter-readonly',
    mode: 'manual',
    status: 'completed',
    startedAt: '2026-07-22T10:00:00.000Z',
    completedAt: '2026-07-22T10:00:01.000Z',
    durationMs: 1000,
    sourceStatus: 'real',
    summary: 'Evidencia documental sanitizada.',
    opportunities: [{ id: 'doc-1', kind: 'documentary_evidence', title: 'Documento', summary: 'No es un lead.' }],
    recommendations: ['Revisar evidencia.'],
    errors: [],
    ...overrides,
  };
}

test('uses a closed Business readonly registry and rejects arbitrary contracts', () => {
  assert.throws(() => validateRunInput({ type: 'evil', identity: IDENTITY, trigger: 'manual' }), /Unsupported/);
  assert.throws(() => validateRunInput({ type: OPERATION_TYPE, identity: IDENTITY, trigger: 'manual', worker: 'evil' }), /Invalid/);
  assert.throws(() => validateRunInput({ type: OPERATION_TYPE, identity: null, trigger: 'manual' }), /authorization/);
});

test('owns one ID pair, lifecycle, sanitized snapshots and safe terminal logging', async () => {
  let adapterOptions;
  let resolveWorker;
  const logged = [];
  const coordinator = createOperationsCoordinator({
    randomUUID: (() => {
      const ids = ['operation-id', 'interaction-id'];
      return () => ids.shift();
    })(),
    businessHunterService: {
      runBusinessHunterReadonly(options) {
        adapterOptions = options;
        return new Promise((resolve) => { resolveWorker = resolve; });
      },
    },
    executionLogger: { logOperation(record) { logged.push(record); } },
  });

  const pending = coordinator.runBusinessAnalysis({ identity: IDENTITY });
  const active = coordinator.getStatus().activeOperation;
  assert.equal(active.status, 'running');
  assert.equal(active.phase, 'running_worker');
  assert.deepEqual(adapterOptions, { operationId: 'operation-id', interactionId: 'interaction-id' });
  await assert.rejects(() => coordinator.runBusinessAnalysis({ identity: IDENTITY }), /already running/);

  resolveWorker(workerResult(adapterOptions));
  const result = await pending;
  assert.equal(result.operationId, 'operation-id');
  assert.equal(result.interactionId, 'interaction-id');
  assert.equal(result.type, OPERATION_TYPE);
  assert.equal(result.executionEnabled, false);
  assert.equal(result.proposalId, null);
  assert.equal(result.approvalId, null);
  assert.equal(result.phase, 'completed');
  assert.equal(coordinator.getStatus().activeOperation, null);
  assert.equal(coordinator.getRecentOperations().length, 1);
  assert.equal(logged.length, 1);
  assert.throws(() => { result.result.opportunities[0].title = 'mutated'; }, TypeError);
  assert.equal(coordinator.getRecentOperations()[0].result.opportunities[0].title, 'Documento');
});

test('keeps only five operations and releases active state after success', async () => {
  let sequence = 0;
  const coordinator = createOperationsCoordinator({
    randomUUID: () => `id-${++sequence}`,
    businessHunterService: { async runBusinessHunterReadonly(options) { return workerResult(options); } },
  });
  for (let index = 0; index < 6; index += 1) {
    await coordinator.runBusinessAnalysis({ identity: IDENTITY });
  }
  assert.equal(coordinator.getRecentOperations().length, 5);
  assert.equal(coordinator.getStatus().activeOperation, null);
});

test('fails closed for worker failure or invalid unsafe result and always releases lock', async () => {
  let invalid = false;
  const coordinator = createOperationsCoordinator({
    randomUUID: (() => { let id = 0; return () => `uuid-${++id}`; })(),
    businessHunterService: {
      async runBusinessHunterReadonly(options) {
        if (!invalid) throw Object.assign(new Error('private stack'), { code: 'worker_private_failure' });
        return workerResult(options, { sourceStatus: 'unavailable', opportunities: [{ title: 'inventada' }] });
      },
    },
  });
  await assert.rejects(() => coordinator.runBusinessAnalysis({ identity: IDENTITY }), /failed/i);
  assert.equal(coordinator.getStatus().activeOperation, null);
  assert.deepEqual(coordinator.getRecentOperations()[0].errors, ['Business Hunter readonly cycle failed.']);
  invalid = true;
  await assert.rejects(() => coordinator.runBusinessAnalysis({ identity: IDENTITY }), /failed|opportunities/i);
  assert.equal(coordinator.getStatus().activeOperation, null);
  assert.equal(coordinator.getRecentOperations()[0].status, 'failed');
});

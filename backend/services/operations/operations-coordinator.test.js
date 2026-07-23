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
const KNOWLEDGE_SERVICE = Object.freeze({
  async runKnowledgeReadonly(options) {
    return {
      ...options, worker: 'knowledge-readonly', mode: 'manual', status: 'completed',
      startedAt: '2026-07-22T10:00:00.000Z', completedAt: '2026-07-22T10:00:01.000Z', durationMs: 1000,
      sourceStatus: 'real', summary: 'Conocimiento revisado.', itemsCount: 1,
      topics: ['gobernanza'], recommendations: ['Revisar temas.'], warnings: [], errors: [],
    };
  },
});
const MEMORY_SERVICE = Object.freeze({
  async runMemoryReadonly(options) {
    return {
      ...options, worker: 'memory-readonly', mode: 'manual', status: 'completed',
      startedAt: '2026-07-22T10:00:00.000Z', completedAt: '2026-07-22T10:00:01.000Z', durationMs: 1000,
      sourceStatus: 'real', summary: 'Memoria revisada.', itemsCount: 1,
      topics: ['Decisiones'], recommendations: ['Revisar los temas.'], warnings: [], errors: [],
    };
  },
});
const GMAIL_SERVICE = Object.freeze({
  async runGmailReadonly(options) {
    return {
      ...options, worker: 'gmail-readonly', mode: 'manual', status: 'completed',
      startedAt: '2026-07-22T10:00:00.000Z', completedAt: '2026-07-22T10:00:01.000Z', durationMs: 1000,
      sourceStatus: 'real', summary: 'Correo revisado.', emailsCount: 1,
      relevantItems: [{ sender: 'Equipo', subject: 'Asunto', summary: 'Resumen.' }],
      recommendations: ['Revisar asunto.'], warnings: [], errors: [],
    };
  },
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
    knowledgeReadonlyService: KNOWLEDGE_SERVICE,
    memoryReadonlyService: MEMORY_SERVICE,
    gmailReadonlyService: GMAIL_SERVICE,
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
  assert.deepEqual(adapterOptions, { operationId: 'operation-id', interactionId: 'interaction-id', identity: IDENTITY });
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
    knowledgeReadonlyService: KNOWLEDGE_SERVICE,
    memoryReadonlyService: MEMORY_SERVICE,
    gmailReadonlyService: GMAIL_SERVICE,
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
    knowledgeReadonlyService: KNOWLEDGE_SERVICE,
    memoryReadonlyService: MEMORY_SERVICE,
    gmailReadonlyService: GMAIL_SERVICE,
    randomUUID: (() => { let id = 0; return () => `uuid-${++id}`; })(),
    businessHunterService: {
      async runBusinessHunterReadonly(options) {
        if (!invalid) throw Object.assign(new Error('private stack'), { code: 'worker_private_failure' });
        return workerResult(options, { sourceStatus: 'unavailable', opportunities: [{ title: 'inventada' }] });
      },
    },
  });
  await assert.rejects(() => coordinator.runBusinessAnalysis({ identity: IDENTITY }), /no se pudo completar/i);
  assert.equal(coordinator.getStatus().activeOperation, null);
  assert.deepEqual(coordinator.getRecentOperations()[0].errors, ['No se pudo completar la operación.']);
  invalid = true;
  await assert.rejects(() => coordinator.runBusinessAnalysis({ identity: IDENTITY }), /no se pudo completar|opportunities/i);
  assert.equal(coordinator.getStatus().activeOperation, null);
  assert.equal(coordinator.getRecentOperations()[0].status, 'failed');
});

test('runs Knowledge through the same global lifecycle and shared history', async () => {
  let sequence = 0;
  let releaseBusiness;
  const coordinator = createOperationsCoordinator({
    randomUUID: () => `shared-${++sequence}`,
    knowledgeReadonlyService: KNOWLEDGE_SERVICE,
    memoryReadonlyService: MEMORY_SERVICE,
    gmailReadonlyService: GMAIL_SERVICE,
    businessHunterService: {
      runBusinessHunterReadonly() { return new Promise((resolve) => { releaseBusiness = resolve; }); },
    },
  });
  const knowledge = await coordinator.runKnowledgeReview({ identity: IDENTITY });
  assert.equal(knowledge.type, 'knowledge-review-readonly');
  assert.equal(knowledge.worker, 'knowledge-readonly');
  assert.equal(knowledge.executionEnabled, false);
  assert.equal(knowledge.proposalId, null);
  assert.equal(knowledge.approvalId, null);
  const businessRun = coordinator.runBusinessAnalysis({ identity: IDENTITY });
  await assert.rejects(() => coordinator.runKnowledgeReview({ identity: IDENTITY }), /already running/i);
  releaseBusiness(workerResult({ operationId: 'shared-3', interactionId: 'shared-4' }));
  await businessRun;
  assert.deepEqual(coordinator.getRecentOperations().map((item) => item.worker), [
    'business-hunter-readonly', 'knowledge-readonly',
  ]);
});

test('runs Memory through the same global lifecycle and shared history', async () => {
  let sequence = 0;
  const coordinator = createOperationsCoordinator({
    randomUUID: () => `memory-${++sequence}`,
    businessHunterService: { async runBusinessHunterReadonly(options) { return workerResult(options); } },
    knowledgeReadonlyService: KNOWLEDGE_SERVICE,
    memoryReadonlyService: MEMORY_SERVICE,
    gmailReadonlyService: GMAIL_SERVICE,
  });
  const business = await coordinator.runBusinessAnalysis({ identity: IDENTITY });
  const memory = await coordinator.runMemoryReview({ identity: IDENTITY });
  assert.equal(memory.type, 'memory-review-readonly');
  assert.equal(memory.worker, 'memory-readonly');
  assert.equal(memory.operationId === business.operationId, false);
  assert.equal(memory.executionEnabled, false);
  assert.equal(memory.proposalId, null);
  assert.equal(memory.approvalId, null);
  assert.deepEqual(coordinator.getRecentOperations().map((item) => item.worker), [
    'memory-readonly', 'business-hunter-readonly',
  ]);
});

test('fails closed when Memory exceeds its specialized public limits', async () => {
  const coordinator = createOperationsCoordinator({
    businessHunterService: { async runBusinessHunterReadonly(options) { return workerResult(options); } },
    knowledgeReadonlyService: KNOWLEDGE_SERVICE,
    memoryReadonlyService: {
      async runMemoryReadonly(options) {
        const result = await MEMORY_SERVICE.runMemoryReadonly(options);
        return { ...result, recommendations: ['1', '2', '3', '4'] };
      },
    },
    gmailReadonlyService: GMAIL_SERVICE,
  });
  await assert.rejects(() => coordinator.runMemoryReview({ identity: IDENTITY }), /no se pudo completar/i);
  assert.equal(coordinator.getStatus().activeOperation, null);
  assert.equal(coordinator.getRecentOperations()[0].status, 'failed');
});

test('runs Gmail through the same global lifecycle and shared history', async () => {
  let sequence = 0;
  const coordinator = createOperationsCoordinator({
    randomUUID: () => `gmail-${++sequence}`,
    businessHunterService: { async runBusinessHunterReadonly(options) { return workerResult(options); } },
    knowledgeReadonlyService: KNOWLEDGE_SERVICE,
    memoryReadonlyService: MEMORY_SERVICE,
    gmailReadonlyService: GMAIL_SERVICE,
  });
  const memory = await coordinator.runMemoryReview({ identity: IDENTITY });
  const gmail = await coordinator.runGmailReview({ identity: IDENTITY });
  assert.equal(gmail.type, 'gmail-review-readonly');
  assert.equal(gmail.worker, 'gmail-readonly');
  assert.equal(gmail.operationId === memory.operationId, false);
  assert.equal(gmail.executionEnabled, false);
  assert.equal(gmail.proposalId, null);
  assert.equal(gmail.approvalId, null);
  assert.equal(gmail.result.emailsCount, 1);
  assert.deepEqual(coordinator.getRecentOperations().map((item) => item.worker), [
    'gmail-readonly', 'memory-readonly',
  ]);
});

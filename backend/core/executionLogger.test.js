'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const ExecutionLogger = require('./executionLogger');
const {
  createSecretRuntime,
  createSyntheticSecretProvider,
} = require('../security/secret-runtime');

const SYNTHETIC_SECRET = 'synthetic-execution-secret-3b';
const syntheticRuntime = createSecretRuntime({
  provider: createSyntheticSecretProvider({ GOOGLE_CLIENT_SECRET: SYNTHETIC_SECRET }),
});

function createLogger(dataFile) {
  return new ExecutionLogger({ dataFile, redactor: syntheticRuntime.redact });
}

function operation(overrides = {}) {
  return {
    operationId: 'operation-id', interactionId: 'interaction-id',
    type: 'business-analysis-readonly', worker: 'business-hunter-readonly', mode: 'manual',
    status: 'completed', sourceStatus: 'real',
    startedAt: '2026-07-22T10:00:00.000Z', completedAt: '2026-07-22T10:00:01.000Z',
    durationMs: 1000, resultSummary: 'Resumen seguro.', warnings: [], errors: [],
    executionEnabled: false, result: { opportunities: ['secret'] }, token: 'secret',
    ...overrides,
  };
}

test('logs terminal operations through a strict whitelist and lists defensive limited clones', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'execution-logger-'));
  const dataFile = path.join(root, 'log.json');
  try {
    const logger = createLogger(dataFile);
    const logged = logger.logOperation(operation());
    assert.equal(logged.kind, 'operation');
    assert.equal(logged.warningCount, 0);
    assert.equal('result' in logged, false);
    assert.equal('token' in logged, false);
    assert.equal(JSON.stringify(logged).includes('secret'), false);
    logged.resultSummary = 'mutated';
    assert.equal(logger.list({ limit: 1 })[0].resultSummary, 'Resumen seguro.');
    assert.equal(logger.list({ limit: 0 }).length, 0);
    assert.throws(() => logger.logOperation(operation({ executionEnabled: true })), /Invalid/);
    assert.throws(() => logger.logOperation(operation({ resultSummary: 'Contactar a person@example.com' })), /Unsafe/);
    const knowledge = logger.logOperation(operation({ type: 'knowledge-review-readonly', worker: 'knowledge-readonly' }));
    assert.equal(knowledge.worker, 'knowledge-readonly');
    const memory = logger.logOperation(operation({ type: 'memory-review-readonly', worker: 'memory-readonly' }));
    assert.equal(memory.worker, 'memory-readonly');
    const gmail = logger.logOperation(operation({ type: 'gmail-review-readonly', worker: 'gmail-readonly' }));
    assert.equal(gmail.worker, 'gmail-readonly');
    const calendar = logger.logOperation(operation({ type: 'calendar-review-readonly', worker: 'calendar-readonly' }));
    assert.equal(calendar.worker, 'calendar-readonly');
    assert.throws(() => logger.logOperation(operation({ type: 'arbitrary', worker: 'arbitrary' })), /Invalid/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('loads legacy records without rewriting or rejecting them', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'execution-logger-legacy-'));
  const dataFile = path.join(root, 'log.json');
  const legacy = { logs: [{ id: 'legacy', approvalId: 'approval-1', executionResult: { ok: true } }] };
  fs.writeFileSync(dataFile, JSON.stringify(legacy));
  try {
    const logger = createLogger(dataFile);
    assert.equal(logger.hasExecuted('approval-1'), true);
    assert.deepEqual(logger.list({ limit: 1 })[0], {
      id: 'legacy', createdAt: null, kind: 'legacy',
    });
    assert.deepEqual(JSON.parse(fs.readFileSync(dataFile, 'utf8')), legacy);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('add and logOperation redact synthetic secrets before persistence', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'execution-logger-redaction-'));
  const dataFile = path.join(root, 'log.json');
  try {
    const logger = createLogger(dataFile);
    const circular = { note: SYNTHETIC_SECRET, Authorization: `Bearer ${SYNTHETIC_SECRET}` };
    circular.self = circular;
    const added = logger.add({ type: 'synthetic', payload: circular });
    assert.equal(JSON.stringify(added).includes(SYNTHETIC_SECRET), false);
    assert.equal(added.payload.self, '[Circular]');

    const logged = logger.logOperation(operation({ resultSummary: `Completed ${SYNTHETIC_SECRET}` }));
    assert.equal(logged.resultSummary.includes(SYNTHETIC_SECRET), false);
    assert.equal(fs.readFileSync(dataFile, 'utf8').includes(SYNTHETIC_SECRET), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

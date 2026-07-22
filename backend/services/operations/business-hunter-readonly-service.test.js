'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  createBusinessHunterReadonlyService,
} = require('./business-hunter-readonly-service');

function createTempBusinessHunterRepository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'business-hunter-readonly-'));
  const repository = path.join(root, 'Business Hunter');

  fs.mkdirSync(repository, { recursive: true });
  fs.writeFileSync(
    path.join(repository, 'lead-guide.md'),
    '# Business Hunter Lead Guide\n\nDocumentacion y estrategia comercial.',
    'utf8',
  );
  fs.writeFileSync(
    path.join(repository, 'notes.txt'),
    'Business Hunter tareas pendientes y decisiones comerciales.',
    'utf8',
  );

  return {
    root,
    repository,
  };
}

function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function snapshotRuntimeHashes() {
  const files = [
    path.join(__dirname, '..', '..', 'auth', 'googleTokens.json'),
    path.join(__dirname, '..', '..', 'core', 'approvalQueue.json'),
    path.join(__dirname, '..', '..', 'memory', 'memory.json'),
  ];

  return files
    .filter((filePath) => fs.existsSync(filePath))
    .map((filePath) => [filePath, hashFile(filePath)])
    .reduce((acc, [filePath, hash]) => {
      acc[filePath] = hash;
      return acc;
    }, {});
}

function getKnowledgeStorePath(documentPath) {
  const id = crypto.createHash('sha1').update(documentPath).digest('hex');
  return path.resolve(__dirname, '..', '..', 'data', 'knowledge-store', 'objects', `${id}.json`);
}

test('runs Business Hunter readonly in sandbox, sanitizes output and keeps runtime hashes stable', async () => {
  const fixture = createTempBusinessHunterRepository();
  let cleanupCalls = 0;
  let sandboxMode = null;
  const service = createBusinessHunterReadonlyService({
    createExecutiveRuntime(options) {
      sandboxMode = options && options.mode;
      return {
        cleanup() {
          cleanupCalls += 1;
        },
      };
    },
  });
  const before = snapshotRuntimeHashes();

  try {
    const result = await service.runBusinessHunterReadonly({
      root: fixture.root,
      worker: 'ignored-by-contract',
      runtime: 'ignored-by-contract',
      executionEnabled: true,
      stores: { fake: true },
      timeoutMs: 2000,
    });

    assert.equal(sandboxMode, 'sandbox');
    assert.equal(cleanupCalls, 1);
    assert.equal(result.worker, 'business-hunter-readonly');
    assert.equal(result.mode, 'manual');
    assert.equal(result.status, 'completed');
    assert.equal(result.sourceStatus, 'real');
    assert.equal(result.proposalCreated, false);
    assert.equal(result.approvalId, null);
    assert.equal(Array.isArray(result.opportunities), true);
    assert.ok(result.opportunities.length > 0);
    assert.ok(result.opportunities.length <= 10);
    assert.equal(result.opportunitiesCount, result.opportunities.length);
    assert.ok(result.opportunities.every((item) => {
      const serialized = JSON.stringify(item);
      return item.kind === 'documentary_evidence'
        && /no representa una empresa ni un lead comercial/i.test(item.summary)
        && !serialized.includes('\\')
        && !serialized.includes('/')
        && !serialized.includes('secret')
        && !serialized.includes('@');
    }));
    assert.ok(Array.isArray(result.recommendations));
    assert.ok(result.recommendations.length > 0);
    assert.equal(typeof result.operationId, 'string');
    assert.equal(typeof result.interactionId, 'string');
    assert.equal(typeof result.startedAt, 'string');
    assert.equal(typeof result.completedAt, 'string');
    assert.equal(Number.isFinite(result.durationMs), true);
    assert.equal(result.errors.length, 0);
    [
      path.join(fixture.repository, 'lead-guide.md'),
      path.join(fixture.repository, 'notes.txt'),
    ].forEach((documentPath) => {
      assert.equal(fs.existsSync(getKnowledgeStorePath(documentPath)), false);
    });

    const status = service.getStatus();
    assert.equal(status.executionEnabled, false);
    assert.equal(status.running, false);
    assert.equal(status.lastError, null);
    assert.equal(status.lastOperation.operationId, result.operationId);
    assert.equal(status.lastResult.operationId, result.operationId);

    const after = snapshotRuntimeHashes();
    assert.deepEqual(after, before);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('fails closed when Business Hunter is unavailable and keeps last error sanitized', async () => {
  let cleanupCalls = 0;
  const service = createBusinessHunterReadonlyService({
    createExecutiveRuntime() {
      return {
        cleanup() {
          cleanupCalls += 1;
        },
      };
    },
    runBusinessHunterConnector() {
      return { found: false };
    },
  });

  const result = await service.runBusinessHunterReadonly({ timeoutMs: 2000 });

  assert.equal(cleanupCalls, 1);
  assert.equal(result.sourceStatus, 'unavailable');
  assert.equal(result.status, 'completed_with_warnings');
  assert.equal(result.opportunities.length, 0);
  assert.equal(result.opportunitiesCount, 0);
  assert.equal(result.proposalCreated, false);
  assert.equal(result.approvalId, null);
  assert.match(result.summary, /no está disponible/i);
  assert.ok(result.recommendations.length > 0);
  assert.equal(service.getStatus().lastError, null);
});

test('does not invent opportunities when Business Hunter is found without knowledge evidence', async () => {
  let connectorOptions;
  const service = createBusinessHunterReadonlyService({
    createExecutiveRuntime() {
      return { cleanup() {} };
    },
    runBusinessHunterConnector(options) {
      connectorOptions = options;
      return {
        found: true,
        asset: { name: 'Business Hunter', recognized: true },
        pipeline: { knowledgeObjects: [] },
      };
    },
  });

  const result = await service.runBusinessHunterReadonly({ timeoutMs: 2000 });

  assert.equal(result.status, 'completed_with_warnings');
  assert.equal(connectorOptions.persist, false);
  assert.equal(result.sourceStatus, 'partial');
  assert.equal(result.opportunitiesCount, 0);
  assert.deepEqual(result.opportunities, []);
  assert.ok(result.recommendations.length > 0);
});

test('rejects concurrent executions and releases the lock after timeout failure', async () => {
  let cleanupCalls = 0;
  const service = createBusinessHunterReadonlyService({
    createExecutiveRuntime() {
      return {
        cleanup() {
          cleanupCalls += 1;
        },
      };
    },
    runBusinessHunterConnector() {
      return new Promise(() => {});
    },
  });

  const firstRun = service.runBusinessHunterReadonly({ timeoutMs: 25 });
  await assert.rejects(
    () => service.runBusinessHunterReadonly({ timeoutMs: 25 }),
    /already running/i,
  );

  await assert.rejects(firstRun, /timed out/i);
  assert.equal(cleanupCalls > 0, true);
  assert.equal(service.getStatus().running, false);
});

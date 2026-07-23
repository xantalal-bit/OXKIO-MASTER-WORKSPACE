'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createMemoryReadonlyService } = require('./memory-readonly-service');

const IDENTITY = Object.freeze({ clientId: 'cliente-cero', expectedClientId: 'cliente-cero', authorization: { status: 'granted' } });

function fixture(entries = []) {
  let cleanup = 0; let reads = 0; let readOptions;
  const forbidden = () => { throw new Error('write forbidden'); };
  const memoryEngine = {
    getRecentMemory(options) { reads += 1; readOptions = options; return entries; },
    saveShortTerm: forbidden, saveLongTerm: forbidden, persistMemory: forbidden,
  };
  const service = createMemoryReadonlyService({
    memoryEngine,
    createExecutiveRuntime(options) { assert.equal(options.mode, 'sandbox'); return { cleanup() { cleanup += 1; } }; },
  });
  return { service, reads: () => reads, readOptions: () => readOptions, cleanup: () => cleanup };
}

test('reads Memory Engine once with persist false and returns only a limited executive summary', async () => {
  const entries = Array.from({ length: 15 }, (_, index) => ({
    timestamp: 'secret timestamp', data: { intent: index % 2 ? 'decisions' : 'tasks', status: 'completed', query: 'private content', operationId: 'secret-id' },
  }));
  const f = fixture(entries);
  const result = await f.service.runMemoryReadonly({ operationId: 'op', interactionId: 'ix', identity: IDENTITY, query: 'ignored' });
  assert.equal(f.reads(), 1); assert.deepEqual(f.readOptions(), { persist: false }); assert.equal(f.cleanup(), 1);
  assert.equal(result.worker, 'memory-readonly'); assert.equal(result.itemsCount, 10); assert.equal(result.topics.length <= 5, true);
  assert.equal(result.recommendations.length <= 3, true); assert.equal(result.sourceStatus, 'real');
  const serialized = JSON.stringify(result);
  ['private content', 'secret timestamp', 'secret-id', 'path', 'payload', 'document'].forEach((value) => assert.equal(serialized.includes(value), false));
});

test('reports partial and unavailable without inventing memories', async () => {
  const partial = await fixture([{ data: { unknown: 'private' } }]).service.runMemoryReadonly({ operationId: 'op', interactionId: 'ix', identity: IDENTITY });
  const unavailable = await fixture([]).service.runMemoryReadonly({ operationId: 'op', interactionId: 'ix', identity: IDENTITY });
  assert.equal(partial.sourceStatus, 'partial'); assert.equal(partial.itemsCount, 1); assert.deepEqual(partial.topics, []);
  assert.equal(unavailable.sourceStatus, 'unavailable'); assert.equal(unavailable.itemsCount, 0); assert.deepEqual(unavailable.topics, []);
});

test('times out, sanitizes errors and always releases cleanup and lock', async () => {
  let cleanup = 0;
  const service = createMemoryReadonlyService({
    memoryEngine: { getRecentMemory() { return new Promise(() => {}); } },
    createExecutiveRuntime() { return { cleanup() { cleanup += 1; } }; },
  });
  await assert.rejects(service.runMemoryReadonly({ operationId: 'op', interactionId: 'ix', identity: IDENTITY, timeoutMs: 10 }), (error) => error.code === 'memory_review_timeout' && !/stack|path|secret/i.test(error.message));
  assert.equal(cleanup, 1);
});

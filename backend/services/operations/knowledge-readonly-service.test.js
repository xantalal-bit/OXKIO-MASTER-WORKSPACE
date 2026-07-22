'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { createKnowledgeReadonlyService, SAFE_ASSET_QUERIES } = require('./knowledge-readonly-service');
const IDENTITY = { clientId: 'cliente-cero', expectedClientId: 'cliente-cero', authorization: { status: 'granted' } };

function serviceWith(results, extra = {}) {
  const calls = [];
  let cleanup = 0;
  const service = createKnowledgeReadonlyService({
    createExecutiveRuntime(options) { assert.equal(options.mode, 'sandbox'); return { cleanup() { cleanup += 1; } }; },
    searchKnowledge(name, options) { calls.push([name, options]); return results[name] || { found: false }; },
    ...extra,
  });
  return { service, calls, cleanup: () => cleanup };
}

test('reviews only closed local assets with persist false and sanitized limits', async () => {
  const objects = Array.from({ length: 15 }, (_, index) => ({ metadata: { documentTypeClassification: { type: `Tema ${index}` } } }));
  const fixture = serviceWith({ XANTALAL: { found: true, asset: { domain: 'gobernanza' }, pipeline: { knowledgeObjects: objects, persistedKnowledge: [] } } });
  const result = await fixture.service.runKnowledgeReadonly({ operationId: 'op', interactionId: 'ix', identity: IDENTITY, query: 'ignored', path: 'ignored' });
  assert.deepEqual(fixture.calls.map(([name]) => name), [...SAFE_ASSET_QUERIES]);
  assert.ok(fixture.calls.every(([, options]) => options.persist === false && Object.keys(options).length === 1));
  assert.equal(fixture.calls.some(([name]) => /KNOWLEDGE-CURATOR/i.test(name)), false);
  assert.equal(result.sourceStatus, 'real');
  assert.equal(result.itemsCount, 10);
  assert.ok(result.topics.length <= 5);
  assert.ok(result.recommendations.length <= 3);
  assert.equal(fixture.cleanup(), 1);
  const serialized = JSON.stringify(result);
  ['path', 'content', 'document', 'payload', 'Tema 6'].forEach((value) => assert.equal(serialized.includes(value), false));
});

test('reports partial and unavailable without inventing items', async () => {
  const partial = serviceWith({ OXKIO: { found: true, asset: { domain: 'unknown' }, pipeline: { knowledgeObjects: [] } } });
  const partialResult = await partial.service.runKnowledgeReadonly({ operationId: 'op', interactionId: 'ix', identity: IDENTITY });
  assert.equal(partialResult.sourceStatus, 'partial');
  assert.equal(partialResult.itemsCount, 0);
  assert.deepEqual(partialResult.topics, []);
  const unavailable = serviceWith({});
  const unavailableResult = await unavailable.service.runKnowledgeReadonly({ operationId: 'op', interactionId: 'ix', identity: IDENTITY });
  assert.equal(unavailableResult.sourceStatus, 'unavailable');
  assert.equal(unavailableResult.itemsCount, 0);
});

test('times out, sanitizes errors and always cleans the sandbox', async () => {
  let cleanup = 0;
  const service = createKnowledgeReadonlyService({
    createExecutiveRuntime() { return { cleanup() { cleanup += 1; } }; },
    searchKnowledge() { return new Promise(() => {}); },
  });
  await assert.rejects(() => service.runKnowledgeReadonly({ operationId: 'op', interactionId: 'ix', identity: IDENTITY, timeoutMs: 10 }), /tardó más/i);
  assert.equal(cleanup, 1);
});

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildDecisionCacheKey, CostDecisionCache } = require('./cost-decision-cache');

test('buildDecisionCacheKey is deterministic and contains no raw fingerprint', () => {
  const input = { taskType: 'classification', capability: 'route', privacyClass: 'internal', residency: 'eu', policyVersion: 1, inputFingerprint: 'sensitive-derived-fingerprint', tags: ['b', 'a', 'a'] };
  const first = buildDecisionCacheKey(input);
  const second = buildDecisionCacheKey({ ...input, tags: ['a', 'b'] });
  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first.includes(input.inputFingerprint), false);
});

test('refuses cache keys without an explicit input fingerprint', () => {
  assert.equal(buildDecisionCacheKey({ taskType: 'classification' }), null);
});

test('expires entries at TTL and fails to a cache miss', () => {
  let now = 1000;
  const cache = new CostDecisionCache({ ttlMs: 100, now: () => now });
  cache.set('k', { level: 'small_model' });
  assert.deepEqual(cache.get('k'), { level: 'small_model' });
  now = 1100;
  assert.equal(cache.get('k'), null);
  assert.equal(cache.snapshotMetrics().misses, 1);
});

test('evicts the oldest entry when capacity is reached', () => {
  const cache = new CostDecisionCache({ maxEntries: 2 });
  cache.set('a', 1);
  cache.set('b', 2);
  cache.set('c', 3);
  assert.equal(cache.get('a'), null);
  assert.equal(cache.get('b'), 2);
  assert.equal(cache.get('c'), 3);
  assert.equal(cache.snapshotMetrics().evictions, 1);
});

test('tracks cache hits and avoided estimated external cost without storing prompts', () => {
  const cache = new CostDecisionCache();
  cache.set('safe-hash', { level: 'small_model' }, { estimatedCostUsd: 0.0125 });
  assert.deepEqual(cache.get('safe-hash'), { level: 'small_model' });
  assert.deepEqual(cache.get('safe-hash'), { level: 'small_model' });
  const metrics = cache.snapshotMetrics();
  assert.equal(metrics.hits, 2);
  assert.equal(metrics.writes, 1);
  assert.equal(metrics.avoidedEstimatedCostUsd, 0.025);
  assert.equal(metrics.size, 1);
});

test('supports explicit invalidation and clear for policy or context changes', () => {
  const cache = new CostDecisionCache();
  cache.set('a', 1);
  cache.set('b', 2);
  assert.equal(cache.invalidate('a'), true);
  assert.equal(cache.get('a'), null);
  assert.equal(cache.clear(), 1);
  const metrics = cache.snapshotMetrics();
  assert.equal(metrics.invalidations, 2);
  assert.equal(metrics.size, 0);
});

test('invalidateGroup removes only entries written under that group', () => {
  const cache = new CostDecisionCache();
  cache.set('a1', 1, { group: 'ctx-a' });
  cache.set('a2', 2, { group: 'ctx-a' });
  cache.set('b1', 3, { group: 'ctx-b' });
  cache.set('loose', 4);
  assert.equal(cache.invalidateGroup('ctx-a'), 2);
  assert.equal(cache.get('a1'), null);
  assert.equal(cache.get('b1'), 3);
  assert.equal(cache.get('loose'), 4);
  assert.equal(cache.invalidateGroup(''), 0);
  assert.equal(cache.snapshotMetrics().invalidations, 2);
});

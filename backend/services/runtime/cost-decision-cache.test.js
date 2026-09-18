'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildDecisionCacheKey, CostDecisionCache } = require('./cost-decision-cache');

test('buildDecisionCacheKey is deterministic and contains no raw fingerprint', () => {
  const input = {
    taskType: 'classification', capability: 'route', privacyClass: 'internal', residency: 'eu',
    policyVersion: 1, inputFingerprint: 'sensitive-derived-fingerprint', tags: ['b', 'a', 'a'],
  };
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
});

test('evicts the oldest entry when capacity is reached', () => {
  const cache = new CostDecisionCache({ maxEntries: 2 });
  cache.set('a', 1);
  cache.set('b', 2);
  cache.set('c', 3);
  assert.equal(cache.get('a'), null);
  assert.equal(cache.get('b'), 2);
  assert.equal(cache.get('c'), 3);
});

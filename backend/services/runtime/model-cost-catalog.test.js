'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_CATALOG, normalizeCatalog, estimateCatalogCostUsd } = require('./model-cost-catalog');

test('default catalog contains only zero-cost local deterministic capability', () => {
  assert.deepEqual(Object.keys(DEFAULT_CATALOG), ['local_deterministic']);
  assert.equal(estimateCatalogCostUsd(DEFAULT_CATALOG, 'local_deterministic', { inputTokens: 1000000, outputTokens: 1000000 }), 0);
});

test('estimates cost from reviewed catalog rates instead of caller-provided avoided cost', () => {
  const catalog = {
    small: { provider: 'example', tier: 'small', inputUsdPerMillion: 1, outputUsdPerMillion: 2, residency: 'eu', privacy: 'api' },
  };
  assert.equal(estimateCatalogCostUsd(catalog, 'small', { inputTokens: 1000, outputTokens: 500 }), 0.002);
});

test('unknown model fails closed with null cost', () => {
  assert.equal(estimateCatalogCostUsd(DEFAULT_CATALOG, 'missing', { inputTokens: 1000 }), null);
});

test('invalid or negative rates are excluded from normalized catalog', () => {
  const normalized = normalizeCatalog({
    bad: { inputUsdPerMillion: -1, outputUsdPerMillion: 2 },
    alsoBad: { inputUsdPerMillion: 1, outputUsdPerMillion: Number.NaN },
  });
  assert.deepEqual(normalized, {});
});

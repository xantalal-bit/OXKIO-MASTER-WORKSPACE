'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_CATALOG, normalizeCatalog, estimateCatalogCostUsd } = require('./model-cost-catalog');

function reviewed(overrides = {}) {
  return {
    provider: 'example', tier: 'small', inputUsdPerMillion: 1, outputUsdPerMillion: 2,
    residency: 'eu', privacy: 'api', pricingVersion: '2026-09-v1',
    pricingSource: 'https://example.invalid/pricing', reviewedAt: '2026-09-21', ...overrides,
  };
}

test('default catalog contains only zero-cost local deterministic capability with provenance', () => {
  assert.deepEqual(Object.keys(DEFAULT_CATALOG), ['local_deterministic']);
  assert.equal(DEFAULT_CATALOG.local_deterministic.pricingVersion, 'builtin-zero-v1');
  assert.equal(estimateCatalogCostUsd(DEFAULT_CATALOG, 'local_deterministic', { inputTokens: 1000000, outputTokens: 1000000 }), 0);
});

test('estimates cost only from reviewed catalog rates', () => {
  const catalog = { small: reviewed() };
  assert.equal(estimateCatalogCostUsd(catalog, 'small', { inputTokens: 1000, outputTokens: 500 }), 0.002);
});

test('unknown model fails closed with null cost', () => {
  assert.equal(estimateCatalogCostUsd(DEFAULT_CATALOG, 'missing', { inputTokens: 1000 }), null);
});

test('invalid or negative rates are excluded from normalized catalog', () => {
  const normalized = normalizeCatalog({
    bad: reviewed({ inputUsdPerMillion: -1 }),
    alsoBad: reviewed({ outputUsdPerMillion: Number.NaN }),
  });
  assert.deepEqual(normalized, {});
});

test('external pricing without provenance is excluded fail closed', () => {
  const normalized = normalizeCatalog({
    noVersion: reviewed({ pricingVersion: '' }),
    noSource: reviewed({ pricingSource: '' }),
    badDate: reviewed({ reviewedAt: 'today' }),
  });
  assert.deepEqual(normalized, {});
  assert.equal(estimateCatalogCostUsd({ unreviewed: { provider: 'x', inputUsdPerMillion: 1, outputUsdPerMillion: 1 } }, 'unreviewed', { inputTokens: 1000 }), null);
});

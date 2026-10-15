'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCostLedger } = require('./cost-ledger');

// Deterministic isolated store: these tests cover sequential mission limits.
// Multi-process atomicity and partially failed settlements are separate,
// still-open defects and MUST NOT be inferred from these assertions.
function storeFixture() {
  const rows = new Map();
  let sequence = 0;
  const key = (kind, id) => JSON.stringify([kind, id]);
  return {
    get(_handle, kind, id) {
      const row = rows.get(key(kind, id));
      if (!row) throw Object.assign(new Error('resource_not_found'), { code: 'resource_not_found' });
      return structuredClone(row);
    },
    put(_handle, kind, id, value) {
      rows.set(key(kind, id), structuredClone(value));
    },
    list(_handle, kind) {
      return [...rows].filter(([k]) => JSON.parse(k)[0] === kind).map(([, value]) => structuredClone(value));
    },
    newId() { return 'token-' + ++sequence; },
  };
}
const catalog = {
  'openai:fixture': {
    provider: 'openai', tier: 'small_model',
    inputUsdPerMillion: 1, outputUsdPerMillion: 1,
    pricingVersion: 'test', pricingSource: 'fixture', reviewedAt: '2026-10-10',
  },
};
function fixture() {
  let date = '2026-10-14';
  const store = storeFixture();
  const ledger = createCostLedger({
    store, catalog,
    policy: { missionBudgetUsd: 0.25, dailyBudgetUsd: 1 },
    now: () => date + 'T10:00:00.000Z',
  });
  const reserve = (missionId, estimatedUsd) =>
    ledger.reserve('owner', { missionId, modelId: 'openai:fixture', estimatedUsd, approvedDailyBudgetUsd: 1 });
  return { ledger, reserve, nextDay() { date = '2026-10-15'; } };
}

test('mission limit counts same-day pending reservations, not only settled charges', () => {
  const { ledger, reserve } = fixture();
  reserve('mission-one', 0.20);
  assert.throws(() => reserve('mission-one', 0.20), { code: 'planning_budget_gate' });
  assert.equal(ledger.owner('owner')[0].openReservations, 1);
});

test('mission limit counts pending reservations across calendar days', () => {
  const { ledger, reserve, nextDay } = fixture();
  reserve('mission-one', 0.20);
  nextDay();
  assert.throws(() => reserve('mission-one', 0.20), { code: 'planning_budget_gate' });
  assert.equal(ledger.owner('owner').reduce((n, day) => n + day.openReservations, 0), 1);
});

test('mission reservations remain scoped; settled charges still count', () => {
  const { ledger, reserve } = fixture();
  const first = reserve('mission-one', 0.20);
  reserve('mission-two', 0.20);
  ledger.settle('owner', first);
  assert.throws(() => reserve('mission-one', 0.20), { code: 'planning_budget_gate' });
  assert.equal(ledger.mission('owner', 'mission-one').chargedUsd, 0.20);
});

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { buildExecutiveFusion, MAX_HEADLINE, MAX_PRIORITIES } = require('./executive-fusion-engine');

const NOW = '2026-07-23T16:00:00.000Z';

function buildInput(overrides = {}) {
  return {
    generatedAt: NOW,
    agenda: { available: false, events: [] },
    gmail: { available: false, unread: 0, important: 0 },
    memory: { counters: { shortTermItems: 0 } },
    ecosystem: { ecosystem: { items: 0 } },
    operations: { recentOperations: [] },
    ...overrides,
  };
}

test('returns unavailable without usable data', () => {
  const result = buildExecutiveFusion(buildInput());
  assert.equal(result.status, 'unavailable');
  assert.deepEqual(result.priorities, []);
  assert.deepEqual(result.sourcesUsed, []);
  assert.equal(result.generatedAt, NOW);
});

test('returns partial with one valid source', () => {
  const result = buildExecutiveFusion(buildInput({
    agenda: { available: true, events: [{ title: 'Reunión de equipo' }] },
  }));
  assert.equal(result.status, 'partial');
  assert.deepEqual(result.sourcesUsed, ['Agenda']);
  assert.equal(result.priorities.length, 1);
});

test('returns ready with several valid sources and prioritizes calendar then mail', () => {
  const result = buildExecutiveFusion(buildInput({
    agenda: { available: true, events: [{ title: 'Reunión de equipo' }] },
    gmail: { available: true, unread: 2, important: 1 },
    memory: { counters: { shortTermItems: 4 } },
  }));
  assert.equal(result.status, 'ready');
  assert.match(result.priorities[0], /compromiso/i);
  assert.match(result.priorities[1], /importante/i);
  assert.deepEqual(result.sourcesUsed.slice(0, 2), ['Agenda', 'Correo']);
});

test('limits priorities to three and emits one recommendation', () => {
  const result = buildExecutiveFusion(buildInput({
    agenda: { available: true, events: [{ title: 'Agenda' }] },
    gmail: { available: true, unread: 2, important: 1 },
    memory: { counters: { shortTermItems: 4 } },
    ecosystem: { ecosystem: { items: 7 } },
    operations: {
      recentOperations: [
        { status: 'failed' },
        { status: 'completed', result: { opportunities: [{ title: 'Mercado' }] } },
      ],
    },
  }));
  assert.equal(result.priorities.length, MAX_PRIORITIES);
  assert.equal(typeof result.recommendation, 'string');
  assert.ok(result.recommendation.length > 0);
  assert.equal(Object.keys(result).filter((key) => key === 'recommendation').length, 1);
});

test('deduplicates repeated operational signals', () => {
  const result = buildExecutiveFusion(buildInput({
    operations: {
      recentOperations: [
        { status: 'failed' },
        { status: 'failed' },
        { status: 'completed_with_warnings' },
        { status: 'completed_with_warnings' },
      ],
    },
  }));
  assert.equal(result.priorities.length, 2);
  assert.equal(new Set(result.priorities).size, result.priorities.length);
});

test('a failed source does not block useful sources', () => {
  const result = buildExecutiveFusion(buildInput({
    gmail: { available: false, unread: 0, important: 0 },
    agenda: { available: true, events: [{ title: 'Compromiso' }] },
    operations: { recentOperations: [{ status: 'failed' }] },
  }));
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.sourcesUsed, ['Agenda', 'Operaciones']);
});

test('keeps output brief, sanitized and free of technical fields', () => {
  const result = buildExecutiveFusion(buildInput({
    agenda: {
      available: true,
      events: [{ title: 'calendar-readonly C:\\private\\secret token@example.com' }],
    },
    gmail: { available: true, unread: 1, important: 0 },
  }));
  const serialized = JSON.stringify(result);
  assert.ok(result.headline.length <= MAX_HEADLINE);
  ['worker', 'sourceStatus', 'operationId', 'interactionId', 'executionEnabled', 'C:\\', '@example.com', '-readonly']
    .forEach((value) => assert.equal(serialized.includes(value), false));
});

test('is deterministic, immutable and does not mutate input', () => {
  const input = buildInput({
    agenda: { available: true, events: [{ title: 'Reunión' }] },
  });
  const before = JSON.stringify(input);
  const first = buildExecutiveFusion(input);
  const second = buildExecutiveFusion(input);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(input), before);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.priorities), true);
});

test('has no worker, provider, store, persistence or external-call dependencies', () => {
  const source = fs.readFileSync(path.join(__dirname, 'executive-fusion-engine.js'), 'utf8');
  assert.doesNotMatch(source, /OperationsCoordinator|runCalendar|runGmail|fetch\(|https?:|approvalQueue|save|writeFile|setInterval|setTimeout/);
  assert.doesNotMatch(source, /require\(['"][^'"]+['"]\)/);
});

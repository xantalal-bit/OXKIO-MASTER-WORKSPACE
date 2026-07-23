'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { buildMorningBriefing } = require('./morning-briefing');

const NOW = '2026-07-19T08:00:00.000Z';

function completeState(overrides = {}) {
  return {
    agenda: {
      source: 'calendar', available: true,
      events: [{ title: 'Private event', location: 'Private room' }],
    },
    gmail: {
      source: 'gmail', available: true, unread: 2, important: 1,
      recent: [{ from: 'private@example.test', subject: 'Private subject', body: 'secret' }],
    },
    automations: {
      source: 'approval-queue', available: true, pending: 3, approved: 1,
      recent: [{ executionPayload: { secret: true }, payloadHash: 'secret-hash' }],
    },
    memory: {
      source: 'runtime-memory', counters: { shortTermItems: 4, longTermItems: 8 },
      raw: 'private memory',
    },
    ecosystem: {
      businessHunter: { source: 'knowledge-inventory', available: true, status: 'active', items: 2 },
      xose: { source: 'knowledge-inventory', available: true, status: 'active', items: 1 },
      ecosystem: { source: 'knowledge-inventory', available: true, status: 'active', items: 6 },
    },
    ...overrides,
  };
}

test('builds stable priorities only from real aggregated sources', () => {
  const result = buildMorningBriefing(completeState(), { now: NOW });

  assert.equal(result.title, 'Resumen ejecutivo del día');
  assert.equal(result.available, true);
  assert.equal(result.generatedAt, NOW);
  assert.deepEqual(result.sourceStatus, {
    gmail: 'real', calendar: 'real', approvals: 'real', memory: 'real', ecosystem: 'real',
  });
  assert.deepEqual(result.priorities.map(({ type, confidence }) => ({ type, confidence })), [
    { type: 'calendar', confidence: 'high' },
    { type: 'approval', confidence: 'high' },
    { type: 'gmail', confidence: 'high' },
    { type: 'memory', confidence: 'medium' },
    { type: 'ecosystem', confidence: 'medium' },
  ]);
  assert.equal(result.priorities.length, 5);
  assert.equal(result.alerts.length, 0);
  assert.match(result.summary, /3 compromisos pendientes/);
  assert.match(result.summary, /1 evento próximo/);
});

test('distinguishes empty real sources from unavailable sources', () => {
  const emptyReal = completeState({
    agenda: { source: 'calendar', available: true, events: [] },
    gmail: { source: 'gmail', available: true, unread: 0, important: 0, recent: [] },
    automations: { source: 'approval-queue', available: true, pending: 0, approved: 0 },
    memory: { source: 'runtime-memory', counters: { shortTermItems: 0, longTermItems: 0 } },
    ecosystem: {
      businessHunter: { source: 'knowledge-inventory', available: true, status: 'inactive', items: 0 },
      xose: { source: 'knowledge-inventory', available: true, status: 'inactive', items: 0 },
      ecosystem: { source: 'knowledge-inventory', available: true, status: 'inactive', items: 0 },
    },
  });
  const unavailable = completeState({
    agenda: { source: 'fallback', available: false, events: [{ title: 'Mock' }] },
    gmail: { source: 'unavailable', available: false, unread: 0, important: 0 },
    automations: { source: 'unavailable', available: false, pending: 0, approved: 0 },
    memory: { source: 'unavailable', counters: { shortTermItems: 0 } },
    ecosystem: {},
  });

  const realResult = buildMorningBriefing(emptyReal, { now: NOW });
  const unavailableResult = buildMorningBriefing(unavailable, { now: NOW });
  assert.deepEqual(realResult.priorities, []);
  assert.deepEqual(realResult.alerts, []);
  assert.equal(realResult.sourceStatus.gmail, 'real');
  assert.deepEqual(unavailableResult.priorities, []);
  assert.equal(unavailableResult.alerts.length, 5);
  assert.deepEqual(unavailableResult.sourceStatus, {
    gmail: 'unavailable', calendar: 'unavailable', approvals: 'unavailable',
    memory: 'unavailable', ecosystem: 'unavailable',
  });
});

test('classifies partial ecosystem and emits one explicit degraded alert', () => {
  const state = completeState();
  state.ecosystem.xose.status = 'partial';
  const result = buildMorningBriefing(state, { now: NOW });

  assert.equal(result.sourceStatus.ecosystem, 'partial');
  assert.equal(result.priorities.find((item) => item.type === 'ecosystem').confidence, 'low');
  assert.deepEqual(result.alerts, [{
    type: 'source_degraded',
    message: 'El ecosistema tiene información parcial.',
    source: 'ecosystem',
  }]);
});

test('never exposes detailed or internal source data', () => {
  const serialized = JSON.stringify(buildMorningBriefing(completeState(), { now: NOW }));
  [
    'Private event', 'Private room', 'private@example.test', 'Private subject',
    'secret-hash', 'executionPayload', 'payloadHash', 'private memory',
    'snippet', 'token', 'stack', 'C:\\', '/home/',
  ].forEach((term) => assert.equal(serialized.includes(term), false));
  assert.deepEqual(Object.keys(JSON.parse(serialized)).sort(), [
    'alerts', 'available', 'generatedAt', 'priorities', 'sourceStatus', 'summary', 'title',
  ]);
});

test('fails closed with an ISO timestamp when total construction throws', () => {
  const broken = new Proxy({}, { get() { throw new Error('sensitive stack'); } });
  const result = buildMorningBriefing(broken, { now: NOW });

  assert.deepEqual(result, {
    title: 'Resumen ejecutivo del día',
    summary: 'No se pudo generar el resumen ejecutivo.',
    priorities: [],
    alerts: [],
    sourceStatus: {
      gmail: 'unavailable', calendar: 'unavailable', approvals: 'unavailable',
      memory: 'unavailable', ecosystem: 'unavailable',
    },
    generatedAt: NOW,
    available: false,
  });
  assert.equal(new Date(result.generatedAt).toISOString(), result.generatedAt);
});

test('frontend renders only unified executive fusion with safe DOM operations', () => {
  const html = fs.readFileSync(
    path.resolve(__dirname, '../../../app/executive-dashboard.html'),
    'utf8',
  );
  const renderer = html.slice(
    html.indexOf('function renderTextList'),
    html.indexOf('function applyDashboardState'),
  );

  assert.match(renderer, /briefing\.headline/);
  assert.match(renderer, /briefing\.priorities/);
  assert.match(renderer, /briefing\.recommendation/);
  assert.doesNotMatch(renderer, /briefing\.(alerts|sourceStatus|generatedAt)/);
  assert.match(renderer, /textContent/);
  assert.match(renderer, /replaceChildren/);
  assert.doesNotMatch(renderer, /innerHTML/);
  assert.doesNotMatch(renderer, /JSON\.stringify/);
});

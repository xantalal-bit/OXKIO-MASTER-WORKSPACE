'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { getAutomations, MAX_RECENT } = require('./automations-provider');

function queueWith(pending, history) {
  return {
    listPending: () => pending,
    getHistory: () => history,
  };
}

function record(id, status, date, proposal = {}) {
  return {
    id,
    interactionId: `interaction-${id}`,
    status,
    createdAt: date,
    publicProposal: {
      type: 'email_draft',
      summary: `Summary ${id}`,
      ...proposal,
    },
    executionPayload: { to: 'secret@example.com', subject: 'Secret', body: 'Secret' },
    payloadHash: 'secret-hash',
    context: { secret: true },
  };
}

test('counts every public Approval Queue state and maps execution_failed to failed', () => {
  const result = getAutomations('ignored', queueWith(
    [record('1', 'pending', '2026-01-01T00:00:00.000Z')],
    [
      record('2', 'approved', '2026-01-02T00:00:00.000Z'),
      record('3', 'executing', '2026-01-03T00:00:00.000Z'),
      record('4', 'executed', '2026-01-04T00:00:00.000Z'),
      record('5', 'execution_failed', '2026-01-05T00:00:00.000Z'),
      record('6', 'rejected', '2026-01-06T00:00:00.000Z'),
      record('7', 'legacy_unknown', '2026-01-07T00:00:00.000Z'),
    ],
  ));

  assert.equal(result.title, 'Compromisos ejecutivos');
  assert.deepEqual(
    {
      pending: result.pending,
      approved: result.approved,
      executing: result.executing,
      executed: result.executed,
      failed: result.failed,
      rejected: result.rejected,
    },
    { pending: 1, approved: 1, executing: 1, executed: 1, failed: 1, rejected: 1 },
  );
  assert.equal(result.source, 'approval-queue');
  assert.equal(result.available, true);
});

test('limits and sorts recent public records from newest to oldest', () => {
  const records = Array.from({ length: 8 }, (_, index) => (
    record(String(index), 'executed', `2026-01-0${index + 1}T00:00:00.000Z`)
  ));
  const result = getAutomations(null, queueWith([], records));

  assert.equal(result.recent.length, MAX_RECENT);
  assert.deepEqual(result.recent.map((item) => item.id), ['7', '6', '5', '4', '3']);
});

test('normalizes legacy records and applies safe fallbacks', () => {
  const result = getAutomations(null, queueWith([], [{
    id: 'legacy-1',
    status: 'approved',
    createdAt: 'invalid-date',
    proposal: { type: 'task_proposal' },
  }, {
    id: 'legacy-2',
    status: 'pending',
    proposal: {},
  }]));

  const task = result.recent.find((item) => item.id === 'legacy-1');
  const unknown = result.recent.find((item) => item.id === 'legacy-2');
  assert.equal(task.interactionId, null);
  assert.equal(task.summary, 'Propuesta de tarea');
  assert.equal(task.updatedAt, 'invalid-date');
  assert.equal(unknown.type, 'unknown');
  assert.equal(unknown.summary, 'Compromiso ejecutivo');
});

test('fails closed when either public Approval Queue view is unavailable', () => {
  const failures = [
    null,
    { listPending() { throw new Error('private failure'); }, getHistory() { return []; } },
    { listPending() { return []; }, getHistory() { throw new Error('private failure'); } },
    { listPending() { return {}; }, getHistory() { return []; } },
  ];

  failures.forEach((approvalQueue) => {
    const result = getAutomations(null, approvalQueue);
    assert.deepEqual(result, {
      title: 'Compromisos ejecutivos',
      pending: 0,
      approved: 0,
      executing: 0,
      executed: 0,
      failed: 0,
      rejected: 0,
      recent: [],
      source: 'unavailable',
      available: false,
    });
  });
});

test('returns only whitelisted public metadata and never exposes executable fields', () => {
  const result = getAutomations(null, queueWith(
    [record('safe', 'pending', '2026-01-01T00:00:00.000Z')],
    [],
  ));
  const serialized = JSON.stringify(result);

  ['executionPayload', 'payloadHash', 'context', 'secret@example.com', 'subject', 'body', 'replyMessageId', 'threadId']
    .forEach((forbidden) => assert.equal(serialized.includes(forbidden), false));
  assert.deepEqual(Object.keys(result.recent[0]).sort(), [
    'createdAt', 'id', 'interactionId', 'status', 'summary', 'type', 'updatedAt',
  ]);
});

test('dashboard and frontend use the shared public provider without changing other fields', () => {
  const dashboardSource = fs.readFileSync(
    path.join(__dirname, '..', 'dashboard-intelligence.js'),
    'utf8',
  );
  const serverSource = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', 'api', 'server.js'),
    'utf8',
  );
  const html = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', '..', 'app', 'executive-dashboard.html'),
    'utf8',
  );
  const renderStart = html.indexOf('function renderCommitments');
  const renderEnd = html.indexOf('function getExecutiveResponse', renderStart);
  const renderer = html.slice(renderStart, renderEnd);

  assert.match(dashboardSource, /getAutomations\(timestamp, options\.approvalQueue\)/);
  assert.match(serverSource, /getDashboardState\(\{[\s\S]*approvalQueue[\s\S]*operationsStatus:/);
  ['greeting', 'executiveStatus', 'agenda', 'gmail', 'memory', 'automations']
    .forEach((field) => assert.match(dashboardSource, new RegExp(`\\b${field}\\b`)));
  assert.match(renderer, /replaceChildren\(\)/);
  assert.match(renderer, /textContent/);
  assert.doesNotMatch(renderer, /innerHTML/);
  assert.match(renderer, /slice\(0, 5\)/);
  assert.match(renderer, /Sin compromisos pendientes/);
});

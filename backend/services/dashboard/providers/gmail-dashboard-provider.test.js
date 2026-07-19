'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { getGmail, normalizeMessage } = require('./gmail-dashboard-provider');

function context(messages) {
  return { privatePayload: { source: 'gmail', messages } };
}

function message(id, date, overrides = {}) {
  return {
    id,
    from: `Sender ${id}`,
    subject: `Subject ${id}`,
    date,
    unread: false,
    important: false,
    ...overrides,
  };
}

test('aggregates a simulated successful readonly Gmail query', async () => {
  let calls = 0;
  const result = await getGmail(null, async () => {
    calls += 1;
    return context([
      message('1', '2026-07-01T10:00:00.000Z', { unread: true }),
      message('2', '2026-07-02T10:00:00.000Z', { important: true }),
      message('3', '2026-07-03T10:00:00.000Z', { unread: true, important: true }),
    ]);
  });

  assert.equal(calls, 1);
  assert.equal(result.available, true);
  assert.equal(result.source, 'gmail');
  assert.equal(result.unread, 2);
  assert.equal(result.important, 2);
  assert.equal(result.recentCount, 3);
  assert.equal(result.errorCode, null);
  assert.deepEqual(result.recent.map((item) => item.id), ['3', '2', '1']);
});

test('limits recent messages to five and counts only included messages', async () => {
  const messages = Array.from({ length: 8 }, (_, index) => message(
    String(index),
    `2026-07-${String(index + 1).padStart(2, '0')}T10:00:00.000Z`,
    { unread: true, important: true },
  ));
  const result = await getGmail(null, () => context(messages));

  assert.equal(result.recent.length, 5);
  assert.equal(result.recentCount, 5);
  assert.equal(result.unread, 5);
  assert.equal(result.important, 5);
  assert.deepEqual(result.recent.map((item) => item.id), ['7', '6', '5', '4', '3']);
});

test('normalizes and sanitizes allowed Gmail metadata', () => {
  const normalized = normalizeMessage({
    id: '',
    from: 'Sender\r\nInjected\u0000'.repeat(30),
    subject: '',
    date: 'invalid-date',
    unread: true,
    important: true,
    body: 'private body',
    snippet: 'private snippet',
    attachments: [{ name: 'private.pdf' }],
    headers: [{ name: 'Secret' }],
    payload: { secret: true },
  });

  assert.equal(normalized.id, null);
  assert.equal(normalized.from.includes('\r'), false);
  assert.equal(normalized.from.includes('\n'), false);
  assert.ok(normalized.from.length <= 160);
  assert.equal(normalized.subject, 'Sin asunto');
  assert.equal(normalized.receivedAt, null);
  assert.equal(normalized.unread, true);
  assert.equal(normalized.important, true);
  assert.deepEqual(Object.keys(normalized), [
    'id', 'from', 'subject', 'receivedAt', 'unread', 'important',
  ]);
  const serialized = JSON.stringify(normalized);
  ['private body', 'private snippet', 'private.pdf', 'headers', 'payload']
    .forEach((forbidden) => assert.equal(serialized.includes(forbidden), false));
});

test('maps OAuth, token, HTTP, service, and generic errors safely', async () => {
  const cases = [
    [{ code: 'google_oauth_not_configured' }, 'gmail_oauth_not_configured'],
    [{ code: 'oauth_token_missing' }, 'gmail_token_unavailable'],
    [{ status: 401 }, 'gmail_unauthorized'],
    [{ response: { status: 403 } }, 'gmail_unauthorized'],
    [{ status: 429 }, 'gmail_rate_limited'],
    [{ status: 500 }, 'gmail_service_error'],
    [{ status: 503 }, 'gmail_service_error'],
    [new Error('private internal message'), 'gmail_unavailable'],
  ];

  for (const [error, expectedCode] of cases) {
    const result = await getGmail(null, () => Promise.reject(error));
    assert.deepEqual(result, {
      title: 'Gmail',
      unread: 0,
      important: 0,
      recentCount: 0,
      recent: [],
      source: 'unavailable',
      available: false,
      stale: false,
      errorCode: expectedCode,
    });
    assert.equal(JSON.stringify(result).includes('private internal message'), false);
  }
});

test('times out locally and fails closed without a mock fallback', async () => {
  const result = await getGmail(null, () => new Promise(() => {}), { timeoutMs: 5 });

  assert.equal(result.available, false);
  assert.equal(result.source, 'unavailable');
  assert.equal(result.errorCode, 'gmail_timeout');
  assert.deepEqual(result.recent, []);
});

test('invalid responses and missing dependency do not break the dashboard', async () => {
  for (const reader of [undefined, () => null, () => ({}), () => ({ privatePayload: { messages: {} } })]) {
    const result = await getGmail(null, reader);
    assert.equal(result.available, false);
    assert.equal(result.source, 'unavailable');
    assert.equal(result.recentCount, 0);
    assert.deepEqual(result.recent, []);
  }
});

test('dashboard injection is lazy and frontend renders only whitelisted Gmail data', () => {
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
  const renderStart = html.indexOf('function renderGmailWidget');
  const renderEnd = html.indexOf('function getExecutiveResponse', renderStart);
  const renderer = html.slice(renderStart, renderEnd);

  assert.match(dashboardSource, /getGmail\(timestamp, options\.gmailReader\)/);
  assert.match(serverSource, /const dashboardGmailReader = \(\) => buildGmailPrivateContext/);
  assert.match(serverSource, /pathname === ["']\/api\/dashboard["'][\s\S]*gmailReader: dashboardGmailReader/);
  assert.match(renderer, /gmail\.available !== true \|\| gmail\.source !== ["']gmail["']/);
  assert.match(renderer, /Gmail no disponible/);
  assert.match(renderer, /textContent/);
  assert.doesNotMatch(renderer, /innerHTML|body|snippet|attachments|payload/);
  assert.doesNotMatch(renderer, /createDraft|sendEmail|sendMail|replyMessage/);
  ['Estado general', 'Agenda', 'Compromisos Ejecutivos', 'Memoria ejecutiva', 'Business Hunter', 'Xose', 'Estado del Ecosistema']
    .forEach((heading) => assert.match(html, new RegExp(`<h2>${heading}<\\/h2>`)));
});

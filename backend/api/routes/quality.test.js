'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { QualityIncidentRegistry } = require('../../services/runtime/quality-incident-registry');
const { createQualityFeedbackService } = require('../../services/runtime/quality-feedback');
const { isApiRouteDeniedForIdentity } = require('../../security/api-route-policy');
const { isAuthorizedExecutiveIdentity } = require('./executive-approval');
const {
  handleQualityFeedbackRequest,
  handleQualitySummaryRequest,
  isQualityFeedbackRoute,
  isQualitySummaryRoute,
} = require('./quality');

const CLIENTE_CERO = Object.freeze({
  clientId: 'cliente-cero', userId: 'usuario-cliente-cero', expectedClientId: 'cliente-cero',
  authorization: { status: 'granted', provider: 'google-oauth' },
});
const FAMILY = Object.freeze({
  clientId: 'family-beta-uid-familiar', userId: 'uid-familiar', expectedClientId: 'cliente-cero',
  authorization: { status: 'granted', provider: 'firebase' },
});

function createRequest(body) {
  const request = new EventEmitter();
  process.nextTick(() => {
    if (body !== undefined) request.emit('data', Buffer.from(body));
    request.emit('end');
  });
  return request;
}

function createResponse() {
  return {
    statusCode: null,
    headers: null,
    body: '',
    writeHead(statusCode, headers) { this.statusCode = statusCode; this.headers = headers; },
    end(body) { this.body = body; },
    getJson() { return JSON.parse(this.body); },
  };
}

function seededRegistry() {
  const registry = new QualityIncidentRegistry();
  const gmail = {
    type: 'INTEGRATION_FAILURE', priority: 'P2', component: 'executive-chat.context.gmail',
    errorCode: 'gmail_unavailable', summary: 'Contexto de Gmail no disponible en Executive Chat.',
  };
  for (let index = 0; index < 8; index += 1) registry.report(gmail);
  registry.report({ type: 'TECHNICAL_BUG', priority: 'P0', component: 'security.secrets', summary: 'Posible secreto en un log.' });
  registry.report({ type: 'CAPABILITY_MISMATCH', component: 'user-feedback.should_be_able', relatedCapability: 'calendar.read', summary: 'Un usuario indicó que OXKIO debería poder hacerlo.' });
  const fixed = registry.report({ type: 'UX_FRICTION', component: 'executive-chat.ui', summary: 'Texto cortado.' });
  registry.resolve(fixed.id, { resolvedBy: 'human', resolution: 'Se ajustó el CSS.', prevention: 'Test visual añadido.' });
  return registry;
}

test('routes: exact paths and methods only', () => {
  assert.equal(isQualitySummaryRoute('/api/quality/summary', 'GET'), true);
  assert.equal(isQualitySummaryRoute('/api/quality/summary', 'POST'), false);
  assert.equal(isQualityFeedbackRoute('/api/quality/feedback', 'POST'), true);
  assert.equal(isQualityFeedbackRoute('/api/quality/feedback', 'GET'), false);
});

test('Manager: Cliente Cero reads the compact summary', () => {
  const response = createResponse();
  handleQualitySummaryRequest(createRequest(), response, { registry: seededRegistry(), getIdentity: () => CLIENTE_CERO });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['Cache-Control'], 'no-store');
  const data = response.getJson();
  assert.deepEqual(Object.keys(data).sort(), [
    'counts', 'incidents', 'module', 'ok', 'pendingHumanDecision', 'persistence', 'recentlyResolved', 'topRecurring',
  ]);
  assert.equal(data.persistence, 'QUALITY_PERSISTENCE_EPHEMERAL');
  assert.deepEqual(data.counts, { P0: 1, P1: 1, P2: 1, P3: 0 });
  assert.deepEqual(data.incidents.map((item) => item.priority), ['P0', 'P1', 'P2']);
  for (const item of data.incidents) {
    assert.deepEqual(Object.keys(item).sort(), [
      'component', 'id', 'lastSeenAt', 'occurrenceCount', 'priority', 'requiresHumanDecision', 'status', 'summary', 'type',
    ]);
  }
  assert.equal(data.topRecurring[0].occurrenceCount, 8);
  assert.deepEqual(data.pendingHumanDecision.map((item) => item.priority), ['P0']);
  assert.equal(data.recentlyResolved[0].prevention, 'Test visual añadido.');
});

test('Manager: family members, anonymous callers and broken identity resolvers get 403', () => {
  for (const getIdentity of [() => FAMILY, () => null, () => { throw new Error('boom'); }, undefined]) {
    const response = createResponse();
    handleQualitySummaryRequest(createRequest(), response, { registry: seededRegistry(), getIdentity });
    assert.equal(response.statusCode, 403);
    assert.equal(response.getJson().code, 'executive_authorization_denied');
    assert.equal(response.body.includes('QI-'), false);
  }
  // Also denied earlier by the default-deny API route policy.
  assert.equal(isApiRouteDeniedForIdentity('/api/quality/summary', isAuthorizedExecutiveIdentity, FAMILY), true);
  assert.equal(isApiRouteDeniedForIdentity('/api/quality/summary', isAuthorizedExecutiveIdentity, CLIENTE_CERO), false);
  assert.equal(isApiRouteDeniedForIdentity('/api/quality/feedback', isAuthorizedExecutiveIdentity, FAMILY), false);
});

test('Manager privacy: no query, conversation, identity, fingerprint or reporter data in the view', async () => {
  const registry = seededRegistry();
  const service = createQualityFeedbackService({ registry });
  service.submit({ category: 'wrong' }, { reporterId: 'firebase-uid-FAMILIAR-1' });
  const response = createResponse();
  handleQualitySummaryRequest(createRequest(), response, { registry, getIdentity: () => CLIENTE_CERO });
  for (const forbidden of [
    'FAMILIAR', 'firebase-uid', 'fingerprint', 'query', 'prompt', 'conversation', 'token', 'stack',
    'usuario-cliente-cero', 'executionPayload', 'reporter',
  ]) {
    assert.equal(response.body.includes(forbidden), false, forbidden);
  }
});

async function postFeedback(body, { reporterId = 'uid-familiar', feedbackService } = {}) {
  const response = createResponse();
  await handleQualityFeedbackRequest(createRequest(body), response, {
    feedbackService,
    getReporterId: () => reporterId,
  });
  return response;
}

test('feedback: a family member can report a problem; the response reveals nothing internal', async () => {
  const registry = new QualityIncidentRegistry();
  const feedbackService = createQualityFeedbackService({ registry });
  const response = await postFeedback(JSON.stringify({ category: 'wrong', shortSummary: 'La respuesta no tenía sentido.' }), { feedbackService });
  assert.equal(response.statusCode, 202);
  assert.deepEqual(Object.keys(response.getJson()).sort(), ['message', 'ok']);
  assert.equal(/QI-|P[0-3]|occurrence|USER_COMPLAINT/.test(response.body), false);
  assert.equal(registry.list()[0].type, 'USER_COMPLAINT');
});

test('feedback: invalid, sensitive, oversized, anonymous and flooding requests fail safely', async (t) => {
  t.mock.method(console, 'error', () => {});
  const registry = new QualityIncidentRegistry();
  const feedbackService = createQualityFeedbackService({ registry });
  const cases = [
    ['not json', 400],
    [JSON.stringify({ category: 'nope' }), 400],
    [JSON.stringify({ category: 'wrong', query: 'mi consulta completa' }), 400],
    [JSON.stringify({ category: 'wrong', shortSummary: 'Mi teléfono es +34 600 123 456' }), 400],
    [JSON.stringify({ category: 'wrong', shortSummary: 'x'.repeat(3000) }), 400],
  ];
  for (const [body, status] of cases) {
    const response = await postFeedback(body, { feedbackService });
    assert.equal(response.statusCode, status, body.slice(0, 40));
    assert.equal(response.body.includes('+34'), false);
  }
  assert.equal((await postFeedback(JSON.stringify({ category: 'wrong' }), { feedbackService, reporterId: null })).statusCode, 403);
  assert.equal((await postFeedback(JSON.stringify({ category: 'wrong' }), {})).statusCode, 503);
  assert.equal(registry.list().length, 0);

  let status = 202;
  for (let index = 0; index < 25 && status !== 429; index += 1) {
    status = (await postFeedback(JSON.stringify({ category: 'other' }), { feedbackService, reporterId: 'uid-flood' })).statusCode;
  }
  assert.equal(status, 429);
});

test('UI: the Manager block is read-only and the chat control sends only category, capability and summary', () => {
  const root = path.join(__dirname, '..', '..', '..', 'app');
  const dashboard = fs.readFileSync(path.join(root, 'executive-dashboard.html'), 'utf8');
  const start = dashboard.indexOf('function renderQualityList');
  const end = dashboard.indexOf('async function loadDashboardState', start);
  assert.ok(start > 0 && end > start);
  const qualityScript = dashboard.slice(start, end);
  assert.match(dashboard, /<h2>Calidad \/ Incidencias<\/h2>/);
  assert.match(qualityScript, /oxkioAuthenticatedFetch\("\/api\/quality\/summary", \{ cache: "no-store" \}\)/);
  assert.doesNotMatch(qualityScript, /method:\s*"POST"|resolve\(|markWontFix|markInProgress|repair|auto ?fix|innerHTML/i);
  assert.match(dashboard, /loadQualitySummary\(\);/);

  const chat = fs.readFileSync(path.join(root, 'js', 'executive-chat.js'), 'utf8');
  const chatStart = chat.indexOf('function appendQualityFeedback');
  const chatEnd = chat.indexOf('function renderExchange', chatStart);
  const feedbackScript = chat.slice(chatStart, chatEnd);
  assert.match(feedbackScript, /'\/api\/quality\/feedback'/);
  assert.match(feedbackScript, /'Esto no está bien'/);
  const body = feedbackScript.slice(feedbackScript.indexOf('JSON.stringify({'), feedbackScript.indexOf('}),', feedbackScript.indexOf('JSON.stringify({')));
  assert.match(body, /category: reason\.value/);
  assert.doesNotMatch(body, /query|response|conversation|priority|component|interactionId/);
  assert.doesNotMatch(feedbackScript, /innerHTML/);
});

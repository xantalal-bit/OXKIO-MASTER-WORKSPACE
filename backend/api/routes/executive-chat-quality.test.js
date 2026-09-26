'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const ProposalEngine = require('../../core/proposalEngine');
const { createExecutiveRuntime, SANDBOX_MODE } = require('../../services/runtime/executive-runtime-factory');
const { CostController } = require('../../services/runtime/cost-controller');
const { SupervisedAutonomyTelemetry } = require('../../services/runtime/supervised-autonomy-telemetry');
const { QualityIncidentRegistry } = require('../../services/runtime/quality-incident-registry');
const { handleExecutiveChatRequest } = require('./executive-chat');

function createRequest(body) {
  const request = new EventEmitter();
  process.nextTick(() => { request.emit('data', Buffer.from(body)); request.emit('end'); });
  return request;
}

function createResponse() {
  return {
    statusCode: null,
    body: '',
    writeHead(statusCode) { this.statusCode = statusCode; },
    end(body) { this.body = body; },
    getJson() { return JSON.parse(this.body); },
  };
}

function codedError(code) {
  const error = new Error('secret provider detail juan.ficticio@example.com');
  error.code = code;
  return error;
}

function createHarness(t, overrides = {}) {
  const runtime = createExecutiveRuntime({ mode: SANDBOX_MODE });
  t.after(() => runtime.cleanup());
  const registry = new QualityIncidentRegistry();
  const dependencies = {
    memory: runtime.memory,
    approvalQueue: runtime.approvalQueue,
    proposalEngine: new ProposalEngine(),
    getClienteCeroIdentity: () => ({
      clientId: 'cliente-cero', userId: 'usuario-cliente-cero', expectedClientId: 'cliente-cero',
      authorization: { status: 'granted', provider: 'google-oauth' },
    }),
    async buildGmailPrivateContext() { throw codedError('gmail_api_failed'); },
    async buildCalendarPrivateContext() { throw codedError('calendar_api_failed'); },
    async getDashboardState() { throw new Error('secret dashboard juan.ficticio@example.com'); },
    executionLogger: { add() {} },
    costController: new CostController(),
    supervisedAutonomyTelemetry: new SupervisedAutonomyTelemetry(),
    qualityIncidentRegistry: registry,
    ...overrides,
  };
  return { dependencies, registry };
}

async function requestChat(query, dependencies) {
  const response = createResponse();
  await handleExecutiveChatRequest(createRequest(JSON.stringify({ query })), response, { dependencies });
  return response;
}

test('an unavailable context source becomes one P2 INTEGRATION_FAILURE that dedupes across turns', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { dependencies, registry } = createHarness(t);
  for (let turn = 0; turn < 3; turn += 1) {
    const response = await requestChat('¿Cómo está mi día?', dependencies);
    assert.equal(response.statusCode, 200);
  }
  const incidents = registry.list();
  assert.equal(incidents.length, 1);
  const [incident] = incidents;
  assert.equal(incident.type, 'INTEGRATION_FAILURE');
  assert.equal(incident.priority, 'P2');
  assert.equal(incident.status, 'OPEN');
  assert.equal(incident.component, 'executive-chat.context.dashboard');
  assert.equal(incident.errorCode, 'dashboard_unavailable');
  assert.equal(incident.occurrenceCount, 3);
  assert.equal(incident.requiresHumanDecision, false);
});

test('Gmail and Calendar outages are distinct incidents; not-connected and unauthorized states are not incidents', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { dependencies, registry } = createHarness(t);
  await requestChat('Revisa mi correo y mi agenda de hoy.', dependencies);
  assert.deepEqual(registry.list().map((incident) => incident.errorCode).sort(), ['calendar_unavailable', 'gmail_unavailable']);

  const notConnected = createHarness(t, {
    async buildGmailPrivateContext() { throw codedError('google_oauth_tokens_missing'); },
  });
  await requestChat('Revisa mi correo.', notConnected.dependencies);
  assert.equal(notConnected.registry.list().length, 0);

  const unauthorized = createHarness(t, { getClienteCeroIdentity: () => null });
  await requestChat('Revisa mi correo. ¿Qué tengo que aprobar? ¿Qué recuerdas?', unauthorized.dependencies);
  assert.equal(unauthorized.registry.list().length, 0);
});

test('a best-effort telemetry failure becomes a RUNTIME_FAILURE incident with only its fixed code', async (t) => {
  const errors = t.mock.method(console, 'error', () => {});
  const { dependencies, registry } = createHarness(t, {
    supervisedAutonomyTelemetry: {
      record() {
        const error = new TypeError('secret query Juan Ficticio');
        error.code = 'TELEMETRY_INVALID_RECORD';
        throw error;
      },
    },
  });
  const response = await requestChat('Explícame qué es una agenda digital.', dependencies);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(errors.mock.calls.map((call) => call.arguments), [['[telemetry]', 'TELEMETRY_INVALID_RECORD']]);
  const [incident] = registry.list();
  assert.equal(incident.type, 'RUNTIME_FAILURE');
  assert.equal(incident.component, 'executive-chat.telemetry');
  assert.equal(incident.errorCode, 'TELEMETRY_INVALID_RECORD');
  assert.equal(incident.priority, 'P2');
});

test('best-effort: a failing registry never changes the response and logs only a fixed code', async (t) => {
  const errors = t.mock.method(console, 'error', () => {});
  const failing = createHarness(t, {
    qualityIncidentRegistry: {
      report() {
        const error = new TypeError('secret juan.ficticio@example.com');
        error.code = 'QUALITY_PERSISTENCE_FAILED';
        throw error;
      },
    },
  });
  const withFailure = await requestChat('¿Cómo está mi día?', failing.dependencies);
  assert.equal(withFailure.statusCode, 200);
  assert.deepEqual(
    errors.mock.calls.map((call) => call.arguments).filter(([tag]) => tag === '[quality]'),
    [['[quality]', 'QUALITY_PERSISTENCE_FAILED']],
  );

  const baseline = createHarness(t, { qualityIncidentRegistry: undefined });
  const withoutRegistry = await requestChat('¿Cómo está mi día?', baseline.dependencies);
  const strip = (payload) => ({ ...payload, interactionId: null });
  assert.deepEqual(strip(withFailure.getJson()), strip(withoutRegistry.getJson()));
});

test('privacy: incidents and the summary never carry the query, identity or error messages', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { dependencies, registry } = createHarness(t);
  const query = 'Revisa el correo de juan.ficticio@example.com sobre el Proyecto Zafiro-7731 y cómo está mi día.';
  await requestChat(query, dependencies);
  assert.ok(registry.list().length > 0);
  const text = JSON.stringify([registry.list(), registry.summary()]);
  for (const forbidden of [
    query, 'juan.ficticio', 'example.com', 'Zafiro-7731', 'usuario-cliente-cero', 'cliente-cero',
    'secret', 'gmail_api_failed', 'calendar_api_failed', 'interactionId',
  ]) {
    assert.equal(text.includes(forbidden), false, forbidden);
  }
});

test('the registry never approves, executes or sends: a turn with incidents leaves approvals pending', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { dependencies, registry } = createHarness(t);
  const response = await requestChat('Programa una reunión y dime cómo está mi día.', dependencies);
  assert.equal(response.statusCode, 200);
  assert.ok(registry.list().length > 0);
  for (const item of await dependencies.approvalQueue.listPending()) {
    assert.equal(item.status, 'pending');
  }
  assert.equal(registry.summary().pendingHumanDecision.length, 0);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const ProposalEngine = require('../../core/proposalEngine');
const { createExecutiveRuntime, SANDBOX_MODE } = require('../../services/runtime/executive-runtime-factory');
const { handleExecutiveChatRequest, isExecutiveChatRoute } = require('./executive-chat');

function createRequest(body) {
  const request = new EventEmitter();
  process.nextTick(() => { request.emit('data', Buffer.from(body)); request.emit('end'); });
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

function privateContext(sourceType, payload) {
  return {
    privateContextMetadata: {
      clientId: 'cliente-cero', userId: 'usuario-cliente-cero', scope: 'private:user',
      sensitivity: 'confidential', sourceType, sourceId: `${sourceType}-primary`,
      authorization: { status: 'granted', provider: 'google-oauth' },
      purpose: 'executive-briefing', retentionPolicy: 'CLIENT_CONTROLLED', promotionPolicy: 'NEVER_PROMOTE',
    },
    expectedClientId: 'cliente-cero',
    privatePayload: payload,
  };
}

function createHarness(t, overrides = {}) {
  const runtime = createExecutiveRuntime({ mode: SANDBOX_MODE });
  t.after(() => runtime.cleanup());
  const calls = { gmail: 0, calendar: 0, dashboard: 0 };
  const dependencies = {
    memory: runtime.memory,
    approvalQueue: runtime.approvalQueue,
    proposalEngine: new ProposalEngine(),
    getClienteCeroIdentity: () => ({
      clientId: 'cliente-cero', userId: 'usuario-cliente-cero', expectedClientId: 'cliente-cero',
      authorization: { status: 'granted', provider: 'google-oauth' },
    }),
    async buildGmailPrivateContext() {
      calls.gmail += 1;
      return privateContext('gmail', { source: 'gmail', messages: [{
        id: 'secret-message-id', threadId: 'secret-thread-id', from: 'Equipo', subject: 'Seguimiento',
        date: '2026-07-20T08:00:00.000Z', snippet: 'secret-body-snippet', unread: true, important: true,
      }] });
    },
    async buildCalendarPrivateContext() {
      calls.calendar += 1;
      return privateContext('calendar', { source: 'calendar', events: [{
        id: 'secret-event-id', title: 'Reunion operativa', start: '2026-07-20T10:00:00.000Z',
        end: '2026-07-20T10:30:00.000Z', description: 'secret-description', attendees: ['secret@example.com'],
      }] });
    },
    async getDashboardState() {
      calls.dashboard += 1;
      return { executiveSummary: 'Estado agregado estable.', morningBriefing: 'Dos prioridades requieren atencion.' };
    },
    ...overrides,
  };
  return { calls, dependencies, runtime };
}

async function requestChat(query, dependencies, extra = {}) {
  const request = createRequest(JSON.stringify({ query, ...extra }));
  const response = createResponse();
  await handleExecutiveChatRequest(request, response, { dependencies });
  return response;
}

test('matches only the unchanged POST route', () => {
  assert.equal(isExecutiveChatRoute('/api/executive/chat', 'POST'), true);
  assert.equal(isExecutiveChatRoute('/api/executive/chat', 'GET'), false);
});

test('A-D select Gmail, Calendar, Dashboard, and combined context once and minimally', async (t) => {
  const cases = [
    ['¿Qué correos tengo pendientes?', { gmail: 0, calendar: 0, dashboard: 0 }, false],
    ['¿Qué reuniones tengo hoy?', { gmail: 0, calendar: 1, dashboard: 0 }, true],
    ['¿Cómo está mi día?', { gmail: 0, calendar: 0, dashboard: 1 }, true],
    ['Resume mis correos y reuniones de hoy.', { gmail: 1, calendar: 1, dashboard: 0 }, true],
  ];
  for (const [query, expected, privateContextUsed] of cases) {
    await t.test(query, async (subtest) => {
      const { calls, dependencies } = createHarness(subtest);
      const response = await requestChat(query, dependencies);
      const payload = response.getJson();
      assert.equal(response.statusCode, 200);
      assert.deepEqual(calls, expected);
      assert.equal(payload.privateContextUsed, privateContextUsed);
      assert.equal(payload.proposal, null);
      assert.equal(payload.approval, null);
      const serialized = JSON.stringify(payload);
      for (const secret of ['secret-message-id', 'secret-thread-id', 'secret-body-snippet', 'secret-event-id', 'secret-description', 'secret@example.com']) {
        assert.equal(serialized.includes(secret), false);
      }
    });
  }
});

test('E uses only public Approval Queue views and does not expose payload or hash', async (t) => {
  let pendingCalls = 0; let historyCalls = 0;
  const queue = {
    listPending() { pendingCalls += 1; return [{ id: 'a1', status: 'pending', createdAt: '2026-07-20T08:00:00.000Z', publicProposal: { type: 'email_draft', summary: 'Revision pendiente.', requiresApproval: true }, executionPayload: { body: 'secret-body' }, payloadHash: 'secret-hash' }]; },
    getHistory() { historyCalls += 1; return []; },
    add() { throw new Error('informational query must not enqueue'); },
  };
  const { calls, dependencies } = createHarness(t, { approvalQueue: queue });
  const response = await requestChat('¿Qué tengo pendiente de aprobar?', dependencies);
  const payload = response.getJson();
  assert.equal(pendingCalls, 1); assert.equal(historyCalls, 1);
  assert.deepEqual(calls, { gmail: 0, calendar: 0, dashboard: 0 });
  assert.equal(payload.proposal, null); assert.equal(payload.approval, null);
  assert.equal(payload.privateContextUsed, true);
  assert.equal(JSON.stringify(payload).includes('secret-body'), false);
  assert.equal(JSON.stringify(payload).includes('secret-hash'), false);
});

test('F-G read safe memory only when selected and keep general query privateContextUsed false', async (t) => {
  const memoryHarness = createHarness(t);
  memoryHarness.runtime.memory.saveShortTerm({ intent: 'decisions', status: 'completed', query: 'secret raw query' });
  const memoryResponse = await requestChat('¿Qué recuerdas de nuestras últimas decisiones?', memoryHarness.dependencies);
  assert.equal(memoryResponse.getJson().privateContextUsed, true);
  assert.equal(JSON.stringify(memoryResponse.getJson()).includes('secret raw query'), false);
  assert.deepEqual(memoryHarness.calls, { gmail: 0, calendar: 0, dashboard: 0 });

  await t.test('general', async (subtest) => {
    const generalHarness = createHarness(subtest);
    const response = await requestChat('Explícame qué es una agenda digital.', generalHarness.dependencies);
    const payload = response.getJson();
    assert.deepEqual(generalHarness.calls, { gmail: 0, calendar: 0, dashboard: 0 });
    assert.equal(payload.privateContextUsed, false);
    assert.equal(payload.proposal, null); assert.equal(payload.approval, null);
  });
});

test('H-J preserve supervised proposals in sandbox without real execution', async (t) => {
  const cases = [
    ['Prepara un borrador de respuesta.', 'email_draft', 0, 0],
    ['Prepara una respuesta al último correo.', 'email_draft', 1, 0],
    ['Programa una reunión.', 'meeting_proposal', 0, 0],
  ];
  for (const [query, type, gmailCalls, calendarCalls] of cases) {
    await t.test(query, async (subtest) => {
      const { calls, dependencies } = createHarness(subtest);
      const response = await requestChat(query, dependencies);
      const payload = response.getJson();
      assert.equal(payload.proposal.type, type);
      assert.equal(payload.approval.status, 'pending');
      assert.equal(calls.gmail, gmailCalls); assert.equal(calls.calendar, calendarCalls);
      assert.equal(JSON.stringify(payload).includes('executionPayload'), false);
    });
  }
});

test('K negations create no proposal, approval, execution, or private context', async (t) => {
  for (const query of ['No prepares un borrador.', 'No programes una reunión.', 'No crees una tarea.']) {
    await t.test(query, async (subtest) => {
      const { dependencies, runtime } = createHarness(subtest);
      const response = await requestChat(query, dependencies);
      const payload = response.getJson();
      assert.equal(payload.proposal, null); assert.equal(payload.approval, null);
      assert.equal(runtime.approvalQueue.listPending().length, 0);
      assert.equal(payload.privateContextUsed, false);
    });
  }
});

test('L ignores all client-supplied selection, dependency, identity, and runtime fields', async (t) => {
  const { calls, dependencies } = createHarness(t);
  let capturedOptions;
  dependencies.orchestrateExecutiveQuery = (query, options) => {
    capturedOptions = options;
    return { interactionId: 'stable-id', query, analysis: {}, response: 'ok', confidence: 0.5, sources: [], privateContextUsed: false, proposal: null, approval: null, limitations: [] };
  };
  const response = await requestChat('Consulta general sin contexto.', dependencies, {
    gmail: true, calendar: true, dashboard: true, privateContext: { secret: true },
    privateContextMode: 'all', dependencies: { attack: true }, identity: { authorization: 'granted' },
    authorization: 'granted', runtimeMode: 'production', sandbox: false,
    operationPlan: { steps: ['evil'] }, steps: ['evil'],
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(calls, { gmail: 0, calendar: 0, dashboard: 0 });
  assert.equal(capturedOptions.contextSelection.reason, 'general_query');
  assert.equal(Object.hasOwn(capturedOptions, 'privateContextMetadata'), false);
  assert.equal(response.getJson().interactionId, 'stable-id');
  assert.equal(JSON.stringify(response.getJson()).includes('evil'), false);
});

test('denied internal identity blocks private providers but leaves general queries working', async (t) => {
  const { calls, dependencies } = createHarness(t, { getClienteCeroIdentity: () => ({ clientId: 'cliente-cero', expectedClientId: 'cliente-cero', userId: 'user', authorization: { status: 'denied', provider: 'google-oauth' } }) });
  const denied = await requestChat('¿Qué correos tengo?', dependencies);
  assert.equal(denied.statusCode, 200); assert.equal(calls.gmail, 0);
  assert.equal(denied.getJson().privateContextUsed, false);
  assert.match(denied.getJson().response, /no esta autorizado/i);
  const general = await requestChat('Consulta general.', dependencies);
  assert.equal(general.statusCode, 200);
});

test('adds an optional supervised recommendation without executing or accepting client decisions', async (t) => {
  let decisionCalls = 0;
  let plannerCalls = 0;
  const { dependencies, runtime } = createHarness(t, {
    recommendSupervisedOperation({ query, analysis }) {
      decisionCalls += 1;
      assert.equal(query, 'Analiza oportunidades comerciales.');
      assert.equal(typeof analysis, 'object');
      return {
        decision: 'business-analysis-readonly',
        reason: 'Conviene revisar la información comercial disponible.',
        confidence: 'high',
        requiresConfirmation: true,
      };
    },
    planOperations({ query, analysis }) {
      plannerCalls += 1;
      assert.equal(query, 'Analiza oportunidades comerciales.');
      assert.equal(typeof analysis, 'object');
      return { steps: ['business-analysis-readonly'], requiresConfirmation: true };
    },
  });
  const response = await requestChat('Analiza oportunidades comerciales.', dependencies, {
    decision: 'knowledge-review-readonly', worker: 'evil', type: 'evil',
  });
  const payload = response.getJson();
  assert.equal(response.statusCode, 200);
  assert.equal(decisionCalls, 1);
  assert.equal(plannerCalls, 1);
  assert.equal(payload.decisionRecommendation.decision, 'business-analysis-readonly');
  assert.deepEqual(payload.operationPlan, { steps: ['business-analysis-readonly'], requiresConfirmation: true });
  assert.equal(payload.decisionRecommendation.requiresConfirmation, true);
  assert.equal(runtime.approvalQueue.listPending().length, 0);
  assert.equal(JSON.stringify(payload).includes('evil'), false);
});

test('recommends supervised Gmail review without reading Gmail before confirmation', async (t) => {
  const { calls, dependencies } = createHarness(t, {
    async buildGmailPrivateContext() {
      throw new Error('Gmail must not be read before confirmation.');
    },
  });
  const response = await requestChat('Revisa mi correo', dependencies);
  const payload = response.getJson();
  assert.equal(response.statusCode, 200);
  assert.equal(calls.gmail, 0);
  assert.equal(payload.decisionRecommendation.decision, 'gmail-review-readonly');
  assert.equal(payload.decisionRecommendation.requiresConfirmation, true);
  assert.doesNotMatch(payload.response, /Gmail readonly no esta disponible/i);
});

test('omits none recommendations and every recommendation for denied identity', async (t) => {
  const noneHarness = createHarness(t, {
    recommendSupervisedOperation: () => ({ decision: 'none', reason: 'No procede.', confidence: 'low', requiresConfirmation: true }),
  });
  const none = await requestChat('Consulta ambigua.', noneHarness.dependencies);
  assert.equal(Object.hasOwn(none.getJson(), 'decisionRecommendation'), false);

  const emptyPlanHarness = createHarness(t, {
    planOperations: () => ({ steps: [], requiresConfirmation: true }),
  });
  const emptyPlan = await requestChat('Consulta sin plan.', emptyPlanHarness.dependencies);
  assert.equal(Object.hasOwn(emptyPlan.getJson(), 'operationPlan'), false);

  await t.test('denied', async (subtest) => {
    let called = false;
    const deniedHarness = createHarness(subtest, {
      getClienteCeroIdentity: () => ({
        clientId: 'cliente-cero', expectedClientId: 'cliente-cero', userId: 'user',
        authorization: { status: 'denied', provider: 'google-oauth' },
      }),
      recommendSupervisedOperation: () => { called = true; return {}; },
      planOperations: () => { called = true; return {}; },
    });
    const denied = await requestChat('Analiza empresas.', deniedHarness.dependencies);
    assert.equal(Object.hasOwn(denied.getJson(), 'decisionRecommendation'), false);
    assert.equal(called, false);
  });
});

test('M isolates each unavailable source and never fabricates context or proposals', async (t) => {
  const cases = [
    ['¿Qué reuniones tengo hoy?', { buildCalendarPrivateContext: async () => { throw new Error('secret calendar stack'); } }, /Calendar readonly/i],
    ['¿Qué tengo pendiente de aprobar?', { approvalQueue: { listPending() { throw new Error('secret queue'); }, getHistory() { return []; } } }, /Approval Queue/i],
    ['¿Cómo está mi día?', { getDashboardState: async () => { throw new Error('secret dashboard'); } }, /resumen agregado/i],
  ];
  for (const [query, override, safeMessage] of cases) {
    await t.test(query, async (subtest) => {
      const { dependencies } = createHarness(subtest, override);
      const response = await requestChat(query, dependencies);
      const payload = response.getJson();
      assert.equal(response.statusCode, 200);
      assert.match(payload.response, safeMessage);
      assert.equal(payload.privateContextUsed, false);
      assert.equal(payload.proposal, null); assert.equal(payload.approval, null);
      assert.equal(JSON.stringify(payload).includes('secret'), false);
    });
  }
});

test('rejects missing query and invalid JSON without changing the contract', async () => {
  for (const body of [JSON.stringify({ query: '' }), '{invalid']) {
    const response = createResponse();
    await handleExecutiveChatRequest(createRequest(body), response);
    assert.equal(response.statusCode, 400);
    assert.equal(response.getJson().ok, false);
  }
});

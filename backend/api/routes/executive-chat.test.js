'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const ProposalEngine = require('../../core/proposalEngine');
const { createExecutiveRuntime, SANDBOX_MODE } = require('../../services/runtime/executive-runtime-factory');
const { createConversationContextStore } = require('../../services/executive-brain/conversation-context-store');
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
        id: 'secret-message-id', threadId: 'secret-thread-id', from: 'Equipo <pilot@example.com>', subject: 'Seguimiento',
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
    // V0.1 (Gmail) / V0.3 (Calendar): a plain, read-only query now answers
    // directly in the same turn (executive-chat.js no longer skips Gmail or
    // Calendar context injection for their supervised readonly
    // recommendation), instead of only attaching a pending
    // decisionRecommendation.
    ['¿Qué correos tengo pendientes?', { gmail: 1, calendar: 0, dashboard: 0 }, true],
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
  // The real ApprovalQueue (backend/core/approvalQueue.js) declares both
  // methods async; mocking them as sync here previously hid a real bug
  // (executive-chat.js called them without await, so .map() ran on a
  // Promise and this whole feature silently always failed closed).
  const queue = {
    async listPending() { pendingCalls += 1; return [{ id: 'a1', status: 'pending', createdAt: '2026-07-20T08:00:00.000Z', publicProposal: { type: 'email_draft', summary: 'Revision pendiente.', requiresApproval: true }, executionPayload: { body: 'secret-body' }, payloadHash: 'secret-hash' }]; },
    async getHistory() { historyCalls += 1; return []; },
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
    ['Prepara un borrador de respuesta.', 'email_draft', 0, 0, false],
    ['Prepara una respuesta al último correo.', 'email_draft', 1, 0, true],
    ['Programa una reunión.', 'meeting_proposal', 0, 0, true],
  ];
  for (const [query, type, gmailCalls, calendarCalls, approvalExpected] of cases) {
    await t.test(query, async (subtest) => {
      const { calls, dependencies } = createHarness(subtest);
      const response = await requestChat(query, dependencies);
      const payload = response.getJson();
      assert.equal(payload.proposal.type, type);
      assert.equal(
        approvalExpected ? payload.approval.status : payload.approval,
        approvalExpected ? 'pending' : null,
      );
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
      assert.equal((await runtime.approvalQueue.listPending()).length, 0);
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

test('denied internal identity also blocks Approval Queue and memory context (no data leak on unauthorized identity)', async (t) => {
  let queueCalls = 0;
  const queue = {
    listPending() { queueCalls += 1; return [{ id: 'secret-approval-id', status: 'pending', createdAt: '2026-07-20T08:00:00.000Z', publicProposal: { type: 'email_draft', summary: 'secret-summary', requiresApproval: true } }]; },
    getHistory() { queueCalls += 1; return []; },
  };
  const { dependencies, runtime } = createHarness(t, {
    approvalQueue: queue,
    getClienteCeroIdentity: () => ({ clientId: 'family:family-uid-a', expectedClientId: 'cliente-cero', userId: 'family-uid-a', authorization: { status: 'not_available', provider: null } }),
  });
  runtime.memory.saveShortTerm({ intent: 'decisions', status: 'completed', query: 'secret raw query' });

  const approvalsResponse = await requestChat('¿Qué tengo pendiente de aprobar?', dependencies);
  assert.equal(approvalsResponse.statusCode, 200);
  assert.equal(queueCalls, 0);
  assert.equal(JSON.stringify(approvalsResponse.getJson()).includes('secret-approval-id'), false);
  assert.match(approvalsResponse.getJson().response, /no esta autorizado/i);

  const memoryResponse = await requestChat('¿Qué recuerdas de nuestras últimas decisiones?', dependencies);
  assert.equal(memoryResponse.statusCode, 200);
  assert.equal(JSON.stringify(memoryResponse.getJson()).includes('secret raw query'), false);
  assert.match(memoryResponse.getJson().response, /no esta autorizado/i);
});

test('a family-beta shaped identity (clientId family:<uid>) gets zero private context but the executive chat still answers general queries', async (t) => {
  const familyIdentity = () => ({ clientId: 'family:family-uid-a', expectedClientId: 'cliente-cero', userId: 'family-uid-a', authorization: { status: 'not_available', provider: null } });
  const { calls, dependencies } = createHarness(t, { getClienteCeroIdentity: familyIdentity });

  for (const query of ['¿Cómo está mi día?', 'Resume mis correos y reuniones de hoy.', '¿Qué reuniones tengo hoy?']) {
    const response = await requestChat(query, dependencies);
    assert.equal(response.statusCode, 200);
    assert.equal(response.getJson().privateContextUsed, false);
  }
  assert.deepEqual(calls, { gmail: 0, calendar: 0, dashboard: 0 });

  const general = await requestChat('Explícame qué es una agenda digital.', dependencies);
  assert.equal(general.statusCode, 200);
  assert.equal(general.getJson().privateContextUsed, false);
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
  assert.equal(payload.capabilityComposition.primaryCapability, 'business-analysis-readonly');
  assert.equal(payload.decisionRecommendation.requiresConfirmation, true);
  assert.equal((await runtime.approvalQueue.listPending()).length, 0);
  assert.equal(JSON.stringify(payload).includes('evil'), false);
});

test('V0.1: a supervised Gmail review recommendation no longer blocks reading Gmail — answers directly in the same turn', async (t) => {
  const { calls, dependencies } = createHarness(t);
  const response = await requestChat('Revisa mi correo', dependencies);
  const payload = response.getJson();
  assert.equal(response.statusCode, 200);
  assert.equal(calls.gmail, 1);
  assert.equal(payload.privateContextUsed, true);
  // The pending-confirmation metadata is still attached (unchanged, for any
  // consumer that wants it), but it no longer suppresses the real answer.
  assert.equal(payload.decisionRecommendation.decision, 'gmail-review-readonly');
  assert.equal(payload.capabilityComposition.primaryCapability, 'gmail-review-readonly');
  assert.equal(payload.decisionRecommendation.requiresConfirmation, true);
  assert.doesNotMatch(payload.response, /Gmail readonly no esta disponible/i);
  assert.match(payload.response, /correo/i);
  // No Knowledge Store leakage into a Gmail-answered response's natural
  // language text (payload.response) — the frontend only ever speaks/shows
  // this field to the user, never the raw confidence/sources/analysis
  // fields, which remain internal API contract details.
  assert.deepEqual(payload.sources, []);
});

test('a Gmail context failure still recommends the same supervised review, with a safe fallback answer', async (t) => {
  const { calls, dependencies } = createHarness(t, {
    async buildGmailPrivateContext() {
      calls.gmail = (calls.gmail || 0) + 1;
      const error = new Error('Google OAuth is not ready.');
      error.code = 'google_oauth_tokens_missing';
      throw error;
    },
  });
  const response = await requestChat('Revisa mi correo', dependencies);
  const payload = response.getJson();
  assert.equal(response.statusCode, 200);
  assert.equal(calls.gmail, 1);
  assert.match(payload.response, /Necesito que conectes tu cuenta de Google/i);
  assert.doesNotMatch(payload.response, /google_oauth|error|stack/i);
});

test('an insufficient-scope Gmail failure gets its own distinct natural message, never the generic one', async (t) => {
  const { dependencies } = createHarness(t, {
    async buildGmailPrivateContext() {
      const error = new Error('Google OAuth is not ready.');
      error.code = 'gmail_compose_scope_missing';
      throw error;
    },
  });
  const response = await requestChat('Revisa mi correo', dependencies);
  const payload = response.getJson();
  assert.match(payload.response, /No tengo todavia permiso suficiente/i);
  assert.doesNotMatch(payload.response, /Necesito que conectes|gmail_compose_scope_missing/i);
});

test('an unrecognized Gmail failure code falls back to the generic temporary-outage message, not silence', async (t) => {
  const { dependencies } = createHarness(t, {
    async buildGmailPrivateContext() {
      const error = new Error('boom');
      error.code = 'some_unexpected_code';
      throw error;
    },
  });
  const response = await requestChat('Revisa mi correo', dependencies);
  const payload = response.getJson();
  assert.match(payload.response, /Gmail readonly no esta disponible temporalmente/i);
  assert.doesNotMatch(payload.response, /boom|some_unexpected_code/i);
});

test('the Gmail intent always requests at most 5 recent messages, never a caller-supplied count', async (t) => {
  let receivedMaxMessages = null;
  const { dependencies } = createHarness(t, {
    async buildGmailPrivateContext(input) {
      receivedMaxMessages = input.maxMessages;
      return privateContext('gmail', { source: 'gmail', messages: [] });
    },
  });
  await requestChat('Revisa mi correo', dependencies, { maxMessages: 500 });
  assert.equal(receivedMaxMessages, 5);
});

test('classifyGmailContextFailure maps known codes and falls back safely for unknown ones', () => {
  const { classifyGmailContextFailure } = require('./executive-chat');
  assert.equal(classifyGmailContextFailure('google_oauth_not_configured'), 'gmail_not_connected');
  assert.equal(classifyGmailContextFailure('google_oauth_tokens_missing'), 'gmail_not_connected');
  assert.equal(classifyGmailContextFailure('oauth_refresh_unavailable'), 'gmail_not_connected');
  assert.equal(classifyGmailContextFailure('gmail_private_identity_required'), 'gmail_not_connected');
  assert.equal(classifyGmailContextFailure('gmail_compose_scope_missing'), 'gmail_insufficient_scope');
  assert.equal(classifyGmailContextFailure('google_oauth_token_store_unavailable'), 'gmail_unavailable');
  assert.equal(classifyGmailContextFailure(undefined), 'gmail_unavailable');
  assert.equal(classifyGmailContextFailure('anything_else'), 'gmail_unavailable');
});

test('routes an explicit email preparation to prepare-email-draft instead of Gmail review', async (t) => {
  let decisionCalls = 0;
  const { dependencies } = createHarness(t, {
    orchestrateExecutiveQuery() {
      return {
        analysis: { intent: 'email' },
        response: 'Preparación disponible.',
        sources: [],
        proposal: {
          type: 'email_draft',
          actionType: 'prepare-email-draft',
          summary: 'Borrador de email preparado para revision.',
          requiresApproval: true,
        },
      };
    },
    recommendSupervisedOperation() {
      decisionCalls += 1;
      return {
        decision: 'gmail-review-readonly',
        reason: 'Revisar correo.',
        confidence: 'medium',
        requiresConfirmation: true,
      };
    },
    planOperations() {
      throw new Error('supporting Knowledge must not replace explicit email preparation');
    },
  });

  const response = await requestChat(
    'Prepara un correo para mi dirección de Gmail con asunto: Prueba OXKIO 5C.6D.1 '
      + 'y cuerpo: Este correo es un borrador de prueba. No debe enviarse.',
    dependencies,
  );
  const payload = response.getJson();

  assert.equal(response.statusCode, 200);
  assert.equal(payload.proposal.actionType, 'prepare-email-draft');
  assert.equal(Object.hasOwn(payload, 'decisionRecommendation'), false);
  assert.equal(Object.hasOwn(payload, 'operationPlan'), false);
  assert.deepEqual(payload.capabilityComposition, {
    primaryCapability: 'prepare-email-draft',
    supportingCapabilities: [],
    deferredCapabilities: [],
    rejectedCapabilities: [],
  });
  assert.equal(decisionCalls, 0);
});

test('keeps Knowledge auxiliary when explicit email preparation is the primary capability', async (t) => {
  const { dependencies } = createHarness(t, {
    orchestrateExecutiveQuery() {
      return {
        analysis: { intent: 'documentation' },
        response: 'Generic Knowledge response that must remain secondary.',
        sources: [],
        proposal: {
          type: 'email_draft',
          actionType: 'prepare-email-draft',
          summary: 'Borrador preparado.',
          requiresApproval: true,
        },
        approval: {
          id: 'approval-composed-email',
          status: 'pending',
          createdAt: '2026-07-25T11:00:00.000Z',
        },
      };
    },
    recommendSupervisedOperation() {
      throw new Error('readonly decision must not compete with explicit action');
    },
    planOperations() {
      throw new Error('supporting capability must not become an operation plan');
    },
  });

  const response = await requestChat(
    'Prepara un correo para pilot@example.com usando la información disponible sobre OXKIO '
      + 'con asunto: Resumen y cuerpo: Contexto revisado.',
    dependencies,
  );
  const payload = response.getJson();

  assert.equal(payload.capabilityComposition.primaryCapability, 'prepare-email-draft');
  assert.deepEqual(payload.capabilityComposition.supportingCapabilities, ['knowledge-review-readonly']);
  assert.equal(payload.approval.status, 'pending');
  assert.equal(Object.hasOwn(payload, 'decisionRecommendation'), false);
  assert.equal(Object.hasOwn(payload, 'operationPlan'), false);
});

test('V0.3: a supervised Calendar review recommendation no longer blocks reading Calendar — answers directly in the same turn', async (t) => {
  const { calls, dependencies } = createHarness(t);
  const response = await requestChat('Revisa mi agenda', dependencies);
  const payload = response.getJson();
  assert.equal(response.statusCode, 200);
  assert.equal(calls.calendar, 1);
  assert.equal(payload.privateContextUsed, true);
  // The pending-confirmation metadata is still attached (unchanged, for any
  // consumer that wants it), but it no longer suppresses the real answer.
  assert.equal(payload.decisionRecommendation.decision, 'calendar-review-readonly');
  assert.equal(payload.capabilityComposition.primaryCapability, 'calendar-review-readonly');
  assert.equal(payload.decisionRecommendation.requiresConfirmation, true);
  assert.doesNotMatch(payload.response, /Calendar readonly no esta disponible/i);
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

test('V0.5 FASE 6: revisa mi correo -> cual primero -> preparame una respuesta al mas importante resolves across turns and drafts, never sends', async (t) => {
  let gmailCalls = 0;
  const conversationContextStore = createConversationContextStore();
  const { dependencies } = createHarness(t, {
    async buildGmailPrivateContext() {
      gmailCalls += 1;
      return {
        privateContextMetadata: {
          clientId: 'cliente-cero', userId: 'usuario-cliente-cero', scope: 'private:user',
          sensitivity: 'confidential', sourceType: 'gmail', sourceId: 'gmail-primary',
          authorization: { status: 'granted', provider: 'google-oauth' },
          purpose: 'executive-briefing', retentionPolicy: 'CLIENT_CONTROLLED', promotionPolicy: 'NEVER_PROMOTE',
        },
        expectedClientId: 'cliente-cero',
        privatePayload: {
          source: 'gmail',
          messages: [
            { id: 'm-ana', threadId: 't-ana', from: 'Ana <ana@example.com>', subject: 'Propuesta comercial', date: '2026-09-20T08:00:00.000Z', snippet: 'x', unread: true, important: true },
            { id: 'm-bob', threadId: 't-bob', from: 'Bob <bob@example.com>', subject: 'Factura', date: '2026-09-19T08:00:00.000Z', snippet: 'x', unread: false, important: false },
          ],
        },
      };
    },
    conversationContextStore,
  });
  const conversationId = 'conv-e2e-gmail-0001';

  const turn1 = await requestChat('Revisa mi correo', dependencies, { conversationId });
  assert.equal(turn1.statusCode, 200);
  assert.equal(gmailCalls, 1);
  assert.match(turn1.getJson().response, /ana|bob/i);

  const turn2 = await requestChat('¿Cuál debería responder primero y por qué?', dependencies, { conversationId });
  assert.equal(turn2.statusCode, 200);
  assert.equal(gmailCalls, 1, 'turn 2 must not trigger its own Gmail fetch');
  assert.match(turn2.getJson().response, /ana/i);
  assert.match(turn2.getJson().response, /propuesta comercial/i);

  const turn3 = await requestChat('Prepárame una respuesta al más importante', dependencies, { conversationId });
  assert.equal(turn3.statusCode, 200);
  assert.equal(gmailCalls, 2, 'turn 3 fetches Gmail context to prepare the draft');
  const proposal = turn3.getJson().proposal;
  assert.ok(proposal, 'turn 3 must produce a draft proposal');
  assert.equal(proposal.type, 'email_draft');
  assert.doesNotMatch(JSON.stringify(turn3.getJson()), /\bsend\b/i);
  // Reproduces the real staging failure: the draft proposal was already
  // correct, but the conversational `response` text fell through to the
  // Knowledge Store simulator (it answers every query, matching real
  // project files by keyword) instead of describing the authorized Gmail
  // context it actually used — because a reference-driven draft request
  // ("al mas importante") names no literal "correo"/"email" noun for
  // isEmailQuery to match. A user reading only the chat text saw an
  // apparent failure (Knowledge Store noise, e.g. "No tengo informacion
  // suficiente..." or fabricated "referencia(s) relevante(s)" from
  // unrelated repo files) even though the draft itself was ready.
  assert.doesNotMatch(
    turn3.getJson().response,
    /referencia\(s\) relevante|no tengo informaci.n suficiente|fuentes principales/i,
    'turn 3 must not fall through to the Knowledge Store simulator answer',
  );
  assert.match(
    turn3.getJson().response,
    /^Correo privado autorizado/,
    'turn 3 must answer from the authorized Gmail context it just fetched',
  );
});

test('V0.5: a bare "respondele" with truly no Gmail data and no saved context never fabricates a recipient', async (t) => {
  // Note: detectActionableIntent already produces generic draft-proposal
  // metadata whenever the verb+object pattern matches, independent of V0.5
  // (pre-existing behavior, unrelated to reference resolution) — the actual
  // "never guess" guarantee this test protects is that no specific person
  // is invented when there is genuinely nothing to resolve the reference
  // against; reference-resolver.test.js separately proves the resolver
  // itself reports { resolved: false, ambiguous: true } in this exact case.
  const conversationContextStore = createConversationContextStore();
  const { dependencies } = createHarness(t, {
    conversationContextStore,
    async buildGmailPrivateContext() {
      const error = new Error('Gmail is not available in this test.');
      error.code = 'gmail_unavailable';
      throw error;
    },
  });
  const response = await requestChat('Respóndele', dependencies, { conversationId: 'conv-ambiguous-0001' });
  assert.equal(response.statusCode, 200);
  const payload = response.getJson();
  assert.doesNotMatch(JSON.stringify(payload), /ana@example\.com|bob@example\.com/i);
});

// FULL RUNTIME REVEAL FASE 18: reproduces the real (not merely
// no-data-available) ambiguous case — two real messages, neither flagged
// important, no prior selection, no ordinal in the query. Before this fix,
// emailPreparationFromPrivateContext's `messages[0]` fallback silently
// picked Ana's message and would have queued a real Approval Queue entry
// addressed to her for a reply the user never specified.
test('V0.5 FASE 18: an ambiguous reference between two real messages asks instead of guessing', async (t) => {
  const conversationContextStore = createConversationContextStore();
  const { dependencies } = createHarness(t, {
    conversationContextStore,
    async buildGmailPrivateContext() {
      return {
        privateContextMetadata: {
          clientId: 'cliente-cero', userId: 'usuario-cliente-cero', scope: 'private:user',
          sensitivity: 'confidential', sourceType: 'gmail', sourceId: 'gmail-primary',
          authorization: { status: 'granted', provider: 'google-oauth' },
          purpose: 'executive-briefing', retentionPolicy: 'CLIENT_CONTROLLED', promotionPolicy: 'NEVER_PROMOTE',
        },
        expectedClientId: 'cliente-cero',
        privatePayload: {
          source: 'gmail',
          messages: [
            { id: 'm-ana', threadId: 't-ana', from: 'Ana <ana@example.com>', subject: 'Propuesta comercial', date: '2026-09-20T08:00:00.000Z', snippet: 'x', unread: true, important: false },
            { id: 'm-bob', threadId: 't-bob', from: 'Bob <bob@example.com>', subject: 'Factura', date: '2026-09-19T08:00:00.000Z', snippet: 'x', unread: true, important: false },
          ],
        },
      };
    },
  });
  const conversationId = 'conv-ambiguous-real-0001';
  const turn1 = await requestChat('Revisa mi correo', dependencies, { conversationId });
  assert.equal(turn1.statusCode, 200);

  const turn2 = await requestChat('Respóndele', dependencies, { conversationId });
  assert.equal(turn2.statusCode, 200);
  const payload = turn2.getJson();
  assert.equal(payload.proposal, null, 'must never fabricate a draft proposal for an ambiguous reference');
  assert.doesNotMatch(JSON.stringify(payload), /ana@example\.com|bob@example\.com/i, 'must never guess a recipient');
  assert.match(payload.response, /ana/i, 'the clarifying question must name the real candidates');
  assert.match(payload.response, /bob/i);
});

test('V0.5: conversationId is optional — the chat still answers normally without it', async (t) => {
  const { dependencies } = createHarness(t);
  const response = await requestChat('Revisa mi correo', dependencies);
  assert.equal(response.statusCode, 200);
  assert.match(response.getJson().response, /correo/i);
});

test('V0.5: a malformed conversationId is ignored safely, never crashes the request', async (t) => {
  const { dependencies } = createHarness(t);
  for (const badId of ['short', '../../etc/passwd', 12345, {}, null]) {
    const response = await requestChat('Hola', dependencies, { conversationId: badId });
    assert.equal(response.statusCode, 200);
  }
});

test('V0.5 FASE 8: a different UID can never read another UID\'s conversation context even with the same conversationId', async (t) => {
  const conversationContextStore = createConversationContextStore();
  const harnessA = createHarness(t, {
    conversationContextStore,
    async buildGmailPrivateContext() {
      return {
        privateContextMetadata: {
          clientId: 'cliente-cero', userId: 'uid-a', scope: 'private:user',
          sensitivity: 'confidential', sourceType: 'gmail', sourceId: 'gmail-primary',
          authorization: { status: 'granted', provider: 'google-oauth' },
          purpose: 'executive-briefing', retentionPolicy: 'CLIENT_CONTROLLED', promotionPolicy: 'NEVER_PROMOTE',
        },
        expectedClientId: 'cliente-cero',
        privatePayload: { source: 'gmail', messages: [
          { from: 'Secreto <secreto@example.com>', subject: 'Solo UID A', date: '2026-09-20T08:00:00.000Z', unread: true, important: true },
        ] },
      };
    },
    getClienteCeroIdentity: () => ({
      clientId: 'cliente-cero', userId: 'uid-a', expectedClientId: 'cliente-cero',
      authorization: { status: 'granted', provider: 'google-oauth' },
    }),
  });
  const conversationId = 'conv-shared-0001';
  await requestChat('Revisa mi correo', harnessA.dependencies, { conversationId });

  let gmailCallsB = 0;
  const harnessB = createHarness(t, {
    conversationContextStore,
    async buildGmailPrivateContext() { gmailCallsB += 1; throw new Error('uid-b has no Gmail context in this test'); },
    getClienteCeroIdentity: () => ({
      clientId: 'cliente-cero', userId: 'uid-b', expectedClientId: 'cliente-cero',
      authorization: { status: 'granted', provider: 'google-oauth' },
    }),
  });
  const responseB = await requestChat('¿Cuál debería responder primero y por qué?', harnessB.dependencies, { conversationId });
  assert.equal(responseB.statusCode, 200);
  assert.doesNotMatch(responseB.getJson().response, /secreto/i);
  assert.match(responseB.getJson().response, /no tengo una lista reciente/i);
});

test('rejects missing query and invalid JSON without changing the contract', async () => {
  for (const body of [JSON.stringify({ query: '' }), '{invalid']) {
    const response = createResponse();
    await handleExecutiveChatRequest(createRequest(body), response);
    assert.equal(response.statusCode, 400);
    assert.equal(response.getJson().ok, false);
  }
});

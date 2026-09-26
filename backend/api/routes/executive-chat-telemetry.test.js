'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const ProposalEngine = require('../../core/proposalEngine');
const { createExecutiveRuntime, SANDBOX_MODE } = require('../../services/runtime/executive-runtime-factory');
const { CostController } = require('../../services/runtime/cost-controller');
const { SupervisedAutonomyTelemetry } = require('../../services/runtime/supervised-autonomy-telemetry');
const { OUTCOMES } = require('../../services/runtime/agent-productivity-metrics');
const { handleExecutiveChatRequest, classifyTelemetryOutcome } = require('./executive-chat');

// Mutating Approval Queue methods that a chat turn must never reach.
const FORBIDDEN_QUEUE_METHODS = [
  'approve', 'reject', 'beginExecution', 'validateForExecution',
  'completeExecution', 'failExecution', 'retryExecution',
];

function createRequest(body) {
  const request = new EventEmitter();
  process.nextTick(() => { request.emit('data', Buffer.from(body)); request.emit('end'); });
  return request;
}

function createResponse({ failFirstWrite = false } = {}) {
  let writes = 0;
  return {
    statusCode: null,
    body: '',
    writeHead(statusCode) {
      writes += 1;
      if (failFirstWrite && writes === 1) throw new Error('socket closed');
      this.statusCode = statusCode;
    },
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

function codedError(code) {
  const error = new Error('secret provider detail');
  error.code = code;
  return error;
}

// Real CostController and real SupervisedAutonomyTelemetry, wrapped only to
// count calls; every costDecision is the genuine branded decide() result.
function createTelemetryHarness(t, overrides = {}) {
  const runtime = createExecutiveRuntime({ mode: SANDBOX_MODE });
  t.after(() => runtime.cleanup());
  const forbiddenCalls = [];
  for (const name of FORBIDDEN_QUEUE_METHODS) {
    const original = runtime.approvalQueue[name];
    runtime.approvalQueue[name] = (...args) => {
      forbiddenCalls.push(name);
      return original.apply(runtime.approvalQueue, args);
    };
  }

  const costController = new CostController();
  const decideInputs = [];
  const decisions = [];
  const realDecide = costController.decide.bind(costController);
  costController.decide = (input) => {
    decideInputs.push(input);
    const decision = realDecide(input);
    decisions.push(decision);
    return decision;
  };

  const telemetry = new SupervisedAutonomyTelemetry();
  const recordInputs = [];
  const realRecord = telemetry.record.bind(telemetry);
  telemetry.record = (input) => {
    recordInputs.push(input);
    return realRecord(input);
  };

  const logEntries = [];
  const dependencies = {
    memory: runtime.memory,
    approvalQueue: runtime.approvalQueue,
    proposalEngine: new ProposalEngine(),
    getClienteCeroIdentity: () => ({
      clientId: 'cliente-cero', userId: 'usuario-cliente-cero', expectedClientId: 'cliente-cero',
      authorization: { status: 'granted', provider: 'google-oauth' },
    }),
    async buildGmailPrivateContext() {
      return privateContext('gmail', { source: 'gmail', messages: [{
        id: 'secret-message-id', from: 'Equipo <pilot@example.com>', subject: 'Seguimiento',
        date: '2026-07-20T08:00:00.000Z', unread: true, important: true,
      }] });
    },
    async buildCalendarPrivateContext() {
      return privateContext('calendar', { source: 'calendar', events: [{
        id: 'secret-event-id', title: 'Reunion operativa', start: '2026-07-20T10:00:00.000Z',
        end: '2026-07-20T10:30:00.000Z',
      }] });
    },
    async getDashboardState() {
      return { executiveSummary: 'Estado agregado estable.' };
    },
    executionLogger: { add(entry) { logEntries.push(entry); } },
    costController,
    supervisedAutonomyTelemetry: telemetry,
    ...overrides,
  };
  return { dependencies, telemetry, decideInputs, decisions, recordInputs, logEntries, forbiddenCalls, runtime };
}

async function requestChat(query, dependencies, responseOptions) {
  const response = createResponse(responseOptions);
  await handleExecutiveChatRequest(createRequest(JSON.stringify({ query })), response, { dependencies });
  return response;
}

function outcomesOf(telemetry) {
  return telemetry.snapshot().outcomes;
}

function assertSingleOutcome(harness, outcome) {
  const outcomes = outcomesOf(harness.telemetry);
  assert.equal(harness.decideInputs.length, 1);
  assert.equal(harness.recordInputs.length, 1);
  assert.equal(outcomes.totalAttempts, 1);
  const expected = {
    [OUTCOMES.COMPLETED]: 'completedCount',
    [OUTCOMES.FAILED]: 'failedCount',
    [OUTCOMES.BLOCKED]: 'blockedCount',
  }[outcome];
  for (const counter of ['completedCount', 'failedCount', 'blockedCount', 'humanInterventionCount']) {
    assert.equal(outcomes[counter], counter === expected ? 1 : 0, counter);
  }
}

test('COMPLETED: a normal turn records once with the natural deterministic policy decision', async (t) => {
  const harness = createTelemetryHarness(t);
  const response = await requestChat('Explícame qué es una agenda digital.', harness.dependencies);
  assert.equal(response.statusCode, 200);
  assertSingleOutcome(harness, OUTCOMES.COMPLETED);

  assert.deepEqual(harness.decideInputs[0], { mission: { deterministicAvailable: true } });
  const [decision] = harness.decisions;
  assert.equal(decision.source, 'policy');
  assert.equal(decision.cacheKey, null);
  assert.equal(decision.costEstimate.status, 'not_requested');
  assert.equal(decision.costEstimate.estimatedCostUsd, null);
  assert.equal(decision.decision.level, 'deterministic');
  assert.equal(decision.executionPattern.pattern, 'deterministic');
  assert.equal(harness.recordInputs[0].costDecision, decision);

  const snapshot = harness.telemetry.snapshot();
  assert.equal(snapshot.cacheHits, 0);
  assert.equal(snapshot.decisionLevelHistogram.deterministic, 1);
  assert.equal(snapshot.executionPatternHistogram.deterministic, 1);
  assert.equal(snapshot.sourceHistogram.policy, 1);
  assert.equal(snapshot.cost.notRequestedCostCount, 1);
  assert.equal(snapshot.outcomes.approvalGatedCount, 0);
});

test('FAILED: an exception after decide() records exactly one failed attempt and keeps the 400 contract', async (t) => {
  const harness = createTelemetryHarness(t, {
    orchestrateExecutiveQuery: async () => { throw new Error('Orchestrator exploded.'); },
  });
  const response = await requestChat('Explícame qué es una agenda digital.', harness.dependencies);
  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.getJson(), { ok: false, error: 'Orchestrator exploded.' });
  assertSingleOutcome(harness, OUTCOMES.FAILED);
  assert.equal(harness.recordInputs[0].approvalGated, false);
});

test('FAILED: an unavailable context source (*_unavailable) is a failed turn', async (t) => {
  const harness = createTelemetryHarness(t, {
    getDashboardState: async () => { throw new Error('secret dashboard'); },
  });
  const response = await requestChat('¿Cómo está mi día?', harness.dependencies);
  assert.equal(response.statusCode, 200);
  assertSingleOutcome(harness, OUTCOMES.FAILED);
});

test('FAILED: a proposal that was attempted but did not succeed is a failed turn', async (t) => {
  const harness = createTelemetryHarness(t, {
    proposalEngine: { generate() { throw new Error('secret proposal engine'); } },
  });
  const response = await requestChat('Programa una reunión.', harness.dependencies);
  assert.equal(response.statusCode, 200);
  assert.equal(response.getJson().proposal, null);
  assertSingleOutcome(harness, OUTCOMES.FAILED);
});

test('FAILED: an approval that was attempted but did not succeed is a failed turn', async (t) => {
  const harness = createTelemetryHarness(t);
  harness.dependencies.approvalQueue = {
    async add() { throw new Error('secret approval store'); },
  };
  const response = await requestChat('Programa una reunión.', harness.dependencies);
  assert.equal(response.statusCode, 200);
  assert.equal(response.getJson().proposal.type, 'meeting_proposal');
  assert.equal(response.getJson().approval, null);
  assertSingleOutcome(harness, OUTCOMES.FAILED);
  assert.equal(harness.recordInputs[0].approvalGated, false);
});

test('BLOCKED: gmail_not_connected is a blocked turn', async (t) => {
  const harness = createTelemetryHarness(t, {
    buildGmailPrivateContext: async () => { throw codedError('google_oauth_tokens_missing'); },
  });
  t.mock.method(console, 'error', () => {});
  const response = await requestChat('¿Qué correos tengo pendientes?', harness.dependencies);
  assert.equal(response.statusCode, 200);
  assertSingleOutcome(harness, OUTCOMES.BLOCKED);
});

test('BLOCKED: gmail_insufficient_scope is a blocked turn', async (t) => {
  const harness = createTelemetryHarness(t, {
    buildGmailPrivateContext: async () => { throw codedError('gmail_compose_scope_missing'); },
  });
  t.mock.method(console, 'error', () => {});
  await requestChat('¿Qué correos tengo pendientes?', harness.dependencies);
  assertSingleOutcome(harness, OUTCOMES.BLOCKED);
});

test('BLOCKED: unauthorized private context, approvals and memory are blocked turns', async (t) => {
  const deniedIdentity = () => ({
    clientId: 'family:family-uid-a', expectedClientId: 'cliente-cero', userId: 'family-uid-a',
    authorization: { status: 'not_available', provider: null },
  });
  const cases = [
    ['¿Qué correos tengo?', 'private_context_unauthorized'],
    ['¿Qué tengo pendiente de aprobar?', 'approvals_unauthorized'],
    ['¿Qué recuerdas de nuestras últimas decisiones?', 'memory_unauthorized'],
  ];
  for (const [query, failureCode] of cases) {
    await t.test(failureCode, async (subtest) => {
      const harness = createTelemetryHarness(subtest, { getClienteCeroIdentity: deniedIdentity });
      const response = await requestChat(query, harness.dependencies);
      assert.equal(response.statusCode, 200);
      assertSingleOutcome(harness, OUTCOMES.BLOCKED);
    });
  }
});

test('precedence: FAILED wins over BLOCKED when both signals are present in one turn', async (t) => {
  const harness = createTelemetryHarness(t, {
    buildGmailPrivateContext: async () => { throw codedError('google_oauth_tokens_missing'); },
    buildCalendarPrivateContext: async () => { throw new Error('secret calendar'); },
  });
  t.mock.method(console, 'error', () => {});
  const response = await requestChat('Resume mis correos y reuniones de hoy.', harness.dependencies);
  assert.equal(response.statusCode, 200);
  assertSingleOutcome(harness, OUTCOMES.FAILED);
});

test('classifyTelemetryOutcome applies FAILED > BLOCKED > COMPLETED and never emits human_intervention', () => {
  const cases = [
    [{ contextFailures: [], diagnostics: {} }, OUTCOMES.COMPLETED],
    [{}, OUTCOMES.COMPLETED],
    [{ contextFailures: ['gmail_unavailable'] }, OUTCOMES.FAILED],
    [{ contextFailures: ['memory_unavailable'] }, OUTCOMES.FAILED],
    [{ diagnostics: { proposalAttempted: true, proposalSucceeded: false } }, OUTCOMES.FAILED],
    [{ diagnostics: { approvalAttempted: true, approvalSucceeded: false } }, OUTCOMES.FAILED],
    [{ contextFailures: ['gmail_not_connected'] }, OUTCOMES.BLOCKED],
    [{ contextFailures: ['approvals_unauthorized'] }, OUTCOMES.BLOCKED],
    [{ contextFailures: ['approvals_unauthorized', 'calendar_unavailable'] }, OUTCOMES.FAILED],
    [{ contextFailures: ['gmail_insufficient_scope'],
      diagnostics: { approvalAttempted: true, approvalSucceeded: false } }, OUTCOMES.FAILED],
    // An ambiguous reference answered by asking for clarification is completed.
    [{ diagnostics: { proposalAttempted: false, proposalSucceeded: false, proposalAmbiguousReference: true } },
      OUTCOMES.COMPLETED],
    [{ diagnostics: { proposalAttempted: true, proposalSucceeded: true,
      approvalAttempted: true, approvalSucceeded: true } }, OUTCOMES.COMPLETED],
  ];
  for (const [input, expected] of cases) {
    const outcome = classifyTelemetryOutcome(input);
    assert.equal(outcome, expected, JSON.stringify(input));
    assert.notEqual(outcome, OUTCOMES.HUMAN_INTERVENTION);
  }
});

test('approval gate: a policy-required approval is completed + approvalGated, never human_intervention', async (t) => {
  const harness = createTelemetryHarness(t);
  const response = await requestChat('Programa una reunión.', harness.dependencies);
  assert.equal(response.getJson().approval.status, 'pending');
  assertSingleOutcome(harness, OUTCOMES.COMPLETED);
  const outcomes = outcomesOf(harness.telemetry);
  assert.equal(outcomes.approvalGatedCount, 1);
  assert.equal(outcomes.humanInterventionCount, 0);
  assert.equal(harness.recordInputs[0].approvalGated, true);
  assert.deepEqual(harness.forbiddenCalls, []);
});

test('decide() and record() run exactly once per routed turn across several turns', async (t) => {
  const harness = createTelemetryHarness(t);
  const queries = ['Explícame qué es una agenda digital.', 'Programa una reunión.', '¿Qué reuniones tengo hoy?'];
  for (const query of queries) await requestChat(query, harness.dependencies);
  assert.equal(harness.decideInputs.length, queries.length);
  assert.equal(harness.recordInputs.length, queries.length);
  assert.equal(new Set(harness.recordInputs.map((input) => input.costDecision)).size, queries.length);
  assert.equal(outcomesOf(harness.telemetry).totalAttempts, queries.length);
});

test('record once: a response write that throws after record() does not record a second attempt', async (t) => {
  const harness = createTelemetryHarness(t);
  const response = await requestChat('Explícame qué es una agenda digital.', harness.dependencies, { failFirstWrite: true });
  assert.equal(response.statusCode, 400);
  assertSingleOutcome(harness, OUTCOMES.COMPLETED);
});

test('pre-routing failures (empty query, invalid JSON) never call decide() or record()', async (t) => {
  const harness = createTelemetryHarness(t);
  for (const body of [JSON.stringify({ query: '' }), JSON.stringify({ query: '   ' }), '{invalid']) {
    const response = createResponse();
    await handleExecutiveChatRequest(createRequest(body), response, { dependencies: harness.dependencies });
    assert.equal(response.statusCode, 400);
    assert.equal(response.getJson().ok, false);
  }
  assert.equal(harness.decideInputs.length, 0);
  assert.equal(harness.recordInputs.length, 0);
  assert.equal(outcomesOf(harness.telemetry).totalAttempts, 0);
});

test('best-effort: a telemetry failure never changes the response and logs only a fixed code', async (t) => {
  const harness = createTelemetryHarness(t);
  harness.dependencies.supervisedAutonomyTelemetry = {
    record() {
      const error = new TypeError('secret query Juan Ficticio');
      error.code = 'TELEMETRY_INVALID_RECORD';
      throw error;
    },
  };
  const errors = t.mock.method(console, 'error', () => {});
  const withTelemetry = await requestChat('Explícame qué es una agenda digital.', harness.dependencies);
  assert.equal(withTelemetry.statusCode, 200);
  assert.deepEqual(errors.mock.calls.map((call) => call.arguments), [['[telemetry]', 'TELEMETRY_INVALID_RECORD']]);

  const baseline = createTelemetryHarness(t, { costController: undefined, supervisedAutonomyTelemetry: undefined });
  const withoutTelemetry = await requestChat('Explícame qué es una agenda digital.', baseline.dependencies);
  const strip = (payload) => ({ ...payload, interactionId: null });
  assert.deepEqual(strip(withTelemetry.getJson()), strip(withoutTelemetry.getJson()));
});

test('best-effort: a decide() failure never breaks the chat and records nothing', async (t) => {
  const harness = createTelemetryHarness(t);
  harness.dependencies.costController = { decide() { throw new Error('secret decide failure'); } };
  const errors = t.mock.method(console, 'error', () => {});
  const response = await requestChat('Explícame qué es una agenda digital.', harness.dependencies);
  assert.equal(response.statusCode, 200);
  assert.equal(harness.recordInputs.length, 0);
  assert.deepEqual(errors.mock.calls.map((call) => call.arguments), [['[telemetry]', 'TELEMETRY_ERROR']]);
});

test('without injected dependencies the chat behaves as before and never touches telemetry', async (t) => {
  const harness = createTelemetryHarness(t, { costController: undefined, supervisedAutonomyTelemetry: undefined });
  const response = await requestChat('Programa una reunión.', harness.dependencies);
  assert.equal(response.statusCode, 200);
  assert.equal(response.getJson().approval.status, 'pending');
  assert.equal(harness.decideInputs.length, 0);
  assert.equal(harness.recordInputs.length, 0);

  const partial = createTelemetryHarness(t, { supervisedAutonomyTelemetry: undefined });
  await requestChat('Explícame qué es una agenda digital.', partial.dependencies);
  assert.equal(partial.decideInputs.length, 0);
});

test('privacy: the snapshot, payload and executionLogger never carry query, identity or decision content', async (t) => {
  const harness = createTelemetryHarness(t);
  const query = 'Prepara un borrador para juan.ficticio@example.com sobre el Proyecto Zafiro-7731 con clave CLAVE-FICTICIA-9981.';
  const response = await requestChat(query, harness.dependencies);
  assert.equal(response.statusCode, 200);
  assert.equal(harness.recordInputs.length, 1);

  const snapshotText = JSON.stringify(harness.telemetry.snapshot());
  const [decision] = harness.decisions;
  for (const forbidden of [
    'juan.ficticio', 'example.com', 'Zafiro-7731', 'CLAVE-FICTICIA-9981', query,
    'query', 'email', 'missionId', 'prompt', 'evidence', 'evidenceHash', 'cacheKey',
    'modelId', 'pricingVersion', 'tokens', 'credential', 'usuario-cliente-cero',
    decision.evidence.evidenceHash, decision.evidence.timestamp,
  ]) {
    assert.equal(snapshotText.includes(forbidden), false, forbidden);
  }

  const payloadText = response.body;
  const loggerText = JSON.stringify(harness.logEntries);
  assert.equal(harness.logEntries.length, 1);
  for (const forbidden of [
    'costDecision', 'executionPattern', 'evidenceHash', 'cacheKey', 'costEstimate',
    'supervisedAutonomy', 'telemetry', decision.evidence.evidenceHash,
  ]) {
    assert.equal(payloadText.includes(forbidden), false, `payload: ${forbidden}`);
    assert.equal(loggerText.includes(forbidden), false, `logger: ${forbidden}`);
  }
});

test('security: executionEnabled stays false and no turn approves, executes or sends anything', async (t) => {
  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(serverSource, /executionEnabled: false,/);
  assert.doesNotMatch(serverSource, /executionEnabled: true/);

  const harness = createTelemetryHarness(t);
  const gmailSends = [];
  harness.dependencies.buildGmailPrivateContext = async () => privateContext('gmail', {
    source: 'gmail',
    messages: [{ from: 'Equipo <pilot@example.com>', subject: 'Seguimiento', date: '2026-07-20T08:00:00.000Z',
      unread: true, important: true, send() { gmailSends.push('send'); } }],
  });
  for (const query of [
    'Prepara una respuesta al último correo.', 'Programa una reunión.', '¿Qué reuniones tengo hoy?',
    'Crea una tarea.', '¿Qué tengo pendiente de aprobar?',
  ]) {
    const response = await requestChat(query, harness.dependencies);
    assert.equal(response.statusCode, 200);
  }
  assert.deepEqual(harness.forbiddenCalls, []);
  assert.deepEqual(gmailSends, []);
  for (const item of await harness.runtime.approvalQueue.listPending()) {
    assert.equal(item.status, 'pending');
  }
  assert.equal(outcomesOf(harness.telemetry).humanInterventionCount, 0);
});

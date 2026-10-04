'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { CostController } = require('../runtime/cost-controller');
const { DEFAULT_CATALOG } = require('../runtime/model-cost-catalog');
const { createSyntheticSecretProvider, createSecretRuntime } = require('../../security/secret-runtime');
const {
  SUPERVISION_STATUS,
  createEmailReplySupervisor,
  verifyEmailReplyDraft,
} = require('./email-reply-supervisor');
const {
  PROVIDER_STATUS,
  buildReasoningCostCatalog,
  createExecutiveReasoningProvider,
} = require('./executive-reasoning-provider');

const MODEL_ID = 'test:model';
// Simulates the explicit human approval the Privacy Gate requires before any
// email reaches a provider: this test provider and region only.
const APPROVED_CONFIDENTIAL_POLICY = Object.freeze({ publicExternalAllowed: true, internalProviders: [], confidentialProviders: [{ providerId: 'test', region: 'eu' }] });
const PRICED_CATALOG = {
  ...DEFAULT_CATALOG,
  [MODEL_ID]: {
    provider: 'test', tier: 'small_model', inputUsdPerMillion: 1, outputUsdPerMillion: 2,
    residency: 'external', privacy: 'provider_api', pricingVersion: 'test', pricingSource: 'test',
    reviewedAt: '2026-09-27',
  },
};

// Modeled on the real reference case (LucusHost ticket 162744).
const LUCUS_SUPPORT = Object.freeze({
  from: 'LucusHost <contacto@lucushost.com>',
  subject: 'Re: [Ticket ID: 162744] plan Hosting SSD Senior',
  date: 'Sat, 27 Sep 2026 09:10:00 +0200',
  text: 'Hola José Antonio, hemos resuelto la incidencia del correo en tu plan Hosting SSD Senior. '
    + '¿Puedes confirmarnos si ya recibes los mensajes correctamente? Quedamos pendientes del ticket.',
});
const LUCUS_DECISION = Object.freeze({
  ...LUCUS_SUPPORT,
  text: 'Hola José Antonio, tu plan Hosting SSD Senior vence pronto. '
    + 'Indícanos si deseas renovarlo por 12 o por 24 meses para preparar la factura.',
});
const GENERIC_TEMPLATE = 'Hola,\n\nHe revisado el asunto y propongo avanzar con prioridad.\n\nQuedo atento a confirmación.\n\nUn saludo,';

function provider(reason, overrides = {}) {
  const calls = [];
  return {
    calls,
    value: {
      status: PROVIDER_STATUS.READY, provider: 'test', model: 'model', modelId: MODEL_ID, region: 'eu', missing: [], catalog: {},
      async reason(request) { calls.push(request); return reason(request, calls.length); },
      ...overrides,
    },
  };
}

function ok(content) {
  return { status: 'ok', content, usage: { inputTokens: 300, outputTokens: 150 } };
}

function supervisorWith(reasoningProvider, options = {}) {
  const logs = [];
  const supervisor = createEmailReplySupervisor({
    provider: reasoningProvider,
    costController: options.costController || new CostController({ catalog: PRICED_CATALOG }),
    privacyPolicy: options.privacyPolicy || APPROVED_CONFIDENTIAL_POLICY,
    logger: (entry) => logs.push(entry),
  });
  return { supervisor, logs };
}

const GROUNDED_REPLY = {
  needsClarification: false,
  clarificationQuestion: null,
  replyBody: 'Hola,\n\nGracias por resolver la incidencia del correo del plan Hosting SSD Senior (ticket 162744). '
    + 'Lo compruebo hoy y os confirmo si ya recibo los mensajes correctamente.\n\nUn saludo,',
  evidence: ['hemos resuelto la incidencia del correo', '¿Puedes confirmarnos si ya recibes los mensajes correctamente?'],
  uncertainties: ['No sé todavía si los mensajes llegan bien; conviene comprobarlo antes de enviar.'],
};

test('A grounded reply to the LucusHost ticket passes Supervisor and Verifier as a contextual draft', async () => {
  const stub = provider(() => ok(GROUNDED_REPLY));
  const { supervisor, logs } = supervisorWith(stub.value);
  const result = await supervisor.supervise({ message: LUCUS_SUPPORT, instruction: 'Prepara una respuesta al segundo correo de contacto@lucushost.com' });

  assert.equal(result.status, SUPERVISION_STATUS.DRAFT);
  assert.match(result.body, /Hosting SSD Senior/);
  assert.match(result.body, /162744/);
  assert.doesNotMatch(result.body, /He revisado el asunto|propongo avanzar/);
  assert.deepEqual(result.warnings, [GROUNDED_REPLY.uncertainties[0]]);
  // The provider received the mission, the authorized source and the rules.
  assert.equal(stub.calls.length, 1);
  assert.equal(stub.calls[0].context.correoRecibido.text, LUCUS_SUPPORT.text);
  assert.ok(stub.calls[0].constraints.some((rule) => /No inventes datos/.test(rule)));
  // Cost routed through the CostController: verifier-gated small model.
  assert.equal(result.telemetry.costLevel, 'small_model');
  assert.equal(result.telemetry.executionPattern, 'verifier_gated');
});

test('B a reply that needs José\'s decision returns needsClarification and no draft', async () => {
  const stub = provider(() => ok({
    needsClarification: true,
    clarificationQuestion: '¿Quieres renovar el plan Hosting SSD Senior por 12 o por 24 meses?',
    replyBody: null,
    evidence: ['renovarlo por 12 o por 24 meses'],
    uncertainties: [],
  }));
  const { supervisor } = supervisorWith(stub.value);
  const result = await supervisor.supervise({ message: LUCUS_DECISION, instruction: 'Prepara una respuesta al correo de contacto@lucushost.com' });

  assert.equal(result.status, SUPERVISION_STATUS.NEEDS_CLARIFICATION);
  assert.equal(result.question, '¿Quieres renovar el plan Hosting SSD Senior por 12 o por 24 meses?');
  assert.equal(Object.hasOwn(result, 'body'), false);
  assert.equal(result.telemetry.needsClarification, true);
});

test('C invented, generic or committing content is rejected by the Verifier and never becomes a draft', async () => {
  const cases = [
    // The deterministic template this whole mission replaces.
    { replyBody: GENERIC_TEMPLATE, evidence: ['hemos resuelto la incidencia del correo'], expected: 'generic_content' },
    // Invented amount/date.
    {
      replyBody: 'Hola,\n\nSobre el plan Hosting SSD Senior, el pago de 59,90 euros se hará el 30/10.\n\nUn saludo,',
      evidence: ['plan Hosting SSD Senior'],
      expected: 'unsupported_fact',
    },
    // Evidence that is not in the source.
    {
      replyBody: 'Hola,\n\nGracias por resolver la incidencia del correo del plan Hosting SSD Senior.\n\nUn saludo,',
      evidence: ['el cliente ha pagado la factura'],
      expected: 'evidence_not_in_source',
    },
    // A decision José did not take.
    {
      replyBody: 'Hola,\n\nAcepto la renovación del plan Hosting SSD Senior por 24 meses como indicáis.\n\nUn saludo,',
      evidence: ['renovarlo por 12 o por 24 meses'],
      source: LUCUS_DECISION,
      expected: 'unauthorized_commitment',
    },
  ];
  for (const testCase of cases) {
    const source = testCase.source || LUCUS_SUPPORT;
    const verification = verifyEmailReplyDraft({
      content: { needsClarification: false, replyBody: testCase.replyBody, evidence: testCase.evidence },
      source,
      instruction: 'Prepara una respuesta al correo de contacto@lucushost.com',
    });
    assert.equal(verification.verdict, 'fail');
    assert.ok(verification.reasons.includes(testCase.expected), `${testCase.expected}: ${verification.reasons}`);

    const stub = provider(() => ok({ needsClarification: false, replyBody: testCase.replyBody, evidence: testCase.evidence }));
    const { supervisor } = supervisorWith(stub.value);
    const result = await supervisor.supervise({ message: source, instruction: 'Prepara una respuesta' });
    assert.equal(result.status, SUPERVISION_STATUS.REJECTED);
    assert.equal(Object.hasOwn(result, 'body'), false);
    // Back to the Supervisor with the cause: one corrective retry, then stop.
    assert.equal(stub.calls.length, 2);
    assert.match(stub.calls[1].context.correccionDelSupervisor, new RegExp(testCase.expected));
  }
});

test('C the Supervisor accepts a corrected second attempt after a Verifier rejection', async () => {
  const stub = provider((request, attempt) => ok(attempt === 1
    ? { needsClarification: false, replyBody: GENERIC_TEMPLATE, evidence: ['hemos resuelto la incidencia del correo'] }
    : GROUNDED_REPLY));
  const { supervisor } = supervisorWith(stub.value);
  const result = await supervisor.supervise({ message: LUCUS_SUPPORT, instruction: 'Prepara una respuesta' });
  assert.equal(result.status, SUPERVISION_STATUS.DRAFT);
  assert.equal(stub.calls.length, 2);
});

test('D provider failure is a safe error with no draft and no internal detail', async () => {
  const stub = provider(() => ({ status: 'error', errorCode: 'reasoning_upstream_error' }));
  const { supervisor, logs } = supervisorWith(stub.value);
  const result = await supervisor.supervise({ message: LUCUS_SUPPORT, instruction: 'Prepara una respuesta' });
  assert.equal(result.status, SUPERVISION_STATUS.PROVIDER_ERROR);
  assert.equal(Object.hasOwn(result, 'body'), false);
  assert.equal(logs.at(-1).errorCode, 'reasoning_upstream_error');
});

test('E without a configured provider the result is CONNECTION_NEEDED and no model is called', async () => {
  const notConfigured = createExecutiveReasoningProvider({
    env: {},
    secretRuntime: createSecretRuntime({ provider: createSyntheticSecretProvider({}) }),
  });
  assert.equal(notConfigured.status, PROVIDER_STATUS.NOT_CONFIGURED);
  assert.deepEqual(notConfigured.missing, [
    'OXKIO_REASONING_PROVIDER',
    'OXKIO_REASONING_MODEL',
    'OXKIO_REASONING_BASE_URL',
    'OXKIO_REASONING_INPUT_USD_PER_MILLION',
    'OXKIO_REASONING_OUTPUT_USD_PER_MILLION',
    'OXKIO_REASONING_PRICING_REVIEWED_AT',
    'OXKIO_REASONING_API_KEY',
  ]);
  assert.deepEqual(await notConfigured.reason({}), { status: 'not_configured' });

  const { supervisor } = supervisorWith(notConfigured);
  const result = await supervisor.supervise({ message: LUCUS_SUPPORT, instruction: 'Prepara una respuesta' });
  assert.equal(result.status, SUPERVISION_STATUS.CONNECTION_NEEDED);
  assert.deepEqual(result.missing, notConfigured.missing);
  assert.equal(Object.hasOwn(result, 'body'), false);
});

test('an unpriced model is blocked by the CostController before any model call', async () => {
  const stub = provider(() => ok(GROUNDED_REPLY));
  const { supervisor } = supervisorWith(stub.value, { costController: new CostController() });
  const result = await supervisor.supervise({ message: LUCUS_SUPPORT, instruction: 'Prepara una respuesta' });
  assert.equal(result.status, SUPERVISION_STATUS.BUDGET_BLOCKED);
  assert.equal(stub.calls.length, 0);
});

test('missing message text is insufficient context and never reaches the model', async () => {
  const stub = provider(() => ok(GROUNDED_REPLY));
  const { supervisor } = supervisorWith(stub.value);
  const result = await supervisor.supervise({ message: { ...LUCUS_SUPPORT, text: '   ' }, instruction: 'x' });
  assert.equal(result.status, SUPERVISION_STATUS.INSUFFICIENT_CONTEXT);
  assert.equal(stub.calls.length, 0);
});

test('telemetry carries only safe metadata: no email text, no draft body', async () => {
  const stub = provider(() => ok(GROUNDED_REPLY));
  const { supervisor, logs } = supervisorWith(stub.value);
  await supervisor.supervise({ message: LUCUS_SUPPORT, instruction: 'Prepara una respuesta' });
  assert.equal(logs.length, 1);
  assert.deepEqual(Object.keys(logs[0]).sort(), [
    'attempts', 'convergenceAction', 'costLevel', 'durationMs', 'errorCode', 'executionPattern', 'mission', 'model',
    'needsClarification', 'privacyClass', 'provider', 'reasoningRegion', 'supervisorDecision', 'verdict', 'verification',
  ]);
  assert.equal(logs[0].privacyClass, 'CONFIDENTIAL');
  const serialized = JSON.stringify(logs[0]);
  assert.equal(serialized.includes('incidencia'), false);
  assert.equal(serialized.includes('Hosting'), false);
});

test('configured provider: operator-reviewed pricing joins the cost catalog and output is parsed JSON', async () => {
  const requests = [];
  const configured = createExecutiveReasoningProvider({
    env: {
      OXKIO_REASONING_PROVIDER: 'openai',
      OXKIO_REASONING_MODEL: 'some-model',
      OXKIO_REASONING_BASE_URL: 'https://api.openai.com/v1',
      OXKIO_REASONING_INPUT_USD_PER_MILLION: '0.5',
      OXKIO_REASONING_OUTPUT_USD_PER_MILLION: '2',
      OXKIO_REASONING_PRICING_REVIEWED_AT: '2026-09-27',
    },
    secretRuntime: createSecretRuntime({ provider: createSyntheticSecretProvider({ OXKIO_REASONING_API_KEY: 'synthetic-key' }) }),
    adapters: {
      openai: ({ apiKey, model }) => {
        assert.equal(apiKey, 'synthetic-key');
        assert.equal(model, 'some-model');
        return async (request) => {
          requests.push(request);
          return { text: JSON.stringify({ needsClarification: false }), usage: { inputTokens: 10, outputTokens: 5 } };
        };
      },
    },
  });
  assert.equal(configured.status, PROVIDER_STATUS.READY);
  assert.equal(configured.modelId, 'openai:some-model');
  const catalog = buildReasoningCostCatalog(configured);
  const estimate = new CostController({ catalog }).estimateCost({ modelId: 'openai:some-model', inputTokens: 1_000_000, outputTokens: 0 });
  assert.equal(estimate.status, 'estimated');
  assert.equal(estimate.estimatedCostUsd, 0.5);

  const result = await configured.reason({ mission: 'M', context: { a: 1 }, constraints: ['R1'], output: { x: 1 } });
  assert.deepEqual(result.content, { needsClarification: false });
  assert.match(requests[0].system, /MISIÓN: M/);
  assert.match(requests[0].system, /- R1/);
  assert.equal(requests[0].user, JSON.stringify({ a: 1 }));
  assert.equal(JSON.stringify(configured).includes('synthetic-key'), false);
});

test('configured provider maps SDK failures and invalid JSON to fixed sanitized codes', async () => {
  const build = (complete) => createExecutiveReasoningProvider({
    env: {
      OXKIO_REASONING_PROVIDER: 'openai', OXKIO_REASONING_MODEL: 'm', OXKIO_REASONING_BASE_URL: 'https://eu.api.openai.com/v1',
      OXKIO_REASONING_INPUT_USD_PER_MILLION: '1', OXKIO_REASONING_OUTPUT_USD_PER_MILLION: '1',
      OXKIO_REASONING_PRICING_REVIEWED_AT: '2026-09-27',
    },
    secretRuntime: createSecretRuntime({ provider: createSyntheticSecretProvider({ OXKIO_REASONING_API_KEY: 'k' }) }),
    adapters: { openai: () => complete },
  });
  const failing = (status) => async () => { const error = new Error('secret upstream detail'); error.status = status; throw error; };
  assert.deepEqual(await build(failing(401)).reason({}), { status: 'error', errorCode: 'reasoning_auth_failed' });
  assert.deepEqual(await build(failing(429)).reason({}), { status: 'error', errorCode: 'reasoning_rate_limited' });
  assert.deepEqual(await build(failing(503)).reason({}), { status: 'error', errorCode: 'reasoning_upstream_error' });
  const invalid = await build(async () => ({ text: 'not json' })).reason({});
  assert.equal(invalid.errorCode, 'reasoning_invalid_output');
});

test('F-G-H the reasoning circuit never executes, never sends and never approves by itself', () => {
  for (const file of ['email-reply-supervisor.js', 'executive-reasoning-provider.js']) {
    const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
    assert.doesNotMatch(source, /gmail\.send|messages\.send|drafts\.(create|send)|\.send\(/);
    assert.doesNotMatch(source, /approvalQueue|addPreparedEmailDraft|\.approve\(|execute-approved/);
    assert.doesNotMatch(source, /executionEnabled\s*:\s*true/);
  }
  const server = fs.readFileSync(path.join(__dirname, '..', '..', 'api', 'server.js'), 'utf8');
  assert.match(server, /executionEnabled: false,/);
  assert.doesNotMatch(server, /executionEnabled: true/);
  const oauth = fs.readFileSync(path.join(__dirname, '..', '..', 'integrations', 'googleOAuth.js'), 'utf8');
  const scopes = oauth.slice(oauth.indexOf('GOOGLE_OAUTH_SCOPES = '), oauth.indexOf(']);', oauth.indexOf('GOOGLE_OAUTH_SCOPES = ')));
  assert.doesNotMatch(scopes, /GMAIL_SEND_SCOPE|gmail\.send/);
});

// ---------------------------------------------------------------------------
// EU data routing (27/09/2026): explicit, allowlisted OpenAI endpoint.
// ---------------------------------------------------------------------------

const DIRECTION_ENV = Object.freeze({
  OXKIO_REASONING_PROVIDER: 'openai',
  OXKIO_REASONING_MODEL: 'gpt-5.6-terra',
  OXKIO_REASONING_INPUT_USD_PER_MILLION: '2.00',
  OXKIO_REASONING_OUTPUT_USD_PER_MILLION: '12.00',
  OXKIO_REASONING_PRICING_REVIEWED_AT: '2026-09-27',
});

function syntheticKeyRuntime() {
  return createSecretRuntime({ provider: createSyntheticSecretProvider({ OXKIO_REASONING_API_KEY: 'sk-synthetic' }) });
}

// Intercepts global fetch (used by the real openai SDK) for one test.
async function withInterceptedFetch(t, run) {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), body: init && init.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify({
      id: 'x', object: 'chat.completion', created: 0, model: 'gpt-5.6-terra',
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '{"needsClarification":false}' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  t.after(() => { globalThis.fetch = original; });
  await run(requests);
}

test('EU-A without OXKIO_REASONING_BASE_URL: CONNECTION_NEEDED and no external call', async (t) => {
  await withInterceptedFetch(t, async (requests) => {
    const reasoning = createExecutiveReasoningProvider({ env: DIRECTION_ENV, secretRuntime: syntheticKeyRuntime() });
    assert.equal(reasoning.status, PROVIDER_STATUS.NOT_CONFIGURED);
    assert.deepEqual(reasoning.missing, ['OXKIO_REASONING_BASE_URL']);
    assert.deepEqual(reasoning.invalid, []);
    const { supervisor } = supervisorWith(reasoning);
    const result = await supervisor.supervise({ message: LUCUS_SUPPORT, instruction: 'Prepara una respuesta' });
    assert.equal(result.status, SUPERVISION_STATUS.CONNECTION_NEEDED);
    assert.deepEqual(requests, []);
  });
});

test('EU-B allowlisted global base URL: the real client calls exactly api.openai.com', async (t) => {
  await withInterceptedFetch(t, async (requests) => {
    const reasoning = createExecutiveReasoningProvider({
      env: { ...DIRECTION_ENV, OXKIO_REASONING_BASE_URL: 'https://api.openai.com/v1' },
      secretRuntime: syntheticKeyRuntime(),
    });
    assert.equal(reasoning.status, PROVIDER_STATUS.READY);
    assert.equal(reasoning.region, 'global');
    await reasoning.reason({ mission: 'M', context: {}, constraints: [], output: {} });
    assert.equal(requests.length, 1);
    assert.equal(new URL(requests[0].url).host, 'api.openai.com');
    assert.equal(requests[0].url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(requests[0].body.model, 'gpt-5.6-terra');
  });
});

test('EU-C EU base URL: the real client calls exactly eu.api.openai.com, priced with the 10% EU surcharge', async (t) => {
  await withInterceptedFetch(t, async (requests) => {
    const reasoning = createExecutiveReasoningProvider({
      env: { ...DIRECTION_ENV, OXKIO_REASONING_BASE_URL: 'https://eu.api.openai.com/v1/' },
      secretRuntime: syntheticKeyRuntime(),
    });
    assert.equal(reasoning.status, PROVIDER_STATUS.READY);
    assert.equal(reasoning.region, 'eu');
    await reasoning.reason({ mission: 'M', context: {}, constraints: [], output: {} });
    assert.equal(requests.length, 1);
    assert.equal(new URL(requests[0].url).host, 'eu.api.openai.com');
    assert.equal(requests[0].url, 'https://eu.api.openai.com/v1/chat/completions');

    const entry = reasoning.catalog['openai:gpt-5.6-terra'];
    assert.equal(entry.inputUsdPerMillion, 2.2);
    assert.equal(entry.outputUsdPerMillion, 13.2);
    assert.equal(entry.reviewedAt, '2026-09-27');
    assert.equal(entry.residency, 'eu');
    const controller = new CostController({ catalog: buildReasoningCostCatalog(reasoning) });
    const estimate = controller.estimateCost({ modelId: 'openai:gpt-5.6-terra', inputTokens: 1_000_000, outputTokens: 1_000_000 });
    assert.equal(estimate.status, 'estimated');
    assert.equal(estimate.estimatedCostUsd, 15.4);
  });
});

test('EU-D a base URL outside the allowlist is an invalid configuration and never called', async (t) => {
  await withInterceptedFetch(t, async (requests) => {
    for (const baseUrl of [
      'https://evil.example.com/v1',
      'http://eu.api.openai.com/v1',
      'https://eu.api.openai.com/v2',
      'https://eu.api.openai.com.attacker.net/v1',
      'https://api.openai.com/v1?x=1',
    ]) {
      const reasoning = createExecutiveReasoningProvider({
        env: { ...DIRECTION_ENV, OXKIO_REASONING_BASE_URL: baseUrl },
        secretRuntime: syntheticKeyRuntime(),
      });
      assert.equal(reasoning.status, PROVIDER_STATUS.NOT_CONFIGURED, baseUrl);
      assert.deepEqual(reasoning.invalid, ['OXKIO_REASONING_BASE_URL']);
      assert.deepEqual(reasoning.missing, []);
      const { supervisor } = supervisorWith(reasoning);
      const result = await supervisor.supervise({ message: LUCUS_SUPPORT, instruction: 'Prepara una respuesta' });
      assert.equal(result.status, SUPERVISION_STATUS.CONNECTION_NEEDED);
    }
    assert.deepEqual(requests, []);
  });
});

test('EU-E telemetry records only the configured region, never email or draft content', async () => {
  for (const [region, expected] of [['eu', 'eu'], ['global', 'global']]) {
    const stub = provider(() => ok(GROUNDED_REPLY), { region });
    // The region checked here is the region explicitly approved for mail.
    const { supervisor, logs } = supervisorWith(stub.value, { privacyPolicy: { confidentialProviders: [{ providerId: 'test', region }] } });
    const result = await supervisor.supervise({ message: LUCUS_SUPPORT, instruction: 'Prepara una respuesta' });
    assert.equal(result.status, SUPERVISION_STATUS.DRAFT);
    assert.equal(logs[0].reasoningRegion, expected);
    const serialized = JSON.stringify(logs[0]);
    for (const fragment of ['incidencia', 'Hosting SSD', 'Gracias por resolver', '162744', 'contacto@lucushost.com']) {
      assert.equal(serialized.includes(fragment), false, fragment);
    }
  }
});

// XATAI CORE V1 integration: every outcome carries a structured Supervisor
// Decision, the Verifier Contract verdict and the Convergence Sentinel action.
test('XATAI a verified draft is NEEDS_APPROVAL (A1, human gate), never CAN_EXECUTE', async () => {
  const stub = provider(() => ok(GROUNDED_REPLY));
  const { supervisor, logs } = supervisorWith(stub.value);
  const result = await supervisor.supervise({ message: LUCUS_SUPPORT, instruction: 'Prepara una respuesta' });
  assert.equal(result.status, SUPERVISION_STATUS.DRAFT);
  assert.equal(result.decision.decision, 'NEEDS_APPROVAL');
  assert.equal(result.decision.capabilityId, 'gmail.draft');
  assert.equal(logs[0].verification, 'PASS');
  assert.equal(logs[0].supervisorDecision, 'NEEDS_APPROVAL');
  assert.equal(logs[0].convergenceAction, null);
});

test('XATAI verifier rejection retries with CHANGE_HYPOTHESIS, then escalates to a human and blocks', async () => {
  const stub = provider(() => ok({ needsClarification: false, replyBody: GENERIC_TEMPLATE, evidence: ['hemos resuelto la incidencia del correo'] }));
  const { supervisor, logs } = supervisorWith(stub.value);
  const result = await supervisor.supervise({ message: LUCUS_SUPPORT, instruction: 'Prepara una respuesta' });
  assert.equal(result.status, SUPERVISION_STATUS.REJECTED);
  assert.equal(stub.calls.length, 2);
  // The retry changed the attempt (corrective feedback), it never repeated it.
  assert.equal(stub.calls[0].context.correccionDelSupervisor, undefined);
  assert.ok(stub.calls[1].context.correccionDelSupervisor);
  assert.equal(logs[0].verification, 'FAIL');
  assert.equal(logs[0].convergenceAction, 'ESCALATE_HUMAN');
  assert.equal(result.decision.decision, 'BLOCKED');
  assert.equal(result.decision.reason, 'verification_failed');
});

test('XATAI invalid JSON is corrected with REFINE_PROMPT before escalating', async () => {
  const stub = provider((request, attempt) => (attempt === 1
    ? { status: 'error', errorCode: 'reasoning_invalid_output' }
    : ok(GROUNDED_REPLY)));
  const { supervisor, logs } = supervisorWith(stub.value);
  const result = await supervisor.supervise({ message: LUCUS_SUPPORT, instruction: 'Prepara una respuesta' });
  assert.equal(result.status, SUPERVISION_STATUS.DRAFT);
  assert.equal(stub.calls.length, 2);
  assert.equal(logs[0].convergenceAction, 'REFINE_PROMPT');
});

test('XATAI provider auth failure is NEEDS_CONNECTION with ESCALATE_HUMAN and no retry', async () => {
  const stub = provider(() => ({ status: 'error', errorCode: 'reasoning_auth_failed' }));
  const { supervisor, logs } = supervisorWith(stub.value);
  const result = await supervisor.supervise({ message: LUCUS_SUPPORT, instruction: 'Prepara una respuesta' });
  assert.equal(result.status, SUPERVISION_STATUS.PROVIDER_ERROR);
  assert.equal(stub.calls.length, 1);
  assert.equal(result.decision.decision, 'NEEDS_CONNECTION');
  assert.equal(logs[0].convergenceAction, 'ESCALATE_HUMAN');
});

test('XATAI clarification, missing context, missing provider and budget map to structured decisions', async () => {
  const clarify = provider(() => ok({
    needsClarification: true, clarificationQuestion: '¿Renuevo por 12 o por 24 meses?', replyBody: null, evidence: [], uncertainties: [],
  }));
  const clarification = await supervisorWith(clarify.value).supervisor
    .supervise({ message: LUCUS_DECISION, instruction: 'Prepara una respuesta' });
  assert.equal(clarification.decision.decision, 'NEEDS_INFORMATION');

  const empty = await supervisorWith(provider(() => ok(GROUNDED_REPLY)).value).supervisor
    .supervise({ message: { ...LUCUS_SUPPORT, text: '' }, instruction: 'x' });
  assert.equal(empty.decision.decision, 'NEEDS_INFORMATION');

  const unconfigured = await supervisorWith({ status: PROVIDER_STATUS.NOT_CONFIGURED, missing: ['OXKIO_REASONING_API_KEY'] })
    .supervisor.supervise({ message: LUCUS_SUPPORT, instruction: 'x' });
  assert.equal(unconfigured.decision.decision, 'NEEDS_CONNECTION');

  const budget = await supervisorWith(provider(() => ok(GROUNDED_REPLY)).value, { costController: new CostController() })
    .supervisor.supervise({ message: LUCUS_SUPPORT, instruction: 'x' });
  assert.equal(budget.decision.decision, 'BLOCKED');
  assert.equal(budget.decision.reason, 'budget_blocked');
});

// P1 Privacy Gate (04/10/2026): no email content reaches any reasoning
// provider unless the canonical Privacy Gate allows it. Synthetic data only.
// A blocked case must make zero provider calls and zero cost decisions.
function countingCostController() {
  const counts = { decide: 0, estimate: 0 };
  const real = new CostController({ catalog: PRICED_CATALOG });
  return { counts, controller: {
    decide: (input) => { counts.decide += 1; return real.decide(input); },
    estimateCost: (input) => { counts.estimate += 1; return real.estimateCost(input); },
  } };
}
const { DEFAULT_PRIVACY_POLICY } = require('./privacy-gate');
const AUTHORIZATION_B_POLICY = { publicExternalAllowed: true, internalProviders: [{ providerId: 'test' }], confidentialProviders: [] };
const PII_MESSAGE = { from: 'Ana Pérez <ana.perez@example.test>', subject: 'Datos para la factura', date: '2026-10-04',
  text: 'Hola José Antonio, para emitir la factura necesito que confirmes tu IBAN ES91 2100 0418 4502 0005 1332 y tu teléfono +34 600 123 456.' };

test('Privacy Gate: blocked mail makes zero provider calls and zero cost decisions (PUBLIC/INTERNAL/CONFIDENTIAL/SECRET/PII)', async (t) => {
  const cases = [
    ['canonical runtime policy (no CONFIDENTIAL provider)', DEFAULT_PRIVACY_POLICY, LUCUS_SUPPORT, 'Prepara una respuesta', 'CONFIDENTIAL', 'confidential_provider_not_allowed'],
    ['PUBLIC-only approval never opens mail', { publicExternalAllowed: true, internalProviders: [], confidentialProviders: [] }, LUCUS_SUPPORT, 'Prepara una respuesta', 'CONFIDENTIAL', 'confidential_provider_not_allowed'],
    ['INTERNAL approval (authorization B) never opens mail', AUTHORIZATION_B_POLICY, LUCUS_SUPPORT, 'Prepara una respuesta', 'CONFIDENTIAL', 'confidential_provider_not_allowed'],
    ['PII in the message stays CONFIDENTIAL and blocked', AUTHORIZATION_B_POLICY, PII_MESSAGE, 'Prepara una respuesta', 'CONFIDENTIAL', 'confidential_provider_not_allowed'],
    ['SECRET marker in the message never leaves, even with CONFIDENTIAL approved', APPROVED_CONFIDENTIAL_POLICY, { ...LUCUS_SUPPORT, text: `${LUCUS_SUPPORT.text} Tu nueva password: Xk9-temporal` }, 'Prepara una respuesta', 'SECRET', 'secret_never_external'],
    ['SECRET marker in the instruction never leaves', APPROVED_CONFIDENTIAL_POLICY, LUCUS_SUPPORT, 'Respóndele y añade api_key=abc123def456', 'SECRET', 'secret_never_external'],
    ['approved provider in another region is blocked', { confidentialProviders: [{ providerId: 'test', region: 'global' }] }, LUCUS_SUPPORT, 'Prepara una respuesta', 'CONFIDENTIAL', 'confidential_provider_not_allowed'],
  ];
  for (const [name, policy, message, instruction, privacyClass, reason] of cases) {
    await t.test(name, async () => {
      const stub = provider(() => ok(GROUNDED_REPLY));
      const cost = countingCostController(); const logs = [];
      const supervisor = createEmailReplySupervisor({ provider: stub.value, costController: cost.controller, privacyPolicy: policy, logger: (entry) => logs.push(entry) });
      const result = await supervisor.supervise({ message, instruction });
      assert.equal(result.status, SUPERVISION_STATUS.PRIVACY_BLOCKED);
      assert.equal(stub.calls.length, 0, 'no provider call');
      assert.deepEqual(cost.counts, { decide: 0, estimate: 0 }, 'no cost decision');
      assert.equal(result.telemetry.privacyClass, privacyClass);
      assert.equal(result.telemetry.errorCode, reason);
      assert.equal(result.decision.decision === 'CAN_EXECUTE', false);
      const serialized = JSON.stringify(logs);
      for (const fragment of ['Hosting', 'IBAN', 'ES91', '600 123', 'Xk9-temporal', 'abc123def456', 'ana.perez']) assert.equal(serialized.includes(fragment), false, fragment);
    });
  }
});

test('Privacy Gate: only an explicit CONFIDENTIAL approval for this provider and region lets mail through (positive control)', async () => {
  const stub = provider(() => ok(GROUNDED_REPLY));
  const cost = countingCostController();
  const supervisor = createEmailReplySupervisor({ provider: stub.value, costController: cost.controller, privacyPolicy: APPROVED_CONFIDENTIAL_POLICY, logger: () => {} });
  const result = await supervisor.supervise({ message: LUCUS_SUPPORT, instruction: 'Prepara una respuesta' });
  assert.equal(result.status, SUPERVISION_STATUS.DRAFT);
  assert.equal(stub.calls.length, 1); assert.equal(cost.counts.decide, 1);
  assert.equal(result.telemetry.privacyClass, 'CONFIDENTIAL');
});

test('Privacy Gate: a provider without a declared region can never receive mail, whatever the policy', async () => {
  const stub = provider(() => ok(GROUNDED_REPLY), { region: undefined });
  const supervisor = createEmailReplySupervisor({ provider: stub.value, costController: countingCostController().controller,
    privacyPolicy: { confidentialProviders: [{ providerId: 'test', region: undefined }] }, logger: () => {} });
  const result = await supervisor.supervise({ message: LUCUS_SUPPORT, instruction: 'Prepara una respuesta' });
  assert.equal(result.status, SUPERVISION_STATUS.PRIVACY_BLOCKED); assert.equal(stub.calls.length, 0);
});

test('Privacy Gate: the default supervisor (as composed by server.js) blocks mail', async () => {
  const stub = provider(() => ok(GROUNDED_REPLY));
  const supervisor = createEmailReplySupervisor({ provider: stub.value, costController: new CostController({ catalog: PRICED_CATALOG }), logger: () => {} });
  const result = await supervisor.supervise({ message: LUCUS_SUPPORT, instruction: 'Prepara una respuesta' });
  assert.equal(result.status, SUPERVISION_STATUS.PRIVACY_BLOCKED); assert.equal(stub.calls.length, 0);
});

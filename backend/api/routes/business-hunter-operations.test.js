'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Readable, Writable } = require('node:stream');
const test = require('node:test');

const {
  handleBusinessHunterOperationRequest,
  isBusinessHunterOperationRoute,
} = require('./business-hunter-operations');

function createRequest(payload = {}, method = 'POST', contentType = 'application/json') {
  const request = Readable.from([JSON.stringify(payload)]);
  request.method = method;
  request.url = '/api/operations/business-hunter/run';
  request.headers = contentType ? { 'content-type': contentType } : {};
  return request;
}

function createResponse() {
  const chunks = [];
  const response = new Writable({
    write(chunk, encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });
  response.writeHead = (statusCode, headers) => {
    response.statusCode = statusCode;
    response.headers = headers;
  };
  response.getJson = () => JSON.parse(Buffer.concat(chunks).toString('utf8'));
  return response;
}

test('matches the official manual readonly route', () => {
  assert.equal(isBusinessHunterOperationRoute('/api/operations/business-hunter/run', 'POST'), true);
  assert.equal(isBusinessHunterOperationRoute('/api/operations/business-hunter/run', 'GET'), false);
  assert.equal(isBusinessHunterOperationRoute('/api/operations/business-hunter/other', 'POST'), false);
});

test('handles authenticated readonly execution with no-store response and ignores client fields', async () => {
  const response = createResponse();
  let capturedOptions = null;
  const coordinator = {
    async runBusinessAnalysis(options) {
      capturedOptions = options;
      return {
        operationId: 'operation-id',
        interactionId: 'interaction-id',
        worker: 'business-hunter-readonly',
        mode: 'manual',
        status: 'completed',
        startedAt: '2026-07-21T10:00:00.000Z',
        completedAt: '2026-07-21T10:00:01.000Z',
        durationMs: 1000,
        sourceStatus: 'real',
        summary: 'Business Hunter local ha devuelto 1 oportunidad sanitizada.',
        opportunities: [],
        recommendations: ['Revisar las oportunidades sanitizadas.'],
        proposalCreated: false,
        approvalId: null,
        errors: [],
      };
    },
  };

  await handleBusinessHunterOperationRequest(
    createRequest({
      worker: 'evil',
      runtime: 'production',
      executionEnabled: true,
      dependencies: { fake: true },
      paths: ['/tmp/secret'],
    }),
    response,
    {
      operationsCoordinator: coordinator,
      getIdentity: () => ({
        clientId: 'cliente-cero',
        expectedClientId: 'cliente-cero',
        authorization: { status: 'granted', provider: 'google-oauth' },
      }),
    },
  );

  const body = response.getJson();
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.equal(capturedOptions && typeof capturedOptions === 'object', true);
  assert.deepEqual(Object.keys(capturedOptions), ['identity']);
  assert.equal(body.worker, 'business-hunter-readonly');
  assert.equal(body.mode, 'manual');
  assert.equal(body.proposalCreated, false);
  assert.equal(body.approvalId, null);
  assert.equal(Array.isArray(body.errors), true);
  assert.equal(body.executionEnabled, undefined);
  assert.equal(JSON.stringify(body).includes('/tmp/secret'), false);
});

test('fails closed for invalid method, invalid content type, invalid JSON and concurrency conflicts', async () => {
  const deniedResponse = createResponse();
  await handleBusinessHunterOperationRequest(
    createRequest({}, 'GET'),
    deniedResponse,
    { operationsCoordinator: { runBusinessAnalysis() {} } },
  );
  assert.equal(deniedResponse.statusCode, 405);

  const contentTypeResponse = createResponse();
  await handleBusinessHunterOperationRequest(
    createRequest({}, 'POST', 'text/plain'),
    contentTypeResponse,
    {
      operationsCoordinator: { runBusinessAnalysis() {} },
      getIdentity: () => ({
        clientId: 'cliente-cero',
        expectedClientId: 'cliente-cero',
        authorization: { status: 'granted', provider: 'google-oauth' },
      }),
    },
  );
  assert.equal(contentTypeResponse.statusCode, 400);

  const invalidJsonRequest = Readable.from(['{']);
  invalidJsonRequest.method = 'POST';
  invalidJsonRequest.url = '/api/operations/business-hunter/run';
  invalidJsonRequest.headers = { 'content-type': 'application/json' };
  const invalidJsonResponse = createResponse();
  await handleBusinessHunterOperationRequest(
    invalidJsonRequest,
    invalidJsonResponse,
    {
      operationsCoordinator: { runBusinessAnalysis() { return Promise.resolve({}); } },
      getIdentity: () => ({
        clientId: 'cliente-cero',
        expectedClientId: 'cliente-cero',
        authorization: { status: 'granted', provider: 'google-oauth' },
      }),
    },
  );
  assert.equal(invalidJsonResponse.statusCode, 400);

  const conflictResponse = createResponse();
  await handleBusinessHunterOperationRequest(
    createRequest({}, 'POST'),
    conflictResponse,
    {
      operationsCoordinator: {
        runBusinessAnalysis() {
          const error = new Error('busy');
          error.code = 'business_hunter_operation_in_progress';
          throw error;
        },
      },
      getIdentity: () => ({
        clientId: 'cliente-cero',
        expectedClientId: 'cliente-cero',
        authorization: { status: 'granted', provider: 'google-oauth' },
      }),
    },
  );
  assert.equal(conflictResponse.statusCode, 409);
  assert.equal(conflictResponse.getJson().message, 'Ya existe un análisis en curso.');
});

test('translates timeout and invalid result failures without changing their HTTP contracts', async () => {
  const identity = () => ({
    clientId: 'cliente-cero',
    expectedClientId: 'cliente-cero',
    authorization: { status: 'granted', provider: 'google-oauth' },
  });
  const cases = [
    ['business_hunter_timeout', 504, /tardó más de lo permitido/i],
    ['invalid_worker_result', 500, /comprobaciones de seguridad/i],
  ];

  for (const [code, expectedStatus, expectedMessage] of cases) {
    const response = createResponse();
    await handleBusinessHunterOperationRequest(createRequest({}), response, {
      getIdentity: identity,
      operationsCoordinator: {
        runBusinessAnalysis() { throw Object.assign(new Error('internal detail'), { code }); },
      },
    });
    assert.equal(response.statusCode, expectedStatus);
    assert.match(response.getJson().message, expectedMessage);
    assert.equal(JSON.stringify(response.getJson()).includes('internal detail'), false);
  }
});

test('dashboard markup exposes the readonly business analysis card and sanitized copy', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'app', 'executive-dashboard.html'), 'utf8');

  assert.match(html, /data-business-hunter-operation/);
  assert.match(html, /Analizar Business/);
  assert.match(html, /Revisar conocimiento/);
  assert.match(html, /Revisar memoria/);
  assert.match(html, /Revisar correo/);
  assert.match(html, /Revisar agenda/);
  assert.match(html, /\/api\/operations\/knowledge\/run/);
  assert.match(html, /\/api\/operations\/memory\/run/);
  assert.match(html, /\/api\/operations\/gmail\/run/);
  assert.match(html, /\/api\/operations\/calendar\/run/);
  assert.match(html, /data-knowledge-topics/);
  assert.match(html, /data\.worker === "knowledge-readonly"/);
  assert.match(html, /data\.worker === "memory-readonly"/);
  assert.match(html, /data\.worker === "gmail-readonly"/);
  assert.match(html, /data\.worker === "calendar-readonly"/);
  assert.match(html, /Hay información disponible, aunque todavía es limitada o incompleta/);
  assert.match(html, /Solo análisis\. No se contacta ni se ejecutan acciones\./);
  assert.match(html, /data-bh-execution-enabled/);
  assert.match(html, /window\.oxkioAuthenticatedFetch\("\/api\/operations\/business-hunter\/run"/);
  assert.doesNotMatch(html, /signOut\(firebaseAuth\)|oxkioLogout|data-logout-button/);
  assert.match(html, /data-back-link href="\/">Atrás<\/a>/);
  assert.match(html, /\.btn-secondary\s*\{[\s\S]*?min-height:\s*44px/);
  assert.match(html, /initializeBusinessHunterOperation\(\)/);
  assert.match(html, /renderBusinessHunterOperation\(state\.operations && state\.operations\.businessHunter\)/);
  assert.match(html, /data-bh-phase/);
  assert.match(html, /data-bh-recent-operations/);
  assert.match(html, /operations\.slice\(0, 3\)/);
  assert.doesNotMatch(html, />Cancelar</);
  assert.doesNotMatch(html, /data-worker-selector|data-scheduler/);
  assert.match(html, /typeof item === "string"/);
  assert.match(html, /Array\.isArray\(businessResult\.opportunities\) \? businessResult\.opportunities\.length : 0/);
  assert.doesNotMatch(html, /innerHTML/);
});

test('operations card presents internal values in executive language without changing the contract vocabulary', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'app', 'executive-dashboard.html'), 'utf8');
  const cardStart = html.indexOf('<article class="panel span-12 dashboard-operations"');
  const cardEnd = html.indexOf('</article>', cardStart);
  const visibleCardText = html.slice(cardStart, cardEnd).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

  [
    'Módulo responsable', 'Análisis comercial', 'Iniciado por José Antonio',
    'Acciones reales', 'Desactivadas', 'Información no disponible', 'Actividad reciente',
    'No se ha preparado ninguna propuesta', 'No hay ninguna aprobación pendiente',
  ].forEach((label) => assert.match(visibleCardText, new RegExp(label, 'i')));
  ['business-hunter-readonly', 'executionEnabled=false', 'documentary_evidence', 'sourceStatus', 'null', 'undefined', 'Markdown']
    .forEach((technical) => assert.equal(visibleCardText.includes(technical), false));

  assert.match(html, /running_worker:\s*"Analizando información"/);
  assert.match(html, /validating_result:\s*"Verificando el resultado"/);
  assert.match(html, /real:\s*"Información disponible"/);
  assert.match(html, /partial:\s*"Información parcial disponible"/);
  assert.match(html, /unavailable:\s*"Información no disponible"/);
  assert.match(html, /data\.mode === "manual" \? "Iniciado por José Antonio"/);
  assert.match(html, /data\.executionEnabled === true \? "Activadas" : "Desactivadas"/);
  assert.match(html, /No representa todavía una empresa o lead verificado/);
  assert.match(html, /operation\.result && typeof operation\.result === "object"/);
  assert.doesNotMatch(html, /title\.textContent\s*=\s*operation\.operationId|detail\.textContent[\s\S]{0,80}interactionId/);
  assert.doesNotMatch(html, /innerHTML/);
});

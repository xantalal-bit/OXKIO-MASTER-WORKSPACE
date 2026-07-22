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
  const service = {
    async runBusinessHunterReadonly(options) {
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
      businessHunterService: service,
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
  assert.equal(body.worker, 'business-hunter-readonly');
  assert.equal(body.mode, 'manual');
  assert.equal(body.proposalCreated, false);
  assert.equal(body.approvalId, null);
  assert.equal(Array.isArray(body.errors), true);
  assert.equal(JSON.stringify(body).includes('/tmp/secret'), false);
});

test('fails closed for invalid method, invalid content type, invalid JSON and concurrency conflicts', async () => {
  const deniedResponse = createResponse();
  await handleBusinessHunterOperationRequest(
    createRequest({}, 'GET'),
    deniedResponse,
    { businessHunterService: { runBusinessHunterReadonly() {} } },
  );
  assert.equal(deniedResponse.statusCode, 405);

  const contentTypeResponse = createResponse();
  await handleBusinessHunterOperationRequest(
    createRequest({}, 'POST', 'text/plain'),
    contentTypeResponse,
    {
      businessHunterService: { runBusinessHunterReadonly() {} },
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
      businessHunterService: { runBusinessHunterReadonly() { return Promise.resolve({}); } },
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
      businessHunterService: {
        runBusinessHunterReadonly() {
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
});

test('dashboard markup exposes the readonly business analysis card and sanitized copy', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'app', 'executive-dashboard.html'), 'utf8');

  assert.match(html, /data-business-hunter-operation/);
  assert.match(html, /Analizar Business/);
  assert.match(html, /Solo análisis\. No se contacta ni se ejecutan acciones\./);
  assert.match(html, /data-bh-execution-enabled/);
  assert.match(html, /window\.oxkioAuthenticatedFetch\("\/api\/operations\/business-hunter\/run"/);
  assert.match(html, /signOut\(firebaseAuth\)/);
  assert.match(html, /data-logout-button/);
  assert.match(html, /\.btn-secondary\s*\{[\s\S]*?min-height:\s*44px/);
  assert.match(html, /window\.oxkioLogout = async function\(\)/);
  assert.match(html, /initializeBusinessHunterOperation\(\)/);
  assert.match(html, /renderBusinessHunterOperation\(state\.operations && state\.operations\.businessHunter\)/);
  assert.match(html, /typeof item === "string"/);
  assert.match(html, /Array\.isArray\(data\.opportunities\) \? data\.opportunities\.length : 0/);
  assert.doesNotMatch(html, /innerHTML/);
});

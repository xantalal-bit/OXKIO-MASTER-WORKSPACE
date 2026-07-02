'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable, Writable } = require('stream');
const {
  handleExecutiveChatRequest,
  isExecutiveChatRoute,
} = require('./executive-chat');

function createRequest(body) {
  const request = Readable.from([body]);

  request.method = 'POST';
  request.url = '/api/executive/chat';

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

test('matches POST /api/executive/chat', () => {
  assert.equal(isExecutiveChatRoute('/api/executive/chat', 'POST'), true);
  assert.equal(isExecutiveChatRoute('/api/executive/chat', 'GET'), false);
  assert.equal(isExecutiveChatRoute('/api/chat', 'POST'), false);
});

test('returns orchestrator response for a valid query', async () => {
  let calledWith = null;
  const request = createRequest(JSON.stringify({ query: 'Resumen del roadmap de Oxkio' }));
  const response = createResponse();

  await handleExecutiveChatRequest(request, response, {
    dependencies: {
      orchestrateExecutiveQuery(query) {
        calledWith = query;

        return {
          query,
          analysis: {
            intent: 'roadmap',
            project: 'Oxkio',
            documentTypes: ['Roadmap'],
            keywords: [],
            filters: {},
            priority: 'medium',
            confidence: 0.8,
          },
          response: 'Respuesta simulada.',
          confidence: 0.7,
          sources: [],
          limitations: ['Simulation only.'],
        };
      },
    },
  });

  const payload = response.getJson();

  assert.equal(response.statusCode, 200);
  assert.equal(calledWith, 'Resumen del roadmap de Oxkio');
  assert.deepEqual(Object.keys(payload), [
    'query',
    'analysis',
    'response',
    'confidence',
    'sources',
    'limitations',
  ]);
  assert.equal(payload.query, 'Resumen del roadmap de Oxkio');
});

test('rejects missing query', async () => {
  const request = createRequest(JSON.stringify({ query: '' }));
  const response = createResponse();

  await handleExecutiveChatRequest(request, response, {
    dependencies: {
      orchestrateExecutiveQuery() {
        throw new Error('orchestrator should not be called');
      },
    },
  });

  const payload = response.getJson();

  assert.equal(response.statusCode, 400);
  assert.equal(payload.ok, false);
  assert.equal(payload.error, 'query is required.');
});

test('rejects invalid JSON', async () => {
  const request = createRequest('{invalid');
  const response = createResponse();

  await handleExecutiveChatRequest(request, response);

  const payload = response.getJson();

  assert.equal(response.statusCode, 400);
  assert.equal(payload.ok, false);
  assert.equal(payload.error, 'Invalid JSON body.');
});

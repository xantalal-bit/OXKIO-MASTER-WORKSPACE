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

function buildPrivateContext(overrides = {}) {
  return {
    clientId: 'client-alpha',
    userId: 'user-alpha',
    scope: 'private:user',
    sensitivity: 'confidential',
    sourceType: 'agenda-ficticia',
    sourceId: 'agenda-source-alpha',
    authorization: { status: 'granted' },
    purpose: 'executive-context',
    retentionPolicy: 'CLIENT_CONTROLLED',
    promotionPolicy: 'NEVER_PROMOTE',
    ...overrides,
  };
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
          sources: [
            {
              id: 'source-1',
              name: 'roadmap.md',
              path: 'C:\\private\\roadmap.md',
              token: 'secret-token',
              credentials: 'secret-credentials',
              type: 'Roadmap',
              score: 5,
              rankingPosition: 1,
              reasons: ['matched'],
            },
          ],
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
  assert.equal(payload.sources.length, 1);
  assert.equal(Object.hasOwn(payload.sources[0], 'path'), false);
  assert.equal(Object.hasOwn(payload.sources[0], 'token'), false);
  assert.equal(Object.hasOwn(payload.sources[0], 'credentials'), false);
});

test('passes optional private context to the executive orchestrator', async () => {
  let calledWith = null;
  const privateContextMetadata = buildPrivateContext();
  const privatePayload = {
    events: [
      {
        title: 'Evento privado ficticio',
        date: '2026-07-04',
        token: 'private-token',
        credentials: 'private-credentials',
      },
    ],
  };
  const request = createRequest(JSON.stringify({
    query: 'Briefing privado',
    privateContextMetadata,
    expectedClientId: 'client-alpha',
    privatePayload,
  }));
  const response = createResponse();

  await handleExecutiveChatRequest(request, response, {
    dependencies: {
      orchestrateExecutiveQuery(query, options) {
        calledWith = { query, options };

        return {
          query,
          analysis: {
            intent: 'briefing',
            project: null,
            documentTypes: [],
            keywords: [],
            filters: {},
            priority: 'high',
            confidence: 0.8,
          },
          response: 'Respuesta con contexto privado autorizado.',
          confidence: 0.7,
          sources: [
            {
              id: 'source-private',
              name: 'private-related.md',
              path: 'C:\\private\\private-related.md',
              type: 'Notes',
              score: 4,
            },
          ],
          privateContextUsed: true,
          limitations: [],
        };
      },
    },
  });

  const payload = response.getJson();

  assert.equal(response.statusCode, 200);
  assert.equal(calledWith.query, 'Briefing privado');
  assert.deepEqual(calledWith.options, {
    privateContextMetadata,
    expectedClientId: 'client-alpha',
    privatePayload,
  });
  assert.equal(payload.privateContextUsed, true);
  assert.equal(JSON.stringify(payload).includes('Evento privado ficticio'), false);
  assert.equal(JSON.stringify(payload).includes('private-token'), false);
  assert.equal(JSON.stringify(payload).includes('private-credentials'), false);
  assert.equal(Object.hasOwn(payload.sources[0], 'path'), false);
});

test('builds Calendar private context for executive chat requests', async () => {
  let providerInput = null;
  let orchestratorCall = null;
  const request = createRequest(JSON.stringify({
    query: 'Que tengo hoy?',
    calendar: {
      enabled: true,
      clientId: 'client-alpha',
      userId: 'user-alpha',
      expectedClientId: 'client-alpha',
      authorization: { status: 'granted' },
      sourceId: 'calendar-source-alpha',
      range: 'today',
      maxResults: 10,
    },
  }));
  const response = createResponse();

  await handleExecutiveChatRequest(request, response, {
    dependencies: {
      async buildCalendarPrivateContext(input) {
        providerInput = input;

        return {
          privateContextMetadata: buildPrivateContext({
            sourceType: 'calendar',
            sourceId: 'calendar-source-alpha',
            purpose: 'executive-briefing',
          }),
          expectedClientId: 'client-alpha',
          privatePayload: {
            source: 'calendar',
            range: {
              preset: 'today',
              timeMin: '2026-07-03T00:00:00.000Z',
              timeMax: '2026-07-04T00:00:00.000Z',
              maxResults: 10,
            },
            events: [
              {
                id: 'event-1',
                title: 'Evento privado ficticio',
                start: '2026-07-03T10:00:00.000Z',
                token: 'private-token',
              },
            ],
          },
        };
      },
      orchestrateExecutiveQuery(query, options) {
        orchestratorCall = { query, options };

        return {
          query,
          analysis: {
            intent: 'briefing',
            project: null,
            documentTypes: [],
            keywords: [],
            filters: {},
            priority: 'high',
            confidence: 0.8,
          },
          response: 'Agenda privada autorizada: Evento privado ficticio.',
          confidence: 0.7,
          sources: [
            {
              id: 'source-1',
              name: 'source.md',
              path: 'C:\\private\\source.md',
              type: 'Notes',
            },
          ],
          privateContextUsed: true,
          limitations: [],
        };
      },
    },
  });

  const payload = response.getJson();

  assert.equal(response.statusCode, 200);
  assert.equal(providerInput.range, 'today');
  assert.equal(orchestratorCall.query, 'Que tengo hoy?');
  assert.equal(orchestratorCall.options.privateContextMetadata.sourceType, 'calendar');
  assert.equal(orchestratorCall.options.privateContextRequiredPurpose, 'executive-briefing');
  assert.equal(payload.privateContextUsed, true);
  assert.equal(Object.hasOwn(payload.sources[0], 'path'), false);
  assert.equal(JSON.stringify(payload).includes('private-token'), false);
});

test('passes weekly Calendar range to provider', async () => {
  let providerInput = null;
  const request = createRequest(JSON.stringify({
    query: 'Que compromisos importantes tengo esta semana?',
    calendar: {
      enabled: true,
      clientId: 'client-alpha',
      userId: 'user-alpha',
      expectedClientId: 'client-alpha',
      authorization: { status: 'granted' },
      range: 'next7Days',
      maxResults: 10,
    },
  }));
  const response = createResponse();

  await handleExecutiveChatRequest(request, response, {
    dependencies: {
      async buildCalendarPrivateContext(input) {
        providerInput = input;

        return {
          privateContextMetadata: buildPrivateContext({
            sourceType: 'calendar',
            purpose: 'executive-briefing',
          }),
          expectedClientId: 'client-alpha',
          privatePayload: {
            source: 'calendar',
            range: {
              preset: 'next7Days',
              timeMin: '2026-07-03T08:00:00.000Z',
              timeMax: '2026-07-10T08:00:00.000Z',
              maxResults: 10,
            },
            events: [],
          },
        };
      },
      orchestrateExecutiveQuery(query) {
        return {
          query,
          analysis: {},
          response: 'Agenda privada autorizada: no hay eventos.',
          confidence: 0.7,
          sources: [],
          privateContextUsed: true,
          limitations: [],
        };
      },
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(providerInput.range, 'next7Days');
});

test('rejects privateContextMetadata without privatePayload', async () => {
  const request = createRequest(JSON.stringify({
    query: 'Briefing privado',
    privateContextMetadata: buildPrivateContext(),
    expectedClientId: 'client-alpha',
  }));
  const response = createResponse();

  await handleExecutiveChatRequest(request, response);

  const payload = response.getJson();

  assert.equal(response.statusCode, 400);
  assert.equal(payload.ok, false);
  assert.equal(payload.error, 'payload is required.');
});

test('rejects privatePayload without privateContextMetadata', async () => {
  const request = createRequest(JSON.stringify({
    query: 'Briefing privado',
    expectedClientId: 'client-alpha',
    privatePayload: {
      events: [
        { title: 'Evento privado ficticio', token: 'private-token' },
      ],
    },
  }));
  const response = createResponse();

  await handleExecutiveChatRequest(request, response);

  const payload = response.getJson();

  assert.equal(response.statusCode, 400);
  assert.equal(payload.ok, false);
  assert.match(payload.error, /clientId must be a non-empty string/);
  assert.equal(JSON.stringify(payload).includes('private-token'), false);
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

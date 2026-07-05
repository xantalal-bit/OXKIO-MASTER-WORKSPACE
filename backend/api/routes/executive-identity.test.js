'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable, Writable } = require('stream');
const {
  buildExecutiveIdentityPayload,
  handleExecutiveIdentityRequest,
  isExecutiveIdentityRoute,
} = require('./executive-identity');

const EXPECTED_RESPONSE = {
  ok: true,
  identity: {
    clientId: 'cliente-cero',
    userId: 'usuario-cliente-cero',
    expectedClientId: 'cliente-cero',
    authorization: {
      status: 'granted',
      provider: 'google-oauth',
    },
  },
};

function createRequest() {
  const request = Readable.from([]);

  request.method = 'GET';
  request.url = '/api/executive/identity';

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
  response.getRawBody = () => Buffer.concat(chunks).toString('utf8');
  response.getJson = () => JSON.parse(response.getRawBody());

  return response;
}

test('matches only GET /api/executive/identity', () => {
  assert.equal(isExecutiveIdentityRoute('/api/executive/identity', 'GET'), true);
  assert.equal(isExecutiveIdentityRoute('/api/executive/identity', 'POST'), false);
  assert.equal(isExecutiveIdentityRoute('/api/executive/chat', 'GET'), false);
});

test('returns 200 with exact Cliente Cero identity', () => {
  const request = createRequest();
  const response = createResponse();

  handleExecutiveIdentityRequest(request, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['Content-Type'], 'application/json; charset=utf-8');
  assert.deepEqual(response.getJson(), EXPECTED_RESPONSE);
});

test('does not expose token or credential fields', () => {
  const payload = buildExecutiveIdentityPayload();
  const serializedPayload = JSON.stringify(payload);

  [
    'access_token',
    'refresh_token',
    'token',
    'secret',
    'credentials',
  ].forEach((fieldName) => {
    assert.equal(serializedPayload.includes(fieldName), false);
  });
});

test('clientId matches expectedClientId', () => {
  const payload = buildExecutiveIdentityPayload();

  assert.equal(payload.identity.clientId, payload.identity.expectedClientId);
});

test('authorization is granted through google-oauth', () => {
  const payload = buildExecutiveIdentityPayload();

  assert.equal(payload.identity.authorization.status, 'granted');
  assert.equal(payload.identity.authorization.provider, 'google-oauth');
});

test('response uses independent identity objects', () => {
  const firstPayload = buildExecutiveIdentityPayload();
  const secondPayload = buildExecutiveIdentityPayload();

  assert.notEqual(firstPayload, secondPayload);
  assert.notEqual(firstPayload.identity, secondPayload.identity);
  assert.notEqual(firstPayload.identity.authorization, secondPayload.identity.authorization);

  firstPayload.identity.clientId = 'modified-client';
  firstPayload.identity.authorization.status = 'pending';

  assert.deepEqual(secondPayload, EXPECTED_RESPONSE);
  assert.deepEqual(buildExecutiveIdentityPayload(), EXPECTED_RESPONSE);
});

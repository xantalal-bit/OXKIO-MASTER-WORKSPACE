'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { Writable } = require('stream');
const { handleGmailOperationRequest, isGmailOperationRoute } = require('./gmail-operations');

const IDENTITY = {
  clientId: 'cliente-cero', expectedClientId: 'cliente-cero', userId: 'firebase-user',
  authorization: { status: 'granted', provider: 'google-oauth' },
};
function req(body = {}, method = 'POST', contentType = 'application/json') {
  const value = new EventEmitter(); value.method = method;
  value.headers = contentType ? { 'content-type': contentType } : {};
  process.nextTick(() => {
    value.emit('data', Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)));
    value.emit('end');
  });
  return value;
}
function res() {
  const chunks = [];
  const response = new Writable({ write(chunk, enc, cb) { chunks.push(Buffer.from(chunk)); cb(); } });
  response.writeHead = (status, headers) => { response.statusCode = status; response.headers = headers; };
  response.json = () => JSON.parse(Buffer.concat(chunks).toString('utf8'));
  return response;
}

test('matches only the specific Gmail POST route', () => {
  assert.equal(isGmailOperationRoute('/api/operations/gmail/run', 'POST'), true);
  assert.equal(isGmailOperationRoute('/api/operations/gmail/run', 'GET'), false);
  assert.equal(isGmailOperationRoute('/api/operations/run', 'POST'), false);
});

test('ignores every client field and delegates only internal identity with no-store', async () => {
  let input; const response = res();
  await handleGmailOperationRequest(req({
    query: 'evil', worker: 'evil', type: 'evil', limit: 999, path: 'secret',
    persist: true, send: true, draft: true,
  }), response, {
    getIdentity: () => IDENTITY,
    operationsCoordinator: { async runGmailReview(value) { input = value; return { status: 'completed' }; } },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.deepEqual(input, { identity: IDENTITY });
  assert.equal(JSON.stringify(response.json()).includes('evil'), false);
});

test('rejects invalid requests and maps global concurrency safely', async () => {
  for (const [request, expected] of [
    [req({}, 'GET'), 405], [req({}, 'POST', 'text/plain'), 400], [req('{bad'), 400],
  ]) {
    const response = res();
    await handleGmailOperationRequest(request, response, { getIdentity: () => IDENTITY });
    assert.equal(response.statusCode, expected);
  }
  const response = res();
  await handleGmailOperationRequest(req({}), response, {
    getIdentity: () => IDENTITY,
    operationsCoordinator: {
      async runGmailReview() {
        throw Object.assign(new Error('private provider error'), { code: 'operation_in_progress' });
      },
    },
  });
  assert.equal(response.statusCode, 409);
  assert.equal(JSON.stringify(response.json()).includes('private provider error'), false);
});

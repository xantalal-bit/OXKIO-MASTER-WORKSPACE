'use strict';
const assert = require('node:assert/strict');
const { Readable, Writable } = require('node:stream');
const test = require('node:test');
const { handleKnowledgeOperationRequest, isKnowledgeOperationRoute } = require('./knowledge-operations');
const IDENTITY = () => ({ clientId: 'cliente-cero', expectedClientId: 'cliente-cero', authorization: { status: 'granted' } });
function req(payload = {}, method = 'POST', raw) {
  const request = Readable.from([raw === undefined ? JSON.stringify(payload) : raw]);
  request.method = method; request.headers = { 'content-type': 'application/json' }; return request;
}
function res() {
  const chunks = []; const response = new Writable({ write(chunk, enc, cb) { chunks.push(Buffer.from(chunk)); cb(); } });
  response.writeHead = (status, headers) => { response.statusCode = status; response.headers = headers; };
  response.json = () => JSON.parse(Buffer.concat(chunks).toString('utf8')); return response;
}
test('matches only the specific Knowledge POST route', () => {
  assert.equal(isKnowledgeOperationRoute('/api/operations/knowledge/run', 'POST'), true);
  assert.equal(isKnowledgeOperationRoute('/api/operations/run', 'POST'), false);
});
test('ignores every client field and delegates only internal identity with no-store', async () => {
  let input; const response = res();
  await handleKnowledgeOperationRequest(req({ query: 'evil', worker: 'evil', type: 'evil', path: 'secret', persist: true }), response, {
    getIdentity: IDENTITY, operationsCoordinator: { async runKnowledgeReview(value) { input = value; return { worker: 'knowledge-readonly' }; } },
  });
  assert.equal(response.statusCode, 200); assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.deepEqual(Object.keys(input), ['identity']); assert.equal(JSON.stringify(response.json()).includes('evil'), false);
});
test('rejects invalid JSON and maps global concurrency to 409', async () => {
  const invalid = res(); await handleKnowledgeOperationRequest(req({}, 'POST', '{'), invalid, { getIdentity: IDENTITY, operationsCoordinator: {} });
  assert.equal(invalid.statusCode, 400);
  const conflict = res(); await handleKnowledgeOperationRequest(req({}), conflict, {
    getIdentity: IDENTITY, operationsCoordinator: { runKnowledgeReview() { throw Object.assign(new Error('busy'), { code: 'operation_in_progress' }); } },
  });
  assert.equal(conflict.statusCode, 409); assert.match(conflict.json().message, /operación en curso/i);
});

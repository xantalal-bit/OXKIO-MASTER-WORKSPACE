'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { handleCalendarOperationRequest, isCalendarOperationRoute } = require('./calendar-operations');

const IDENTITY = {
  clientId: 'cliente-cero',
  expectedClientId: 'cliente-cero',
  userId: 'owner',
  authorization: { status: 'granted', provider: 'google-oauth' },
};

function req(body = {}, method = 'POST', contentType = 'application/json') {
  const request = new EventEmitter();
  request.method = method;
  request.headers = { 'content-type': contentType };
  process.nextTick(() => {
    request.emit('data', Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)));
    request.emit('end');
  });
  return request;
}

function res() {
  return {
    statusCode: null,
    headers: null,
    payload: null,
    writeHead(statusCode, headers) { this.statusCode = statusCode; this.headers = headers; },
    end(value) { this.payload = JSON.parse(value); },
  };
}

test('matches only the specific Calendar POST route', () => {
  assert.equal(isCalendarOperationRoute('/api/operations/calendar/run', 'POST'), true);
  assert.equal(isCalendarOperationRoute('/api/operations/calendar/run', 'GET'), false);
  assert.equal(isCalendarOperationRoute('/api/operations/run', 'POST'), false);
});

test('ignores every client field and delegates only internal identity with no-store', async () => {
  let input;
  const response = res();
  await handleCalendarOperationRequest(req({
    date: '2099-01-01', calendarId: 'attacker', limit: 999, filter: 'private', persist: true,
  }), response, {
    getIdentity: () => IDENTITY,
    operationsCoordinator: {
      async runCalendarReview(value) { input = value; return { status: 'completed' }; },
    },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.deepEqual(input, { identity: IDENTITY });
});

test('rejects invalid requests and maps the global lock safely', async () => {
  for (const request of [req({}, 'GET'), req({}, 'POST', 'text/plain'), req('{', 'POST')]) {
    const response = res();
    await handleCalendarOperationRequest(request, response, { getIdentity: () => IDENTITY });
    assert.ok([400, 405].includes(response.statusCode));
  }
  const denied = res();
  await handleCalendarOperationRequest(req({}), denied, { getIdentity: () => null });
  assert.equal(denied.statusCode, 403);

  const locked = res();
  await handleCalendarOperationRequest(req({}), locked, {
    getIdentity: () => IDENTITY,
    operationsCoordinator: {
      async runCalendarReview() {
        throw Object.assign(new Error('busy'), { code: 'operation_in_progress' });
      },
    },
  });
  assert.equal(locked.statusCode, 409);
  assert.equal(locked.payload.code, 'operation_in_progress');
  assert.doesNotMatch(JSON.stringify(locked.payload), /stack|token|calendarId|filter/);
});

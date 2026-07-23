'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createGmailReadonlyService } = require('./gmail-readonly-service');

const IDENTITY = Object.freeze({
  clientId: 'cliente-cero',
  expectedClientId: 'cliente-cero',
  userId: 'firebase-user',
  authorization: { status: 'granted', provider: 'google-oauth' },
});

function fixture(messages = []) {
  let input; let cleanup = 0;
  const service = createGmailReadonlyService({
    createExecutiveRuntime(options) {
      assert.deepEqual(options, { mode: 'sandbox' });
      return { cleanup() { cleanup += 1; } };
    },
    async buildGmailPrivateContext(value) {
      input = value;
      return { privatePayload: { messages } };
    },
  });
  return { service, input: () => input, cleanup: () => cleanup };
}

test('uses the existing readonly Gmail provider and returns only limited sanitized metadata', async () => {
  const messages = Array.from({ length: 12 }, (_, index) => ({
    id: `secret-${index}`, threadId: `thread-${index}`,
    from: `Persona ${index} <person${index}@example.com>`,
    subject: `Asunto ${index}`, snippet: `Resumen seguro ${index}`,
    unread: index < 6, important: index === 0,
    payload: { headers: [{ name: 'Authorization', value: 'secret' }], body: 'full body' },
  }));
  const f = fixture(messages);
  const result = await f.service.runGmailReadonly({
    operationId: 'op', interactionId: 'ix', identity: IDENTITY,
    maxMessages: 99, query: 'ignored', persist: true,
  });
  assert.equal(f.input().maxMessages, 10);
  assert.deepEqual(Object.keys(f.input()).sort(), [
    'authorization', 'clientId', 'expectedClientId', 'maxMessages', 'userId',
  ]);
  assert.equal(result.emailsCount, 10);
  assert.equal(result.relevantItems.length, 5);
  assert.equal(result.recommendations.length <= 3, true);
  assert.equal(f.cleanup(), 1);
  const serialized = JSON.stringify(result);
  ['secret-', 'thread-', '@example.com', 'Authorization', 'full body', 'payload', 'headers'].forEach(
    (value) => assert.equal(serialized.includes(value), false),
  );
});

test('reports partial and unavailable without inventing relevant messages', async () => {
  const partial = await fixture([{ from: 'Equipo', subject: 'Actualización', snippet: 'Sin prioridad.' }])
    .service.runGmailReadonly({ operationId: 'op', interactionId: 'ix', identity: IDENTITY });
  const unavailable = await fixture([])
    .service.runGmailReadonly({ operationId: 'op', interactionId: 'ix', identity: IDENTITY });
  assert.equal(partial.sourceStatus, 'partial');
  assert.deepEqual(partial.relevantItems, []);
  assert.equal(unavailable.sourceStatus, 'unavailable');
  assert.equal(unavailable.emailsCount, 0);
  assert.deepEqual(unavailable.relevantItems, []);
});

test('times out safely, never exposes provider errors and always releases cleanup and lock', async () => {
  let cleanup = 0;
  const service = createGmailReadonlyService({
    buildGmailPrivateContext() { return new Promise(() => {}); },
    createExecutiveRuntime() { return { cleanup() { cleanup += 1; } }; },
  });
  await assert.rejects(
    service.runGmailReadonly({
      operationId: 'op', interactionId: 'ix', identity: IDENTITY, timeoutMs: 10,
    }),
    (error) => error.code === 'gmail_review_timeout' && !/token|path|stack/i.test(error.message),
  );
  assert.equal(cleanup, 1);
});

test('contains no Gmail mutation, send or draft capability', () => {
  const source = fs.readFileSync(__filename.replace(/\.test\.js$/, '.js'), 'utf8');
  [
    /users\.messages\.(?:send|modify|trash|delete)/,
    /users\.drafts/,
    /createDraft/,
    /SAFE_DRAFT_ONLY/,
    /saveTokens|setCredentials/,
  ].forEach((pattern) => assert.doesNotMatch(source, pattern));
});

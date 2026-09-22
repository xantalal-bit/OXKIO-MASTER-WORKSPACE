'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createConversationContextStore, isValidConversationId, isValidUid } = require('./conversation-context-store');

test('saves and retrieves context scoped to uid+conversationId', () => {
  const store = createConversationContextStore();
  const saved = store.save('uid-a', 'conv-aaaaaaaa', { lastIntent: 'gmail_query' });
  assert.equal(saved, true);
  assert.deepEqual(store.get('uid-a', 'conv-aaaaaaaa'), { lastIntent: 'gmail_query' });
});

test('a UID cannot read another UID context even with the same conversationId', () => {
  const store = createConversationContextStore();
  store.save('uid-a', 'conv-aaaaaaaa', { lastIntent: 'gmail_query', secret: 'a-only' });
  assert.equal(store.get('uid-b', 'conv-aaaaaaaa'), null);
});

test('rejects malformed conversationId on both save and get', () => {
  const store = createConversationContextStore();
  assert.equal(store.save('uid-a', 'short', { x: 1 }), false);
  assert.equal(store.save('uid-a', 'has spaces!!', { x: 1 }), false);
  assert.equal(store.get('uid-a', 'short'), null);
  assert.equal(store.get('uid-a', ''), null);
  assert.equal(store.get('uid-a', null), null);
});

test('rejects a missing or empty uid', () => {
  const store = createConversationContextStore();
  assert.equal(store.save('', 'conv-aaaaaaaa', { x: 1 }), false);
  assert.equal(store.save(null, 'conv-aaaaaaaa', { x: 1 }), false);
  assert.equal(store.get(null, 'conv-aaaaaaaa'), null);
});

test('entries expire after the configured TTL', () => {
  let currentTime = 1000;
  const store = createConversationContextStore({ ttlMs: 500, now: () => currentTime });
  store.save('uid-a', 'conv-aaaaaaaa', { lastIntent: 'gmail_query' });
  assert.notEqual(store.get('uid-a', 'conv-aaaaaaaa'), null);
  currentTime += 600;
  assert.equal(store.get('uid-a', 'conv-aaaaaaaa'), null);
});

test('evicts the oldest conversation once the max conversation limit is exceeded', () => {
  const store = createConversationContextStore({ maxConversations: 2 });
  store.save('uid-a', 'conv-11111111', { n: 1 });
  store.save('uid-a', 'conv-22222222', { n: 2 });
  store.save('uid-a', 'conv-33333333', { n: 3 });
  assert.equal(store.size(), 2);
  assert.equal(store.get('uid-a', 'conv-11111111'), null);
  assert.notEqual(store.get('uid-a', 'conv-33333333'), null);
});

test('clear removes only the targeted conversation', () => {
  const store = createConversationContextStore();
  store.save('uid-a', 'conv-11111111', { n: 1 });
  store.save('uid-a', 'conv-22222222', { n: 2 });
  store.clear('uid-a', 'conv-11111111');
  assert.equal(store.get('uid-a', 'conv-11111111'), null);
  assert.notEqual(store.get('uid-a', 'conv-22222222'), null);
});

test('isValidConversationId/isValidUid validate shape only, never trust content', () => {
  assert.equal(isValidConversationId('a-valid-id-12345678'), true);
  assert.equal(isValidConversationId('../../etc/passwd'), false);
  assert.equal(isValidConversationId(12345), false);
  assert.equal(isValidUid('cliente-cero'), true);
  assert.equal(isValidUid(''), false);
});

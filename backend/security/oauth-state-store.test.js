'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createOAuthStateStore } = require('./oauth-state-store');

function fixedClock(startMs) {
  let currentMs = startMs;
  return {
    now: () => currentMs,
    advance(deltaMs) { currentMs += deltaMs; },
  };
}

test('a freshly issued state is consumed successfully exactly once', () => {
  const store = createOAuthStateStore();
  const state = store.issue();

  assert.deepEqual(store.consume(state), { ok: true, code: null });
  assert.deepEqual(store.consume(state), { ok: false, code: 'oauth_state_invalid' }); // replay denied
});

test('an unknown state is denied without ever being issued', () => {
  const store = createOAuthStateStore();
  assert.deepEqual(store.consume('never-issued'), { ok: false, code: 'oauth_state_invalid' });
});

test('missing or malformed state input is denied, fail-closed', () => {
  const store = createOAuthStateStore();
  for (const input of [undefined, null, '', 42, {}]) {
    assert.deepEqual(store.consume(input), { ok: false, code: 'oauth_state_required' });
  }
});

test('an expired state is denied and cannot be consumed twice either', () => {
  const clock = fixedClock(0);
  const store = createOAuthStateStore({ now: clock.now, ttlMs: 1000 });
  const state = store.issue();

  clock.advance(1001);
  assert.deepEqual(store.consume(state), { ok: false, code: 'oauth_state_expired' });
  assert.deepEqual(store.consume(state), { ok: false, code: 'oauth_state_invalid' });
});

test('two issued states are independent: consuming one never consumes the other', () => {
  const store = createOAuthStateStore();
  const stateA = store.issue();
  const stateB = store.issue();

  assert.notEqual(stateA, stateB);
  assert.deepEqual(store.consume(stateA), { ok: true, code: null });
  assert.deepEqual(store.consume(stateB), { ok: true, code: null });
});

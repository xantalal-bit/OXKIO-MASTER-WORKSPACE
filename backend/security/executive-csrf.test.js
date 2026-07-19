'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { DEFAULT_TTL_MS, createExecutiveCsrf } = require('./executive-csrf');

test('generates random process-local tokens with a thirty minute expiry', () => {
  const first = createExecutiveCsrf();
  const second = createExecutiveCsrf();
  const firstContext = first.getSecurityContext();
  const secondContext = second.getSecurityContext();

  assert.match(firstContext.csrfToken, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(firstContext.csrfToken, secondContext.csrfToken);
  assert.equal(firstContext.authorized, true);
  assert.equal(Date.parse(firstContext.expiresAt) > Date.now(), true);
  assert.equal(DEFAULT_TTL_MS, 30 * 60 * 1000);
});

test('accepts reuse within the window and rejects missing or mismatched values', () => {
  let clock = 1_000;
  const csrf = createExecutiveCsrf({ now: () => clock });
  const token = csrf.getSecurityContext().csrfToken;

  assert.deepEqual(csrf.validate(undefined), { ok: false, code: 'csrf_token_required' });
  assert.deepEqual(csrf.validate('wrong'), { ok: false, code: 'csrf_token_invalid' });
  assert.deepEqual(csrf.validate(token), { ok: true, code: null });
  assert.deepEqual(csrf.validate(token), { ok: true, code: null });
});

test('rejects an otherwise matching expired token', () => {
  let clock = 5_000;
  const csrf = createExecutiveCsrf({ now: () => clock, ttlMs: 100 });
  const token = csrf.getSecurityContext().csrfToken;
  clock += 100;

  assert.deepEqual(csrf.validate(token), { ok: false, code: 'csrf_token_expired' });
});

test('rotates an expired token when a new security context is requested', () => {
  let clock = 10_000;
  let sequence = 0;
  const csrf = createExecutiveCsrf({
    now: () => clock,
    ttlMs: 100,
    randomBytes: () => Buffer.alloc(32, ++sequence),
  });
  const first = csrf.getSecurityContext();
  clock += 100;
  const second = csrf.getSecurityContext();

  assert.notEqual(second.csrfToken, first.csrfToken);
  assert.equal(Date.parse(second.expiresAt), clock + 100);
  assert.equal(csrf.validate(first.csrfToken).code, 'csrf_token_invalid');
  assert.deepEqual(csrf.validate(second.csrfToken), { ok: true, code: null });
});

test('uses timingSafeEqual for equal-length comparisons without exposing expected token', () => {
  let comparisons = 0;
  const csrf = createExecutiveCsrf({
    randomBytes: () => Buffer.alloc(32, 7),
    timingSafeEqual(actual, expected) {
      comparisons += 1;
      return actual.equals(expected);
    },
  });
  const token = csrf.getSecurityContext().csrfToken;
  const invalid = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;

  assert.equal(csrf.validate(invalid).code, 'csrf_token_invalid');
  assert.equal(comparisons, 1);
  assert.equal(Object.hasOwn(csrf.validate(invalid), 'expected'), false);
});

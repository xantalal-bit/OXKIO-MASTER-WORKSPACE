'use strict';

const crypto = require('node:crypto');

const DEFAULT_TTL_MS = 30 * 60 * 1000;

function createExecutiveCsrf({
  randomBytes = crypto.randomBytes,
  timingSafeEqual = crypto.timingSafeEqual,
  now = () => Date.now(),
  ttlMs = DEFAULT_TTL_MS,
} = {}) {
  let token;
  let expiresAtMs;

  function rotate() {
    token = randomBytes(32).toString('base64url');
    expiresAtMs = now() + ttlMs;
  }

  rotate();

  return Object.freeze({
    getSecurityContext() {
      if (now() >= expiresAtMs) rotate();
      return {
        authorized: true,
        csrfToken: token,
        expiresAt: new Date(expiresAtMs).toISOString(),
      };
    },

    validate(candidate) {
      if (typeof candidate !== 'string' || !candidate) {
        return { ok: false, code: 'csrf_token_required' };
      }
      if (now() >= expiresAtMs) {
        return { ok: false, code: 'csrf_token_expired' };
      }

      const actual = Buffer.from(candidate, 'utf8');
      const expected = Buffer.from(token, 'utf8');
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        return { ok: false, code: 'csrf_token_invalid' };
      }
      return { ok: true, code: null };
    },
  });
}

module.exports = {
  DEFAULT_TTL_MS,
  createExecutiveCsrf,
};

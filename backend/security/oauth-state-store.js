'use strict';

const crypto = require('node:crypto');

const DEFAULT_TTL_MS = 10 * 60 * 1000;

// GET /oauth/google/callback is Google's own redirect target: it carries no
// Authorization header, so it cannot go through the normal Firebase
// authentication gate (see api-route-policy.js, which still keeps
// GET /oauth/google itself Cliente-Cero-only). Without something else
// binding the callback back to a legitimately-initiated flow, anyone who
// obtains a `code` for our OAuth client (from their own, separately
// completed Google consent) could call the callback directly and overwrite
// the single global Gmail/Calendar token file. This store issues a
// single-use, short-lived, unguessable `state` value when the flow starts
// and requires the callback to present that exact value before it will
// exchange the code.
function createOAuthStateStore({
  randomBytes = crypto.randomBytes,
  now = () => Date.now(),
  ttlMs = DEFAULT_TTL_MS,
} = {}) {
  const pending = new Map();

  function prune() {
    const currentTime = now();
    for (const [state, expiresAtMs] of pending) {
      if (currentTime >= expiresAtMs) pending.delete(state);
    }
  }

  return Object.freeze({
    issue() {
      prune();
      const state = randomBytes(32).toString('base64url');
      pending.set(state, now() + ttlMs);
      return state;
    },

    // Single-use: the state is removed as soon as it is looked up, whether
    // or not it turns out to be expired, so it can never be replayed. Does
    // not prune() first: an expired-but-present entry must still be
    // distinguishable from one that was never issued.
    consume(candidate) {
      if (typeof candidate !== 'string' || !candidate) {
        return { ok: false, code: 'oauth_state_required' };
      }
      const expiresAtMs = pending.get(candidate);
      if (expiresAtMs === undefined) {
        return { ok: false, code: 'oauth_state_invalid' };
      }
      pending.delete(candidate);
      if (now() >= expiresAtMs) {
        return { ok: false, code: 'oauth_state_expired' };
      }
      return { ok: true, code: null };
    },
  });
}

module.exports = {
  DEFAULT_TTL_MS,
  createOAuthStateStore,
};

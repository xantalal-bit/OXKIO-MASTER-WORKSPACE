'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  authorizeExecutiveClaims,
  createExecutiveAuthorizer,
  parseAllowlist,
} = require('./executive-authorization');

test('parses closed comma-separated allowlists', () => {
  assert.deepEqual([...parseAllowlist(' uid-a,uid-b, uid-a, ')], ['uid-a', 'uid-b']);
});

test('normalizes quoted and noisy allowlist entries without broadening access', () => {
  assert.deepEqual([...parseAllowlist(' "uid-a" , \uFEFFuid-b\u200B ')], ['uid-a', 'uid-b']);
});

test('authorizes an allowlisted uid as Cliente Cero admin', () => {
  const result = authorizeExecutiveClaims({
    uid: 'firebase-admin-uid',
    email: 'admin@example.test',
    email_verified: true,
    role: 'user',
    clientId: 'attacker',
  }, { adminUids: new Set(['firebase-admin-uid']) });

  assert.deepEqual(result, {
    ok: true,
    identity: {
      uid: 'firebase-admin-uid',
      email: 'admin@example.test',
      emailVerified: true,
      role: 'admin',
      clientId: 'cliente-cero',
      authorized: true,
    },
  });
  assert.equal(Object.isFrozen(result.identity), true);
});

test('allows only a verified email from the optional fallback allowlist', () => {
  const options = { adminEmails: new Set(['verified@example.test']) };
  assert.equal(authorizeExecutiveClaims({
    uid: 'uid-a', email: 'VERIFIED@example.test', email_verified: true,
  }, options).ok, true);
  assert.deepEqual(authorizeExecutiveClaims({
    uid: 'uid-a', email: 'verified@example.test', email_verified: false,
  }, options), { ok: false, code: 'auth_forbidden' });
});

test('rejects missing and non-allowlisted identities', () => {
  assert.deepEqual(authorizeExecutiveClaims(null), {
    ok: false, code: 'auth_identity_unavailable',
  });
  assert.deepEqual(authorizeExecutiveClaims({ uid: '' }), {
    ok: false, code: 'auth_identity_unavailable',
  });
  assert.deepEqual(authorizeExecutiveClaims({ uid: 'unknown' }), {
    ok: false, code: 'auth_forbidden',
  });
});

test('builds policy only from server environment allowlists', () => {
  const authorize = createExecutiveAuthorizer({
    OXKIO_ADMIN_FIREBASE_UIDS: 'jose-uid',
    OXKIO_ADMIN_FIREBASE_EMAILS: 'fallback@example.test',
  });
  assert.equal(authorize({ uid: 'jose-uid' }).identity.role, 'admin');
  assert.equal(authorize({
    uid: 'other', email: 'fallback@example.test', email_verified: true,
  }).identity.clientId, 'cliente-cero');
  assert.equal(authorize({ uid: 'other' }).code, 'auth_forbidden');
});

test('accepts the canonical token uid from sub or user_id when uid is not present', () => {
  const allow = new Set(['firebase-admin-uid']);
  assert.equal(authorizeExecutiveClaims({ sub: 'firebase-admin-uid' }, { adminUids: allow }).ok, true);
  assert.equal(authorizeExecutiveClaims({ user_id: 'firebase-admin-uid' }, { adminUids: allow }).ok, true);
});

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

test('authorizes an allowlisted family uid with its own isolated clientId, never cliente-cero', () => {
  const result = authorizeExecutiveClaims({ uid: 'family-uid-a' }, {
    familyUids: new Set(['family-uid-a']),
  });
  assert.deepEqual(result, {
    ok: true,
    identity: {
      uid: 'family-uid-a',
      email: null,
      emailVerified: false,
      role: 'family_member',
      clientId: 'family:family-uid-a',
      authorized: true,
    },
  });
  assert.notEqual(result.identity.clientId, 'cliente-cero');
});

test('isolates two family members from each other with distinct clientIds', () => {
  const options = { familyUids: new Set(['family-uid-a', 'family-uid-b']) };
  const a = authorizeExecutiveClaims({ uid: 'family-uid-a' }, options);
  const b = authorizeExecutiveClaims({ uid: 'family-uid-b' }, options);
  assert.notEqual(a.identity.clientId, b.identity.clientId);
});

test('family email fallback requires a verified email, matching the admin fallback behavior', () => {
  const options = { familyEmails: new Set(['familia@example.test']) };
  assert.equal(authorizeExecutiveClaims({
    uid: 'uid-x', email: 'familia@example.test', email_verified: true,
  }, options).ok, true);
  assert.deepEqual(authorizeExecutiveClaims({
    uid: 'uid-x', email: 'familia@example.test', email_verified: false,
  }, options), { ok: false, code: 'auth_forbidden' });
});

test('admin allowlist takes priority over family allowlist for the same uid', () => {
  const result = authorizeExecutiveClaims({ uid: 'shared-uid' }, {
    adminUids: new Set(['shared-uid']),
    familyUids: new Set(['shared-uid']),
  });
  assert.equal(result.identity.role, 'admin');
  assert.equal(result.identity.clientId, 'cliente-cero');
});

test('a uid absent from both allowlists is denied (unknown uid, fail closed)', () => {
  assert.deepEqual(authorizeExecutiveClaims({ uid: 'stranger-uid' }, {
    adminUids: new Set(['jose-uid']),
    familyUids: new Set(['family-uid-a']),
  }), { ok: false, code: 'auth_forbidden' });
});

test('createExecutiveAuthorizer keeps the family allowlist empty by default (backward compatible)', () => {
  const authorize = createExecutiveAuthorizer({ OXKIO_ADMIN_FIREBASE_UIDS: 'jose-uid' });
  assert.equal(authorize({ uid: 'jose-uid' }).identity.clientId, 'cliente-cero');
  assert.equal(authorize({ uid: 'any-family-uid' }).code, 'auth_forbidden');
});

test('createExecutiveAuthorizer authorizes a configured family uid without granting Cliente Cero', () => {
  const authorize = createExecutiveAuthorizer({
    OXKIO_ADMIN_FIREBASE_UIDS: 'jose-uid',
    OXKIO_FAMILY_FIREBASE_UIDS: 'family-uid-a,family-uid-b',
  });
  const result = authorize({ uid: 'family-uid-a' });
  assert.equal(result.identity.role, 'family_member');
  assert.notEqual(result.identity.clientId, 'cliente-cero');
});

test('the 4-user Family Beta V0.1 shape: 1 admin + 3 family uids from one authorizer, all distinct and simultaneous', () => {
  const authorize = createExecutiveAuthorizer({
    OXKIO_ADMIN_FIREBASE_UIDS: 'admin-uid',
    OXKIO_FAMILY_FIREBASE_UIDS: 'family-uid-a,family-uid-b,family-uid-c',
  });

  const admin = authorize({ uid: 'admin-uid' });
  const a = authorize({ uid: 'family-uid-a' });
  const b = authorize({ uid: 'family-uid-b' });
  const c = authorize({ uid: 'family-uid-c' });

  assert.equal(admin.identity.clientId, 'cliente-cero');
  assert.equal(admin.identity.role, 'admin');
  for (const member of [a, b, c]) {
    assert.equal(member.identity.role, 'family_member');
    assert.notEqual(member.identity.clientId, 'cliente-cero');
  }

  // All four clientIds are pairwise distinct: no shared identity, no fallback to admin.
  const clientIds = [admin, a, b, c].map((result) => result.identity.clientId);
  assert.equal(new Set(clientIds).size, 4);

  // A UID that is neither the admin nor one of the three family members is denied.
  assert.equal(authorize({ uid: 'stranger-uid' }).code, 'auth_forbidden');
});

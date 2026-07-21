'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  authenticateFirebaseRequest,
  createFirebaseAdminVerifier,
  extractBearerToken,
  sendFirebaseAuthError,
} = require('./firebase-server-auth');

function request(authorization, extraHeaders = {}) {
  return { headers: { ...extraHeaders, ...(authorization ? { authorization } : {}) } };
}

const adminIdentity = Object.freeze({
  uid: 'admin-uid', email: null, emailVerified: false,
  role: 'admin', clientId: 'cliente-cero', authorized: true,
});
const authorizeAdmin = (claims) => claims.uid === 'admin-uid'
  ? { ok: true, identity: adminIdentity }
  : { ok: false, code: 'auth_forbidden' };

test('requires exactly one Bearer token from Authorization', () => {
  assert.deepEqual(extractBearerToken(request()), {
    ok: false, code: 'auth_token_required',
  });
  for (const value of ['Basic abc', 'Bearer', 'Bearer a b', 'Token abc']) {
    assert.deepEqual(extractBearerToken(request(value)), {
      ok: false, code: 'auth_token_invalid',
    });
  }
  assert.deepEqual(extractBearerToken(request('Bearer safe-token')), {
    ok: true, token: 'safe-token',
  });
});

test('ignores identity, role, and client headers outside Authorization', async () => {
  const result = await authenticateFirebaseRequest(request(null, {
    'x-role': 'admin', 'x-client-id': 'cliente-cero', 'x-identity': 'granted',
  }), { verifyIdToken: async () => ({ uid: 'admin-uid' }), authorizeIdentity: authorizeAdmin });
  assert.deepEqual(result, { ok: false, code: 'auth_token_required' });
});

test('fails closed when verifier is unavailable', async () => {
  assert.deepEqual(await authenticateFirebaseRequest(request('Bearer token'), {
    authorizeIdentity: authorizeAdmin,
  }), { ok: false, code: 'auth_service_unavailable' });
  assert.equal(createFirebaseAdminVerifier({ env: {} }), null);
});

test('maps invalid and expired Firebase tokens safely', async () => {
  const cases = [
    ['auth/argument-error', 'auth_token_invalid'],
    ['auth/id-token-expired', 'auth_token_expired'],
    ['app/network-error', 'auth_service_unavailable'],
    ['app/invalid-credential', 'auth_service_unavailable'],
  ];
  for (const [firebaseCode, expected] of cases) {
    const result = await authenticateFirebaseRequest(request('Bearer private-token'), {
      verifyIdToken: async () => { const error = new Error('sensitive'); error.code = firebaseCode; throw error; },
      authorizeIdentity: authorizeAdmin,
    });
    assert.deepEqual(result, { ok: false, code: expected });
    assert.equal(JSON.stringify(result).includes('private-token'), false);
    assert.equal(JSON.stringify(result).includes('sensitive'), false);
  }
});

test('rejects unavailable and unauthorized identities', async () => {
  assert.deepEqual(await authenticateFirebaseRequest(request('Bearer token'), {
    verifyIdToken: async () => ({}), authorizeIdentity: authorizeAdmin,
  }), { ok: false, code: 'auth_identity_unavailable' });
  assert.deepEqual(await authenticateFirebaseRequest(request('Bearer token'), {
    verifyIdToken: async () => ({ uid: 'unknown' }), authorizeIdentity: authorizeAdmin,
  }), { ok: false, code: 'auth_forbidden' });
});

test('returns only normalized authorized identity for a valid admin token', async () => {
  let verifiedToken;
  const result = await authenticateFirebaseRequest(request('Bearer private-token'), {
    verifyIdToken: async (token) => {
      verifiedToken = token;
      return { uid: 'admin-uid', customClaims: { secret: true } };
    },
    authorizeIdentity: authorizeAdmin,
  });
  assert.equal(verifiedToken, 'private-token');
  assert.deepEqual(result, { ok: true, identity: adminIdentity });
  assert.equal(JSON.stringify(result).includes('customClaims'), false);
  assert.equal(JSON.stringify(result).includes('private-token'), false);
});

test('sends safe no-store errors without tokens, claims, or stacks', () => {
  const response = {
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body) { this.body = body; },
  };
  sendFirebaseAuthError(response, { code: 'auth_forbidden', token: 'private-token' });
  assert.equal(response.status, 403);
  assert.equal(response.headers['Cache-Control'], 'no-store');
  assert.deepEqual(JSON.parse(response.body), {
    ok: false,
    code: 'auth_forbidden',
    message: 'This identity is not authorized.',
  });
  assert.equal(response.body.includes('private-token'), false);
});

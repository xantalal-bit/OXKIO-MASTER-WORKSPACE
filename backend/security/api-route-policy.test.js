'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  FAMILY_SAFE_API_ROUTES,
  isApiRouteDeniedForIdentity,
  isFamilySafeApiRoute,
  isPrivateApiRoute,
} = require('./api-route-policy');
const { isAuthorizedExecutiveIdentity } = require('../api/routes/executive-approval');
const { buildPrivateIdentity } = require('./private-identity-projection');

const clienteCeroFirebaseIdentity = { uid: 'jose-uid', clientId: 'cliente-cero' };
const familyFirebaseIdentity = { uid: 'family-uid-a', clientId: 'family:family-uid-a' };

function getClienteCeroIdentity() {
  return {
    clientId: 'cliente-cero', userId: 'usuario-cliente-cero', expectedClientId: 'cliente-cero',
    authorization: { status: 'granted', provider: 'google-oauth' },
  };
}

test('only /api/executive/identity and /api/executive/chat are family-safe', () => {
  assert.deepEqual([...FAMILY_SAFE_API_ROUTES].sort(), ['/api/executive/chat', '/api/executive/identity']);
  assert.equal(isFamilySafeApiRoute('/api/executive/identity'), true);
  assert.equal(isFamilySafeApiRoute('/api/executive/chat'), true);
  assert.equal(isFamilySafeApiRoute('/api/dashboard'), false);
});

test('every other /api/* legacy route defaults to private (Cliente-Cero-only)', () => {
  for (const pathname of [
    '/api/dashboard', '/api/chat', '/api/gmail/inbox', '/api/gmail/analyze',
    '/api/search-memory', '/api/memory', '/api/logs', '/api/add-rule', '/api/rules',
    '/api/pending-approvals', '/api/approval-history', '/api/execute',
    '/api/knowledge-supervisor/github-releases/discover', '/api/execution-logs',
    '/api/simulator-executive-export', '/api/projects', '/api/process-email',
    '/api/approve', '/api/execute-approved', '/api/executive/security-context',
    '/oauth/google',
  ]) {
    assert.equal(isPrivateApiRoute(pathname), true, `${pathname} should be private by default`);
  }
});

test('a non-/api/ pathname is never treated as a private API route', () => {
  assert.equal(isPrivateApiRoute('/executive-dashboard.html'), false);
  assert.equal(isPrivateApiRoute('/'), false);
});

test('end-to-end: a family member is denied every legacy /api/* route Gmail/memory/rules/execute included', () => {
  const familyIdentity = buildPrivateIdentity(familyFirebaseIdentity, { getClienteCeroIdentity });
  for (const pathname of [
    '/api/gmail/inbox', '/api/gmail/analyze', '/api/search-memory', '/api/memory',
    '/api/logs', '/api/add-rule', '/api/execute', '/api/pending-approvals',
    '/api/approval-history', '/api/chat', '/api/dashboard',
  ]) {
    assert.equal(
      isApiRouteDeniedForIdentity(pathname, isAuthorizedExecutiveIdentity, familyIdentity),
      true,
      `${pathname} must deny a family member`,
    );
  }
});

test('end-to-end: Cliente Cero keeps access to legacy routes (no regression)', () => {
  const ceroIdentity = buildPrivateIdentity(clienteCeroFirebaseIdentity, { getClienteCeroIdentity });
  for (const pathname of ['/api/gmail/inbox', '/api/dashboard', '/api/chat', '/api/memory']) {
    assert.equal(isApiRouteDeniedForIdentity(pathname, isAuthorizedExecutiveIdentity, ceroIdentity), false);
  }
});

test('a family member keeps access to the two family-safe routes', () => {
  const familyIdentity = buildPrivateIdentity(familyFirebaseIdentity, { getClienteCeroIdentity });
  assert.equal(isApiRouteDeniedForIdentity('/api/executive/identity', isAuthorizedExecutiveIdentity, familyIdentity), false);
  assert.equal(isApiRouteDeniedForIdentity('/api/executive/chat', isAuthorizedExecutiveIdentity, familyIdentity), false);
});

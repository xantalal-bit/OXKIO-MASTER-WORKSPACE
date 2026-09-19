'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  CLIENTE_CERO_CLIENT_ID,
  buildDashboardReaders,
  buildPrivateIdentity,
  isClienteCeroFirebaseIdentity,
} = require('./private-identity-projection');
const { isAuthorizedExecutiveIdentity } = require('../api/routes/executive-approval');

const clienteCeroFirebaseIdentity = Object.freeze({
  uid: 'jose-uid', role: 'admin', clientId: 'cliente-cero', authorized: true,
});
const familyFirebaseIdentityA = Object.freeze({
  uid: 'family-uid-a', role: 'family_member', clientId: 'family:family-uid-a', authorized: true,
});
const familyFirebaseIdentityB = Object.freeze({
  uid: 'family-uid-b', role: 'family_member', clientId: 'family:family-uid-b', authorized: true,
});

function getClienteCeroIdentity() {
  return {
    clientId: CLIENTE_CERO_CLIENT_ID,
    userId: 'usuario-cliente-cero',
    expectedClientId: CLIENTE_CERO_CLIENT_ID,
    authorization: { status: 'granted', provider: 'google-oauth' },
  };
}

test('isClienteCeroFirebaseIdentity only accepts the literal cliente-cero clientId', () => {
  assert.equal(isClienteCeroFirebaseIdentity(clienteCeroFirebaseIdentity), true);
  assert.equal(isClienteCeroFirebaseIdentity(familyFirebaseIdentityA), false);
  assert.equal(isClienteCeroFirebaseIdentity(null), false);
  assert.equal(isClienteCeroFirebaseIdentity({}), false);
});

test('buildPrivateIdentity grants the Cliente Cero private identity only to the Cliente Cero clientId', () => {
  const identity = buildPrivateIdentity(clienteCeroFirebaseIdentity, { getClienteCeroIdentity });
  assert.deepEqual(identity, {
    clientId: 'cliente-cero',
    userId: 'jose-uid',
    expectedClientId: 'cliente-cero',
    authorization: { status: 'granted', provider: 'google-oauth' },
  });
});

test('buildPrivateIdentity never falls back to the Cliente Cero identity for a family member', () => {
  const identity = buildPrivateIdentity(familyFirebaseIdentityA, { getClienteCeroIdentity });
  assert.deepEqual(identity, {
    clientId: 'family:family-uid-a',
    userId: 'family-uid-a',
    expectedClientId: 'cliente-cero',
    authorization: { status: 'not_available', provider: null },
  });
  assert.notEqual(identity.clientId, identity.expectedClientId);
});

test('buildPrivateIdentity fails closed for missing, malformed, or unknown-shaped identity', () => {
  for (const input of [null, undefined, {}, { clientId: 'cliente-cero' }, { uid: 42, clientId: 'cliente-cero' }]) {
    const identity = buildPrivateIdentity(input, { getClienteCeroIdentity });
    assert.notEqual(identity.authorization.status, 'granted');
  }
});

test('buildDashboardReaders isolates two different family members from each other and from Cliente Cero', async () => {
  let gmailCalls = 0;
  let calendarCalls = 0;
  const dependencies = {
    getClienteCeroIdentity,
    buildGmailPrivateContext: async (input) => { gmailCalls += 1; return { input }; },
    buildCalendarPrivateContext: async (input) => { calendarCalls += 1; return { input }; },
  };

  const cero = buildDashboardReaders(clienteCeroFirebaseIdentity, dependencies);
  const ceroGmail = await cero.gmailReader();
  assert.equal(ceroGmail.input.clientId, 'cliente-cero');
  assert.equal(gmailCalls, 1);

  const familyA = buildDashboardReaders(familyFirebaseIdentityA, dependencies);
  const familyB = buildDashboardReaders(familyFirebaseIdentityB, dependencies);
  const gapA = await familyA.gmailReader();
  const gapB = await familyB.calendarReader();
  assert.equal(gapA.capabilityGap, true);
  assert.equal(gapA.privatePayload, null);
  assert.equal(gapB.capabilityGap, true);
  // Real integrations are never touched for a non-Cliente-Cero identity.
  assert.equal(gmailCalls, 1);
  assert.equal(calendarCalls, 0);
});

test('end-to-end composition: a family member is denied /api/dashboard, /api/approve, and /api/execute-approved (they all gate on isAuthorizedExecutiveIdentity)', () => {
  const familyPrivateIdentity = buildPrivateIdentity(familyFirebaseIdentityA, { getClienteCeroIdentity });
  assert.equal(isAuthorizedExecutiveIdentity(familyPrivateIdentity), false);

  const ceroPrivateIdentity = buildPrivateIdentity(clienteCeroFirebaseIdentity, { getClienteCeroIdentity });
  assert.equal(isAuthorizedExecutiveIdentity(ceroPrivateIdentity), true);
});

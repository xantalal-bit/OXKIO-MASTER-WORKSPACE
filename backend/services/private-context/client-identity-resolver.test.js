'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getClienteCeroIdentity } = require('./client-identity-resolver');

test('returns Cliente Cero operative identity', () => {
  assert.deepEqual(getClienteCeroIdentity(), {
    clientId: 'cliente-cero',
    userId: 'usuario-cliente-cero',
    expectedClientId: 'cliente-cero',
    authorization: {
      status: 'granted',
      provider: 'google-oauth',
    },
  });
});

test('returns a safe clone without shared mutable authorization', () => {
  const firstIdentity = getClienteCeroIdentity();
  const secondIdentity = getClienteCeroIdentity();

  assert.notEqual(firstIdentity, secondIdentity);
  assert.notEqual(firstIdentity.authorization, secondIdentity.authorization);

  firstIdentity.clientId = 'modified-client';
  firstIdentity.authorization.status = 'pending';

  assert.equal(secondIdentity.clientId, 'cliente-cero');
  assert.equal(secondIdentity.authorization.status, 'granted');
  assert.deepEqual(getClienteCeroIdentity(), {
    clientId: 'cliente-cero',
    userId: 'usuario-cliente-cero',
    expectedClientId: 'cliente-cero',
    authorization: {
      status: 'granted',
      provider: 'google-oauth',
    },
  });
});

test('does not expose token or credential fields', () => {
  const serializedIdentity = JSON.stringify(getClienteCeroIdentity());

  [
    'access_token',
    'refresh_token',
    'token',
    'secret',
    'credentials',
  ].forEach((fieldName) => {
    assert.equal(serializedIdentity.includes(fieldName), false);
  });
});

test('uses granted google-oauth authorization', () => {
  const identity = getClienteCeroIdentity();

  assert.equal(identity.authorization.status, 'granted');
  assert.equal(identity.authorization.provider, 'google-oauth');
});

test('expectedClientId matches clientId', () => {
  const identity = getClienteCeroIdentity();

  assert.equal(identity.expectedClientId, identity.clientId);
});

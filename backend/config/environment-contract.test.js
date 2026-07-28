'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  ENVIRONMENT_VARIABLES,
  assertEnvironment,
  validateEnvironment,
} = require('./environment-contract');

test('classifies every known environment variable without exposing values', () => {
  Object.values(ENVIRONMENT_VARIABLES).forEach((definition) => {
    assert.ok(definition.classifications.length > 0);
    definition.classifications.forEach((classification) => {
      assert.ok(['required', 'optional', 'local_only', 'secret', 'invariant'].includes(classification));
    });
  });

  const secret = 'must-not-be-reported';
  const result = validateEnvironment({
    GOOGLE_CLIENT_SECRET: secret,
    NODE_ENV: 'invalid',
  }, { requiredScopes: ['google_oauth'] });
  assert.equal(result.ok, false);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
  assert.deepEqual(result.missing, ['GOOGLE_CLIENT_ID', 'GOOGLE_REDIRECT_URI']);
  assert.deepEqual(result.invalid, ['NODE_ENV']);
});

test('validates required capabilities only when explicitly activated', () => {
  assert.equal(validateEnvironment({}).ok, true);
  assert.throws(
    () => assertEnvironment({}, { requiredScopes: ['authorization'] }),
    /OXKIO_ADMIN_FIREBASE_UIDS/
  );
  assert.equal(validateEnvironment({
    OXKIO_ADMIN_FIREBASE_UIDS: 'test-uid',
  }, { requiredScopes: ['authorization'] }).ok, true);
});

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  REDACTED,
  createSecretRuntime,
  createSyntheticSecretProvider,
} = require('./secret-runtime');

const SYNTHETIC_SECRET = 'synthetic-secret-value-3b';

function runtime(values = {}) {
  return createSecretRuntime({ provider: createSyntheticSecretProvider(values) });
}

test('returns only registered synthetic secrets and fails closed safely', () => {
  const secrets = runtime({ GOOGLE_CLIENT_SECRET: SYNTHETIC_SECRET });
  assert.equal(secrets.getSecret('GOOGLE_CLIENT_SECRET'), SYNTHETIC_SECRET);

  for (const [id, code] of [
    ['PORT', 'secret_not_allowed'],
    ['NOT_REGISTERED', 'secret_unknown'],
    ['OPENAI_API_KEY', 'secret_missing'],
  ]) {
    assert.throws(() => secrets.getSecret(id), (error) => {
      assert.equal(error.code, code);
      assert.equal(error.secretId, id);
      assert.equal(error.message.includes(id), true);
      assert.equal(error.message.includes(SYNTHETIC_SECRET), false);
      return true;
    });
  }
});

test('redacts known values, sensitive keys, authorization, credentials, and private keys', () => {
  const secrets = runtime({ GOOGLE_CLIENT_SECRET: SYNTHETIC_SECRET });
  const input = {
    safe: `prefix ${SYNTHETIC_SECRET} suffix`,
    nested: {
      password: 'synthetic-password',
      occurredAt: new Date('2026-08-09T12:00:00.000Z'),
      headers: { Authorization: 'Bearer synthetic-token' },
      accessToken: 'synthetic-access-token',
      url: 'postgresql://user:synthetic-password@example.test/db',
      note: 'token=synthetic-token',
      key: '-----BEGIN PRIVATE KEY-----\nsynthetic-key\n-----END PRIVATE KEY-----',
    },
    list: [SYNTHETIC_SECRET, { connection_string: 'postgresql://private' }],
  };

  const output = secrets.redact(input);
  assert.notEqual(output, input);
  assert.equal(input.nested.password, 'synthetic-password');
  assert.equal(output.safe, `prefix ${REDACTED} suffix`);
  assert.equal(output.nested.password, REDACTED);
  assert.equal(output.nested.occurredAt, '2026-08-09T12:00:00.000Z');
  assert.equal(output.nested.headers.Authorization, REDACTED);
  assert.equal(output.nested.accessToken, REDACTED);
  assert.equal(output.nested.url.includes('synthetic-password'), false);
  assert.equal(output.nested.note.includes('synthetic-token'), false);
  assert.equal(output.nested.key, REDACTED);
  assert.equal(output.list[0], REDACTED);
  assert.equal(output.list[1].connection_string, REDACTED);
});

test('handles Error and circular references without stacks or mutation', () => {
  const secrets = runtime({ GOOGLE_CLIENT_SECRET: SYNTHETIC_SECRET });
  const input = { error: new Error(`failure ${SYNTHETIC_SECRET}`) };
  input.self = input;
  input.error.code = 'synthetic_failure';

  const output = secrets.redact(input);
  assert.deepEqual(output.error, {
    name: 'Error',
    message: `failure ${REDACTED}`,
    code: 'synthetic_failure',
  });
  assert.equal('stack' in output.error, false);
  assert.equal(output.self, '[Circular]');
  assert.equal(input.self, input);
});

test('safeDiagnostic exposes only an allowlisted code and generic message', () => {
  const secrets = runtime({ GOOGLE_CLIENT_SECRET: SYNTHETIC_SECRET });
  const error = new Error(SYNTHETIC_SECRET);
  error.code = 'oauth_not_ready';
  assert.deepEqual(secrets.safeDiagnostic(error, 'api_execute_failed'), {
    code: 'oauth_not_ready',
    message: 'Operation failed.',
  });
  for (const unsafeCode of ['unknown_code', 'syntheticsecretvalue', SYNTHETIC_SECRET]) {
    error.code = unsafeCode;
    const diagnostic = secrets.safeDiagnostic(error, 'api_execute_failed');
    assert.deepEqual(diagnostic, {
      code: 'api_execute_failed',
      message: 'Operation failed.',
    });
    assert.equal(JSON.stringify(diagnostic).includes(SYNTHETIC_SECRET), false);
  }
  assert.deepEqual(secrets.safeDiagnostic(error, 'not_allowlisted'), {
    code: 'operation_failed',
    message: 'Operation failed.',
  });
});

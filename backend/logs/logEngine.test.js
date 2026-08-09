'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const LogEngine = require('./logEngine');
const {
  createSecretRuntime,
  createSyntheticSecretProvider,
} = require('../security/secret-runtime');

test('sanitizes message and data before persistence or emission', () => {
  const syntheticSecret = 'synthetic-log-secret-3b';
  const runtime = createSecretRuntime({
    provider: createSyntheticSecretProvider({ GOOGLE_CLIENT_SECRET: syntheticSecret }),
  });
  const emissions = [];
  const logger = new LogEngine({
    redactor: runtime.redact,
    consoleRef: { log: (message) => emissions.push(message) },
  });
  const data = { nested: { Authorization: `Bearer ${syntheticSecret}` }, safe: 'visible' };

  logger.addLog('SECURITY', `failure ${syntheticSecret}`, data);

  assert.equal(data.nested.Authorization.includes(syntheticSecret), true);
  assert.equal(JSON.stringify(logger.getLogs()).includes(syntheticSecret), false);
  assert.equal(emissions.join('\n').includes(syntheticSecret), false);
  assert.equal(logger.getLogs()[0].data.safe, 'visible');
});

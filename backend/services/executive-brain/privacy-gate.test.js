'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_PRIVACY_POLICY, PRIVACY_CLASSES, classifyContext, evaluateProviderRouting, maxPrivacyClass,
} = require('./privacy-gate');

test('classification only raises the declared class, never lowers it', () => {
  assert.equal(classifyContext({ declaredClass: 'PUBLIC', capabilities: ['research.web'] }).privacyClass, 'PUBLIC');
  assert.equal(classifyContext({ declaredClass: 'PUBLIC', capabilities: ['gmail.draft'] }).privacyClass, 'CONFIDENTIAL');
  assert.equal(classifyContext({ declaredClass: 'PUBLIC', capabilities: ['repository.analyze'] }).privacyClass, 'INTERNAL');
  assert.equal(classifyContext({ declaredClass: 'CONFIDENTIAL', capabilities: ['research.web'] }).privacyClass, 'CONFIDENTIAL');
  assert.equal(classifyContext({ declaredClass: 'nonsense' }).privacyClass, 'CONFIDENTIAL');
});

test('credential-looking context is SECRET', () => {
  for (const text of ['api_key=abc', 'Authorization: Bearer abcdefghijkl', '-----BEGIN PRIVATE KEY-----', 'password: x', 'sk-abcdefghijklmnopqrst']) {
    assert.equal(classifyContext({ declaredClass: 'PUBLIC', texts: [text] }).privacyClass, 'SECRET', text);
  }
  assert.equal(classifyContext({ declaredClass: 'PUBLIC', texts: ['company: ACME'] }).privacyClass, 'PUBLIC');
});

test('SECRET never goes to an external provider, whatever the policy', () => {
  const policy = { confidentialProviders: [{ providerId: 'p', region: 'eu' }], internalProviders: [{ providerId: 'p' }] };
  const routed = evaluateProviderRouting({ privacyClass: 'SECRET', provider: { external: true, providerId: 'p', region: 'eu' }, policy });
  assert.deepEqual([routed.allowed, routed.reason], [false, 'secret_never_external']);
  assert.equal(evaluateProviderRouting({ privacyClass: 'SECRET', provider: { external: false } }).allowed, true);
});

test('CONFIDENTIAL needs provider AND region; INTERNAL needs provider; defaults allow none', () => {
  const external = { external: true, providerId: 'p', region: 'eu' };
  assert.equal(evaluateProviderRouting({ privacyClass: 'CONFIDENTIAL', provider: external }).allowed, false);
  assert.equal(evaluateProviderRouting({ privacyClass: 'INTERNAL', provider: external }).allowed, false);
  const policy = { confidentialProviders: [{ providerId: 'p', region: 'eu' }], internalProviders: [{ providerId: 'p' }] };
  assert.equal(evaluateProviderRouting({ privacyClass: 'CONFIDENTIAL', provider: external, policy }).allowed, true);
  assert.equal(evaluateProviderRouting({ privacyClass: 'CONFIDENTIAL', provider: { ...external, region: 'us' }, policy }).allowed, false);
  assert.equal(evaluateProviderRouting({ privacyClass: 'CONFIDENTIAL', provider: { external: true, providerId: 'p' }, policy }).allowed, false);
  assert.equal(evaluateProviderRouting({ privacyClass: 'INTERNAL', provider: { external: true, providerId: 'p' }, policy }).allowed, true);
  assert.deepEqual(DEFAULT_PRIVACY_POLICY.confidentialProviders, []);
  assert.deepEqual(DEFAULT_PRIVACY_POLICY.internalProviders, []);
});

test('PUBLIC is allowed externally unless the policy forbids it; unknown classes are refused', () => {
  const external = { external: true, providerId: 'p' };
  assert.equal(evaluateProviderRouting({ privacyClass: 'PUBLIC', provider: external }).allowed, true);
  assert.equal(evaluateProviderRouting({ privacyClass: 'PUBLIC', provider: external, policy: { publicExternalAllowed: false } }).allowed, false);
  assert.equal(evaluateProviderRouting({ privacyClass: 'TOP', provider: external }).allowed, false);
  assert.equal(maxPrivacyClass('PUBLIC', 'INTERNAL'), 'INTERNAL');
  assert.equal(maxPrivacyClass('PUBLIC', 'weird'), PRIVACY_CLASSES.CONFIDENTIAL);
});

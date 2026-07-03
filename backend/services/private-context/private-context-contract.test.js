'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SCOPES,
  SENSITIVITIES,
  PROMOTION_POLICIES,
  RETENTION_POLICIES,
  validatePrivateContext,
  prepareAuthorizedContext,
  canPromoteContext,
  assertCompatibleClient,
} = require('./private-context-contract');

function buildContext(overrides = {}) {
  return {
    clientId: 'cliente-cero',
    userId: 'jose',
    scope: SCOPES.PRIVATE_USER,
    sensitivity: SENSITIVITIES.CONFIDENTIAL,
    sourceType: 'gmail',
    sourceId: 'gmail-primary',
    authorization: {
      status: 'granted',
      grantedBy: 'jose',
    },
    purpose: 'executive-assistance',
    ...overrides,
  };
}

test('accepts valid Cliente Cero private context', () => {
  const result = validatePrivateContext(buildContext());

  assert.equal(result.ok, true);
  assert.equal(result.context.clientId, 'cliente-cero');
  assert.equal(result.context.userId, 'jose');
  assert.equal(result.context.promotionPolicy, PROMOTION_POLICIES.NEVER_PROMOTE);
});

test('accepts valid future client private context', () => {
  const result = validatePrivateContext(buildContext({
    clientId: 'cliente-final-001',
    userId: 'owner-001',
    scope: SCOPES.PRIVATE_CLIENT,
    sourceType: 'documents',
    sourceId: 'client-documents',
  }));

  assert.equal(result.ok, true);
  assert.equal(result.context.clientId, 'cliente-final-001');
  assert.equal(result.context.scope, SCOPES.PRIVATE_CLIENT);
});

test('rejects context without clientId', () => {
  const result = validatePrivateContext(buildContext({
    clientId: '',
  }));

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === 'missing_client_id'));
});

test('rejects context without authorization', () => {
  const result = validatePrivateContext(buildContext({
    authorization: null,
  }));

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === 'missing_authorization'));
});

test('rejects cross-client context use', () => {
  assert.throws(
    () => assertCompatibleClient(buildContext(), 'cliente-final-001'),
    /clientId does not match/,
  );
});

test('private:user is not promotable', () => {
  const result = canPromoteContext(buildContext({
    scope: SCOPES.PRIVATE_USER,
  }));

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'private_scope_never_promote');
});

test('private:client is not promotable', () => {
  const result = canPromoteContext(buildContext({
    scope: SCOPES.PRIVATE_CLIENT,
  }));

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'private_scope_never_promote');
});

test('private:project is not promotable', () => {
  const result = canPromoteContext(buildContext({
    scope: SCOPES.PRIVATE_PROJECT,
    sourceType: 'project',
    sourceId: 'private-project',
  }));

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'private_scope_never_promote');
});

test('platform:capability is reusable', () => {
  const prepared = prepareAuthorizedContext(buildContext({
    clientId: 'xantalal-platform',
    userId: 'platform-owner',
    scope: SCOPES.PLATFORM_CAPABILITY,
    sensitivity: SENSITIVITIES.INTERNAL,
    sourceType: 'code',
    sourceId: 'private-context-contract',
    purpose: 'platform-development',
  }), {
    expectedClientId: 'xantalal-platform',
    allowedScopes: [SCOPES.PLATFORM_CAPABILITY],
    requiredPurpose: 'platform-development',
  });

  assert.equal(prepared.authorized, true);
  assert.equal(prepared.promotable, true);
  assert.equal(prepared.promotionPolicy, PROMOTION_POLICIES.REUSABLE_CAPABILITY);
});

test('runtime:temporary is not persistent by default', () => {
  const result = validatePrivateContext(buildContext({
    scope: SCOPES.RUNTIME_TEMPORARY,
    sensitivity: SENSITIVITIES.NORMAL,
    sourceType: 'runtime',
    sourceId: 'briefing-request',
  }));

  assert.equal(result.ok, true);
  assert.equal(result.context.retentionPolicy, RETENTION_POLICIES.NO_PERSISTENCE_BY_DEFAULT);
  assert.equal(canPromoteContext(result.context).ok, false);
});

test('rejects clientId object', () => {
  const result = validatePrivateContext(buildContext({
    clientId: { id: 'cliente-cero' },
  }));

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === 'invalid_client_id'));
});

test('rejects userId number', () => {
  const result = validatePrivateContext(buildContext({
    userId: 123,
  }));

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === 'invalid_user_id'));
});

test('rejects sourceId array', () => {
  const result = validatePrivateContext(buildContext({
    sourceId: ['gmail-primary'],
  }));

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === 'invalid_source_id'));
});

test('rejects purpose boolean', () => {
  const result = validatePrivateContext(buildContext({
    purpose: true,
  }));

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === 'invalid_purpose'));
});

test('rejects missing expectedClientId for private scopes', () => {
  assert.throws(
    () => prepareAuthorizedContext(buildContext()),
    (error) => error.code === 'missing_expected_client_id_for_private_scope',
  );
});

test('rejects non-string expectedClientId', () => {
  assert.throws(
    () => assertCompatibleClient(buildContext(), { id: 'cliente-cero' }),
    (error) => error.code === 'missing_expected_client_id',
  );
});

test('rejects malformed authorization', () => {
  const result = validatePrivateContext(buildContext({
    authorization: 123,
  }));

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === 'missing_authorization'));
});

test('normalizes private promotable policy to NEVER_PROMOTE', () => {
  const result = validatePrivateContext(buildContext({
    promotionPolicy: PROMOTION_POLICIES.REUSABLE_CAPABILITY,
  }));

  assert.equal(result.ok, true);
  assert.equal(result.context.promotionPolicy, PROMOTION_POLICIES.NEVER_PROMOTE);
  assert.equal(canPromoteContext(result.context).ok, false);
});

test('rejects unknown scope', () => {
  const result = validatePrivateContext(buildContext({
    scope: 'private:unknown',
  }));

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === 'invalid_scope'));
});

test('rejects unknown sensitivity', () => {
  const result = validatePrivateContext(buildContext({
    sensitivity: 'secret',
  }));

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.code === 'invalid_sensitivity'));
});

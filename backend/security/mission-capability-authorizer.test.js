'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const authorizerModule = require('./mission-capability-authorizer');
const {
  MissionCapabilityAuthorizationError,
  authorizeMissionCapability,
} = authorizerModule;

const BASE_SCOPE = Object.freeze({
  tenantId: 'tenant-synthetic-alpha',
  userId: 'user-synthetic-alpha',
  clientId: 'client-synthetic-alpha',
  roles: Object.freeze(['owner']),
});

function scopeWith(roles, overrides = {}) {
  return { ...BASE_SCOPE, roles, ...overrides };
}

function expectCode(operation, code) {
  assert.throws(operation, (error) => (
    error instanceof MissionCapabilityAuthorizationError && error.code === code
  ));
}

test('exports only the minimal frozen authorizer surface', () => {
  assert.equal(Object.isFrozen(authorizerModule), true);
  assert.deepEqual(Object.keys(authorizerModule).sort(), [
    'MissionCapabilityAuthorizationError',
    'authorizeMissionCapability',
  ]);
});

for (const role of ['owner', 'admin', 'operator']) {
  test(`${role} receives a scope-bound mission:create grant`, () => {
    const grant = authorizeMissionCapability({
      scope: scopeWith([role]),
      capability: 'mission:create',
    });
    assert.deepEqual(grant, {
      capability: 'mission:create',
      tenantId: BASE_SCOPE.tenantId,
      userId: BASE_SCOPE.userId,
      clientId: BASE_SCOPE.clientId,
    });
  });
}

for (const role of ['reviewer', 'viewer']) {
  test(`${role} cannot use mission:create`, () => {
    expectCode(
      () => authorizeMissionCapability({
        scope: scopeWith([role]),
        capability: 'mission:create',
      }),
      'mission_capability_denied',
    );
  });
}

test('a multi-role scope is allowed when one tenant role grants the capability', () => {
  const grant = authorizeMissionCapability({
    scope: scopeWith(['viewer', 'operator']),
    capability: 'mission:create',
  });
  assert.equal(grant.capability, 'mission:create');
});

test('rejects empty, unknown, duplicate, and non-array tenant roles', () => {
  for (const roles of [[], ['superadmin'], ['owner', 'owner'], 'owner']) {
    expectCode(
      () => authorizeMissionCapability({
        scope: scopeWith(roles),
        capability: 'mission:create',
      }),
      'mission_capability_scope_invalid',
    );
  }
});

test('rejects malformed scope and caller-supplied platform authority', () => {
  for (const scope of [
    undefined,
    {},
    scopeWith(['owner'], { tenantId: '' }),
    scopeWith(['owner'], { userId: 'x' }),
    scopeWith(['owner'], { clientId: null }),
    { ...scopeWith(['owner']), platformRole: 'admin' },
  ]) {
    expectCode(
      () => authorizeMissionCapability({ scope, capability: 'mission:create' }),
      'mission_capability_scope_invalid',
    );
  }
});

test('fails closed for every capability except the exact known value', () => {
  for (const capability of [undefined, '', 'mission:*', 'mission:create:any', 'MISSION:CREATE']) {
    expectCode(
      () => authorizeMissionCapability({ scope: BASE_SCOPE, capability }),
      'mission_capability_unknown',
    );
  }
});

test('a conceptual platform admin without tenant roles receives no grant', () => {
  const platformIdentity = {
    tenantId: BASE_SCOPE.tenantId,
    userId: BASE_SCOPE.userId,
    clientId: BASE_SCOPE.clientId,
    roles: [],
    platformRole: 'admin',
  };
  expectCode(
    () => authorizeMissionCapability({
      scope: platformIdentity,
      capability: 'mission:create',
    }),
    'mission_capability_scope_invalid',
  );
});

test('grant is frozen, minimal, and detached from mutable role input', () => {
  const roles = ['operator'];
  const grant = authorizeMissionCapability({
    scope: scopeWith(roles),
    capability: 'mission:create',
  });
  roles[0] = 'viewer';
  assert.equal(Object.isFrozen(grant), true);
  assert.deepEqual(Object.keys(grant).sort(), ['capability', 'clientId', 'tenantId', 'userId']);
  assert.throws(() => { grant.tenantId = 'tenant-spoofed'; }, TypeError);
  assert.equal(grant.tenantId, BASE_SCOPE.tenantId);
});

test('does not accept authority spoofing through extra input fields', () => {
  for (const field of ['roles', 'platformRole', 'authorized', 'projectId', 'workspaceId']) {
    expectCode(
      () => authorizeMissionCapability({
        scope: BASE_SCOPE,
        capability: 'mission:create',
        [field]: field === 'roles' ? ['owner'] : 'spoofed',
      }),
      'mission_capability_request_invalid',
    );
  }
});

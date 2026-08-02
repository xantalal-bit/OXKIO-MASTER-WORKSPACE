'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  MEMBERSHIP_ROLES,
  MEMBERSHIP_STATUSES,
  MembershipResolutionError,
  createClientZeroBootstrapProvider,
  createMembershipResolver,
} = require('./membership-resolver');

const USER_ID = 'firebase-user-synthetic';
const ACTIVE_MEMBERSHIP = Object.freeze({
  tenantId: 'tenant-synthetic-alpha',
  clientId: 'client-synthetic-alpha',
  userId: USER_ID,
  roles: Object.freeze(['owner']),
  status: 'ACTIVE',
});

function providerReturning(value) {
  return { findMemberships: async () => value };
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => (
    error instanceof MembershipResolutionError && error.code === code
  ));
}

function resolveWith(candidates, input = { authenticatedUserId: USER_ID }) {
  return createMembershipResolver({ provider: providerReturning(candidates) })
    .resolveMembership(input);
}

test('publishes only the frozen approved status and role registries', () => {
  assert.deepEqual(MEMBERSHIP_STATUSES, ['ACTIVE', 'SUSPENDED', 'REVOKED']);
  assert.deepEqual(MEMBERSHIP_ROLES, ['owner', 'admin', 'operator', 'reviewer', 'viewer']);
  assert.equal(Object.isFrozen(MEMBERSHIP_STATUSES), true);
  assert.equal(Object.isFrozen(MEMBERSHIP_ROLES), true);
});

test('resolves exactly one valid ACTIVE membership into MissionScope', async () => {
  const scope = await resolveWith([ACTIVE_MEMBERSHIP]);
  assert.deepEqual(scope, {
    tenantId: ACTIVE_MEMBERSHIP.tenantId,
    userId: USER_ID,
    clientId: ACTIVE_MEMBERSHIP.clientId,
    roles: ['owner'],
  });
  assert.equal(Object.hasOwn(scope, 'status'), false);
});

test('fails closed without a membership', async () => {
  await expectCode(resolveWith([]), 'membership_not_available');
});

for (const status of ['SUSPENDED', 'REVOKED']) {
  test(`fails closed for ${status}`, async () => {
    await expectCode(resolveWith([{ ...ACTIVE_MEMBERSHIP, status }]), 'membership_not_available');
  });
}

test('rejects an unknown membership status', async () => {
  await expectCode(
    resolveWith([{ ...ACTIVE_MEMBERSHIP, status: 'UNKNOWN' }]),
    'membership_data_invalid',
  );
});

test('rejects unknown, empty, and duplicate roles', async () => {
  for (const roles of [['superadmin'], [], ['owner', 'owner']]) {
    await expectCode(resolveWith([{ ...ACTIVE_MEMBERSHIP, roles }]), 'membership_data_invalid');
  }
});

test('rejects absent or malformed authenticatedUserId', async () => {
  for (const authenticatedUserId of [undefined, '', 'x', { uid: USER_ID }]) {
    await expectCode(
      resolveWith([], { authenticatedUserId }),
      'membership_identity_invalid',
    );
  }
});

test('rejects a membership for a different authenticated user', async () => {
  await expectCode(
    resolveWith([{ ...ACTIVE_MEMBERSHIP, userId: 'firebase-user-foreign' }]),
    'membership_data_invalid',
  );
});

test('rejects missing tenantId or clientId', async () => {
  await expectCode(resolveWith([{ ...ACTIVE_MEMBERSHIP, tenantId: '' }]), 'membership_data_invalid');
  await expectCode(resolveWith([{ ...ACTIVE_MEMBERSHIP, clientId: '' }]), 'membership_data_invalid');
});

test('rejects multiple ACTIVE memberships and exact ACTIVE duplicates', async () => {
  await expectCode(resolveWith([
    ACTIVE_MEMBERSHIP,
    { ...ACTIVE_MEMBERSHIP, tenantId: 'tenant-synthetic-beta' },
  ]), 'membership_ambiguous');
  await expectCode(resolveWith([ACTIVE_MEMBERSHIP, ACTIVE_MEMBERSHIP]), 'membership_ambiguous');
});

test('selects one ACTIVE membership when valid inactive history is also returned', async () => {
  const scope = await resolveWith([
    { ...ACTIVE_MEMBERSHIP, status: 'REVOKED' },
    ACTIVE_MEMBERSHIP,
  ]);
  assert.equal(scope.tenantId, ACTIVE_MEMBERSHIP.tenantId);
});

test('fails closed when all returned memberships are inactive', async () => {
  await expectCode(resolveWith([
    { ...ACTIVE_MEMBERSHIP, status: 'SUSPENDED' },
    { ...ACTIVE_MEMBERSHIP, status: 'REVOKED' },
  ]), 'membership_not_available');
});

test('disabled CLIENT_ZERO_BOOTSTRAP is identifiable and resolves nobody', async () => {
  const provider = createClientZeroBootstrapProvider();
  assert.equal(provider.kind, 'CLIENT_ZERO_BOOTSTRAP');
  await expectCode(
    createMembershipResolver({ provider }).resolveMembership({ authenticatedUserId: USER_ID }),
    'membership_not_available',
  );
});

test('enabled CLIENT_ZERO_BOOTSTRAP resolves only its configured synthetic UID', async () => {
  const provider = createClientZeroBootstrapProvider({
    enabled: true,
    authenticatedUserId: USER_ID,
    membership: ACTIVE_MEMBERSHIP,
  });
  const resolver = createMembershipResolver({ provider });
  assert.equal(provider.kind, 'CLIENT_ZERO_BOOTSTRAP');
  assert.deepEqual(await resolver.resolveMembership({ authenticatedUserId: USER_ID }), {
    tenantId: ACTIVE_MEMBERSHIP.tenantId,
    userId: USER_ID,
    clientId: ACTIVE_MEMBERSHIP.clientId,
    roles: ['owner'],
  });
  await expectCode(
    resolver.resolveMembership({ authenticatedUserId: 'firebase-user-foreign' }),
    'membership_not_available',
  );
});

test('rejects incomplete enabled bootstrap configuration without leaking values', () => {
  for (const configuration of [
    { enabled: true },
    { enabled: true, authenticatedUserId: USER_ID },
    { enabled: true, authenticatedUserId: USER_ID, membership: { ...ACTIVE_MEMBERSHIP, roles: [] } },
  ]) {
    assert.throws(
      () => createClientZeroBootstrapProvider(configuration),
      (error) => error.code === 'bootstrap_configuration_invalid'
        && !error.message.includes(USER_ID)
        && !error.message.includes(ACTIVE_MEMBERSHIP.tenantId)
        && !error.message.includes(ACTIVE_MEMBERSHIP.clientId),
    );
  }
});

test('a conceptual platform admin without membership receives no MissionScope', async () => {
  const identity = { authenticatedUserId: USER_ID, platformRole: 'admin' };
  await expectCode(
    resolveWith([], { authenticatedUserId: identity.authenticatedUserId }),
    'membership_not_available',
  );
});

test('provider data and returned MissionScope do not share mutable roles', async () => {
  const roles = ['owner'];
  const candidate = { ...ACTIVE_MEMBERSHIP, roles };
  const scope = await resolveWith([candidate]);
  roles[0] = 'viewer';
  candidate.tenantId = 'tenant-mutated-later';
  assert.deepEqual(scope, {
    tenantId: ACTIVE_MEMBERSHIP.tenantId,
    userId: USER_ID,
    clientId: ACTIVE_MEMBERSHIP.clientId,
    roles: ['owner'],
  });
});

test('MissionScope and its roles are frozen', async () => {
  const scope = await resolveWith([ACTIVE_MEMBERSHIP]);
  assert.equal(Object.isFrozen(scope), true);
  assert.equal(Object.isFrozen(scope.roles), true);
  assert.throws(() => { scope.tenantId = 'tenant-mutated'; }, TypeError);
  assert.throws(() => { scope.roles.push('viewer'); }, TypeError);
});

test('wraps provider failures in a sanitized stable error', async () => {
  const failures = [
    new Error(`failure for ${ACTIVE_MEMBERSHIP.tenantId}/${ACTIVE_MEMBERSHIP.clientId}`),
    new MembershipResolutionError(
      'provider_private_error',
      `private ${ACTIVE_MEMBERSHIP.tenantId}/${ACTIVE_MEMBERSHIP.clientId}`,
    ),
  ];
  for (const failure of failures) {
    const provider = { findMemberships: async () => { throw failure; } };
    try {
      await createMembershipResolver({ provider }).resolveMembership({ authenticatedUserId: USER_ID });
      assert.fail('Expected provider failure.');
    } catch (error) {
      assert.equal(error.code, 'membership_provider_unavailable');
      assert.equal(error.message.includes(ACTIVE_MEMBERSHIP.tenantId), false);
      assert.equal(error.message.includes(ACTIVE_MEMBERSHIP.clientId), false);
    }
  }
});

test('rejects invalid provider and invalid provider response', async () => {
  assert.throws(
    () => createMembershipResolver(),
    (error) => error.code === 'membership_provider_invalid',
  );
  await expectCode(resolveWith({ membership: ACTIVE_MEMBERSHIP }), 'membership_data_invalid');
  await expectCode(resolveWith([null]), 'membership_data_invalid');
});

test('errors never reveal tenant, client, status, or another user', async () => {
  const foreign = {
    ...ACTIVE_MEMBERSHIP,
    tenantId: 'tenant-private-foreign',
    clientId: 'client-private-foreign',
    userId: 'firebase-user-private-foreign',
    status: 'REVOKED',
  };
  try {
    await resolveWith([foreign]);
    assert.fail('Expected invalid provider data.');
  } catch (error) {
    for (const sensitive of [foreign.tenantId, foreign.clientId, foreign.userId, foreign.status]) {
      assert.equal(error.message.includes(sensitive), false);
    }
  }
});

test('rejects caller-supplied authority fields and provides no fallback', async () => {
  let providerCalls = 0;
  const resolver = createMembershipResolver({
    provider: {
      findMemberships: async () => {
        providerCalls += 1;
        return [ACTIVE_MEMBERSHIP];
      },
    },
  });
  for (const field of ['tenantId', 'clientId', 'userId', 'role', 'platformRole']) {
    await expectCode(
      resolver.resolveMembership({ authenticatedUserId: USER_ID, [field]: 'spoofed-value' }),
      'membership_request_invalid',
    );
  }
  assert.equal(providerCalls, 0);
});

test('bootstrap snapshots injected configuration and does not infer a role', async () => {
  const roles = ['viewer'];
  const membership = { ...ACTIVE_MEMBERSHIP, roles };
  const provider = createClientZeroBootstrapProvider({
    enabled: true,
    authenticatedUserId: USER_ID,
    membership,
    platformRole: 'admin',
  });
  roles[0] = 'owner';
  membership.clientId = 'client-mutated-later';
  const scope = await createMembershipResolver({ provider })
    .resolveMembership({ authenticatedUserId: USER_ID });
  assert.deepEqual(scope.roles, ['viewer']);
  assert.equal(scope.clientId, ACTIVE_MEMBERSHIP.clientId);
});

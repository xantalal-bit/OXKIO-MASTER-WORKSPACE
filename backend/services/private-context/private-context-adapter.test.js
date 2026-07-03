'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SCOPES,
  SENSITIVITIES,
  PROMOTION_POLICIES,
  RETENTION_POLICIES,
} = require('./private-context-contract');
const { preparePrivateContextAdapter } = require('./private-context-adapter');

function buildPrivateContext(overrides = {}) {
  return {
    clientId: 'cliente-cero',
    userId: 'cliente-cero-user',
    scope: SCOPES.PRIVATE_USER,
    sensitivity: SENSITIVITIES.CONFIDENTIAL,
    sourceType: 'authorized-provider',
    sourceId: 'provider-source',
    authorization: {
      status: 'granted',
      grantedBy: 'cliente-cero-user',
    },
    purpose: 'executive-context',
    ...overrides,
  };
}

function adapt(overrides = {}) {
  return preparePrivateContextAdapter({
    privateContext: buildPrivateContext(overrides.privateContext),
    expectedClientId: overrides.expectedClientId || 'cliente-cero',
    payload: Object.hasOwn(overrides, 'payload') ? overrides.payload : { items: ['authorized'] },
    allowedScopes: overrides.allowedScopes,
    requiredPurpose: overrides.requiredPurpose,
  });
}

test('prepares valid private context', () => {
  const result = adapt();

  assert.equal(result.clientId, 'cliente-cero');
  assert.equal(result.userId, 'cliente-cero-user');
  assert.equal(result.private, true);
  assert.equal(result.authorized, true);
  assert.equal(result.promotionPolicy, PROMOTION_POLICIES.NEVER_PROMOTE);
});

test('preserves valid payload', () => {
  const payload = { agenda: [{ title: 'Revision' }] };
  const result = adapt({ payload });

  assert.deepEqual(result.payload, payload);
});

test('rejects missing payload', () => {
  assert.throws(
    () => preparePrivateContextAdapter({
      privateContext: buildPrivateContext(),
      expectedClientId: 'cliente-cero',
    }),
    (error) => error.code === 'missing_payload',
  );
});

test('rejects null payload', () => {
  assert.throws(
    () => adapt({ payload: null }),
    (error) => error.code === 'invalid_payload',
  );
});

test('rejects context without authorization', () => {
  assert.throws(
    () => adapt({
      privateContext: {
        authorization: null,
      },
    }),
    (error) => error.code === 'invalid_private_context',
  );
});

test('rejects incompatible clientId', () => {
  assert.throws(
    () => adapt({ expectedClientId: 'cliente-final-001' }),
    (error) => error.code === 'client_scope_mismatch',
  );
});

test('rejects missing expectedClientId for private scopes', () => {
  assert.throws(
    () => preparePrivateContextAdapter({
      privateContext: buildPrivateContext(),
      payload: { items: [] },
    }),
    (error) => error.code === 'missing_expected_client_id_for_private_scope',
  );
});

test('private:user is not persistable', () => {
  const result = adapt({
    privateContext: {
      scope: SCOPES.PRIVATE_USER,
    },
  });

  assert.equal(result.private, true);
  assert.equal(result.persistable, false);
});

test('private:client is not promotable', () => {
  const result = adapt({
    privateContext: {
      scope: SCOPES.PRIVATE_CLIENT,
      promotionPolicy: PROMOTION_POLICIES.REUSABLE_CAPABILITY,
    },
  });

  assert.equal(result.private, true);
  assert.equal(result.promotable, false);
  assert.equal(result.promotionPolicy, PROMOTION_POLICIES.NEVER_PROMOTE);
});

test('private:project remains isolated', () => {
  const result = adapt({
    privateContext: {
      scope: SCOPES.PRIVATE_PROJECT,
      sourceType: 'project',
      sourceId: 'private-project',
    },
  });

  assert.equal(result.scope, SCOPES.PRIVATE_PROJECT);
  assert.equal(result.private, true);
  assert.equal(result.persistable, false);
  assert.equal(result.promotable, false);
});

test('platform:capability preserves reusable semantics', () => {
  const result = preparePrivateContextAdapter({
    privateContext: buildPrivateContext({
      clientId: 'xantalal-platform',
      userId: 'platform-owner',
      scope: SCOPES.PLATFORM_CAPABILITY,
      sensitivity: SENSITIVITIES.INTERNAL,
      sourceType: 'code',
      sourceId: 'capability-module',
      purpose: 'platform-development',
    }),
    expectedClientId: 'xantalal-platform',
    payload: { capability: 'adapter' },
    allowedScopes: [SCOPES.PLATFORM_CAPABILITY],
    requiredPurpose: 'platform-development',
  });

  assert.equal(result.private, false);
  assert.equal(result.persistable, true);
  assert.equal(result.promotable, true);
  assert.equal(result.promotionPolicy, PROMOTION_POLICIES.REUSABLE_CAPABILITY);
});

test('runtime:temporary preserves non-persistence by default', () => {
  const result = preparePrivateContextAdapter({
    privateContext: buildPrivateContext({
      clientId: 'runtime-context',
      userId: 'runtime-user',
      scope: SCOPES.RUNTIME_TEMPORARY,
      sensitivity: SENSITIVITIES.NORMAL,
      sourceType: 'runtime',
      sourceId: 'request-context',
      purpose: 'temporary-processing',
    }),
    expectedClientId: 'runtime-context',
    payload: { request: 'briefing' },
  });

  assert.equal(result.private, false);
  assert.equal(result.persistable, false);
  assert.equal(result.promotable, false);
  assert.equal(result.retentionPolicy, RETENTION_POLICIES.NO_PERSISTENCE_BY_DEFAULT);
});

test('does not mutate original input', () => {
  const privateContext = buildPrivateContext({
    promotionPolicy: PROMOTION_POLICIES.REUSABLE_CAPABILITY,
  });
  const payload = { items: ['original'] };
  const input = {
    privateContext,
    expectedClientId: 'cliente-cero',
    payload,
  };
  const before = JSON.stringify(input);

  const result = preparePrivateContextAdapter(input);

  assert.throws(
    () => {
      result.payload.items = ['changed'];
    },
    /read only property|Cannot assign/,
  );

  assert.equal(JSON.stringify(input), before);
});

test('nested object payload does not share references', () => {
  const payload = {
    nested: {
      value: 'original',
    },
  };
  const result = adapt({ payload });

  assert.notEqual(result.payload, payload);
  assert.notEqual(result.payload.nested, payload.nested);

  payload.nested.value = 'changed';

  assert.equal(result.payload.nested.value, 'original');
});

test('nested array payload does not share references', () => {
  const payload = {
    items: [
      {
        value: 'original',
      },
    ],
  };
  const result = adapt({ payload });

  assert.notEqual(result.payload.items, payload.items);
  assert.notEqual(result.payload.items[0], payload.items[0]);

  payload.items[0].value = 'changed';

  assert.equal(result.payload.items[0].value, 'original');
});

test('rejects Date payload', () => {
  assert.throws(
    () => adapt({ payload: new Date() }),
    (error) => error.code === 'invalid_payload',
  );
});

test('rejects Map payload', () => {
  assert.throws(
    () => adapt({ payload: new Map([['key', 'value']]) }),
    (error) => error.code === 'invalid_payload',
  );
});

test('rejects Set payload', () => {
  assert.throws(
    () => adapt({ payload: new Set(['value']) }),
    (error) => error.code === 'invalid_payload',
  );
});

test('rejects class instance payload', () => {
  class PrivatePayload {
    constructor() {
      this.value = 'not-plain';
    }
  }

  assert.throws(
    () => adapt({ payload: new PrivatePayload() }),
    (error) => error.code === 'invalid_payload',
  );
});

test('rejects Function payload', () => {
  assert.throws(
    () => adapt({ payload: () => ({}) }),
    (error) => error.code === 'invalid_payload',
  );
});

test('mutating original input after adaptation does not change adapted payload', () => {
  const payload = {
    nested: {
      list: ['original'],
    },
  };
  const result = adapt({ payload });

  payload.nested.list.push('changed');

  assert.deepEqual(result.payload, {
    nested: {
      list: ['original'],
    },
  });
});

test('adapted payload is deeply frozen', () => {
  const result = adapt({
    payload: {
      nested: {
        list: ['original'],
      },
    },
  });

  assert.equal(Object.isFrozen(result.payload), true);
  assert.equal(Object.isFrozen(result.payload.nested), true);
  assert.equal(Object.isFrozen(result.payload.nested.list), true);
  assert.throws(
    () => {
      result.payload.nested.list.push('changed');
    },
    /object is not extensible|Cannot add property/,
  );
  assert.deepEqual(result.payload.nested.list, ['original']);
});

test('accepts null-prototype plain payload when simple', () => {
  const payload = Object.create(null);
  payload.value = 'allowed';
  payload.nested = Object.create(null);
  payload.nested.enabled = true;

  const result = adapt({ payload });

  assert.deepEqual(result.payload, {
    value: 'allowed',
    nested: {
      enabled: true,
    },
  });
});

'use strict';

const {
  SCOPES,
  prepareAuthorizedContext,
} = require('./private-context-contract');

function isPrivateScope(scope) {
  return [
    SCOPES.PRIVATE_USER,
    SCOPES.PRIVATE_CLIENT,
    SCOPES.PRIVATE_PROJECT,
  ].includes(scope);
}

function isPayloadPresent(input) {
  return Boolean(input && Object.hasOwn(input, 'payload'));
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
}

function isSafePayloadValue(value) {
  if (value === null) {
    return true;
  }

  if (['string', 'number', 'boolean'].includes(typeof value)) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every(isSafePayloadValue);
  }

  if (isPlainObject(value)) {
    return Object.values(value).every(isSafePayloadValue);
  }

  return false;
}

function isValidPayload(payload) {
  if (Array.isArray(payload)) {
    return payload.every(isSafePayloadValue);
  }

  if (isPlainObject(payload)) {
    return Object.values(payload).every(isSafePayloadValue);
  }

  return false;
}

function clonePayload(payload) {
  if (Array.isArray(payload)) {
    return payload.map(clonePayload);
  }

  if (isPlainObject(payload)) {
    return Object.entries(payload).reduce((copy, [key, value]) => {
      copy[key] = clonePayload(value);
      return copy;
    }, {});
  }

  return payload;
}

function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }

  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);

  return value;
}

function buildAdapterError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function getPersistableFlag(context) {
  if (isPrivateScope(context.scope)) {
    return false;
  }

  if (context.scope === SCOPES.RUNTIME_TEMPORARY) {
    return false;
  }

  return true;
}

function preparePrivateContextAdapter(input = {}) {
  if (!isPayloadPresent(input)) {
    throw buildAdapterError('missing_payload', 'payload is required.');
  }

  if (!isValidPayload(input.payload)) {
    throw buildAdapterError('invalid_payload', 'payload must be a JSON-like plain object or array.');
  }

  const context = prepareAuthorizedContext(input.privateContext, {
    expectedClientId: input.expectedClientId,
    allowedScopes: input.allowedScopes,
    requiredPurpose: input.requiredPurpose,
  });
  const privateScope = isPrivateScope(context.scope);

  return {
    clientId: context.clientId,
    userId: context.userId,
    scope: context.scope,
    sensitivity: context.sensitivity,
    sourceType: context.sourceType,
    sourceId: context.sourceId,
    purpose: context.purpose,
    promotionPolicy: context.promotionPolicy,
    retentionPolicy: context.retentionPolicy,
    private: privateScope,
    persistable: getPersistableFlag(context),
    promotable: privateScope ? false : context.promotable,
    authorized: true,
    payload: deepFreeze(clonePayload(input.payload)),
  };
}

module.exports = {
  preparePrivateContextAdapter,
};

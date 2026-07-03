'use strict';

const SCOPES = Object.freeze({
  PRIVATE_USER: 'private:user',
  PRIVATE_CLIENT: 'private:client',
  PRIVATE_PROJECT: 'private:project',
  PLATFORM_KNOWLEDGE: 'platform:knowledge',
  PLATFORM_CAPABILITY: 'platform:capability',
  RUNTIME_TEMPORARY: 'runtime:temporary',
});

const SENSITIVITIES = Object.freeze({
  NORMAL: 'normal',
  INTERNAL: 'internal',
  CONFIDENTIAL: 'confidential',
  CRITICAL: 'critical',
});

const PROMOTION_POLICIES = Object.freeze({
  NEVER_PROMOTE: 'NEVER_PROMOTE',
  GOVERNED_BY_KNOWLEDGE_RULES: 'GOVERNED_BY_KNOWLEDGE_RULES',
  REUSABLE_CAPABILITY: 'REUSABLE_CAPABILITY',
  TEMPORARY_ONLY: 'TEMPORARY_ONLY',
});

const RETENTION_POLICIES = Object.freeze({
  CLIENT_CONTROLLED: 'CLIENT_CONTROLLED',
  GOVERNED: 'GOVERNED',
  NO_PERSISTENCE_BY_DEFAULT: 'NO_PERSISTENCE_BY_DEFAULT',
});

const AUTHORIZATION_STATES = Object.freeze({
  GRANTED: 'granted',
  DENIED: 'denied',
  PENDING: 'pending',
  REVOKED: 'revoked',
});

const VALID_SCOPES = new Set(Object.values(SCOPES));
const VALID_SENSITIVITIES = new Set(Object.values(SENSITIVITIES));
const VALID_PROMOTION_POLICIES = new Set(Object.values(PROMOTION_POLICIES));
const VALID_RETENTION_POLICIES = new Set(Object.values(RETENTION_POLICIES));
const VALID_AUTHORIZATION_STATES = new Set(Object.values(AUTHORIZATION_STATES));

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeOptionalText(value) {
  return typeof value === 'undefined' || value === null ? '' : normalizeText(value);
}

function isValidRequiredString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function getStringFieldErrorCode(fieldName) {
  return `invalid_${fieldName.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)}`;
}

function getMissingFieldErrorCode(fieldName) {
  return `missing_${fieldName.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)}`;
}

function validateRequiredStringField(input, fieldName, errors) {
  if (typeof input[fieldName] !== 'string') {
    errors.push(buildValidationError(
      getStringFieldErrorCode(fieldName),
      `${fieldName} must be a non-empty string.`,
    ));
    return;
  }

  if (!input[fieldName].trim()) {
    errors.push(buildValidationError(
      getMissingFieldErrorCode(fieldName),
      `${fieldName} is required.`,
    ));
  }
}

function isPrivateScope(scope) {
  return [
    SCOPES.PRIVATE_USER,
    SCOPES.PRIVATE_CLIENT,
    SCOPES.PRIVATE_PROJECT,
  ].includes(scope);
}

function getDefaultPromotionPolicy(scope) {
  if (isPrivateScope(scope)) {
    return PROMOTION_POLICIES.NEVER_PROMOTE;
  }

  if (scope === SCOPES.PLATFORM_KNOWLEDGE) {
    return PROMOTION_POLICIES.GOVERNED_BY_KNOWLEDGE_RULES;
  }

  if (scope === SCOPES.PLATFORM_CAPABILITY) {
    return PROMOTION_POLICIES.REUSABLE_CAPABILITY;
  }

  if (scope === SCOPES.RUNTIME_TEMPORARY) {
    return PROMOTION_POLICIES.TEMPORARY_ONLY;
  }

  return PROMOTION_POLICIES.NEVER_PROMOTE;
}

function getDefaultRetentionPolicy(scope) {
  if (scope === SCOPES.RUNTIME_TEMPORARY) {
    return RETENTION_POLICIES.NO_PERSISTENCE_BY_DEFAULT;
  }

  if (scope === SCOPES.PLATFORM_KNOWLEDGE || scope === SCOPES.PLATFORM_CAPABILITY) {
    return RETENTION_POLICIES.GOVERNED;
  }

  return RETENTION_POLICIES.CLIENT_CONTROLLED;
}

function normalizeAuthorization(authorization) {
  if (typeof authorization === 'string') {
    return {
      status: authorization,
    };
  }

  if (authorization && typeof authorization === 'object') {
    return {
      ...authorization,
      status: authorization.status || authorization.state,
    };
  }

  return null;
}

function normalizePrivateContext(context) {
  const input = context || {};
  const scope = normalizeOptionalText(input.scope);
  const authorization = normalizeAuthorization(input.authorization);
  const rawPromotionPolicy = normalizeOptionalText(input.promotionPolicy);
  const promotionPolicy = isPrivateScope(scope)
    ? PROMOTION_POLICIES.NEVER_PROMOTE
    : (rawPromotionPolicy || getDefaultPromotionPolicy(scope));

  return {
    clientId: normalizeText(input.clientId),
    userId: normalizeText(input.userId),
    scope,
    sensitivity: normalizeOptionalText(input.sensitivity) || SENSITIVITIES.CONFIDENTIAL,
    sourceType: normalizeText(input.sourceType),
    sourceId: normalizeText(input.sourceId),
    authorization,
    purpose: normalizeText(input.purpose),
    retentionPolicy: normalizeOptionalText(input.retentionPolicy) || getDefaultRetentionPolicy(scope),
    promotionPolicy,
    originalPromotionPolicy: rawPromotionPolicy || null,
    metadata: input.metadata && typeof input.metadata === 'object'
      ? { ...input.metadata }
      : {},
  };
}

function buildValidationError(code, message) {
  return {
    code,
    message,
  };
}

function validatePrivateContext(context) {
  const input = context || {};
  const normalized = normalizePrivateContext(context);
  const errors = [];

  validateRequiredStringField(input, 'clientId', errors);
  validateRequiredStringField(input, 'userId', errors);

  if (!VALID_SCOPES.has(normalized.scope)) {
    errors.push(buildValidationError('invalid_scope', 'scope is invalid or missing.'));
  }

  if (!VALID_SENSITIVITIES.has(normalized.sensitivity)) {
    errors.push(buildValidationError('invalid_sensitivity', 'sensitivity is invalid.'));
  }

  validateRequiredStringField(input, 'sourceType', errors);
  validateRequiredStringField(input, 'sourceId', errors);

  if (!normalized.authorization) {
    errors.push(buildValidationError('missing_authorization', 'authorization is required.'));
  } else if (!VALID_AUTHORIZATION_STATES.has(normalized.authorization.status)) {
    errors.push(buildValidationError('invalid_authorization', 'authorization status is invalid.'));
  } else if (normalized.authorization.status !== AUTHORIZATION_STATES.GRANTED) {
    errors.push(buildValidationError('authorization_not_granted', 'authorization must be granted.'));
  }

  validateRequiredStringField(input, 'purpose', errors);

  if (!VALID_RETENTION_POLICIES.has(normalized.retentionPolicy)) {
    errors.push(buildValidationError('invalid_retention_policy', 'retentionPolicy is invalid.'));
  }

  if (!VALID_PROMOTION_POLICIES.has(normalized.promotionPolicy)) {
    errors.push(buildValidationError('invalid_promotion_policy', 'promotionPolicy is invalid.'));
  }

  if (
    normalized.scope === SCOPES.RUNTIME_TEMPORARY
    && normalized.retentionPolicy !== RETENTION_POLICIES.NO_PERSISTENCE_BY_DEFAULT
  ) {
    errors.push(buildValidationError('runtime_persistence_not_allowed', 'runtime:temporary is not persistent by default.'));
  }

  return {
    ok: errors.length === 0,
    context: normalized,
    errors,
  };
}

function assertValidPrivateContext(context) {
  const result = validatePrivateContext(context);

  if (!result.ok) {
    const error = new Error(result.errors.map((item) => item.message).join(' '));
    error.code = 'invalid_private_context';
    error.errors = result.errors;
    throw error;
  }

  return result.context;
}

function checkScope(context, allowedScopes) {
  const normalized = assertValidPrivateContext(context);
  const allowed = Array.isArray(allowedScopes) ? allowedScopes : [allowedScopes];
  const isAllowed = allowed.includes(normalized.scope);

  return {
    ok: isAllowed,
    scope: normalized.scope,
    allowedScopes: allowed,
    reason: isAllowed ? null : 'scope_not_allowed',
  };
}

function checkAuthorization(context, requiredPurpose) {
  const normalized = assertValidPrivateContext(context);
  const purposeMatches = !requiredPurpose || normalized.purpose === requiredPurpose;

  return {
    ok: normalized.authorization.status === AUTHORIZATION_STATES.GRANTED && purposeMatches,
    authorization: normalized.authorization,
    purpose: normalized.purpose,
    requiredPurpose: requiredPurpose || null,
    reason: purposeMatches ? null : 'purpose_not_authorized',
  };
}

function canPromoteContext(context) {
  const normalized = assertValidPrivateContext(context);

  if (isPrivateScope(normalized.scope)) {
    return {
      ok: false,
      promotionPolicy: normalized.promotionPolicy,
      reason: 'private_scope_never_promote',
    };
  }

  if (normalized.scope === SCOPES.RUNTIME_TEMPORARY) {
    return {
      ok: false,
      promotionPolicy: normalized.promotionPolicy,
      reason: 'runtime_temporary_not_persistent',
    };
  }

  return {
    ok: normalized.promotionPolicy !== PROMOTION_POLICIES.NEVER_PROMOTE,
    promotionPolicy: normalized.promotionPolicy,
    reason: null,
  };
}

function assertCompatibleClient(context, expectedClientId) {
  const normalized = assertValidPrivateContext(context);

  if (!isValidRequiredString(expectedClientId)) {
    throw Object.assign(new Error('expectedClientId is required.'), {
      code: 'missing_expected_client_id',
    });
  }

  const expected = expectedClientId.trim();

  if (normalized.clientId !== expected) {
    throw Object.assign(new Error('Context clientId does not match the authorized clientId.'), {
      code: 'client_scope_mismatch',
      contextClientId: normalized.clientId,
      expectedClientId: expected,
    });
  }

  return {
    ok: true,
    clientId: normalized.clientId,
  };
}

function prepareAuthorizedContext(context, options = {}) {
  const normalized = assertValidPrivateContext(context);

  if (isPrivateScope(normalized.scope) && !isValidRequiredString(options.expectedClientId)) {
    throw Object.assign(new Error('expectedClientId is required for private scopes.'), {
      code: 'missing_expected_client_id_for_private_scope',
      scope: normalized.scope,
    });
  }

  if (options.expectedClientId) {
    assertCompatibleClient(normalized, options.expectedClientId);
  }

  if (options.allowedScopes) {
    const scopeResult = checkScope(normalized, options.allowedScopes);

    if (!scopeResult.ok) {
      throw Object.assign(new Error('Context scope is not allowed.'), {
        code: scopeResult.reason,
        scope: scopeResult.scope,
        allowedScopes: scopeResult.allowedScopes,
      });
    }
  }

  if (options.requiredPurpose) {
    const authorizationResult = checkAuthorization(normalized, options.requiredPurpose);

    if (!authorizationResult.ok) {
      throw Object.assign(new Error('Context purpose is not authorized.'), {
        code: authorizationResult.reason,
        purpose: authorizationResult.purpose,
        requiredPurpose: authorizationResult.requiredPurpose,
      });
    }
  }

  return {
    ...normalized,
    authorized: true,
    promotable: canPromoteContext(normalized).ok,
  };
}

module.exports = {
  SCOPES,
  SENSITIVITIES,
  PROMOTION_POLICIES,
  RETENTION_POLICIES,
  AUTHORIZATION_STATES,
  normalizePrivateContext,
  validatePrivateContext,
  assertValidPrivateContext,
  checkScope,
  checkAuthorization,
  canPromoteContext,
  assertCompatibleClient,
  prepareAuthorizedContext,
};

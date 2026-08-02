'use strict';

const IDENTIFIER_PATTERN = /^[A-Za-z0-9:_-]{3,128}$/;

const MEMBERSHIP_STATUSES = Object.freeze([
  'ACTIVE',
  'SUSPENDED',
  'REVOKED',
]);

const MEMBERSHIP_ROLES = Object.freeze([
  'owner',
  'admin',
  'operator',
  'reviewer',
  'viewer',
]);

const STATUS_SET = new Set(MEMBERSHIP_STATUSES);
const ROLE_SET = new Set(MEMBERSHIP_ROLES);

class MembershipResolutionError extends Error {
  constructor(code, message = 'Membership resolution failed.') {
    super(message);
    this.name = 'MembershipResolutionError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new MembershipResolutionError(code, message);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateIdentifier(value) {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) {
    fail('membership_data_invalid');
  }
  return value;
}

function validateAuthenticatedUserId(value) {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) {
    fail('membership_identity_invalid', 'Authenticated identity is unavailable.');
  }
  return value;
}

function validateRoles(roles) {
  if (!Array.isArray(roles) || roles.length === 0) {
    fail('membership_data_invalid');
  }
  if (roles.some((role) => typeof role !== 'string' || !ROLE_SET.has(role))) {
    fail('membership_data_invalid');
  }
  if (new Set(roles).size !== roles.length) {
    fail('membership_data_invalid');
  }
  return Object.freeze([...roles]);
}

function validateMembership(candidate, authenticatedUserId) {
  if (!isPlainObject(candidate)) fail('membership_data_invalid');
  const membership = {
    tenantId: validateIdentifier(candidate.tenantId),
    clientId: validateIdentifier(candidate.clientId),
    userId: validateIdentifier(candidate.userId),
    roles: validateRoles(candidate.roles),
    status: candidate.status,
  };
  if (!STATUS_SET.has(membership.status) || membership.userId !== authenticatedUserId) {
    fail('membership_data_invalid');
  }
  return Object.freeze(membership);
}

function buildMissionScope(membership) {
  return Object.freeze({
    tenantId: membership.tenantId,
    userId: membership.userId,
    clientId: membership.clientId,
    roles: Object.freeze([...membership.roles]),
  });
}

function createMembershipResolver({ provider } = {}) {
  if (!provider || typeof provider.findMemberships !== 'function') {
    fail('membership_provider_invalid', 'Membership provider is unavailable.');
  }

  async function resolveMembership(input = {}) {
    if (!isPlainObject(input)
      || Object.keys(input).some((key) => key !== 'authenticatedUserId')) {
      fail('membership_request_invalid', 'Membership request is invalid.');
    }
    const authenticatedUserId = validateAuthenticatedUserId(input.authenticatedUserId);
    let candidates;
    try {
      candidates = await provider.findMemberships({ authenticatedUserId });
    } catch (error) {
      fail('membership_provider_unavailable', 'Membership provider is unavailable.');
    }
    if (!Array.isArray(candidates)) fail('membership_data_invalid');

    const memberships = candidates.map((candidate) => (
      validateMembership(candidate, authenticatedUserId)
    ));
    const active = memberships.filter((membership) => membership.status === 'ACTIVE');
    if (active.length === 0) {
      fail('membership_not_available', 'Membership is unavailable.');
    }
    if (active.length !== 1) {
      fail('membership_ambiguous', 'Membership cannot be resolved unambiguously.');
    }
    return buildMissionScope(active[0]);
  }

  return Object.freeze({ resolveMembership });
}

function createClientZeroBootstrapProvider(configuration = {}) {
  if (!isPlainObject(configuration)) {
    fail('bootstrap_configuration_invalid', 'Bootstrap configuration is invalid.');
  }
  const enabled = configuration.enabled === true;
  if (!enabled) {
    return Object.freeze({
      kind: 'CLIENT_ZERO_BOOTSTRAP',
      findMemberships: async () => [],
    });
  }

  let configuredUserId;
  let membership;
  try {
    configuredUserId = validateAuthenticatedUserId(configuration.authenticatedUserId);
    membership = validateMembership(configuration.membership, configuredUserId);
  } catch (error) {
    fail('bootstrap_configuration_invalid', 'Bootstrap configuration is invalid.');
  }

  return Object.freeze({
    kind: 'CLIENT_ZERO_BOOTSTRAP',
    findMemberships: async ({ authenticatedUserId } = {}) => (
      authenticatedUserId === configuredUserId ? [membership] : []
    ),
  });
}

module.exports = {
  MEMBERSHIP_ROLES,
  MEMBERSHIP_STATUSES,
  MembershipResolutionError,
  createClientZeroBootstrapProvider,
  createMembershipResolver,
};

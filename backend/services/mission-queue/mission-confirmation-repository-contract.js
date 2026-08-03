'use strict';

const { isDeepStrictEqual } = require('node:util');

const { validateMissionConfirmation } = require('./mission-confirmation-contract');

const IDENTIFIER_PATTERN = /^[A-Za-z0-9:_-]{3,128}$/;

const CONFIRMATION_REPOSITORY_METHODS = Object.freeze([
  'create',
  'get',
  'saveIfVersion',
  'acquireConsumeLease',
  'releaseConsumeLease',
  'consumeIfLeased',
]);

const FORBIDDEN_CONFIRMATION_REPOSITORY_METHODS = Object.freeze([
  'delete',
  'hardDelete',
  'globalList',
  'listAll',
  'findAcrossTenants',
  'bypassScope',
  'getByMissionId',
]);

const IMMUTABLE_CONFIRMATION_FIELDS = Object.freeze([
  'confirmationId',
  'tenantId',
  'userId',
  'clientId',
  'missionId',
  'idempotencyKey',
  'planSnapshot',
  'planSchemaVersion',
  'createdAt',
  'expiresAt',
]);

class ConfirmationRepositoryError extends Error {
  constructor(code, message = 'ConfirmationRepository operation failed.') {
    super(message);
    this.name = 'ConfirmationRepositoryError';
    this.code = code;
  }
}

function repositoryFail(code, message) {
  throw new ConfirmationRepositoryError(code, message);
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  if (!isObject(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length
    && actual.every((key) => keys.includes(key))
    && keys.every((key) => Object.hasOwn(value, key));
}

function normalizeIdentifier(value, code) {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) {
    repositoryFail(code, 'An opaque portable identifier is required.');
  }
  return value;
}

function normalizeTimestamp(value, code = 'confirmation_lease_invalid') {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    repositoryFail(code, 'A valid canonical timestamp is required.');
  }
  const normalized = new Date(value).toISOString();
  if (normalized !== value) {
    repositoryFail(code, 'A valid canonical timestamp is required.');
  }
  return normalized;
}

function assertConfirmationRepository(repository) {
  if (!isObject(repository)) {
    repositoryFail('invalid_confirmation_repository', 'ConfirmationRepository is required.');
  }
  CONFIRMATION_REPOSITORY_METHODS.forEach((method) => {
    if (typeof repository[method] !== 'function') {
      repositoryFail('invalid_confirmation_repository', 'ConfirmationRepository is incomplete.');
    }
  });
  FORBIDDEN_CONFIRMATION_REPOSITORY_METHODS.forEach((method) => {
    if (typeof repository[method] === 'function') {
      repositoryFail('unsafe_confirmation_repository', 'ConfirmationRepository is unsafe.');
    }
  });
  return repository;
}

function normalizeConfirmationScope(scope) {
  if (!hasExactKeys(scope, ['tenantId', 'userId', 'clientId'])) {
    repositoryFail('confirmation_scope_invalid', 'A complete scoped identity is required.');
  }
  return Object.freeze({
    tenantId: normalizeIdentifier(scope.tenantId, 'confirmation_scope_invalid'),
    userId: normalizeIdentifier(scope.userId, 'confirmation_scope_invalid'),
    clientId: normalizeIdentifier(scope.clientId, 'confirmation_scope_invalid'),
  });
}

function normalizeConfirmationId(value) {
  return normalizeIdentifier(value, 'confirmation_id_invalid');
}

function normalizeLeaseId(value) {
  return normalizeIdentifier(value, 'confirmation_lease_invalid');
}

function normalizeExpectedVersion(value) {
  if (!Number.isInteger(value) || value < 1) {
    repositoryFail('confirmation_version_invalid', 'expectedVersion must be positive.');
  }
  return value;
}

function normalizeOperationTime(value) {
  return normalizeTimestamp(value, 'confirmation_time_invalid');
}

function normalizeConsumeLease(lease) {
  if (!hasExactKeys(lease, ['leaseId', 'acquiredAt', 'expiresAt'])) {
    repositoryFail('confirmation_lease_invalid', 'Consume lease is invalid.');
  }
  const normalized = Object.freeze({
    leaseId: normalizeLeaseId(lease.leaseId),
    acquiredAt: normalizeTimestamp(lease.acquiredAt),
    expiresAt: normalizeTimestamp(lease.expiresAt),
  });
  if (Date.parse(normalized.expiresAt) <= Date.parse(normalized.acquiredAt)) {
    repositoryFail('confirmation_lease_invalid', 'Consume lease expiration is invalid.');
  }
  return normalized;
}

function assertConfirmationScope(confirmation, scope) {
  validateMissionConfirmation(confirmation);
  const normalized = normalizeConfirmationScope(scope);
  if (confirmation.tenantId !== normalized.tenantId
    || confirmation.userId !== normalized.userId
    || confirmation.clientId !== normalized.clientId) {
    repositoryFail('confirmation_scope_mismatch', 'Confirmation does not match scope.');
  }
  return normalized;
}

function assertConfirmationUpdate(previous, next) {
  validateMissionConfirmation(previous);
  validateMissionConfirmation(next);
  for (const field of IMMUTABLE_CONFIRMATION_FIELDS) {
    const same = field === 'planSnapshot'
      ? isDeepStrictEqual(previous[field], next[field])
      : previous[field] === next[field];
    if (!same) {
      repositoryFail('confirmation_update_invalid', 'Immutable Confirmation data changed.');
    }
  }
  if (next.version <= previous.version) {
    repositoryFail('confirmation_update_invalid', 'Confirmation version must advance.');
  }
  return next;
}

module.exports = {
  CONFIRMATION_REPOSITORY_METHODS,
  FORBIDDEN_CONFIRMATION_REPOSITORY_METHODS,
  ConfirmationRepositoryError,
  assertConfirmationRepository,
  assertConfirmationScope,
  assertConfirmationUpdate,
  normalizeConfirmationId,
  normalizeConfirmationScope,
  normalizeConsumeLease,
  normalizeExpectedVersion,
  normalizeLeaseId,
  normalizeOperationTime,
  repositoryFail,
};

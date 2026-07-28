'use strict';

const REQUIRED_METHODS = Object.freeze([
  'initializeScope',
  'createApproval',
  'approveApproval',
  'reserveOperation',
  'startOperation',
  'completeOperation',
  'saveMemory',
  'searchMemory',
  'appendAudit',
  'queryAuditByTenantAndDate',
  'exportTenant',
  'restoreTenant',
  'getMetrics',
]);

const IDENTIFIER_PATTERN = /^[A-Za-z0-9:_-]{3,128}$/;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9:_-]{8,200}$/;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function validateIdentifier(value, fieldName) {
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) {
    throw new Error(`${fieldName} must be a portable identifier.`);
  }
  return value;
}

function validateIdempotencyKey(value) {
  if (typeof value !== 'string' || !IDEMPOTENCY_PATTERN.test(value)) {
    throw new Error('idempotencyKey must be a portable idempotency key.');
  }
  return value;
}

function validateScope(input = {}) {
  return Object.freeze({
    tenantId: validateIdentifier(input.tenantId, 'tenantId'),
    userId: validateIdentifier(input.userId, 'userId'),
  });
}

function assertPocAdapter(adapter) {
  const missing = REQUIRED_METHODS.filter(
    (method) => !adapter || typeof adapter[method] !== 'function',
  );
  if (missing.length > 0) {
    throw new Error(`Persistence POC adapter is missing: ${missing.join(', ')}.`);
  }
  return adapter;
}

module.exports = {
  REQUIRED_METHODS,
  assertPocAdapter,
  clone,
  validateIdentifier,
  validateIdempotencyKey,
  validateScope,
};

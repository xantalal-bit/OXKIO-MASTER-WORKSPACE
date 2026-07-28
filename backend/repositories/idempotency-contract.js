'use strict';

const IDEMPOTENCY_STATES = Object.freeze([
  'reserved',
  'executing',
  'succeeded',
  'failed_retryable',
  'failed_terminal',
  'external_effect_unknown',
]);

const ALLOWED_TRANSITIONS = Object.freeze({
  reserved: Object.freeze(['executing', 'failed_terminal']),
  executing: Object.freeze(['succeeded', 'failed_retryable', 'failed_terminal', 'external_effect_unknown']),
  failed_retryable: Object.freeze(['executing', 'failed_terminal']),
  succeeded: Object.freeze([]),
  failed_terminal: Object.freeze([]),
  external_effect_unknown: Object.freeze([]),
});

function validateIdempotencyKey(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9:_-]{8,200}$/.test(value)) {
    throw new Error('A valid idempotencyKey is required.');
  }
  return value;
}

function canTransition(from, to) {
  return IDEMPOTENCY_STATES.includes(from)
    && IDEMPOTENCY_STATES.includes(to)
    && ALLOWED_TRANSITIONS[from].includes(to);
}

function createIdempotencyRecord({ idempotencyKey, subjectId, operationType }) {
  return Object.freeze({
    idempotencyKey: validateIdempotencyKey(idempotencyKey),
    subjectId: typeof subjectId === 'string' ? subjectId : null,
    operationType: typeof operationType === 'string' ? operationType : null,
    state: 'reserved',
    externalResult: null,
    safeFailure: null,
    retryCount: 0,
  });
}

module.exports = {
  ALLOWED_TRANSITIONS,
  IDEMPOTENCY_STATES,
  canTransition,
  createIdempotencyRecord,
  validateIdempotencyKey,
};

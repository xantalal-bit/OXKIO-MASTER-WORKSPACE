'use strict';

const {
  CONFIRMATION_STATUSES,
  ConfirmationContractError,
  createMissionConfirmation: createDomainConfirmation,
  isMissionConfirmationExpired,
  transitionMissionConfirmation,
  validateMissionConfirmation,
} = require('./mission-confirmation-contract');
const {
  ConfirmationRepositoryError,
  assertConfirmationRepository,
  assertConfirmationScope,
  normalizeConfirmationId,
  normalizeConfirmationScope,
  normalizeConsumeLease,
  normalizeExpectedVersion,
  normalizeLeaseId,
  normalizeOperationTime,
} = require('./mission-confirmation-repository-contract');

const CREATE_KEYS = Object.freeze(['planSnapshot', 'planSchemaVersion', 'expiresAt']);

class ConfirmationServiceError extends Error {
  constructor(code, message = 'ConfirmationService operation failed.') {
    super(message);
    this.name = 'ConfirmationServiceError';
    this.code = code;
  }
}

function serviceFail(code, message) {
  throw new ConfirmationServiceError(code, message);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value, keys) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length
    && actual.every((key) => keys.includes(key))
    && keys.every((key) => Object.hasOwn(value, key));
}

function freezeValue(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freezeValue);
  return Object.freeze(value);
}

function safeCopy(value) {
  return freezeValue(JSON.parse(JSON.stringify(value)));
}

function normalizeOptions(options, keys) {
  if (!hasExactKeys(options, keys)) {
    serviceFail('confirmation_service_input_invalid', 'ConfirmationService input is invalid.');
  }
  return options;
}

function normalizeCreateInput(input) {
  if (!hasExactKeys(input, CREATE_KEYS)) {
    serviceFail('confirmation_service_input_invalid', 'Confirmation creation input is invalid.');
  }
  return input;
}

function assertExpectedVersion(confirmation, rawExpectedVersion) {
  const expectedVersion = normalizeExpectedVersion(rawExpectedVersion);
  if (confirmation.version !== expectedVersion) {
    serviceFail('confirmation_version_conflict', 'Confirmation version conflict.');
  }
  return expectedVersion;
}

function validateScopedConfirmation(confirmation, scope) {
  validateMissionConfirmation(confirmation);
  try {
    assertConfirmationScope(confirmation, scope);
  } catch (error) {
    if (error && error.code === 'confirmation_scope_mismatch') {
      serviceFail('confirmation_not_found', 'Confirmation was not found.');
    }
    throw error;
  }
  return confirmation;
}

function validateCreateResult(result, scope) {
  if (!hasExactKeys(result, ['confirmation', 'created'])
    || typeof result.created !== 'boolean') {
    serviceFail('confirmation_repository_result_invalid', 'Repository result is invalid.');
  }
  validateScopedConfirmation(result.confirmation, scope);
  return safeCopy({ confirmation: result.confirmation, created: result.created });
}

function validateReleaseResult(result) {
  if (!hasExactKeys(result, ['released']) || result.released !== true) {
    serviceFail('confirmation_repository_result_invalid', 'Repository result is invalid.');
  }
  return Object.freeze({ released: true });
}

class ConfirmationService {
  #repository;

  #clock;

  #confirmationIdFactory;

  #missionIdFactory;

  #leaseIdFactory;

  constructor({
    repository,
    clock,
    confirmationIdFactory,
    missionIdFactory,
    leaseIdFactory,
  } = {}) {
    if (typeof clock !== 'function'
      || typeof confirmationIdFactory !== 'function'
      || typeof missionIdFactory !== 'function'
      || typeof leaseIdFactory !== 'function') {
      serviceFail('confirmation_service_dependencies_invalid', 'Service dependencies are invalid.');
    }
    this.#repository = assertConfirmationRepository(repository);
    this.#clock = clock;
    this.#confirmationIdFactory = confirmationIdFactory;
    this.#missionIdFactory = missionIdFactory;
    this.#leaseIdFactory = leaseIdFactory;
    Object.freeze(this);
  }

  #now() {
    return normalizeOperationTime(this.#clock());
  }

  async #callRepository(operation) {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof ConfirmationRepositoryError
        || error instanceof ConfirmationContractError
        || error instanceof ConfirmationServiceError) {
        throw error;
      }
      serviceFail('confirmation_repository_unavailable', 'ConfirmationRepository is unavailable.');
    }
  }

  async createConfirmation(scope, rawInput) {
    const normalizedScope = normalizeConfirmationScope(scope);
    const input = normalizeCreateInput(rawInput);
    const now = this.#now();
    const confirmationId = this.#confirmationIdFactory();
    const confirmation = createDomainConfirmation({
      confirmationId,
      tenantId: normalizedScope.tenantId,
      userId: normalizedScope.userId,
      clientId: normalizedScope.clientId,
      missionId: this.#missionIdFactory(),
      idempotencyKey: `mission-confirmation:v1:${confirmationId}`,
      planSnapshot: input.planSnapshot,
      planSchemaVersion: input.planSchemaVersion,
      expiresAt: input.expiresAt,
    }, { now });
    const result = await this.#callRepository(
      () => this.#repository.create(normalizedScope, confirmation),
    );
    return validateCreateResult(result, normalizedScope);
  }

  async getConfirmation(scope, confirmationId) {
    const normalizedScope = normalizeConfirmationScope(scope);
    const normalizedId = normalizeConfirmationId(confirmationId);
    const confirmation = await this.#callRepository(
      () => this.#repository.get(normalizedScope, normalizedId),
    );
    return safeCopy(validateScopedConfirmation(confirmation, normalizedScope));
  }

  async confirmConfirmation(scope, confirmationId, rawOptions) {
    const options = normalizeOptions(rawOptions, ['expectedVersion']);
    const normalizedScope = normalizeConfirmationScope(scope);
    const stored = await this.getConfirmation(normalizedScope, confirmationId);
    const expectedVersion = assertExpectedVersion(stored, options.expectedVersion);
    const now = this.#now();
    const confirmed = transitionMissionConfirmation(
      stored,
      CONFIRMATION_STATUSES.CONFIRMED,
      { now },
    );
    const saved = await this.#callRepository(
      () => this.#repository.saveIfVersion(
        normalizedScope, confirmed, expectedVersion, now,
      ),
    );
    return safeCopy(validateScopedConfirmation(saved, normalizedScope));
  }

  async acquireConsumption(scope, confirmationId, rawOptions) {
    const options = normalizeOptions(rawOptions, ['expectedVersion', 'leaseExpiresAt']);
    const normalizedScope = normalizeConfirmationScope(scope);
    const stored = await this.getConfirmation(normalizedScope, confirmationId);
    const expectedVersion = assertExpectedVersion(stored, options.expectedVersion);
    const now = this.#now();
    if (stored.status !== CONFIRMATION_STATUSES.CONFIRMED) {
      if ([CONFIRMATION_STATUSES.CONSUMED, CONFIRMATION_STATUSES.REVOKED]
        .includes(stored.status)) {
        serviceFail('confirmation_terminal', 'Terminal Confirmation cannot be consumed.');
      }
      serviceFail('confirmation_transition_invalid', 'Confirmation is not ready for consumption.');
    }
    if (isMissionConfirmationExpired(stored, now)) {
      serviceFail('confirmation_expired', 'Mission Confirmation has expired.');
    }
    const lease = normalizeConsumeLease({
      leaseId: this.#leaseIdFactory(),
      acquiredAt: now,
      expiresAt: options.leaseExpiresAt,
    });
    if (Date.parse(lease.expiresAt) > Date.parse(stored.expiresAt)) {
      serviceFail('confirmation_lease_invalid', 'Consume lease exceeds Confirmation lifetime.');
    }
    const acquired = await this.#callRepository(
      () => this.#repository.acquireConsumeLease(
        normalizedScope, stored.confirmationId, expectedVersion, lease,
      ),
    );
    return safeCopy(normalizeConsumeLease(acquired));
  }

  async markConsumed(scope, confirmationId, rawOptions) {
    const options = normalizeOptions(rawOptions, ['expectedVersion', 'leaseId']);
    const normalizedScope = normalizeConfirmationScope(scope);
    const stored = await this.getConfirmation(normalizedScope, confirmationId);
    const expectedVersion = assertExpectedVersion(stored, options.expectedVersion);
    const leaseId = normalizeLeaseId(options.leaseId);
    const consumed = transitionMissionConfirmation(
      stored,
      CONFIRMATION_STATUSES.CONSUMED,
      { now: this.#now() },
    );
    const saved = await this.#callRepository(
      () => this.#repository.consumeIfLeased(
        normalizedScope, consumed, expectedVersion, leaseId,
      ),
    );
    return safeCopy(validateScopedConfirmation(saved, normalizedScope));
  }

  async revokeConfirmation(scope, confirmationId, rawOptions) {
    const options = normalizeOptions(rawOptions, ['expectedVersion']);
    const normalizedScope = normalizeConfirmationScope(scope);
    const stored = await this.getConfirmation(normalizedScope, confirmationId);
    const expectedVersion = assertExpectedVersion(stored, options.expectedVersion);
    const now = this.#now();
    const revoked = transitionMissionConfirmation(
      stored,
      CONFIRMATION_STATUSES.REVOKED,
      { now },
    );
    const saved = await this.#callRepository(
      () => this.#repository.saveIfVersion(
        normalizedScope, revoked, expectedVersion, now,
      ),
    );
    return safeCopy(validateScopedConfirmation(saved, normalizedScope));
  }

  async releaseConsumption(scope, confirmationId, rawOptions) {
    const options = normalizeOptions(rawOptions, ['leaseId']);
    const normalizedScope = normalizeConfirmationScope(scope);
    const normalizedId = normalizeConfirmationId(confirmationId);
    const leaseId = normalizeLeaseId(options.leaseId);
    const result = await this.#callRepository(
      () => this.#repository.releaseConsumeLease(normalizedScope, normalizedId, leaseId),
    );
    return validateReleaseResult(result);
  }
}

module.exports = {
  ConfirmationService,
  ConfirmationServiceError,
};

'use strict';

const ACCEPTED_ACTION_TYPES = Object.freeze([
  'propose_email',
  'propose_meeting',
  'create_task_proposal',
]);

function buildResult(overrides = {}) {
  return {
    success: false,
    provider: null,
    mode: 'NOT_CONNECTED',
    externalId: null,
    secondaryExternalId: null,
    metadata: {},
    ...overrides,
  };
}

function validateRequiredString(input, field) {
  return input && typeof input[field] === 'string' && input[field].trim()
    ? null
    : field;
}

function validateExecutionContract(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {
      valid: false,
      code: 'invalid_execution_contract',
      message: 'Execution contract must be an object.',
    };
  }

  const missingField = [
    'approvalId',
    'interactionId',
    'executionId',
    'actionType',
  ].map((field) => validateRequiredString(input, field)).find(Boolean);

  if (missingField) {
    return {
      valid: false,
      code: 'invalid_execution_contract',
      message: `${missingField} is required.`,
    };
  }

  if (
    !input.executionPayload
    || typeof input.executionPayload !== 'object'
    || Array.isArray(input.executionPayload)
  ) {
    return {
      valid: false,
      code: 'invalid_execution_contract',
      message: 'executionPayload is required.',
    };
  }

  if (!ACCEPTED_ACTION_TYPES.includes(input.actionType)) {
    return {
      valid: false,
      code: 'unknown_action_type',
      message: 'No execution provider is registered for this actionType.',
    };
  }

  return { valid: true };
}

function normalizeProviderResult(result, actionType) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return buildResult({
      code: 'provider_execution_failed',
      retryable: true,
      message: 'Execution provider returned an invalid result.',
      metadata: { actionType },
    });
  }

  const normalized = {
    success: result.success === true,
    provider: typeof result.provider === 'string' ? result.provider : null,
    mode: typeof result.mode === 'string' ? result.mode : 'NOT_CONNECTED',
    externalId: typeof result.externalId === 'string' ? result.externalId : null,
    secondaryExternalId: typeof result.secondaryExternalId === 'string'
      ? result.secondaryExternalId
      : null,
    metadata: { actionType },
  };

  if (!normalized.success) {
    normalized.code = typeof result.code === 'string' && /^[a-z0-9_]{1,64}$/.test(result.code)
      ? result.code
      : 'provider_execution_failed';
    normalized.retryable = result.retryable === true;
    normalized.message = 'Execution provider did not complete the action.';
  }

  return normalized;
}

class ExecutionAdapter {
  constructor({ emailProvider } = {}) {
    this.emailProvider = emailProvider;
  }

  async execute(input) {
    const validation = validateExecutionContract(input);

    if (!validation.valid) {
      return buildResult({
        code: validation.code,
        message: validation.message,
      });
    }

    if (
      input.actionType === 'propose_email'
      && this.emailProvider
      && typeof this.emailProvider.execute === 'function'
    ) {
      try {
        const result = await this.emailProvider.execute(input);
        return normalizeProviderResult(result, input.actionType);
      } catch (error) {
        return buildResult({
          code: 'provider_execution_failed',
          retryable: true,
          message: 'Execution provider failed safely.',
          metadata: { actionType: input.actionType },
        });
      }
    }

    return buildResult({
      code: 'execution_not_connected',
      message: 'No execution provider is connected.',
      metadata: {
        actionType: input.actionType,
        connected: false,
      },
    });
  }
}

module.exports = {
  ACCEPTED_ACTION_TYPES,
  ExecutionAdapter,
  normalizeProviderResult,
  validateExecutionContract,
};

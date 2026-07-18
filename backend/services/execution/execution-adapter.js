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

class ExecutionAdapter {
  execute(input) {
    const validation = validateExecutionContract(input);

    if (!validation.valid) {
      return buildResult({
        code: validation.code,
        message: validation.message,
      });
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
  validateExecutionContract,
};

'use strict';

function safeCode(value, fallback) {
  return typeof value === 'string' && /^[a-z0-9_]{1,64}$/.test(value)
    ? value
    : fallback;
}

class ExecutionService {
  constructor({ approvalQueue, executionAdapter } = {}) {
    this.approvalQueue = approvalQueue;
    this.executionAdapter = executionAdapter;
  }

  async executeApproved(approvalId) {
    if (typeof approvalId !== 'string' || !approvalId.trim()) {
      return {
        ok: false,
        status: 'execution_rejected',
        error: {
          code: 'invalid_approval_id',
          message: 'A valid approvalId is required.',
        },
      };
    }

    const storedApproval = this.approvalQueue
      && typeof this.approvalQueue.getInternalById === 'function'
      ? this.approvalQueue.getInternalById(approvalId)
      : null;
    const beginResult = storedApproval && storedApproval.status === 'execution_failed'
      ? this.approvalQueue.retryExecution(approvalId)
      : this.approvalQueue.beginExecution(approvalId);
    if (!beginResult || beginResult.ok !== true) {
      return {
        ok: false,
        approvalId,
        status: 'execution_rejected',
        error: {
          code: safeCode(beginResult && beginResult.code, 'execution_rejected'),
          message: beginResult && typeof beginResult.message === 'string'
            ? beginResult.message
            : 'Execution request was rejected.',
        },
      };
    }

    const contract = {
      approvalId: beginResult.approvalId,
      interactionId: beginResult.interactionId,
      executionId: beginResult.executionId,
      actionType: beginResult.actionType,
      executionPayload: beginResult.executionPayload,
    };

    let result;
    try {
      result = await this.executionAdapter.execute(contract);
    } catch (error) {
      const safeError = {
        code: 'execution_provider_error',
        retryable: false,
      };
      this.approvalQueue.failExecution(approvalId, {
        executionId: beginResult.executionId,
        error: safeError,
      });
      return this.buildFailure(beginResult, safeError);
    }

    if (!result || result.success !== true) {
      const safeError = {
        code: safeCode(result && result.code, 'execution_failed'),
        retryable: Boolean(result && result.retryable),
      };
      this.approvalQueue.failExecution(approvalId, {
        executionId: beginResult.executionId,
        error: safeError,
      });
      return this.buildFailure(beginResult, safeError);
    }

    const type = beginResult.actionType === 'propose_email'
      ? 'email_draft'
      : beginResult.actionType;
    const completion = this.approvalQueue.completeExecution(approvalId, {
      executionId: beginResult.executionId,
      result: {
        type,
        mode: result.mode,
        externalId: result.externalId,
        secondaryExternalId: result.secondaryExternalId,
      },
    });
    if (!completion || completion.ok !== true || completion.status !== 'executed') {
      return {
        ok: false,
        approvalId: beginResult.approvalId,
        interactionId: beginResult.interactionId,
        executionId: beginResult.executionId,
        status: 'execution_state_unsynchronized',
        error: {
          code: safeCode(completion && completion.code, 'execution_state_unsynchronized'),
          retryable: false,
        },
      };
    }

    return {
      ok: true,
      approvalId: beginResult.approvalId,
      interactionId: beginResult.interactionId,
      executionId: beginResult.executionId,
      status: completion.status,
      result: {
        type: 'email_draft',
        provider: 'gmail',
        mode: 'SAFE_DRAFT_ONLY',
        externalId: completion.result.externalId,
        secondaryExternalId: completion.result.secondaryExternalId,
      },
    };
  }

  buildFailure(beginResult, error) {
    return {
      ok: false,
      approvalId: beginResult.approvalId,
      interactionId: beginResult.interactionId,
      executionId: beginResult.executionId,
      status: 'execution_failed',
      error: {
        code: error.code,
        retryable: error.retryable,
      },
    };
  }
}

module.exports = { ExecutionService };

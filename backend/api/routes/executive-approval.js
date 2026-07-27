'use strict';

const { getClienteCeroIdentity } = require('../../services/private-context/client-identity-resolver');

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(JSON.stringify(payload, null, 2));
}

function isJsonRequest(req) {
  const contentType = String(req.headers && req.headers['content-type'] || '');
  return contentType.split(';', 1)[0].trim().toLowerCase() === 'application/json';
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new Error('invalid_json'));
      }
    });
    req.on('error', reject);
  });
}

function getApprovalId(body) {
  return body && typeof body.approvalId === 'string' && body.approvalId.trim()
    ? body.approvalId.trim()
    : null;
}

function statusForQueueError(result) {
  if (result && result.code === 'approval_not_found') return 404;
  return 409;
}

function statusForExecutionResult(result) {
  if (result && result.ok === true) return 200;
  if (result && result.status === 'execution_failed') {
    return result.error && result.error.retryable === true ? 503 : 502;
  }

  const code = result && result.error && result.error.code;
  if (code === 'approval_not_found') return 404;
  if (code === 'invalid_approval_id') return 400;
  return 409;
}

function sendMethodNotAllowed(res) {
  return sendJson(res, 405, {
    ok: false,
    code: 'method_not_allowed',
    message: 'Use POST with a JSON approvalId.',
  }, { Allow: 'POST' });
}

function validatePostJson(req, res) {
  if (req.method !== 'POST') {
    sendMethodNotAllowed(res);
    return false;
  }

  if (!isJsonRequest(req)) {
    sendJson(res, 400, {
      ok: false,
      code: 'invalid_content_type',
      message: 'Content-Type application/json is required.',
    });
    return false;
  }

  return true;
}

function isAuthorizedExecutiveIdentity(identity) {
  return Boolean(
    identity
    && identity.clientId === 'cliente-cero'
    && identity.expectedClientId === 'cliente-cero'
    && identity.authorization
    && identity.authorization.status === 'granted'
  );
}

function authorizeExecutiveRequest(res, getIdentity = getClienteCeroIdentity) {
  let identity;
  try {
    identity = typeof getIdentity === 'function' ? getIdentity() : null;
  } catch (error) {
    identity = null;
  }
  if (isAuthorizedExecutiveIdentity(identity)) return true;

  sendJson(res, 403, {
    ok: false,
    code: 'executive_authorization_denied',
    message: 'Executive authorization is required.',
  });
  return false;
}

function validateCsrfRequest(req, res, csrf) {
  const candidate = req.headers && req.headers['x-oxkio-csrf'];
  const result = csrf && typeof csrf.validate === 'function'
    ? csrf.validate(candidate)
    : { ok: false, code: 'csrf_token_required' };
  if (result.ok) return true;

  const messages = {
    csrf_token_required: 'CSRF token is required.',
    csrf_token_invalid: 'CSRF token is invalid.',
    csrf_token_expired: 'CSRF token has expired.',
  };
  const code = Object.hasOwn(messages, result.code) ? result.code : 'csrf_token_invalid';
  sendJson(res, 403, { ok: false, code, message: messages[code] });
  return false;
}

function validateMutableRequest(req, res, { getIdentity, csrf } = {}) {
  if (req.method !== 'POST') {
    sendMethodNotAllowed(res);
    return false;
  }
  if (!authorizeExecutiveRequest(res, getIdentity)) return false;
  if (!validateCsrfRequest(req, res, csrf)) return false;
  return validatePostJson(req, res);
}

function handleExecutiveSecurityContextRequest(req, res, {
  getIdentity = getClienteCeroIdentity,
  csrf,
} = {}) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, {
      ok: false,
      code: 'method_not_allowed',
      message: 'Use GET for the executive security context.',
    }, { Allow: 'GET' });
  }
  if (!authorizeExecutiveRequest(res, getIdentity)) return;
  if (!csrf || typeof csrf.getSecurityContext !== 'function') {
    return sendJson(res, 500, {
      ok: false,
      code: 'security_context_unavailable',
      message: 'Executive security context is unavailable.',
    });
  }
  return sendJson(res, 200, csrf.getSecurityContext());
}

async function handleApproveRequest(req, res, { approvalQueue, getIdentity, csrf }) {
  if (!validateMutableRequest(req, res, { getIdentity, csrf })) return;

  try {
    const body = await readJsonBody(req);
    const approvalId = getApprovalId(body);

    if (!approvalId) {
      return sendJson(res, 400, {
        ok: false,
        code: 'invalid_approval_id',
        message: 'approvalId is required.',
      });
    }

    const decision = body && body.decision === 'reject' ? 'reject' : 'approve';
    const identity = typeof getIdentity === 'function' ? getIdentity() : null;
    const result = decision === 'reject'
      ? approvalQueue.reject(approvalId)
      : approvalQueue.approve(approvalId, identity);
    if (!result.ok) {
      return sendJson(res, statusForQueueError(result), {
        ok: false,
        code: result.code || 'invalid_transition',
        message: result.error || 'Approval could not be updated.',
      });
    }

    return sendJson(res, 200, {
      ok: true,
      module: 'approval-queue',
      result,
      status: approvalQueue.getStatus(),
    });
  } catch (error) {
    if (error && error.message === 'invalid_json') {
      return sendJson(res, 400, {
        ok: false,
        code: 'invalid_json',
        message: 'Invalid JSON body.',
      });
    }

    return sendJson(res, 500, {
      ok: false,
      code: 'internal_error',
      message: 'Approval could not be processed.',
    });
  }
}

async function handleExecuteApprovedRequest(req, res, {
  approvalQueue,
  executionService,
  config = { executionEnabled: false, draftExecutionEnabled: false },
  getIdentity,
  csrf,
}) {
  if (!validateMutableRequest(req, res, { getIdentity, csrf })) return;

  try {
    const body = await readJsonBody(req);
    const approvalId = getApprovalId(body);

    if (!approvalId) {
      return sendJson(res, 400, {
        ok: false,
        code: 'invalid_approval_id',
        message: 'approvalId is required.',
      });
    }

    if (config.draftExecutionEnabled !== true && config.executionEnabled !== true) {
      const validation = approvalQueue.validateForExecution(approvalId);
      if (!validation.ok) {
        return sendJson(res, statusForQueueError(validation), {
          ok: false,
          code: validation.code || 'invalid_transition',
          message: 'Approval is not ready for execution.',
        });
      }

      return sendJson(res, 503, {
        ok: false,
        code: 'execution_disabled',
        message: 'Execution is not enabled.',
      });
    }

    const result = await executionService.executeApproved(approvalId);
    return sendJson(res, statusForExecutionResult(result), result);
  } catch (error) {
    if (error && error.message === 'invalid_json') {
      return sendJson(res, 400, {
        ok: false,
        code: 'invalid_json',
        message: 'Invalid JSON body.',
      });
    }

    return sendJson(res, 500, {
      ok: false,
      code: 'internal_error',
      message: 'Execution validation could not be processed.',
    });
  }
}

module.exports = {
  handleApproveRequest,
  handleExecutiveSecurityContextRequest,
  handleExecuteApprovedRequest,
  isAuthorizedExecutiveIdentity,
  statusForExecutionResult,
};

'use strict';

const EXECUTION_ENABLED = false;

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

async function handleApproveRequest(req, res, { approvalQueue }) {
  if (!validatePostJson(req, res)) return;

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

    const result = approvalQueue.approve(approvalId);
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

async function handleExecuteApprovedRequest(req, res, { approvalQueue }) {
  if (!validatePostJson(req, res)) return;

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

    const validation = approvalQueue.validateForExecution(approvalId);
    if (!validation.ok) {
      return sendJson(res, statusForQueueError(validation), {
        ok: false,
        code: validation.code || 'invalid_transition',
        message: validation.error || 'Approval is not ready for execution.',
      });
    }

    if (!EXECUTION_ENABLED) {
      return sendJson(res, 503, {
        ok: false,
        code: 'execution_disabled',
        message: 'Execution is not enabled.',
      });
    }

    return sendJson(res, 503, {
      ok: false,
      code: 'execution_disabled',
      message: 'Execution is not enabled.',
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
      message: 'Execution validation could not be processed.',
    });
  }
}

module.exports = {
  handleApproveRequest,
  handleExecuteApprovedRequest,
};

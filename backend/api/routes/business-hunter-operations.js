'use strict';

const { getClienteCeroIdentity } = require('../../services/private-context/client-identity-resolver');
const { isAuthorizedExecutiveIdentity } = require('./executive-approval');

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
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

function sendMethodNotAllowed(res) {
  return sendJson(res, 405, {
    ok: false,
    code: 'method_not_allowed',
    message: 'Use POST with JSON.',
  });
}

function authorizeBusinessHunterRequest(res, getIdentity = getClienteCeroIdentity) {
  let identity = null;

  try {
    identity = typeof getIdentity === 'function' ? getIdentity() : null;
  } catch (error) {
    identity = null;
  }

  if (isAuthorizedExecutiveIdentity(identity)) {
    return true;
  }

  sendJson(res, 403, {
    ok: false,
    code: 'executive_authorization_denied',
    message: 'Executive authorization is required.',
  });
  return false;
}

function validateBusinessHunterRequest(req, res, getIdentity) {
  if (req.method !== 'POST') {
    sendMethodNotAllowed(res);
    return false;
  }

  if (!authorizeBusinessHunterRequest(res, getIdentity)) {
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

function isBusinessHunterOperationRoute(pathname, method) {
  return pathname === '/api/operations/business-hunter/run' && method === 'POST';
}

async function handleBusinessHunterOperationRequest(req, res, {
  operationsCoordinator,
  getIdentity = getClienteCeroIdentity,
} = {}) {
  if (!validateBusinessHunterRequest(req, res, getIdentity)) {
    return;
  }

  try {
    const body = await readJsonBody(req);
    if ((body && typeof body !== 'object') || Array.isArray(body)) {
      return sendJson(res, 400, {
        ok: false,
        code: 'invalid_json_body',
        message: 'Invalid JSON body.',
      });
    }

    const coordinator = operationsCoordinator;
    if (!coordinator || typeof coordinator.runBusinessAnalysis !== 'function') {
      return sendJson(res, 500, {
        ok: false,
        code: 'business_hunter_service_unavailable',
        message: 'Business Hunter service is unavailable.',
      });
    }

    const identity = getIdentity();
    const result = await coordinator.runBusinessAnalysis({ identity });

    return sendJson(res, 200, result);
  } catch (error) {
    if (error && error.code === 'business_hunter_operation_in_progress') {
      return sendJson(res, 409, {
        ok: false,
        code: error.code,
        message: 'Business Hunter readonly cycle is already running.',
      });
    }

    if (error && error.code === 'business_hunter_timeout') {
      return sendJson(res, 504, {
        ok: false,
        code: error.code,
        message: 'Business Hunter readonly cycle timed out.',
      });
    }

    if (error && error.message === 'invalid_json') {
      return sendJson(res, 400, {
        ok: false,
        code: 'invalid_json',
        message: 'Invalid JSON body.',
      });
    }

    return sendJson(res, 500, {
      ok: false,
      code: 'business_hunter_operation_failed',
      message: 'Business Hunter readonly cycle failed.',
    });
  }
}

module.exports = {
  handleBusinessHunterOperationRequest,
  isBusinessHunterOperationRoute,
};

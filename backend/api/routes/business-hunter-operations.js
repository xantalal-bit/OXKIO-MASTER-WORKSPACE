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
    message: 'Esta operación solo puede iniciarse desde el botón de análisis.',
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
    message: 'Tu sesión no tiene permiso para realizar esta operación.',
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
      message: 'La solicitud de análisis no tiene un formato válido.',
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
        message: 'La solicitud de análisis no tiene un formato válido.',
      });
    }

    const coordinator = operationsCoordinator;
    if (!coordinator || typeof coordinator.runBusinessAnalysis !== 'function') {
      return sendJson(res, 500, {
        ok: false,
        code: 'business_hunter_service_unavailable',
        message: 'El análisis comercial no está disponible en este momento.',
      });
    }

    const identity = getIdentity();
    const result = await coordinator.runBusinessAnalysis({ identity });

    return sendJson(res, 200, result);
  } catch (error) {
    if (error && ['business_hunter_operation_in_progress', 'operation_in_progress'].includes(error.code)) {
      return sendJson(res, 409, {
        ok: false,
        code: error.code,
        message: 'Ya existe un análisis en curso.',
      });
    }

    if (error && error.code === 'business_hunter_timeout') {
      return sendJson(res, 504, {
        ok: false,
        code: error.code,
        message: 'El análisis tardó más de lo permitido y se detuvo de forma segura.',
      });
    }

    if (error && error.message === 'invalid_json') {
      return sendJson(res, 400, {
        ok: false,
        code: 'invalid_json',
        message: 'La solicitud de análisis no tiene un formato válido.',
      });
    }

    if (error && ['invalid_worker_result', 'unsafe_worker_result'].includes(error.code)) {
      return sendJson(res, 500, {
        ok: false,
        code: error.code,
        message: 'El resultado no superó las comprobaciones de seguridad.',
      });
    }

    return sendJson(res, 500, {
      ok: false,
      code: 'business_hunter_operation_failed',
      message: 'No se pudo completar el análisis comercial.',
    });
  }
}

module.exports = {
  handleBusinessHunterOperationRequest,
  isBusinessHunterOperationRoute,
};

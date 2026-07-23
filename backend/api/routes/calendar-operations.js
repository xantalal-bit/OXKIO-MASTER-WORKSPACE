'use strict';

const { getClienteCeroIdentity } = require('../../services/private-context/client-identity-resolver');
const { isAuthorizedExecutiveIdentity } = require('./executive-approval');

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload, null, 2));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk.toString(); });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch (error) {
        reject(Object.assign(new Error('invalid_json'), { code: 'invalid_json' }));
      }
    });
    req.on('error', reject);
  });
}

function isCalendarOperationRoute(pathname, method) {
  return pathname === '/api/operations/calendar/run' && method === 'POST';
}

async function handleCalendarOperationRequest(req, res, {
  operationsCoordinator,
  getIdentity = getClienteCeroIdentity,
} = {}) {
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, code: 'method_not_allowed', message: 'Esta operación solo puede iniciarse desde el botón de revisión.' });
  let identity;
  try { identity = getIdentity(); } catch (error) { identity = null; }
  if (!isAuthorizedExecutiveIdentity(identity)) return sendJson(res, 403, { ok: false, code: 'executive_authorization_denied', message: 'Tu sesión no tiene permiso para realizar esta operación.' });
  const contentType = String(req.headers && req.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json') return sendJson(res, 400, { ok: false, code: 'invalid_content_type', message: 'La solicitud de revisión no tiene un formato válido.' });
  try {
    const body = await readJsonBody(req);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return sendJson(res, 400, { ok: false, code: 'invalid_json_body', message: 'La solicitud de revisión no tiene un formato válido.' });
    if (!operationsCoordinator || typeof operationsCoordinator.runCalendarReview !== 'function') return sendJson(res, 500, { ok: false, code: 'calendar_service_unavailable', message: 'La revisión de agenda no está disponible.' });
    return sendJson(res, 200, await operationsCoordinator.runCalendarReview({ identity }));
  } catch (error) {
    if (error && ['operation_in_progress', 'calendar_operation_in_progress'].includes(error.code)) return sendJson(res, 409, { ok: false, code: 'operation_in_progress', message: 'Ya existe una operación en curso.' });
    if (error && error.code === 'calendar_review_timeout') return sendJson(res, 504, { ok: false, code: error.code, message: 'La revisión tardó más de lo permitido y se detuvo de forma segura.' });
    if (error && error.code === 'invalid_json') return sendJson(res, 400, { ok: false, code: error.code, message: 'La solicitud de revisión no tiene un formato válido.' });
    return sendJson(res, 500, { ok: false, code: 'calendar_review_failed', message: 'No se pudo completar la revisión de agenda.' });
  }
}

module.exports = { handleCalendarOperationRequest, isCalendarOperationRoute };

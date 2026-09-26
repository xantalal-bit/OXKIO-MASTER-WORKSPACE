'use strict';

const { isAuthorizedExecutiveIdentity } = require('./executive-approval');

// Quality Loop routes.
//
// GET  /api/quality/summary  — Manager, read-only, Cliente Cero only
//      (default-deny api-route-policy + explicit isAuthorizedExecutiveIdentity).
//      Only compact Quality Incident metadata. No repair/resolve actions.
// POST /api/quality/feedback — any authenticated OXKIO user (family-safe).
//      Records a Quality Incident; the response never reveals incident ids,
//      priorities, counts or any other internal metric.

const MAX_BODY_BYTES = 2048;

const USER_INPUT_ERRORS = new Map([
  ['QUALITY_SENSITIVE_TEXT', 'No incluyas datos personales, correos, teléfonos, enlaces ni claves en el comentario.'],
  ['QUALITY_INVALID_TEXT', 'El comentario debe ser breve (máximo 160 caracteres).'],
  ['QUALITY_FEEDBACK_INVALID_CATEGORY', 'Tipo de problema no válido.'],
  ['QUALITY_FEEDBACK_INVALID', 'Solicitud no válida.'],
  ['QUALITY_FEEDBACK_UNEXPECTED_FIELD', 'Solicitud no válida.'],
  ['QUALITY_INVALID_IDENTIFIER', 'Solicitud no válida.'],
]);

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(data, null, 2));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let tooLarge = false;
    req.on('data', (chunk) => {
      if (tooLarge) return;
      body += chunk.toString();
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) tooLarge = true;
    });
    req.on('end', () => {
      if (tooLarge) return reject(Object.assign(new Error('too large'), { code: 'QUALITY_FEEDBACK_INVALID' }));
      try { resolve(body ? JSON.parse(body) : {}); } catch (error) {
        reject(Object.assign(new Error('invalid json'), { code: 'QUALITY_FEEDBACK_INVALID' }));
      }
    });
    req.on('error', reject);
  });
}

function isQualitySummaryRoute(pathname, method) {
  return pathname === '/api/quality/summary' && method === 'GET';
}

function isQualityFeedbackRoute(pathname, method) {
  return pathname === '/api/quality/feedback' && method === 'POST';
}

function handleQualitySummaryRequest(req, res, { registry, getIdentity } = {}) {
  let identity = null;
  try {
    identity = typeof getIdentity === 'function' ? getIdentity() : null;
  } catch (error) {
    identity = null;
  }
  if (!isAuthorizedExecutiveIdentity(identity)) {
    return sendJson(res, 403, {
      ok: false,
      code: 'executive_authorization_denied',
      message: 'Executive authorization is required.',
    });
  }
  if (!registry || typeof registry.summary !== 'function') {
    return sendJson(res, 503, { ok: false, code: 'quality_unavailable' });
  }
  const summary = registry.summary();
  return sendJson(res, 200, {
    ok: true,
    module: 'quality-loop',
    persistence: summary.persistence,
    counts: summary.counts,
    incidents: summary.incidents,
    topRecurring: summary.topRecurring,
    pendingHumanDecision: summary.pendingHumanDecision,
    recentlyResolved: summary.recentlyResolved,
  });
}

async function handleQualityFeedbackRequest(req, res, { feedbackService, getReporterId } = {}) {
  if (!feedbackService || typeof feedbackService.submit !== 'function') {
    return sendJson(res, 503, { ok: false, code: 'quality_unavailable' });
  }
  const reporterId = typeof getReporterId === 'function' ? getReporterId() : null;
  if (typeof reporterId !== 'string' || reporterId.length === 0) {
    return sendJson(res, 403, { ok: false, code: 'quality_feedback_denied' });
  }
  try {
    const body = await readJsonBody(req);
    feedbackService.submit(body, { reporterId });
    return sendJson(res, 202, { ok: true, message: 'Gracias. Lo hemos registrado para revisarlo.' });
  } catch (error) {
    const code = error && typeof error.code === 'string' ? error.code : null;
    if (code === 'QUALITY_FEEDBACK_RATE_LIMITED') {
      return sendJson(res, 429, { ok: false, code: 'quality_feedback_rate_limited', message: 'Has enviado muchos avisos. Inténtalo más tarde.' });
    }
    if (code && USER_INPUT_ERRORS.has(code)) {
      return sendJson(res, 400, { ok: false, code: 'quality_feedback_invalid', message: USER_INPUT_ERRORS.get(code) });
    }
    console.error('[quality]', 'QUALITY_FEEDBACK_FAILED');
    return sendJson(res, 500, { ok: false, code: 'quality_feedback_failed' });
  }
}

module.exports = {
  handleQualityFeedbackRequest,
  handleQualitySummaryRequest,
  isQualityFeedbackRoute,
  isQualitySummaryRoute,
};

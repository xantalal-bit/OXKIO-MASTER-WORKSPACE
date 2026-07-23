'use strict';

const { createExecutiveRuntime } = require('../runtime/executive-runtime-factory');
const { buildGmailPrivateContext } = require('../private-context/gmail-private-provider');

const WORKER_NAME = 'gmail-readonly';
const MODE = 'manual';
const DEFAULT_TIMEOUT_MS = 7000;
const MAX_EMAILS = 10;
const MAX_RELEVANT_ITEMS = 5;
const MAX_RECOMMENDATIONS = 3;

function cleanText(value, limit = 160) {
  return String(value || '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/<?[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}>?/g, '')
    .replace(/(?:[A-Za-z]:\\|\/Users\/|\/home\/)\S*/gi, '')
    .replace(/\b\+?\d[\d .()-]{7,}\d\b/g, '')
    .replace(/bearer\s+\S+|private[_-]?key/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*<>\s*/g, ' ')
    .trim()
    .slice(0, limit);
}

function safeSender(value) {
  const withoutAddress = cleanText(value, 100)
    .replace(/^["']|["']$/g, '')
    .replace(/[<>]/g, '')
    .trim();
  return withoutAddress || 'Remitente no disponible';
}

function withTimeout(promise, timeoutMs) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('Gmail review timed out.'), {
        code: 'gmail_review_timeout',
      })), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

function sanitizeMessage(message) {
  if (!message || typeof message !== 'object') return null;
  return Object.freeze({
    sender: safeSender(message.from),
    subject: cleanText(message.subject, 140) || 'Sin asunto',
    summary: cleanText(message.snippet, 180) || 'Sin resumen disponible.',
    unread: message.unread === true,
    important: message.important === true,
  });
}

function buildResult(ids, messages, startedAt) {
  const safeMessages = (Array.isArray(messages) ? messages : [])
    .slice(0, MAX_EMAILS)
    .map(sanitizeMessage)
    .filter(Boolean);
  const relevantItems = safeMessages
    .filter((message) => message.unread || message.important)
    .slice(0, MAX_RELEVANT_ITEMS)
    .map(({ sender, subject, summary }) => Object.freeze({ sender, subject, summary }));
  const emailsCount = safeMessages.length;
  const sourceStatus = emailsCount === 0 ? 'unavailable' : relevantItems.length > 0 ? 'real' : 'partial';
  const summary = sourceStatus === 'real'
    ? `Se han revisado ${emailsCount} correos recientes y hay asuntos que requieren atención.`
    : sourceStatus === 'partial'
      ? `Se han revisado ${emailsCount} correos recientes sin asuntos prioritarios claramente identificados.`
      : 'No hay correos seguros disponibles para completar la revisión.';
  const recommendations = sourceStatus === 'real'
    ? ['Revisar primero los asuntos marcados como relevantes.', 'Confirmar el contexto antes de responder o realizar cualquier acción.']
    : sourceStatus === 'partial'
      ? ['Revisar manualmente la bandeja antes de tomar decisiones.']
      : ['Comprobar la disponibilidad de Gmail antes de repetir la revisión.'];
  const completedAt = new Date().toISOString();
  return Object.freeze({
    ...ids,
    worker: WORKER_NAME,
    mode: MODE,
    status: sourceStatus === 'real' ? 'completed' : 'completed_with_warnings',
    startedAt,
    completedAt,
    durationMs: Math.max(0, Date.parse(completedAt) - Date.parse(startedAt)),
    sourceStatus,
    summary,
    emailsCount,
    relevantItems: Object.freeze(relevantItems),
    recommendations: Object.freeze(recommendations.slice(0, MAX_RECOMMENDATIONS)),
    warnings: Object.freeze(sourceStatus === 'real' ? [] : [summary]),
    errors: Object.freeze([]),
  });
}

function createGmailReadonlyService(dependencies = {}) {
  let lock = false;
  async function runGmailReadonly(options = {}) {
    if (lock) throw Object.assign(new Error('Gmail review already running.'), { code: 'gmail_operation_in_progress' });
    const operationId = cleanText(options.operationId, 80);
    const interactionId = cleanText(options.interactionId, 80);
    if (!operationId || !interactionId) throw Object.assign(new Error('Missing operation identifiers.'), { code: 'invalid_gmail_operation' });
    const identity = options.identity;
    if (!identity || identity.clientId !== identity.expectedClientId || !identity.userId
      || !identity.authorization || identity.authorization.status !== 'granted'
      || identity.authorization.provider !== 'google-oauth') {
      throw Object.assign(new Error('Gmail review authorization required.'), { code: 'operation_authorization_denied' });
    }
    lock = true;
    let runtime;
    const startedAt = new Date().toISOString();
    try {
      const runtimeFactory = dependencies.createExecutiveRuntime || createExecutiveRuntime;
      const gmailProvider = dependencies.buildGmailPrivateContext || buildGmailPrivateContext;
      runtime = runtimeFactory({ mode: 'sandbox' });
      const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
        ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
      const context = await withTimeout(Promise.resolve().then(() => gmailProvider({
        clientId: identity.clientId,
        expectedClientId: identity.expectedClientId,
        userId: identity.userId,
        authorization: identity.authorization,
        maxMessages: MAX_EMAILS,
      })), timeoutMs);
      const messages = context && context.privatePayload && Array.isArray(context.privatePayload.messages)
        ? context.privatePayload.messages : [];
      return buildResult({ operationId, interactionId }, messages, startedAt);
    } catch (error) {
      throw Object.assign(new Error(error && error.code === 'gmail_review_timeout'
        ? 'La revisión tardó más de lo permitido y se detuvo de forma segura.'
        : 'No se pudo completar la revisión de correo.'), {
        code: error && error.code || 'gmail_review_failed',
      });
    } finally {
      lock = false;
      if (runtime && typeof runtime.cleanup === 'function') {
        try { runtime.cleanup(); } catch (error) { /* readonly cleanup is best effort */ }
      }
    }
  }
  return Object.freeze({ runGmailReadonly });
}

module.exports = {
  WORKER_NAME,
  DEFAULT_TIMEOUT_MS,
  MAX_EMAILS,
  createGmailReadonlyService,
};

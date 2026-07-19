'use strict';

const DEFAULT_TIMEOUT_MS = 7000;
const MAX_RECENT = 5;
const MAX_FROM_LENGTH = 160;
const MAX_SUBJECT_LENGTH = 200;

function unavailableResult(errorCode = 'gmail_unavailable') {
  return {
    title: 'Gmail',
    unread: 0,
    important: 0,
    recentCount: 0,
    recent: [],
    source: 'unavailable',
    available: false,
    stale: false,
    errorCode,
  };
}

function sanitizeText(value, fallback, maxLength) {
  if (typeof value !== 'string') return fallback;
  const sanitized = value
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return sanitized ? sanitized.slice(0, maxLength) : fallback;
}

function normalizeDate(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeMessage(message) {
  if (!message || typeof message !== 'object') return null;
  return {
    id: typeof message.id === 'string' && message.id.trim()
      ? message.id.trim().slice(0, 200)
      : null,
    from: sanitizeText(message.from, 'Remitente no disponible', MAX_FROM_LENGTH),
    subject: sanitizeText(message.subject, 'Sin asunto', MAX_SUBJECT_LENGTH),
    receivedAt: normalizeDate(message.date || message.receivedAt),
    unread: message.unread === true,
    important: message.important === true,
  };
}

function classifyError(error) {
  const rawCode = error && error.code;
  const code = typeof rawCode === 'string' ? rawCode : '';
  const status = Number(
    (error && error.status)
    || (error && error.response && error.response.status)
    || rawCode,
  );

  if (code === 'gmail_timeout') return 'gmail_timeout';
  if (code === 'google_oauth_not_configured' || code === 'oauth_not_configured') {
    return 'gmail_oauth_not_configured';
  }
  if (/token|refresh|access/.test(code)) return 'gmail_token_unavailable';
  if (status === 401 || status === 403) return 'gmail_unauthorized';
  if (status === 429) return 'gmail_rate_limited';
  if (status >= 500 && status <= 599) return 'gmail_service_error';
  return 'gmail_unavailable';
}

function withTimeout(promise, timeoutMs) {
  let timeoutId;
  const timeout = new Promise((resolve, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error('gmail_timeout');
      error.code = 'gmail_timeout';
      reject(error);
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

async function getGmail(timestamp, readonlyGmailProvider, options = {}) {
  if (typeof readonlyGmailProvider !== 'function') {
    return unavailableResult();
  }

  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : DEFAULT_TIMEOUT_MS;

  try {
    const context = await withTimeout(
      Promise.resolve().then(() => readonlyGmailProvider()),
      timeoutMs,
    );
    const messages = context
      && context.privatePayload
      && Array.isArray(context.privatePayload.messages)
      ? context.privatePayload.messages
      : null;
    if (!messages) return unavailableResult('gmail_invalid_response');

    const recent = messages
      .map(normalizeMessage)
      .filter(Boolean)
      .sort((left, right) => (
        Date.parse(right.receivedAt || '') || 0
      ) - (Date.parse(left.receivedAt || '') || 0))
      .slice(0, MAX_RECENT);

    return {
      title: 'Gmail',
      unread: recent.filter((message) => message.unread).length,
      important: recent.filter((message) => message.important).length,
      recentCount: recent.length,
      recent,
      source: 'gmail',
      available: true,
      stale: false,
      errorCode: null,
    };
  } catch (error) {
    return unavailableResult(classifyError(error));
  }
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  MAX_RECENT,
  classifyError,
  getGmail,
  normalizeMessage,
};

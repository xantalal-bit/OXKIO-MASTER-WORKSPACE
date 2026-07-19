'use strict';

const DEFAULT_TIMEOUT_MS = 7000;
const MAX_EVENTS = 10;
const MAX_TEXT_LENGTH = 200;

function unavailableResult(errorCode = 'calendar_unavailable') {
  return {
    title: 'Agenda',
    events: [],
    count: 0,
    source: 'unavailable',
    available: false,
    stale: false,
    errorCode,
  };
}

function sanitizeText(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const sanitized = value
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return sanitized ? sanitized.slice(0, MAX_TEXT_LENGTH) : fallback;
}

function normalizeDate(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeEvent(event) {
  if (!event || typeof event !== 'object') return null;
  return {
    id: typeof event.id === 'string' && event.id.trim()
      ? event.id.trim().slice(0, MAX_TEXT_LENGTH)
      : null,
    title: sanitizeText(event.title, 'Evento sin título'),
    start: normalizeDate(event.start),
    end: normalizeDate(event.end),
    allDay: event.allDay === true,
    location: sanitizeText(event.location, null),
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

  if (code === 'calendar_timeout') return 'calendar_timeout';
  if (code === 'google_oauth_not_configured' || code === 'oauth_not_configured') {
    return 'calendar_oauth_not_configured';
  }
  if (/token|refresh|access/.test(code)) return 'calendar_token_unavailable';
  if (status === 401 || status === 403) return 'calendar_unauthorized';
  if (status === 429) return 'calendar_rate_limited';
  if (status >= 500 && status <= 599) return 'calendar_service_error';
  return 'calendar_unavailable';
}

function withTimeout(promise, timeoutMs) {
  let timeoutId;
  const timeout = new Promise((resolve, reject) => {
    timeoutId = setTimeout(() => {
      const error = new Error('calendar_timeout');
      error.code = 'calendar_timeout';
      reject(error);
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
}

async function getAgenda(timestamp, readonlyCalendarProvider, options = {}) {
  if (typeof readonlyCalendarProvider !== 'function') {
    return unavailableResult();
  }
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : DEFAULT_TIMEOUT_MS;

  try {
    const context = await withTimeout(
      Promise.resolve().then(() => readonlyCalendarProvider()),
      timeoutMs,
    );
    const events = context
      && context.privatePayload
      && Array.isArray(context.privatePayload.events)
      ? context.privatePayload.events
      : null;
    if (!events) return unavailableResult('calendar_invalid_response');

    const normalizedEvents = events
      .map(normalizeEvent)
      .filter(Boolean)
      .sort((left, right) => (
        Date.parse(left.start || '') || Number.MAX_SAFE_INTEGER
      ) - (Date.parse(right.start || '') || Number.MAX_SAFE_INTEGER))
      .slice(0, MAX_EVENTS);

    return {
      title: 'Agenda',
      events: normalizedEvents,
      count: normalizedEvents.length,
      source: 'calendar',
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
  MAX_EVENTS,
  classifyError,
  getAgenda,
  normalizeEvent,
};

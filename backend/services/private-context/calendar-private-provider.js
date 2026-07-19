'use strict';

const { listUpcomingEvents } = require('../../integrations/calendar/connector');
const { assertGoogleOAuthConfigured } = require('../../integrations/googleOAuth');

const MAX_RANGE_DAYS = 7;
const MAX_EVENTS = 20;
const DEFAULT_EVENTS = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

function buildProviderError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isValidText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseDate(value, fieldName) {
  if (!isValidText(value)) {
    throw buildProviderError(`invalid_${fieldName}`, `${fieldName} must be a valid ISO date string.`);
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw buildProviderError(`invalid_${fieldName}`, `${fieldName} must be a valid ISO date string.`);
  }

  return date;
}

function clampMaxResults(value) {
  if (typeof value === 'undefined' || value === null) {
    return DEFAULT_EVENTS;
  }

  if (!Number.isInteger(value) || value < 1) {
    throw buildProviderError('invalid_max_results', 'maxResults must be a positive integer.');
  }

  return Math.min(value, MAX_EVENTS);
}

function hasGrantedGoogleOAuthAuthorization(authorization) {
  return Boolean(
    authorization
      && typeof authorization === 'object'
      && authorization.status === 'granted'
      && authorization.provider === 'google-oauth',
  );
}

function assertCalendarPrivateIdentity(input = {}) {
  if (
    !isValidText(input.clientId)
    || !isValidText(input.userId)
    || !isValidText(input.expectedClientId)
    || !hasGrantedGoogleOAuthAuthorization(input.authorization)
  ) {
    throw buildProviderError(
      'calendar_private_identity_required',
      'calendar_private_identity_required',
    );
  }
}

function startOfDay(date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return start;
}

function resolveCalendarRange(input = {}) {
  const now = input.now ? parseDate(input.now, 'now') : new Date();
  const preset = input.range || 'next24Hours';
  let timeMin;
  let timeMax;

  if (preset === 'today') {
    timeMin = startOfDay(now);
    timeMax = new Date(timeMin.getTime() + DAY_MS);
  } else if (preset === 'next24Hours') {
    timeMin = now;
    timeMax = new Date(now.getTime() + DAY_MS);
  } else if (preset === 'next7Days') {
    timeMin = now;
    timeMax = new Date(now.getTime() + MAX_RANGE_DAYS * DAY_MS);
  } else if (preset === 'custom') {
    timeMin = parseDate(input.timeMin, 'timeMin');
    timeMax = parseDate(input.timeMax, 'timeMax');
  } else {
    throw buildProviderError('invalid_calendar_range', 'calendar range is invalid.');
  }

  if (timeMax.getTime() <= timeMin.getTime()) {
    throw buildProviderError('invalid_calendar_range', 'timeMax must be after timeMin.');
  }

  if (timeMax.getTime() - timeMin.getTime() > MAX_RANGE_DAYS * DAY_MS) {
    throw buildProviderError('calendar_range_too_large', 'calendar range must be 7 days or less.');
  }

  return {
    preset,
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
  };
}

function normalizeEventText(value, fallback) {
  return isValidText(value) ? value.trim() : fallback;
}

function normalizeCalendarEvent(event = {}) {
  const start = event.start || null;
  const end = event.end || null;

  return {
    id: isValidText(event.id) ? event.id.trim() : null,
    title: normalizeEventText(event.title || event.summary, 'Evento sin titulo'),
    start: isValidText(start) ? start.trim() : null,
    end: isValidText(end) ? end.trim() : null,
    allDay: event.allDay === true,
    location: isValidText(event.location) ? event.location.trim() : null,
  };
}

async function buildCalendarPrivateContext(input = {}, dependencies = {}) {
  const calendarReader = dependencies.listUpcomingEvents || listUpcomingEvents;
  const oauthGuard = dependencies.assertGoogleOAuthConfigured || assertGoogleOAuthConfigured;
  assertCalendarPrivateIdentity(input);
  const maxResults = clampMaxResults(input.maxResults);
  const range = resolveCalendarRange(input);

  if (!dependencies.listUpcomingEvents) {
    oauthGuard();
  }

  const events = await calendarReader({
    calendarId: input.calendarId || 'primary',
    timeMin: range.timeMin,
    timeMax: range.timeMax,
    maxResults,
  });
  const normalizedEvents = Array.isArray(events)
    ? events.slice(0, maxResults).map(normalizeCalendarEvent)
    : [];

  return {
    privateContextMetadata: {
      clientId: input.clientId.trim(),
      userId: input.userId.trim(),
      scope: 'private:user',
      sensitivity: input.sensitivity || 'confidential',
      sourceType: 'calendar',
      sourceId: input.sourceId || 'google-calendar-primary',
      authorization: input.authorization,
      purpose: 'executive-briefing',
      retentionPolicy: 'CLIENT_CONTROLLED',
      promotionPolicy: 'NEVER_PROMOTE',
    },
    expectedClientId: input.expectedClientId.trim(),
    privatePayload: {
      source: 'calendar',
      range: {
        ...range,
        maxResults,
      },
      events: normalizedEvents,
    },
  };
}

module.exports = {
  MAX_EVENTS,
  MAX_RANGE_DAYS,
  assertCalendarPrivateIdentity,
  buildCalendarPrivateContext,
  normalizeCalendarEvent,
  resolveCalendarRange,
};

'use strict';

const { createExecutiveRuntime } = require('../runtime/executive-runtime-factory');
const { buildCalendarPrivateContext } = require('../private-context/calendar-private-provider');

const WORKER_NAME = 'calendar-readonly';
const MODE = 'manual';
const DEFAULT_TIMEOUT_MS = 7000;
const MAX_EVENTS = 10;
const MAX_RELEVANT_ITEMS = 5;
const MAX_RECOMMENDATIONS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

function cleanText(value, limit = 160) {
  return String(value || '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/(?:[A-Za-z]:\\|\/Users\/|\/home\/)\S*/gi, '')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '')
    .replace(/bearer\s+\S+|private[_-]?key/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function withTimeout(promise, timeoutMs) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('Calendar review timed out.'), {
        code: 'calendar_review_timeout',
      })), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

function parseDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function resolveReviewRange(nowMs) {
  const timeMin = new Date(nowMs);
  timeMin.setHours(0, 0, 0, 0);
  return {
    range: 'custom',
    timeMin: timeMin.toISOString(),
    timeMax: new Date(timeMin.getTime() + 7 * DAY_MS).toISOString(),
  };
}

function formatDate(value, allDay) {
  const date = parseDate(value);
  if (!date) return 'Fecha no disponible';
  return new Intl.DateTimeFormat('es-ES', {
    dateStyle: 'medium',
    ...(allDay ? {} : { timeStyle: 'short' }),
    timeZone: 'Europe/Madrid',
  }).format(date);
}

function sanitizeEvent(event) {
  if (!event || typeof event !== 'object') return null;
  const start = parseDate(event.start);
  const end = parseDate(event.end);
  if (!start) return null;
  return Object.freeze({
    title: cleanText(event.title, 140) || 'Evento sin título',
    date: formatDate(event.start, event.allDay === true),
    time: event.allDay === true
      ? 'Todo el día'
      : new Intl.DateTimeFormat('es-ES', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Madrid',
      }).format(start),
    location: cleanText(event.location, 120) || 'Ubicación no indicada',
    startMs: start.getTime(),
    endMs: end && end.getTime() >= start.getTime() ? end.getTime() : start.getTime(),
  });
}

function analyzeEvents(events, nowMs) {
  const sorted = events.slice().sort((left, right) => left.startMs - right.startMs);
  const overlapIndexes = new Set();
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index].startMs < sorted[index - 1].endMs) {
      overlapIndexes.add(index - 1);
      overlapIndexes.add(index);
    }
  }
  const relevantItems = sorted.slice(0, MAX_RELEVANT_ITEMS).map((event, index) => Object.freeze({
    title: event.title,
    date: event.date,
    time: event.time,
    location: event.location,
    conflict: overlapIndexes.has(index),
  }));
  const occupiedDays = new Set(sorted.map((event) => {
    const date = new Date(event.startMs);
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  }));
  const daysWithoutEvents = [];
  for (let offset = 0; offset < 7; offset += 1) {
    const day = new Date(nowMs + offset * DAY_MS);
    const key = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
    if (!occupiedDays.has(key)) daysWithoutEvents.push(offset);
  }
  return {
    relevantItems,
    conflictCount: overlapIndexes.size,
    daysWithoutEvents: daysWithoutEvents.length,
  };
}

function buildResult(ids, events, startedAt, nowMs = Date.now()) {
  const safeEvents = (Array.isArray(events) ? events : [])
    .slice(0, MAX_EVENTS)
    .map(sanitizeEvent)
    .filter(Boolean);
  const analysis = analyzeEvents(safeEvents, nowMs);
  const eventsCount = safeEvents.length;
  const sourceStatus = eventsCount === 0 ? 'unavailable' : 'real';
  const summary = sourceStatus === 'unavailable'
    ? 'No hay eventos seguros disponibles para completar la revisión.'
    : analysis.conflictCount > 0
      ? `Se han revisado ${eventsCount} próximos eventos y hay solapamientos que conviene comprobar.`
      : `Se han revisado ${eventsCount} próximos eventos sin solapamientos evidentes.`;
  const recommendations = [];
  if (analysis.conflictCount > 0) recommendations.push('Revisar los compromisos que coinciden antes de confirmar nuevos planes.');
  if (analysis.daysWithoutEvents > 0) recommendations.push('Aprovechar los huecos disponibles para trabajo de concentración o preparación.');
  if (sourceStatus === 'real') recommendations.push('Confirmar los próximos compromisos antes de realizar cualquier cambio.');
  else recommendations.push('Comprobar la disponibilidad de Calendar antes de repetir la revisión.');
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
    eventsCount,
    relevantItems: Object.freeze(analysis.relevantItems),
    recommendations: Object.freeze(recommendations.slice(0, MAX_RECOMMENDATIONS)),
    warnings: Object.freeze(sourceStatus === 'real' ? [] : [summary]),
    errors: Object.freeze([]),
  });
}

function createCalendarReadonlyService(dependencies = {}) {
  let lock = false;
  async function runCalendarReadonly(options = {}) {
    if (lock) throw Object.assign(new Error('Calendar review already running.'), { code: 'calendar_operation_in_progress' });
    const operationId = cleanText(options.operationId, 80);
    const interactionId = cleanText(options.interactionId, 80);
    if (!operationId || !interactionId) throw Object.assign(new Error('Missing operation identifiers.'), { code: 'invalid_calendar_operation' });
    const identity = options.identity;
    if (!identity || identity.clientId !== identity.expectedClientId || !identity.userId
      || !identity.authorization || identity.authorization.status !== 'granted'
      || identity.authorization.provider !== 'google-oauth') {
      throw Object.assign(new Error('Calendar review authorization required.'), { code: 'operation_authorization_denied' });
    }
    lock = true;
    let runtime;
    const startedAt = new Date().toISOString();
    try {
      runtime = (dependencies.createExecutiveRuntime || createExecutiveRuntime)({ mode: 'sandbox' });
      const provider = dependencies.buildCalendarPrivateContext || buildCalendarPrivateContext;
      const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
        ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
      const reviewNowMs = dependencies.nowMs || Date.now();
      const context = await withTimeout(Promise.resolve().then(() => provider({
        clientId: identity.clientId,
        expectedClientId: identity.expectedClientId,
        userId: identity.userId,
        authorization: identity.authorization,
        ...resolveReviewRange(reviewNowMs),
        maxResults: MAX_EVENTS,
      })), timeoutMs);
      const events = context && context.privatePayload && Array.isArray(context.privatePayload.events)
        ? context.privatePayload.events : [];
      return buildResult({ operationId, interactionId }, events, startedAt, reviewNowMs);
    } catch (error) {
      throw Object.assign(new Error(error && error.code === 'calendar_review_timeout'
        ? 'La revisión tardó más de lo permitido y se detuvo de forma segura.'
        : 'No se pudo completar la revisión de agenda.'), {
        code: error && error.code || 'calendar_review_failed',
      });
    } finally {
      lock = false;
      if (runtime && typeof runtime.cleanup === 'function') {
        try { runtime.cleanup(); } catch (error) { /* readonly cleanup is best effort */ }
      }
    }
  }
  return Object.freeze({ runCalendarReadonly });
}

module.exports = {
  WORKER_NAME,
  DEFAULT_TIMEOUT_MS,
  MAX_EVENTS,
  createCalendarReadonlyService,
};

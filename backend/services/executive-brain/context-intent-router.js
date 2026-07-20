'use strict';

const REASONS = Object.freeze({
  GMAIL: 'gmail_query',
  CALENDAR: 'calendar_query',
  DASHBOARD: 'dashboard_query',
  MEMORY: 'memory_query',
  APPROVALS: 'approvals_query',
  COMBINED: 'combined_query',
  GENERAL: 'general_query',
});

function normalizeContextQuery(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function includesPhrase(text, phrases) {
  const padded = ` ${text} `;
  return phrases.some((phrase) => padded.includes(` ${phrase} `));
}

function isEducationalQuery(query) {
  return includesPhrase(query, [
    'que es', 'que significa', 'explicame que es', 'define', 'definicion',
    'como funciona', 'que son',
  ]);
}

function isNegatedAction(query) {
  return /\b(?:no|nunca)\s+(?:me\s+)?(?:prepares?|redactes?|crees?|generes?|programes?|agendes?|anadas?|registres?)\b/.test(query);
}

function hasEmailAction(query) {
  return includesPhrase(query, ['prepara', 'preparar', 'redacta', 'redactar', 'crea', 'crear', 'genera', 'generar'])
    && includesPhrase(query, ['borrador', 'respuesta', 'correo', 'email', 'contestacion']);
}

function hasCalendarAction(query) {
  return includesPhrase(query, ['programa', 'programar', 'agenda', 'agendar', 'crea', 'crear', 'propone', 'proponer'])
    && includesPhrase(query, ['reunion', 'cita', 'evento']);
}

function needsEmailActionContext(query) {
  return hasEmailAction(query) && includesPhrase(query, [
    'ultimo correo', 'ultimo email', 'ultimo mensaje', 'mensaje pendiente',
    'correo pendiente', 'email pendiente', 'al correo', 'al email', 'al mensaje',
  ]);
}

function needsCalendarActionContext(query) {
  return hasCalendarAction(query) && includesPhrase(query, [
    'disponibilidad', 'hueco', 'huecos', 'calendario', 'conflicto', 'libre',
  ]);
}

function selectExecutiveContext(query) {
  const normalized = normalizeContextQuery(query);
  const selection = {
    gmail: false,
    calendar: false,
    dashboard: false,
    memory: false,
    approvals: false,
    reason: REASONS.GENERAL,
  };

  if (!normalized || isEducationalQuery(normalized) || isNegatedAction(normalized)) {
    return selection;
  }

  const emailAction = hasEmailAction(normalized);
  const calendarAction = hasCalendarAction(normalized);
  const gmail = needsEmailActionContext(normalized) || (!emailAction && includesPhrase(normalized, [
    'correo', 'correos', 'email', 'emails', 'gmail', 'bandeja', 'mensaje', 'mensajes',
    'remitente', 'remitentes', 'no leido', 'no leidos', 'pendiente de leer',
    'pendientes de leer', 'mensajes importantes', 'correos importantes',
  ]));
  const calendar = needsCalendarActionContext(normalized) || (!calendarAction && includesPhrase(normalized, [
    'agenda', 'calendario', 'reunion', 'reuniones', 'cita', 'citas', 'evento',
    'eventos', 'hoy', 'manana', 'esta semana', 'proximos eventos',
    'proximas reuniones', 'proximos compromisos',
  ]));
  const dashboard = includesPhrase(normalized, [
    'como esta mi dia', 'estado general', 'resumen ejecutivo', 'requiere mi atencion',
    'requieren mi atencion', 'mis prioridades', 'cuales son mis prioridades',
  ]);
  const approvals = includesPhrase(normalized, [
    'aprobacion', 'aprobaciones', 'pendiente de aprobar', 'pendientes de aprobar',
    'que tengo que aprobar', 'propuestas pendientes', 'acciones pendientes',
    'ejecuciones pendientes', 'mis compromisos', 'compromisos pendientes',
  ]) || (includesPhrase(normalized, ['compromiso', 'compromisos'])
    && !includesPhrase(normalized, ['proximo compromiso', 'proximos compromisos']));
  const memory = includesPhrase(normalized, [
    'que recuerdas', 'memoria', 'historial', 'decisiones anteriores',
    'ultimas decisiones', 'lo que hablamos', 'registros recientes',
  ]);

  if (dashboard) {
    selection.dashboard = true;
  } else {
    selection.gmail = gmail;
    selection.calendar = calendar;
  }
  selection.approvals = approvals;
  selection.memory = memory;

  const selected = ['gmail', 'calendar', 'dashboard', 'memory', 'approvals']
    .filter((source) => selection[source]);
  if (selected.length > 1) selection.reason = REASONS.COMBINED;
  else if (selection.gmail) selection.reason = REASONS.GMAIL;
  else if (selection.calendar) selection.reason = REASONS.CALENDAR;
  else if (selection.dashboard) selection.reason = REASONS.DASHBOARD;
  else if (selection.memory) selection.reason = REASONS.MEMORY;
  else if (selection.approvals) selection.reason = REASONS.APPROVALS;

  return selection;
}

module.exports = {
  REASONS,
  normalizeContextQuery,
  selectExecutiveContext,
};

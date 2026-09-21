'use strict';

const REASONS = Object.freeze({
  GMAIL: 'gmail_query',
  CALENDAR: 'calendar_query',
  DASHBOARD: 'dashboard_query',
  MEMORY: 'memory_query',
  APPROVALS: 'approvals_query',
  COMBINED: 'combined_query',
  GENERAL: 'general_query',
  CHITCHAT: 'chitchat_query',
  CAPABILITY: 'capability_query',
  PRIORITIZE: 'prioritize_query',
});

// Pure greeting small talk ("hola", "quien eres"): exact match only (not
// includesPhrase) so a longer sentence that happens to contain one of these
// words, e.g. "ayudame a revisar mi correo", is never misclassified and
// loses its real context selection. This lets the orchestrator answer with
// a natural greeting instead of routing the query into the Knowledge Store
// simulator, which has nothing to match a greeting against and would
// otherwise leak its internal "No se encontraron Knowledge Objects..."
// wording to the user.
const CHITCHAT_QUERIES = new Set([
  'hola', 'buenas', 'buenos dias', 'buenas tardes', 'buenas noches',
  'puedes responder algo', 'quien eres', 'que eres', 'para que sirves',
  'ayudame', 'ayuda',
]);

// V0.4 FASE 2/12: "what can/can't you do" is not small talk — it must be
// answered from the real Capability Registry (capability-registry.js), not
// a static string, or the answer silently goes stale as capabilities are
// added. Same exact-match rationale as CHITCHAT_QUERIES above.
const CAPABILITY_QUERIES = new Set([
  'que puedes hacer', 'que sabes hacer', 'que no puedes hacer todavia',
  'que capacidades tienes', 'que capacidades tienes activas',
]);

// V0.5 FASE 6: "which one should I answer first" only makes sense against
// messages already shown earlier in the same conversation — it never
// triggers its own fresh Gmail fetch. Exact match, same rationale as above:
// this is a narrow, explicitly-recognized phrasing, never a guess.
const PRIORITIZE_QUERIES = new Set([
  'cual deberia responder primero y por que', 'cual deberia responder primero',
  'cual debo responder primero', 'que deberia responder primero',
  'cual es el mas urgente', 'que deberia atender primero',
]);

function isChitchatQuery(query) {
  return CHITCHAT_QUERIES.has(query);
}

function isCapabilityQuery(query) {
  return CAPABILITY_QUERIES.has(query);
}

function isPrioritizeQuery(query) {
  return PRIORITIZE_QUERIES.has(query);
}

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
  // "respondele"/"contestale" are self-contained reply commands (verb +
  // implicit object), unlike "prepara"/"redacta" which need a noun like
  // "respuesta"/"correo" alongside them to mean the same thing.
  if (includesPhrase(query, ['respondele', 'contestale'])) return true;
  return includesPhrase(query, [
    'prepara', 'preparame', 'preparar', 'redacta', 'redactame', 'redactar',
    'crea', 'crear', 'genera', 'generar',
  ])
    && includesPhrase(query, ['borrador', 'respuesta', 'correo', 'email', 'contestacion']);
}

function hasCalendarAction(query) {
  return includesPhrase(query, ['programa', 'programar', 'agenda', 'agendar', 'crea', 'crear', 'propone', 'proponer'])
    && includesPhrase(query, ['reunion', 'cita', 'evento']);
}

function needsEmailActionContext(query) {
  // V0.5: broadened to the conversational reference phrasings the
  // reference-resolver.js also recognizes ("al mas importante", "al
  // primero"...) so a turn like "preparame una respuesta al mas
  // importante" actually fetches Gmail context this turn instead of
  // silently falling through to the Knowledge Store.
  return hasEmailAction(query) && includesPhrase(query, [
    'ultimo correo', 'ultimo email', 'ultimo mensaje', 'mensaje pendiente',
    'correo pendiente', 'email pendiente', 'al correo', 'al email', 'al mensaje',
    'al mas importante', 'al primero', 'al segundo', 'al tercero', 'al ultimo',
    'a ese correo', 'a este correo', 'con ese correo', 'con ese', 'con esa',
    'respondele', 'contestale',
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

  if (isChitchatQuery(normalized)) {
    return { ...selection, reason: REASONS.CHITCHAT };
  }

  if (isCapabilityQuery(normalized)) {
    return { ...selection, reason: REASONS.CAPABILITY };
  }

  if (isPrioritizeQuery(normalized)) {
    return { ...selection, reason: REASONS.PRIORITIZE };
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
    'que esta haciendo oxkio', 'que esta haciendo ahora',
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

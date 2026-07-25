'use strict';

const MAX_BODY = 500;
const MAX_TEXT = 200;
const MAX_ITEMS = 5;

const TYPES = Object.freeze({
  'prepare-email-draft': 'email-draft-preview',
  'prepare-calendar-event': 'calendar-event-preview',
  'review-business': 'business-review-preview',
  'review-knowledge': 'knowledge-review-preview',
  'review-memory': 'memory-review-preview',
});

const TITLES = Object.freeze({
  'email-draft-preview': 'Borrador de correo preparado',
  'calendar-event-preview': 'Evento de calendario preparado',
  'business-review-preview': 'Revisión de negocio preparada',
  'knowledge-review-preview': 'Revisión de conocimiento preparada',
  'memory-review-preview': 'Revisión de memoria preparada',
});

const TECHNICAL_TEXT = /(?:[A-Za-z]:\\|\/Users\/|\/home\/|https?:\/\/|\b(?:worker|operationId|interactionId|executionPayload|payloadHash)\b)/i;

function safeText(value, limit = MAX_TEXT) {
  if (typeof value !== 'string') return '';
  const text = value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text || TECHNICAL_TEXT.test(text)) return '';
  return text.slice(0, limit);
}

function safeList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => safeText(item)).filter(Boolean).slice(0, MAX_ITEMS);
}

function freezeFields(fields) {
  Object.values(fields).forEach((value) => {
    if (Array.isArray(value)) Object.freeze(value);
  });
  return Object.freeze(fields);
}

function result(type, fields, missingFields, risk, summary) {
  const missing = Object.freeze([...missingFields]);
  return Object.freeze({
    status: missing.length === 0 ? 'prepared' : 'not_ready',
    preparationType: type,
    title: type === 'none' ? '' : TITLES[type],
    summary: safeText(summary),
    fields: freezeFields(fields),
    missingFields: missing,
    risk: risk === 'medium' ? 'medium' : 'low',
    requiresApproval: true,
    executionEnabled: false,
  });
}

function unavailable(type = 'none', missingFields = ['proposal'], risk = 'low') {
  return result(type, {}, missingFields, risk, '');
}

function recipientLabel(value) {
  const text = safeText(value);
  if (!text || /(?:no disponible|sin remitente)/i.test(text)) return '';
  const withoutAddress = text.replace(/\s*<[^>]+@[^>]+>\s*/g, '').trim();
  if (withoutAddress && !withoutAddress.includes('@')) return withoutAddress;
  if (/^[^\s@]+@[^\s@]+$/.test(text)) {
    const [local, domain] = text.split('@');
    return `${local.slice(0, 2)}***@${domain.slice(0, 1)}***`;
  }
  return text.includes('@') ? '' : text;
}

function prepareEmail(dashboard, summary, risk) {
  const recent = dashboard.gmail && Array.isArray(dashboard.gmail.recent)
    ? dashboard.gmail.recent : [];
  const message = recent.find((item) => item && typeof item === 'object') || {};
  const recipient = recipientLabel(message.from);
  const subject = safeText(message.subject);
  const context = safeText(summary.recommendation || summary.headline);
  const fields = {};
  const missing = [];
  if (recipient) fields.recipientLabel = recipient;
  else missing.push('recipientLabel');
  if (subject && !/^sin asunto$/i.test(subject)) fields.subjectPreview = `Re: ${subject}`.slice(0, MAX_TEXT);
  else missing.push('subjectPreview');
  if (context && recipient && subject) {
    fields.bodyPreview = safeText(
      `Hola ${recipient}, gracias por tu mensaje sobre “${subject}”. ${context}`,
      MAX_BODY,
    );
  } else {
    missing.push('bodyPreview');
  }
  return result('email-draft-preview', fields, missing, risk, context);
}

function formatDateParts(value) {
  if (typeof value !== 'string' || !value.trim()) return {};
  const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  return match ? { datePreview: match[1], timePreview: match[2] } : {};
}

function duration(start, end) {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return '';
  const minutes = Math.round((endMs - startMs) / 60000);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
}

function prepareCalendar(dashboard, summary, risk) {
  const events = dashboard.agenda && Array.isArray(dashboard.agenda.events)
    ? dashboard.agenda.events : [];
  const event = events.find((item) => item && typeof item === 'object') || {};
  const titlePreview = safeText(event.title);
  const parts = formatDateParts(event.start);
  const fields = {};
  const missing = [];
  if (titlePreview && !/evento sin t[ií]tulo/i.test(titlePreview)) fields.titlePreview = titlePreview;
  else missing.push('titlePreview');
  if (parts.datePreview) fields.datePreview = parts.datePreview;
  else missing.push('datePreview');
  if (parts.timePreview && event.allDay !== true) fields.timePreview = parts.timePreview;
  else missing.push('timePreview');
  const durationPreview = duration(event.start, event.end);
  const locationPreview = safeText(event.location);
  const attendeeLabels = safeList(event.attendeeLabels);
  if (durationPreview) fields.durationPreview = durationPreview;
  if (locationPreview) fields.locationPreview = locationPreview;
  if (attendeeLabels.length) fields.attendeeLabels = attendeeLabels;
  return result(
    'calendar-event-preview',
    fields,
    missing,
    risk,
    summary.recommendation || summary.headline,
  );
}

function firstOperation(dashboard, worker) {
  const operations = dashboard.operations && dashboard.operations.businessHunter;
  const recent = operations && Array.isArray(operations.recentOperations)
    ? operations.recentOperations : [];
  return recent.find((item) => (
    item && item.status === 'completed' && (!worker || item.worker === worker)
  )) || {};
}

function prepareReview(type, dashboard, summary, risk) {
  const fields = {};
  const missing = [];
  let source = {};
  if (type === 'business-review-preview') {
    const operation = firstOperation(dashboard);
    const opportunity = operation.result && Array.isArray(operation.result.opportunities)
      ? operation.result.opportunities[0] : null;
    source = opportunity || {};
    fields.objective = safeText(source.objective || source.title || summary.recommendation);
    const sector = safeText(source.sector);
    const location = safeText(source.location);
    const limits = safeList(source.limits);
    if (sector) fields.sector = sector;
    if (location) fields.location = location;
    if (limits.length) fields.limits = limits;
  } else {
    const worker = type === 'memory-review-preview' ? 'memory-readonly' : 'knowledge-readonly';
    const operation = firstOperation(dashboard, worker);
    source = operation.result || {};
    fields.objective = safeText(source.objective || summary.recommendation);
    const topics = safeList(source.topics);
    const limits = safeList(source.limits);
    if (topics.length) fields.topics = topics;
    if (limits.length) fields.limits = limits;
  }
  if (!fields.objective) missing.push('objective');
  return result(type, fields, missing, risk, summary.headline || fields.objective);
}

function buildExecutiveActionPreparation(input = {}) {
  const proposal = input.proposal;
  const summary = input.executiveSummary;
  const dashboard = input.dashboard;
  if (
    !proposal || proposal.status !== 'proposed'
    || !summary || typeof summary !== 'object'
    || !dashboard || typeof dashboard !== 'object'
  ) return unavailable();

  const type = TYPES[proposal.actionType];
  if (!type) return unavailable();
  const risk = proposal.risk;
  if (type === 'email-draft-preview') return prepareEmail(dashboard, summary, risk);
  if (type === 'calendar-event-preview') return prepareCalendar(dashboard, summary, risk);
  return prepareReview(type, dashboard, summary, risk);
}

module.exports = {
  MAX_BODY,
  MAX_TEXT,
  buildExecutiveActionPreparation,
};

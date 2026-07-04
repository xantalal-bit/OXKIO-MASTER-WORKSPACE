'use strict';

const { analyzeExecutiveQuery } = require('./query-analyzer');
const { searchKnowledge } = require('../knowledge/knowledge-query-service');
const { simulateExecutiveBrainQuery } = require('../knowledge/executive-brain-simulation');
const { preparePrivateContextAdapter } = require('../private-context/private-context-adapter');
const { buildExecutiveResponse } = require('./executive-response-builder');

function shouldUseKnowledgeQuery(analysis) {
  return Boolean(analysis && analysis.project);
}

function buildSimulationQuery(query, analysis) {
  const parts = [
    query,
    analysis && analysis.project ? analysis.project : null,
    analysis && analysis.intent !== 'unknown' ? analysis.intent : null,
    ...(analysis && Array.isArray(analysis.keywords) ? analysis.keywords : []),
  ].filter(Boolean);

  return Array.from(new Set(parts)).join(' ');
}

function normalizeQueryText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function isTemporalAgendaQuery(query, analysis) {
  const normalizedQuery = normalizeQueryText(query);
  const keywords = analysis && Array.isArray(analysis.keywords)
    ? analysis.keywords.map(normalizeQueryText)
    : [];
  const searchableText = `${normalizedQuery} ${keywords.join(' ')}`;

  return [
    'agenda',
    'calendario',
    'calendar',
    'evento',
    'eventos',
    'reunion',
    'reuniones',
    'cita',
    'citas',
    'compromiso',
    'compromisos',
    'hoy',
    'manana',
    'semana',
    'proximas 24',
    'briefing',
  ].some((term) => searchableText.includes(term));
}

function shouldPreferPrivateCalendarContext(query, analysis, authorizedContext) {
  return Boolean(
    authorizedContext
      && authorizedContext.sourceType === 'calendar'
      && isTemporalAgendaQuery(query, analysis),
  );
}

function filterCalendarPrimaryLimitations(limitations) {
  const noisyPatterns = [
    /knowledge store/i,
    /knowledge objects/i,
    /simulation only/i,
    /no ai is used/i,
    /persisted knowledge objects/i,
    /deterministic keyword/i,
  ];

  return Array.isArray(limitations)
    ? limitations.filter((limitation) => !noisyPatterns.some((pattern) => pattern.test(String(limitation))))
    : [];
}

function hasPrivateContextInput(options) {
  return Boolean(options && (
    Object.hasOwn(options, 'privateContextMetadata')
    || Object.hasOwn(options, 'privatePayload')
    || Object.hasOwn(options, 'expectedClientId')
  ));
}

function countPayloadItems(payload) {
  if (Array.isArray(payload)) {
    return payload.length;
  }

  if (!payload || typeof payload !== 'object') {
    return 0;
  }

  const listKeys = [
    'items',
    'events',
    'emails',
    'documents',
    'projects',
    'criticalDates',
    'tasks',
  ];
  const matchedListKey = listKeys.find((key) => Array.isArray(payload[key]));

  return matchedListKey ? payload[matchedListKey].length : Object.keys(payload).length;
}

function buildPrivateContextSummary(authorizedContext) {
  if (authorizedContext.sensitivity === 'critical') {
    return 'Contexto privado autorizado considerado.';
  }

  if (authorizedContext.sourceType === 'calendar') {
    return buildCalendarContextSummary(authorizedContext.payload);
  }

  const itemCount = countPayloadItems(authorizedContext.payload);

  return `Contexto privado autorizado considerado: ${itemCount} elemento(s).`;
}

function formatCalendarEvent(event) {
  const title = event && typeof event.title === 'string' && event.title.trim()
    ? event.title.trim()
    : 'Evento sin titulo';
  const start = event && typeof event.start === 'string' && event.start.trim()
    ? event.start.trim()
    : null;

  if (!start) {
    return title;
  }

  const timeMatch = start.match(/T(\d{2}:\d{2})/);
  const timeText = timeMatch ? timeMatch[1] : start;

  return `${title} a las ${timeText}`;
}

function buildCalendarContextSummary(payload) {
  const events = payload && Array.isArray(payload.events) ? payload.events : [];

  if (events.length === 0) {
    return 'Agenda privada autorizada: no hay eventos en el rango solicitado.';
  }

  const visibleEvents = events.slice(0, 3).map(formatCalendarEvent);
  const hiddenCount = Math.max(events.length - visibleEvents.length, 0);
  const suffix = hiddenCount > 0 ? ` y ${hiddenCount} evento(s) mas.` : '.';
  const eventWord = events.length === 1 ? 'evento' : 'eventos';

  return `Agenda privada autorizada: tienes ${events.length} ${eventWord} hoy: ${visibleEvents.join('; ')}${suffix}`;
}

function sanitizeExecutiveSources(sources) {
  if (!Array.isArray(sources)) {
    return [];
  }

  return sources.map((source) => {
    const sanitized = {};

    [
      'id',
      'name',
      'type',
      'score',
      'rankingPosition',
      'reasons',
    ].forEach((fieldName) => {
      if (source && Object.hasOwn(source, fieldName)) {
        sanitized[fieldName] = source[fieldName];
      }
    });

    return sanitized;
  });
}

function prepareAuthorizedPrivateContext(options, adapter) {
  if (!hasPrivateContextInput(options)) {
    return null;
  }

  const adapterInput = {
    privateContext: options.privateContextMetadata,
    expectedClientId: options.expectedClientId,
    allowedScopes: options.privateContextAllowedScopes,
    requiredPurpose: options.privateContextRequiredPurpose,
  };

  if (Object.hasOwn(options, 'privatePayload')) {
    adapterInput.payload = options.privatePayload;
  }

  return adapter(adapterInput);
}

function orchestrateExecutiveQuery(query, options) {
  const dependencies = options && options.dependencies ? options.dependencies : {};
  const analyzer = dependencies.analyzeExecutiveQuery || analyzeExecutiveQuery;
  const knowledgeSearch = dependencies.searchKnowledge || searchKnowledge;
  const simulator = dependencies.simulateExecutiveBrainQuery || simulateExecutiveBrainQuery;
  const responseBuilder = dependencies.buildExecutiveResponse || buildExecutiveResponse;
  const privateContextAdapter = dependencies.preparePrivateContextAdapter || preparePrivateContextAdapter;
  const authorizedPrivateContext = prepareAuthorizedPrivateContext(options, privateContextAdapter);
  const analysis = analyzer(query);
  let knowledgeQueryResult = null;

  if (shouldUseKnowledgeQuery(analysis)) {
    knowledgeQueryResult = knowledgeSearch(analysis.project, options && options.knowledgeQueryOptions);
  }

  const response = simulator(buildSimulationQuery(query, analysis), options && options.simulationOptions);
  const privateContextSummary = authorizedPrivateContext
    ? buildPrivateContextSummary(authorizedPrivateContext)
    : null;
  const preferPrivateCalendarContext = shouldPreferPrivateCalendarContext(query, analysis, authorizedPrivateContext);
  const responseSources = preferPrivateCalendarContext ? [] : sanitizeExecutiveSources(response.sources);
  const responseLimitations = preferPrivateCalendarContext
    ? filterCalendarPrimaryLimitations(response.limitations)
    : response.limitations;
  const responseConfidence = preferPrivateCalendarContext
    ? Math.max(analysis.confidence, 0.7)
    : response.confidence;
  const executiveResponse = responseBuilder({
    answer: preferPrivateCalendarContext
      ? privateContextSummary
      : (privateContextSummary
        ? `${response.answer} ${privateContextSummary}`
        : response.answer),
    confidence: responseConfidence,
    sources: responseSources,
    reasoningSummary: response.reasoningSummary,
    limitations: responseLimitations,
  });
  const finalConfidence = preferPrivateCalendarContext
    ? executiveResponse.confidence
    : Math.min(analysis.confidence, executiveResponse.confidence);

  return {
    query,
    analysis,
    response: executiveResponse.executiveSummary,
    confidence: finalConfidence,
    sources: sanitizeExecutiveSources(executiveResponse.sources),
    privateContextUsed: Boolean(authorizedPrivateContext),
    limitations: [
      ...executiveResponse.limitations,
      ...(!preferPrivateCalendarContext && knowledgeQueryResult && knowledgeQueryResult.found === false
        ? [`Knowledge Query Service did not find project ${analysis.project}.`]
        : []),
    ],
  };
}

module.exports = {
  orchestrateExecutiveQuery,
  sanitizeExecutiveSources,
};

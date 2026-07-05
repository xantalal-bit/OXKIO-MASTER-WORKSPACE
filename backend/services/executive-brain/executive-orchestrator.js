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

function isEmailQuery(query, analysis) {
  const normalizedQuery = normalizeQueryText(query);
  const keywords = analysis && Array.isArray(analysis.keywords)
    ? analysis.keywords.map(normalizeQueryText)
    : [];
  const searchableText = `${normalizedQuery} ${keywords.join(' ')}`;

  return [
    'correo',
    'correos',
    'email',
    'emails',
    'gmail',
    'inbox',
    'bandeja',
    'mensaje',
    'mensajes',
  ].some((term) => searchableText.includes(term));
}

function shouldPreferPrivateGmailContext(query, analysis, authorizedContext) {
  return Boolean(
    authorizedContext
      && authorizedContext.sourceType === 'gmail'
      && isEmailQuery(query, analysis),
  );
}

function isMixedAgendaEmailQuery(query, analysis) {
  return isTemporalAgendaQuery(query, analysis) && isEmailQuery(query, analysis);
}

function filterPrivatePrimaryLimitations(limitations) {
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

function hasPrivateContextCollectionInput(options) {
  return Boolean(options && Object.hasOwn(options, 'privateContexts'));
}

function buildPrivateContextIdentityMismatchError() {
  const error = new Error('private context identity mismatch.');
  error.code = 'private_context_identity_mismatch';
  return error;
}

function getEffectivePrivateContextValue(privateContextOptions, fieldName, defaults = {}) {
  if (Object.hasOwn(privateContextOptions, fieldName)) {
    return privateContextOptions[fieldName];
  }

  return defaults[fieldName];
}

function validatePrivateContextCollectionIdentity(privateContexts, defaults = {}) {
  if (!Array.isArray(privateContexts) || privateContexts.length <= 1) {
    return;
  }

  const firstContextOptions = privateContexts[0] || {};
  const firstMetadata = firstContextOptions.privateContextMetadata || {};
  const expectedIdentity = {
    clientId: firstMetadata.clientId,
    userId: firstMetadata.userId,
    expectedClientId: getEffectivePrivateContextValue(firstContextOptions, 'expectedClientId', defaults),
    purpose: firstMetadata.purpose,
    promotionPolicy: firstMetadata.promotionPolicy,
  };

  const hasMismatch = privateContexts.some((privateContextOptions = {}) => {
    const metadata = privateContextOptions.privateContextMetadata || {};

    return metadata.clientId !== expectedIdentity.clientId
      || metadata.userId !== expectedIdentity.userId
      || getEffectivePrivateContextValue(
        privateContextOptions,
        'expectedClientId',
        defaults,
      ) !== expectedIdentity.expectedClientId
      || metadata.purpose !== 'executive-briefing'
      || metadata.purpose !== expectedIdentity.purpose
      || metadata.promotionPolicy !== 'NEVER_PROMOTE'
      || metadata.promotionPolicy !== expectedIdentity.promotionPolicy;
  });

  if (hasMismatch) {
    throw buildPrivateContextIdentityMismatchError();
  }
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

  if (authorizedContext.sourceType === 'gmail') {
    return buildGmailContextSummary(authorizedContext.payload);
  }

  const itemCount = countPayloadItems(authorizedContext.payload);

  return `Contexto privado autorizado considerado: ${itemCount} elemento(s).`;
}

function findAuthorizedPrivateContextBySource(authorizedPrivateContexts, sourceType) {
  return Array.isArray(authorizedPrivateContexts)
    ? authorizedPrivateContexts.find((authorizedContext) => (
      authorizedContext && authorizedContext.sourceType === sourceType
    ))
    : null;
}

function buildCombinedPrivateContextSummary(query, analysis, authorizedPrivateContexts) {
  if (!isMixedAgendaEmailQuery(query, analysis)) {
    return null;
  }

  const calendarContext = findAuthorizedPrivateContextBySource(authorizedPrivateContexts, 'calendar');
  const gmailContext = findAuthorizedPrivateContextBySource(authorizedPrivateContexts, 'gmail');

  if (!calendarContext || !gmailContext) {
    return null;
  }

  return [
    buildCalendarContextSummary(calendarContext.payload),
    buildGmailContextSummary(gmailContext.payload),
  ].join(' ');
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

function formatGmailMessage(message) {
  const subject = message && typeof message.subject === 'string' && message.subject.trim()
    ? message.subject.trim()
    : 'Sin asunto';
  const from = message && typeof message.from === 'string' && message.from.trim()
    ? message.from.trim()
    : 'remitente desconocido';

  return `${subject} de ${from}`;
}

function buildGmailContextSummary(payload) {
  const messages = payload && Array.isArray(payload.messages) ? payload.messages : [];

  if (messages.length === 0) {
    return 'Correo privado autorizado: no hay correos recientes en el rango solicitado.';
  }

  const visibleMessages = messages.slice(0, 3).map(formatGmailMessage);
  const hiddenCount = Math.max(messages.length - visibleMessages.length, 0);
  const suffix = hiddenCount > 0 ? ` y ${hiddenCount} correo(s) mas.` : '.';
  const messageWord = messages.length === 1 ? 'correo reciente' : 'correos recientes';
  const bulletMessages = visibleMessages.map((message, index) => {
    const isLastVisibleMessage = index === visibleMessages.length - 1;

    return `- ${message}${isLastVisibleMessage ? suffix : ''}`;
  }).join('\n');

  return `Correo privado autorizado: tienes ${messages.length} ${messageWord}:\n${bulletMessages}`;
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

function prepareAuthorizedPrivateContext(options, adapter, defaults = {}) {
  if (!hasPrivateContextInput(options)) {
    return null;
  }

  const adapterInput = {
    privateContext: options.privateContextMetadata,
    expectedClientId: Object.hasOwn(options, 'expectedClientId')
      ? options.expectedClientId
      : defaults.expectedClientId,
    allowedScopes: Object.hasOwn(options, 'privateContextAllowedScopes')
      ? options.privateContextAllowedScopes
      : defaults.privateContextAllowedScopes,
    requiredPurpose: Object.hasOwn(options, 'privateContextRequiredPurpose')
      ? options.privateContextRequiredPurpose
      : defaults.privateContextRequiredPurpose,
  };

  if (Object.hasOwn(options, 'privatePayload')) {
    adapterInput.payload = options.privatePayload;
  }

  return adapter(adapterInput);
}

function prepareAuthorizedPrivateContexts(options, adapter) {
  if (hasPrivateContextCollectionInput(options)) {
    if (!Array.isArray(options.privateContexts)) {
      throw new TypeError('privateContexts must be an array.');
    }

    const defaults = {
      expectedClientId: options.expectedClientId,
      privateContextAllowedScopes: options.privateContextAllowedScopes,
      privateContextRequiredPurpose: options.privateContextRequiredPurpose,
    };

    validatePrivateContextCollectionIdentity(options.privateContexts, defaults);

    return options.privateContexts.map((privateContextOptions) => prepareAuthorizedPrivateContext(
      privateContextOptions,
      adapter,
      defaults,
    ));
  }

  const authorizedPrivateContext = prepareAuthorizedPrivateContext(options, adapter);

  return authorizedPrivateContext ? [authorizedPrivateContext] : [];
}

function selectPrimaryPrivateContext(query, analysis, authorizedPrivateContexts) {
  if (!Array.isArray(authorizedPrivateContexts) || authorizedPrivateContexts.length === 0) {
    return null;
  }

  return authorizedPrivateContexts.find((authorizedContext) => (
    shouldPreferPrivateCalendarContext(query, analysis, authorizedContext)
    || shouldPreferPrivateGmailContext(query, analysis, authorizedContext)
  )) || authorizedPrivateContexts[0];
}

function orchestrateExecutiveQuery(query, options) {
  const dependencies = options && options.dependencies ? options.dependencies : {};
  const analyzer = dependencies.analyzeExecutiveQuery || analyzeExecutiveQuery;
  const knowledgeSearch = dependencies.searchKnowledge || searchKnowledge;
  const simulator = dependencies.simulateExecutiveBrainQuery || simulateExecutiveBrainQuery;
  const responseBuilder = dependencies.buildExecutiveResponse || buildExecutiveResponse;
  const privateContextAdapter = dependencies.preparePrivateContextAdapter || preparePrivateContextAdapter;
  const authorizedPrivateContexts = prepareAuthorizedPrivateContexts(options, privateContextAdapter);
  const analysis = analyzer(query);
  const authorizedPrivateContext = selectPrimaryPrivateContext(query, analysis, authorizedPrivateContexts);
  let knowledgeQueryResult = null;

  if (shouldUseKnowledgeQuery(analysis)) {
    knowledgeQueryResult = knowledgeSearch(analysis.project, options && options.knowledgeQueryOptions);
  }

  const response = simulator(buildSimulationQuery(query, analysis), options && options.simulationOptions);
  const combinedPrivateContextSummary = buildCombinedPrivateContextSummary(
    query,
    analysis,
    authorizedPrivateContexts,
  );
  const privateContextSummary = authorizedPrivateContext
    ? buildPrivateContextSummary(authorizedPrivateContext)
    : null;
  const preferPrivateCalendarContext = shouldPreferPrivateCalendarContext(query, analysis, authorizedPrivateContext);
  const preferPrivateGmailContext = shouldPreferPrivateGmailContext(query, analysis, authorizedPrivateContext);
  const preferCombinedPrivateContext = Boolean(combinedPrivateContextSummary);
  const preferPrivateContext = preferCombinedPrivateContext
    || preferPrivateCalendarContext
    || preferPrivateGmailContext;
  const responseSources = preferPrivateContext ? [] : sanitizeExecutiveSources(response.sources);
  const responseLimitations = preferCombinedPrivateContext
    ? []
    : (preferPrivateContext
    ? filterPrivatePrimaryLimitations(response.limitations)
    : response.limitations);
  const responseConfidence = preferPrivateContext
    ? Math.max(analysis.confidence, 0.7)
    : response.confidence;
  const executiveResponse = responseBuilder({
    answer: preferPrivateContext
      ? (combinedPrivateContextSummary || privateContextSummary)
      : (privateContextSummary
        ? `${response.answer} ${privateContextSummary}`
        : response.answer),
    confidence: responseConfidence,
    sources: responseSources,
    reasoningSummary: response.reasoningSummary,
    limitations: responseLimitations,
  });
  const finalConfidence = preferPrivateContext
    ? executiveResponse.confidence
    : Math.min(analysis.confidence, executiveResponse.confidence);

  return {
    query,
    analysis,
    response: executiveResponse.executiveSummary,
    confidence: finalConfidence,
    sources: sanitizeExecutiveSources(executiveResponse.sources),
    privateContextUsed: authorizedPrivateContexts.length > 0,
    limitations: [
      ...executiveResponse.limitations,
      ...(!preferPrivateContext && knowledgeQueryResult && knowledgeQueryResult.found === false
        ? [`Knowledge Query Service did not find project ${analysis.project}.`]
        : []),
    ],
  };
}

module.exports = {
  orchestrateExecutiveQuery,
  prepareAuthorizedPrivateContexts,
  sanitizeExecutiveSources,
};

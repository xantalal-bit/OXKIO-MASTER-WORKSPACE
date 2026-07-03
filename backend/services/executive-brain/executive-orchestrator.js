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

  const itemCount = countPayloadItems(authorizedContext.payload);

  return `Contexto privado autorizado considerado: ${itemCount} elemento(s).`;
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
  const executiveResponse = responseBuilder({
    answer: privateContextSummary
      ? `${response.answer} ${privateContextSummary}`
      : response.answer,
    confidence: response.confidence,
    sources: sanitizeExecutiveSources(response.sources),
    reasoningSummary: response.reasoningSummary,
    limitations: response.limitations,
  });

  return {
    query,
    analysis,
    response: executiveResponse.executiveSummary,
    confidence: Math.min(analysis.confidence, executiveResponse.confidence),
    sources: sanitizeExecutiveSources(executiveResponse.sources),
    privateContextUsed: Boolean(authorizedPrivateContext),
    limitations: [
      ...executiveResponse.limitations,
      ...(knowledgeQueryResult && knowledgeQueryResult.found === false
        ? [`Knowledge Query Service did not find project ${analysis.project}.`]
        : []),
    ],
  };
}

module.exports = {
  orchestrateExecutiveQuery,
  sanitizeExecutiveSources,
};

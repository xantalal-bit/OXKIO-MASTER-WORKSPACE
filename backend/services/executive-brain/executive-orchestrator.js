'use strict';

const { analyzeExecutiveQuery } = require('./query-analyzer');
const { searchKnowledge } = require('../knowledge/knowledge-query-service');
const { simulateExecutiveBrainQuery } = require('../knowledge/executive-brain-simulation');
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

function orchestrateExecutiveQuery(query, options) {
  const dependencies = options && options.dependencies ? options.dependencies : {};
  const analyzer = dependencies.analyzeExecutiveQuery || analyzeExecutiveQuery;
  const knowledgeSearch = dependencies.searchKnowledge || searchKnowledge;
  const simulator = dependencies.simulateExecutiveBrainQuery || simulateExecutiveBrainQuery;
  const responseBuilder = dependencies.buildExecutiveResponse || buildExecutiveResponse;
  const analysis = analyzer(query);
  let knowledgeQueryResult = null;

  if (shouldUseKnowledgeQuery(analysis)) {
    knowledgeQueryResult = knowledgeSearch(analysis.project, options && options.knowledgeQueryOptions);
  }

  const response = simulator(buildSimulationQuery(query, analysis), options && options.simulationOptions);
  const executiveResponse = responseBuilder({
    answer: response.answer,
    confidence: response.confidence,
    sources: response.sources,
    reasoningSummary: response.reasoningSummary,
    limitations: response.limitations,
  });

  return {
    query,
    analysis,
    response: executiveResponse.executiveSummary,
    confidence: Math.min(analysis.confidence, executiveResponse.confidence),
    sources: executiveResponse.sources,
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
};

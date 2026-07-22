'use strict';

const { recommendSupervisedOperation } = require('./supervised-decision-engine');

const ALLOWED_STEPS = new Set([
  'business-analysis-readonly',
  'knowledge-review-readonly',
]);
const MAX_STEPS = 3;

function splitRequest(query) {
  return String(query || '')
    .split(/\b(?:y\s+despu[eé]s|despu[eé]s|luego|a\s+continuaci[oó]n|y)\b/iu)
    .map((part) => part.trim())
    .filter(Boolean);
}

function decisionQuery(part) {
  const normalized = String(part || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return /\b(?:que\s+sabemos|sabemos\s+sobre)\b/u.test(normalized) ? `conocimiento ${part}` : part;
}

function buildPlan(steps) {
  return Object.freeze({
    steps: Object.freeze(steps.slice(0, MAX_STEPS)),
    requiresConfirmation: true,
  });
}

function planOperations(input = {}, dependencies = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return buildPlan([]);
  if (Object.keys(input).some((key) => !['query', 'analysis'].includes(key))) return buildPlan([]);

  const query = typeof input.query === 'string' ? input.query.trim() : '';
  const analysis = input.analysis && typeof input.analysis === 'object' && !Array.isArray(input.analysis)
    ? input.analysis
    : {};
  if (!query) return buildPlan([]);

  const decide = dependencies.recommendSupervisedOperation || recommendSupervisedOperation;
  const parts = splitRequest(query);
  const candidates = parts.length > 1 ? parts : [query];
  const steps = [];

  candidates.forEach((part) => {
    const recommendation = decide({ query: decisionQuery(part), analysis });
    const step = recommendation && recommendation.decision;
    if (ALLOWED_STEPS.has(step) && !steps.includes(step) && steps.length < MAX_STEPS) steps.push(step);
  });

  return buildPlan(steps);
}

module.exports = { MAX_STEPS, planOperations };

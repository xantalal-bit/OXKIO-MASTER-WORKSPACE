'use strict';

const DECISIONS = Object.freeze({
  BUSINESS: 'business-analysis-readonly',
  KNOWLEDGE: 'knowledge-review-readonly',
  NONE: 'none',
});

const CONFIDENCE = new Set(['high', 'medium', 'low']);
const BUSINESS_TERMS = Object.freeze([
  'cliente', 'clientes', 'empresa', 'empresas', 'oportunidad', 'oportunidades',
  'captacion', 'ventas', 'mercado', 'analisis comercial',
]);
const KNOWLEDGE_TERMS = Object.freeze([
  'conocimiento', 'biblioteca', 'documentacion', 'informacion', 'aprendizaje',
  'temas', 'estado del conocimiento',
]);
const EXCLUDED_TERMS = Object.freeze([
  'hola', 'buenos dias', 'buenas tardes', 'gmail', 'correo', 'correos',
  'calendar', 'calendario', 'agenda', 'reunion', 'reuniones',
]);

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matches(normalized, terms) {
  return terms.filter((term) => normalized.includes(term));
}

function buildDecision(decision, reason, confidence) {
  return Object.freeze({
    decision,
    reason: String(reason).slice(0, 160),
    confidence: CONFIDENCE.has(confidence) ? confidence : 'low',
    requiresConfirmation: true,
  });
}

function recommendSupervisedOperation(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return buildDecision(DECISIONS.NONE, 'No hay una petición suficientemente clara.', 'low');
  }
  const allowedKeys = new Set(['query', 'analysis']);
  if (Object.keys(input).some((key) => !allowedKeys.has(key))) {
    return buildDecision(DECISIONS.NONE, 'La petición no cumple el contrato de decisión.', 'low');
  }

  const normalized = normalizeText(input.query);
  const analysis = input.analysis && typeof input.analysis === 'object' && !Array.isArray(input.analysis)
    ? input.analysis
    : {};
  if (!normalized || matches(normalized, EXCLUDED_TERMS).length > 0) {
    return buildDecision(DECISIONS.NONE, 'No hace falta iniciar una operación especializada.', 'high');
  }

  const businessMatches = matches(normalized, BUSINESS_TERMS);
  const knowledgeMatches = matches(normalized, KNOWLEDGE_TERMS);
  if (analysis.project === 'Business Hunter' && !businessMatches.includes('analisis comercial')) {
    businessMatches.push('business hunter');
  }
  if (['documentation', 'learning'].includes(analysis.intent) && knowledgeMatches.length === 0) {
    knowledgeMatches.push(analysis.intent);
  }
  if (knowledgeMatches.length === 1 && knowledgeMatches[0] === 'informacion') {
    knowledgeMatches.length = 0;
  }

  if (businessMatches.length > 0 && knowledgeMatches.length > 0) {
    return buildDecision(DECISIONS.NONE, 'La petición puede corresponder a más de una revisión.', 'low');
  }
  if (businessMatches.length > 0) {
    return buildDecision(
      DECISIONS.BUSINESS,
      'La petición busca información comercial que puede revisarse en modo preparatorio.',
      businessMatches.length > 1 ? 'high' : 'medium',
    );
  }
  if (knowledgeMatches.length > 0) {
    return buildDecision(
      DECISIONS.KNOWLEDGE,
      'La petición puede resolverse revisando el conocimiento disponible.',
      knowledgeMatches.length > 1 ? 'high' : 'medium',
    );
  }
  return buildDecision(DECISIONS.NONE, 'No hay una operación especializada claramente indicada.', 'low');
}

module.exports = { DECISIONS, recommendSupervisedOperation };

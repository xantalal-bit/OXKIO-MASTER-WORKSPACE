'use strict';

const projectRules = [
  {
    project: 'Learning Heroes',
    keywords: ['learning heroes', 'learning-heroes', 'learningheroes'],
  },
  {
    project: 'Business Hunter',
    keywords: ['business hunter', 'business-hunter'],
  },
  {
    project: 'Profesor IA',
    keywords: ['profesor ia', 'profesor-ia', 'profesor inteligencia artificial'],
  },
  {
    project: 'Oxkio',
    keywords: ['oxkio'],
  },
  {
    project: 'XANTALAL',
    keywords: ['xantalal'],
  },
];

const intentRules = [
  {
    intent: 'tasks',
    documentTypes: ['Meeting', 'Roadmap', 'Notes', 'Governance'],
    keywords: ['tarea', 'tareas', 'pendiente', 'pendientes', 'hacer', 'accion', 'acciones', 'next steps'],
    priority: 'high',
  },
  {
    intent: 'decisions',
    documentTypes: ['Governance', 'Meeting', 'Notes'],
    keywords: ['decision', 'decisiones', 'decidir', 'aprobado', 'pendiente de decision'],
    priority: 'high',
  },
  {
    intent: 'roadmap',
    documentTypes: ['Roadmap'],
    keywords: ['roadmap', 'fase', 'hito', 'plan', 'prioridad', 'estado'],
    priority: 'medium',
  },
  {
    intent: 'documentation',
    documentTypes: ['Documentation'],
    keywords: ['documentacion', 'documentation', 'docs', 'readme', 'guia', 'manual'],
    priority: 'medium',
  },
  {
    intent: 'governance',
    documentTypes: ['Governance'],
    keywords: ['governance', 'gobierno', 'regla', 'reglas', 'estandar', 'politica'],
    priority: 'high',
  },
  {
    intent: 'learning',
    documentTypes: ['Learning'],
    keywords: ['learning', 'curso', 'modulo', 'leccion', 'training', 'aprendizaje'],
    priority: 'medium',
  },
];

const stopWords = new Set([
  'a',
  'al',
  'con',
  'de',
  'del',
  'el',
  'en',
  'la',
  'las',
  'lo',
  'los',
  'para',
  'por',
  'que',
  'sobre',
  'un',
  'una',
  'y',
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

function findProject(normalizedQuery) {
  const matchedRule = projectRules.find((rule) => (
    rule.keywords.some((keyword) => normalizedQuery.includes(normalizeText(keyword)))
  ));

  return matchedRule ? matchedRule.project : null;
}

function findIntentMatches(normalizedQuery) {
  return intentRules
    .map((rule) => {
      const matches = rule.keywords.filter((keyword) => (
        normalizedQuery.includes(normalizeText(keyword))
      ));

      return {
        ...rule,
        matches,
      };
    })
    .filter((rule) => rule.matches.length > 0)
    .sort((left, right) => right.matches.length - left.matches.length);
}

function extractKeywords(normalizedQuery, project, intentMatches) {
  const projectTerms = project ? normalizeText(project).split(/\s+/) : [];
  const intentTerms = intentMatches.flatMap((match) => (
    match.matches.flatMap((keyword) => normalizeText(keyword).split(/\s+/))
  ));
  const ignoredTerms = new Set([...projectTerms, ...intentTerms]);

  return Array.from(new Set(
    normalizedQuery
      .split(/\s+/)
      .filter((term) => term.length > 2)
      .filter((term) => !stopWords.has(term))
      .filter((term) => !ignoredTerms.has(term)),
  ));
}

function buildFilters(project, documentTypes, intent) {
  return {
    project,
    documentTypes,
    intent,
  };
}

function calculateConfidence({ project, intentMatches, keywords }) {
  let confidence = 0.35;

  if (project) {
    confidence += 0.2;
  }

  if (intentMatches.length > 0) {
    confidence += 0.25;
  }

  if (keywords.length > 0) {
    confidence += 0.1;
  }

  if (intentMatches.length > 1) {
    confidence += 0.05;
  }

  return Number(Math.min(confidence, 0.95).toFixed(2));
}

function analyzeExecutiveQuery(query) {
  const normalizedQuery = normalizeText(query);
  const project = findProject(normalizedQuery);
  const intentMatches = findIntentMatches(normalizedQuery);
  const primaryIntent = intentMatches.length > 0 ? intentMatches[0] : null;
  const intent = primaryIntent ? primaryIntent.intent : 'unknown';
  const documentTypes = Array.from(new Set(
    intentMatches.length > 0
      ? intentMatches.flatMap((match) => match.documentTypes)
      : [],
  ));
  const keywords = extractKeywords(normalizedQuery, project, intentMatches);
  const priority = intentMatches.some((match) => match.priority === 'high')
    ? 'high'
    : (primaryIntent ? primaryIntent.priority : 'normal');

  return {
    intent,
    project,
    documentTypes,
    keywords,
    filters: buildFilters(project, documentTypes, intent),
    priority,
    confidence: calculateConfidence({ project, intentMatches, keywords }),
  };
}

module.exports = {
  analyzeExecutiveQuery,
};

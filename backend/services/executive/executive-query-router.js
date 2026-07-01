'use strict';

function normalizeQuery(message = '') {
  return String(message || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchExecutiveQuery(message) {
  const normalized = normalizeQuery(message);

  if ([
    'hola',
    'buenos dias',
    'buenas tardes',
    'buenas noches',
    'buenas',
  ].includes(normalized)) {
    return 'greeting';
  }

  if (normalized.includes('hago hoy') ||
    normalized.includes('tengo que hacer hoy') ||
    normalized.includes('plan de hoy') ||
    normalized.includes('prioridades de hoy')) {
    return 'morningBriefing';
  }

  if (normalized.includes('conoces de mi') ||
    normalized.includes('sabes de mi') ||
    normalized === 'que conoces' ||
    normalized.includes('conoces sobre mi')) {
    return 'knowledgeInventory';
  }

  if (normalized === 'proyectos' ||
    normalized.includes('proyectos prioritarios') ||
    normalized.includes('proyectos requieren atencion') ||
    normalized.includes('proyectos tengo') ||
    normalized.includes('estado de proyectos') ||
    normalized.includes('prioridades de proyectos')) {
    return 'projects';
  }

  if (normalized.startsWith('busca ') ||
    normalized.startsWith('buscar ') ||
    normalized.startsWith('localizar ') ||
    normalized.startsWith('encuentra ') ||
    normalized.startsWith('donde esta ')) {
    return 'knowledgeSearch';
  }

  return 'unknown';
}

module.exports = {
  matchExecutiveQuery,
};

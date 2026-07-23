'use strict';

const MAX_HEADLINE = 180;
const MAX_PRIORITY = 160;
const MAX_RECOMMENDATION = 180;
const MAX_PRIORITIES = 3;

const TECHNICAL_TEXT = /(?:[A-Za-z]:\\|\/Users\/|\/home\/|https?:\/\/|bearer\s+|private[_-]?key|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\b(?:worker|sourceStatus|operationId|interactionId|executionEnabled)\b|[\w-]+-readonly)/i;

function safeText(value, limit) {
  if (typeof value !== 'string') return '';
  const text = value
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text || TECHNICAL_TEXT.test(text)) return '';
  return text.slice(0, limit);
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : 0;
}

function normalize(value) {
  return safeText(value, MAX_PRIORITY)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function addUnique(items, seen, value) {
  const text = safeText(value, MAX_PRIORITY);
  const key = normalize(text);
  if (!text || !key || seen.has(key)) return;
  seen.add(key);
  items.push(text);
}

function addSource(sources, name) {
  if (!sources.includes(name)) sources.push(name);
}

function calendarSignals(input, priorities, seen, sources) {
  const agenda = input.agenda;
  if (!agenda || agenda.available !== true || !Array.isArray(agenda.events) || agenda.events.length === 0) return;
  const first = agenda.events.find((event) => event && typeof event === 'object') || {};
  const title = safeText(first.title, 80);
  addUnique(
    priorities,
    seen,
    title
      ? `Próximo compromiso: ${title}.`
      : `${Math.min(10, agenda.events.length)} compromisos próximos en agenda.`,
  );
  addSource(sources, 'Agenda');
}

function gmailSignals(input, priorities, seen, sources) {
  const gmail = input.gmail;
  if (!gmail || gmail.available !== true) return;
  const unread = nonNegativeInteger(gmail.unread);
  const important = nonNegativeInteger(gmail.important);
  if (unread + important === 0) return;
  addUnique(
    priorities,
    seen,
    important > 0
      ? `${important} ${important === 1 ? 'asunto importante' : 'asuntos importantes'} y ${unread} ${unread === 1 ? 'correo no leído' : 'correos no leídos'} requieren atención.`
      : `${unread} ${unread === 1 ? 'correo no leído requiere' : 'correos no leídos requieren'} revisión.`,
  );
  addSource(sources, 'Correo');
}

function operationSignals(input, priorities, seen, sources) {
  const operations = input.operations;
  const recent = operations && Array.isArray(operations.recentOperations)
    ? operations.recentOperations
    : [];
  recent.forEach((operation) => {
    if (!operation || typeof operation !== 'object') return;
    if (operation.status === 'failed') {
      addUnique(priorities, seen, 'Hay una revisión reciente que no pudo completarse.');
      addSource(sources, 'Operaciones');
      return;
    }
    if (operation.status === 'completed_with_warnings' || operation.sourceStatus === 'partial') {
      addUnique(priorities, seen, 'Hay una revisión reciente con información parcial.');
      addSource(sources, 'Operaciones');
    }
  });
}

function usefulSignals(input, priorities, seen, sources) {
  const operations = input.operations;
  const recent = operations && Array.isArray(operations.recentOperations)
    ? operations.recentOperations
    : [];
  recent.forEach((operation) => {
    if (!operation || operation.status !== 'completed' || !operation.result) return;
    const result = operation.result;
    if (Array.isArray(result.opportunities) && result.opportunities.length > 0) {
      const opportunity = result.opportunities[0] || {};
      const title = safeText(opportunity.title, 100);
      addUnique(priorities, seen, title ? `Oportunidad útil: ${title}.` : 'Hay una oportunidad útil pendiente de revisión.');
      addSource(sources, 'Business');
    }
    if (Array.isArray(result.topics) && result.topics.length > 0) {
      const topic = safeText(result.topics[0], 100);
      addUnique(priorities, seen, topic ? `Conocimiento útil: ${topic}.` : 'Hay conocimiento útil disponible para revisión.');
      addSource(sources, operation.worker === 'memory-readonly' ? 'Memoria' : 'Conocimiento');
    }
  });

  const memoryCount = input.memory && input.memory.counters
    ? nonNegativeInteger(input.memory.counters.shortTermItems)
    : 0;
  if (memoryCount > 0) {
    addUnique(priorities, seen, `${memoryCount} señales recientes están disponibles en memoria.`);
    addSource(sources, 'Memoria');
  }

  const ecosystemCount = input.ecosystem && input.ecosystem.ecosystem
    ? nonNegativeInteger(input.ecosystem.ecosystem.items)
    : 0;
  if (ecosystemCount > 0) {
    addUnique(priorities, seen, `${ecosystemCount} elementos útiles de conocimiento están disponibles.`);
    addSource(sources, 'Conocimiento');
  }
}

function recommendationFor(priorities, sources) {
  if (priorities.length === 0) return 'Revisar la disponibilidad de información antes de tomar decisiones.';
  if (sources.includes('Agenda')) return 'Atender primero el próximo compromiso y después revisar los asuntos pendientes.';
  if (sources.includes('Correo')) return 'Revisar primero los asuntos importantes antes de continuar con otras tareas.';
  if (sources.includes('Operaciones')) return 'Resolver primero las revisiones incompletas antes de tomar nuevas decisiones.';
  return 'Revisar la primera prioridad antes de iniciar nuevas acciones.';
}

function headlineFor(priorities, sources) {
  if (priorities.length === 0) return 'No hay información suficiente para generar un resumen ejecutivo.';
  if (sources.includes('Agenda') && sources.includes('Correo')) {
    return 'La agenda y los asuntos pendientes concentran la atención ejecutiva del momento.';
  }
  if (sources.includes('Agenda')) return 'Los próximos compromisos marcan la prioridad ejecutiva.';
  if (sources.includes('Correo')) return 'Los asuntos pendientes requieren atención ejecutiva.';
  return 'Hay información útil que conviene revisar antes de avanzar.';
}

function buildExecutiveFusion(input = {}) {
  const priorities = [];
  const sourcesUsed = [];
  const seen = new Set();
  calendarSignals(input, priorities, seen, sourcesUsed);
  gmailSignals(input, priorities, seen, sourcesUsed);
  operationSignals(input, priorities, seen, sourcesUsed);
  usefulSignals(input, priorities, seen, sourcesUsed);
  const limitedPriorities = priorities.slice(0, MAX_PRIORITIES);
  const status = sourcesUsed.length === 0
    ? 'unavailable'
    : sourcesUsed.length === 1
      ? 'partial'
      : 'ready';
  const generatedAt = typeof input.generatedAt === 'string' && Number.isFinite(Date.parse(input.generatedAt))
    ? new Date(input.generatedAt).toISOString()
    : null;

  return Object.freeze({
    status,
    headline: safeText(headlineFor(limitedPriorities, sourcesUsed), MAX_HEADLINE),
    priorities: Object.freeze(limitedPriorities),
    recommendation: safeText(recommendationFor(limitedPriorities, sourcesUsed), MAX_RECOMMENDATION),
    sourcesUsed: Object.freeze(sourcesUsed),
    generatedAt,
  });
}

module.exports = {
  MAX_HEADLINE,
  MAX_PRIORITIES,
  buildExecutiveFusion,
};

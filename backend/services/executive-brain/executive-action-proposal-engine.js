'use strict';

const MAX_TITLE = 90;
const MAX_REASON = 180;

const ACTIONS = Object.freeze({
  'prepare-email-draft': Object.freeze({
    title: 'Preparar una respuesta de correo para revisión',
    reason: 'Hay un asunto de correo prioritario que requiere atención.',
    risk: 'medium',
  }),
  'prepare-calendar-event': Object.freeze({
    title: 'Preparar la organización de un compromiso',
    reason: 'Hay un compromiso próximo que requiere organización.',
    risk: 'medium',
  }),
  'review-business': Object.freeze({
    title: 'Revisar la prioridad comercial',
    reason: 'El resumen identifica una prioridad comercial concreta.',
    risk: 'low',
  }),
  'review-knowledge': Object.freeze({
    title: 'Revisar el conocimiento disponible',
    reason: 'El resumen identifica una falta concreta de conocimiento.',
    risk: 'low',
  }),
  'review-memory': Object.freeze({
    title: 'Revisar el contexto histórico relevante',
    reason: 'El resumen identifica contexto previo relevante para la decisión.',
    risk: 'low',
  }),
});

const TECHNICAL_TEXT = /(?:[A-Za-z]:\\|\/Users\/|\/home\/|https?:\/\/|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\b(?:worker|sourceStatus|operationId|interactionId|executionPayload|payloadHash)\b)/i;

function safeText(value, limit) {
  if (typeof value !== 'string') return '';
  const text = value
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text || TECHNICAL_TEXT.test(text)) return '';
  return text.slice(0, limit);
}

function normalize(value) {
  return safeText(value, MAX_REASON)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function hasSource(summary, source) {
  return Array.isArray(summary.sourcesUsed) && summary.sourcesUsed.includes(source);
}

function detectActionType(summary) {
  const priorities = Array.isArray(summary.priorities) ? summary.priorities : [];

  for (const priority of priorities) {
    const text = normalize(priority);
    if (!text) continue;
    const detected = new Set();

    if (
      hasSource(summary, 'Correo')
      && /(?:correo|mensaje|asunto)/.test(text)
      && /(?:prioritari|important|pendient|requiere atencion)/.test(text)
    ) {
      detected.add('prepare-email-draft');
    }
    if (
      hasSource(summary, 'Agenda')
      && /(?:compromiso|reunion|agenda)/.test(text)
      && /(?:organiz|coordin|prepar|program|agendar)/.test(text)
    ) {
      detected.add('prepare-calendar-event');
    }
    if (
      hasSource(summary, 'Business')
      && /(?:comercial|negocio|oportunidad)/.test(text)
    ) {
      detected.add('review-business');
    }
    if (
      hasSource(summary, 'Conocimiento')
      && /(?:falta|insuficient|sin informacion|necesita conocimiento)/.test(text)
    ) {
      detected.add('review-knowledge');
    }
    if (
      hasSource(summary, 'Memoria')
      && /(?:memoria|histor|contexto previo|antecedente)/.test(text)
    ) {
      detected.add('review-memory');
    }

    if (detected.size > 1) return null;
    if (detected.size === 1) return [...detected][0];
  }

  return null;
}

function noneProposal() {
  return Object.freeze({
    status: 'none',
    actionType: 'none',
    title: '',
    reason: '',
    risk: 'low',
    requiresApproval: true,
    executionEnabled: false,
  });
}

function buildExecutiveActionProposal(summary) {
  if (
    !summary
    || typeof summary !== 'object'
    || !['ready', 'partial'].includes(summary.status)
  ) {
    return noneProposal();
  }

  const actionType = detectActionType(summary);
  if (!actionType) return noneProposal();

  const action = ACTIONS[actionType];
  return Object.freeze({
    status: 'proposed',
    actionType,
    title: safeText(action.title, MAX_TITLE),
    reason: safeText(action.reason, MAX_REASON),
    risk: action.risk,
    requiresApproval: true,
    executionEnabled: false,
  });
}

module.exports = {
  MAX_REASON,
  MAX_TITLE,
  buildExecutiveActionProposal,
};

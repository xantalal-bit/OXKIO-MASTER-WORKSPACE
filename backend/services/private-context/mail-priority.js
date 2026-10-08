'use strict';

// V0.5 FASE 6 wired this into executive-orchestrator.js:buildPrioritizationAnswer
// (called for context-intent-router.js's PRIORITIZE_QUERIES set, e.g. "cual
// deberia responder primero") — it is live in production, not just a future
// foundation. classifyMailPriority is intentionally a pure function over the
// two signals Gmail context already exposes (see gmail-private-provider.js),
// so it never needs new Gmail API scopes, never persists anything, and never
// modifies or labels real messages.
const MAIL_PRIORITY_LEVELS = Object.freeze([
  'urgent',
  'important',
  'review',
  'informational',
  'noise',
]);

function classifyMailPriority(message) {
  const important = Boolean(message && message.important);
  const unread = Boolean(message && message.unread);
  if (important && unread) return 'urgent';
  if (important) return 'important';
  if (unread) return 'review';
  return 'informational';
}

// V3 local analysis (06/10/2026): the same classification over the signals
// V3 keeps, extended explicitly and only here, so Executive Chat keeps its
// behaviour. A star is the person's own mark of importance; Gmail's
// promotions and social categories are noise unless the person starred them.
// Unread alone stays "review", never "urgent".
const NOISE_CATEGORIES = new Set(['promotions', 'social']);

function classifyMailSignals(signals) {
  const s = signals || {};
  if (NOISE_CATEGORIES.has(s.category) && !s.starred) return 'noise';
  return classifyMailPriority({ important: Boolean(s.important || s.starred), unread: Boolean(s.unread) });
}

// Moved unchanged from executive-orchestrator.js so V3 can reuse it.
function extractSenderName(from) {
  const match = String(from || '').match(/^([^<]+)</);
  return match ? match[1].trim() : String(from || 'remitente desconocido').trim();
}

module.exports = {
  MAIL_PRIORITY_LEVELS,
  classifyMailPriority,
  classifyMailSignals,
  extractSenderName,
};

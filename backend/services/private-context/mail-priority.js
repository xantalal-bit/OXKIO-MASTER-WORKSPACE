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

module.exports = {
  MAIL_PRIORITY_LEVELS,
  classifyMailPriority,
};

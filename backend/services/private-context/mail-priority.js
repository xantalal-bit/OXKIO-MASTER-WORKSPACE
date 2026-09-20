'use strict';

// Minimal foundation for a future personal mail-priority feature (V0.2
// scope: base type only, not a classification engine). Nothing calls this
// yet — Gmail summaries and the chat UI keep using only sender/subject/date/
// unread/important, unchanged. classifyMailPriority is intentionally a pure
// function over the two signals Gmail context already exposes (see
// gmail-private-provider.js), so it never needs new Gmail API scopes, never
// persists anything, and never modifies or labels real messages.
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

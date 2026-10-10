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

// P2 (10/10/2026, sixth real mission): a LinkedIn message from a person
// (social) was noise and a Railway newsletter marked important became the
// first action. Two closed signals separate a person writing from bulk mail:
// - directMessage: the subject is a platform's "X sent you a message"
//   notice (closed phrases below). Outside promotions it is never noise, and
//   Gmail's important mark keeps counting for it.
// - bulk: the message carries List-Unsubscribe (RFC 2369), the header bulk
//   senders add. Gmail's important mark alone does not make it a priority;
//   the person's own star still does.
const DIRECT_MESSAGE_SUBJECTS = [
  /\b(?:acaba de enviarte|te ha enviado|te envió) un (?:nuevo )?mensaje\b/i,
  /\bsent you a (?:new )?message\b/i,
];

function isDirectMessageSubject(subject) {
  return typeof subject === 'string' && DIRECT_MESSAGE_SUBJECTS.some((pattern) => pattern.test(subject));
}

const isDirect = (s) => s.directMessage === true && s.category !== 'promotions';

// P2 bulk detection (10/10/2026, targeted real check): the real Railway
// newsletter (hello@news.railway.app, updates, important) carries no
// List-Unsubscribe header. Second closed signal, metadata only:
// - automatedSender: the sender address has a whole token news, newsletter(s)
//   or digest, in its local part (split on . _ + -) or in a subdomain label.
//   noreply/no-reply alone is not one: it is also how invoices and receipts
//   arrive.
// - it counts as bulk only together with a Gmail category that holds
//   automated mail (updates, social, promotions), never in primary.
// A direct message keeps precedence over it, as over List-Unsubscribe.
const AUTOMATED_SENDER_TOKENS = new Set(['news', 'newsletter', 'newsletters', 'digest']);
const AUTOMATED_CATEGORIES = new Set(['updates', 'social', 'promotions']);

function isAutomatedSenderAddress(from) {
  const text = String(from || '');
  const bracketed = text.match(/<([^<>]+)>\s*$/);
  const address = (bracketed ? bracketed[1] : text).trim().toLowerCase();
  const match = address.match(/^([^@\s]+)@([^@\s]+)$/);
  if (!match) return false;
  const subdomains = match[2].split('.').slice(0, -2);
  return [...match[1].split(/[._+-]/), ...subdomains].some((token) => AUTOMATED_SENDER_TOKENS.has(token));
}

const isBulk = (s) => s.bulk === true || (s.automatedSender === true && AUTOMATED_CATEGORIES.has(s.category));

// Whether Gmail's important mark counts for these signals.
function countsAsImportant(signals) {
  const s = signals || {};
  return s.important === true && (isDirect(s) || !isBulk(s));
}

function classifyMailSignals(signals) {
  const s = signals || {};
  if (NOISE_CATEGORIES.has(s.category) && !s.starred && !isDirect(s)) return 'noise';
  return classifyMailPriority({ important: countsAsImportant(s) || Boolean(s.starred), unread: Boolean(s.unread) });
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
  countsAsImportant,
  isDirectMessageSubject,
  isAutomatedSenderAddress,
  extractSenderName,
};

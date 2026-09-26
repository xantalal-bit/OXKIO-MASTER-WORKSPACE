'use strict';

const { createHmac, randomBytes } = require('crypto');
const { getCapability } = require('../executive-brain/capability-registry');

// Manual user feedback ("esto está mal", "sí deberías poder hacerlo"...) as
// Quality Incidents. Simple deterministic rules, no LLM. Feedback CREATES or
// UPDATES an incident and nothing else: it never changes policy, enables a
// capability, changes permissions, triggers a repair or executes anything.
// A user can be wrong; a human decides.

const FEEDBACK_CATEGORIES = Object.freeze({
  wrong: Object.freeze({ type: 'USER_COMPLAINT', summary: 'Un usuario indicó que la respuesta está mal.' }),
  not_working: Object.freeze({ type: 'USER_COMPLAINT', summary: 'Un usuario indicó que algo no funciona.' }),
  should_be_able: Object.freeze({ type: 'CAPABILITY_MISMATCH', summary: 'Un usuario indicó que OXKIO debería poder hacerlo.' }),
  misunderstood: Object.freeze({ type: 'WRONG_RESPONSE', summary: 'Un usuario indicó que OXKIO no entendió la petición.' }),
  incorrect_result: Object.freeze({ type: 'WRONG_RESPONSE', summary: 'Un usuario indicó un resultado incorrecto.' }),
  other: Object.freeze({ type: 'USER_COMPLAINT', summary: 'Un usuario reportó otra incidencia.' }),
});

// The chat payload carries capabilityComposition.primaryCapability as a
// supervised-decision id; these map it to the Capability Registry id. Unknown
// values are ignored (never trusted, never stored).
const COMPOSITION_TO_CAPABILITY = Object.freeze({
  'gmail-review-readonly': 'gmail.read',
  'prepare-email-draft': 'gmail.draft',
  'calendar-review-readonly': 'calendar.read',
  'memory-review-readonly': 'memory.search',
  'knowledge-review-readonly': 'memory.search',
});

const FEEDBACK_KEYS = new Set(['category', 'relatedCapability', 'shortSummary']);
const DEFAULT_PRIORITY = 'P2';
// Objective escalation criterion: the same cause reported by several
// distinct reporter-days. Never P0 from a complaint.
const ESCALATE_TO_P1_AT = 3;
const REPORTER_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_REPORTS_PER_REPORTER_PER_WINDOW = 20;
const MAX_TRACKED_KEYS = 5000;

function feedbackError(code, statusCode = 400) {
  const error = new TypeError(code);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function resolveCapability(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) return null;
  const id = Object.hasOwn(COMPOSITION_TO_CAPABILITY, value) ? COMPOSITION_TO_CAPABILITY[value] : value;
  return getCapability(id) ? id : null;
}

// Contrast the claim "OXKIO should be able to do this" with the real
// Capability Registry: only an AVAILABLE capability is a mismatch; anything
// else is a governance question for a human.
function classify(category, capabilityId) {
  const base = FEEDBACK_CATEGORIES[category];
  if (category !== 'should_be_able') {
    return { type: base.type, summary: base.summary, requiresHumanDecision: false };
  }
  const capability = capabilityId ? getCapability(capabilityId) : null;
  if (capability && capability.available === true) {
    return { type: 'CAPABILITY_MISMATCH', summary: base.summary, requiresHumanDecision: false };
  }
  if (capability) {
    return { type: 'POLICY_GAP', summary: 'Un usuario pidió una capacidad que hoy no está aprobada.', requiresHumanDecision: true };
  }
  return { type: 'USER_COMPLAINT', summary: base.summary, requiresHumanDecision: true };
}

function createQualityFeedbackService({ registry, now = () => Date.now(), reporterKey = randomBytes(32) } = {}) {
  if (!registry || typeof registry.report !== 'function' || typeof registry.findByCause !== 'function') {
    throw new TypeError('QualityIncidentRegistry is required.');
  }
  // Per-process, in-memory only: an HMAC of the reporter id with a random
  // key, never persisted, never exposed, never part of an incident. It only
  // prevents one person from inflating a count or flooding the registry.
  const lastCountedAt = new Map();
  const reportTimes = new Map();

  const reporterToken = (reporterId) => createHmac('sha256', reporterKey).update(String(reporterId)).digest('hex');

  function prune(map, current) {
    if (map.size <= MAX_TRACKED_KEYS) return;
    for (const [key, value] of map) {
      const latest = Array.isArray(value) ? value[value.length - 1] : value;
      if (current - latest > REPORTER_WINDOW_MS) map.delete(key);
    }
  }

  function submit(input, { reporterId } = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw feedbackError('QUALITY_FEEDBACK_INVALID');
    for (const key of Object.keys(input)) {
      if (!FEEDBACK_KEYS.has(key)) throw feedbackError('QUALITY_FEEDBACK_UNEXPECTED_FIELD');
    }
    if (!Object.hasOwn(FEEDBACK_CATEGORIES, input.category)) throw feedbackError('QUALITY_FEEDBACK_INVALID_CATEGORY');
    if (typeof reporterId !== 'string' || reporterId.length === 0) throw feedbackError('QUALITY_FEEDBACK_REPORTER_REQUIRED', 403);
    if (input.shortSummary !== undefined && input.shortSummary !== null && typeof input.shortSummary !== 'string') {
      throw feedbackError('QUALITY_FEEDBACK_INVALID');
    }

    const current = now();
    const token = reporterToken(reporterId);
    const recent = (reportTimes.get(token) || []).filter((time) => current - time < REPORTER_WINDOW_MS);
    if (recent.length >= MAX_REPORTS_PER_REPORTER_PER_WINDOW) throw feedbackError('QUALITY_FEEDBACK_RATE_LIMITED', 429);
    recent.push(current);
    reportTimes.set(token, recent);
    prune(reportTimes, current);

    const relatedCapability = resolveCapability(input.relatedCapability);
    const { type, summary, requiresHumanDecision } = classify(input.category, relatedCapability);
    const cause = {
      type,
      component: `user-feedback.${input.category}`,
      errorCode: null,
      relatedCapability,
    };
    const userSummary = typeof input.shortSummary === 'string' ? input.shortSummary.trim() : '';

    // The same reporter repeating the same cause within the window does not
    // inflate occurrenceCount: 10 users = 10, one user x10 = 1.
    const causeKey = `${token}|${type}|${cause.component}|${relatedCapability || '-'}`;
    const counted = lastCountedAt.get(causeKey);
    const existing = registry.findByCause(cause);
    if (existing && counted !== undefined && current - counted < REPORTER_WINDOW_MS) {
      return { accepted: true, counted: false };
    }

    const nextCount = existing ? existing.occurrenceCount + 1 : 1;
    const escalate = nextCount >= ESCALATE_TO_P1_AT && type !== 'POLICY_GAP';
    registry.report({
      type,
      priority: escalate ? 'P1' : DEFAULT_PRIORITY,
      component: cause.component,
      summary: userSummary || summary,
      ...(relatedCapability ? { relatedCapability } : {}),
      ...(requiresHumanDecision ? { requiresHumanDecision: true } : {}),
    });
    lastCountedAt.set(causeKey, current);
    prune(lastCountedAt, current);
    return { accepted: true, counted: true };
  }

  return Object.freeze({ submit });
}

module.exports = {
  COMPOSITION_TO_CAPABILITY,
  ESCALATE_TO_P1_AT,
  FEEDBACK_CATEGORIES,
  createQualityFeedbackService,
};

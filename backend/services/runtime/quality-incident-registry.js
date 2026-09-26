'use strict';

const { assertRepository } = require('../../repositories/repository-contracts');

// Quality Incident Registry: the single owner of important failures, wrong
// answers, complaints and repairs. It only RECORDS: it never repairs, retries,
// changes policy, permissions, spend or the execution flag. A repair (human or
// automatic) happens elsewhere and is merely declared here via resolve().
//
// An incident is deliberately compact: fixed enums, identifiers and short
// fixed-wording sentences. Prompts, conversations, email content, identities,
// secrets and stack traces never belong here; text that looks private is
// rejected with a fixed code instead of being stored.

const INCIDENT_TYPES = Object.freeze({
  TECHNICAL_BUG: 'TECHNICAL_BUG',
  RUNTIME_FAILURE: 'RUNTIME_FAILURE',
  CAPABILITY_MISMATCH: 'CAPABILITY_MISMATCH',
  WRONG_RESPONSE: 'WRONG_RESPONSE',
  USER_COMPLAINT: 'USER_COMPLAINT',
  UX_FRICTION: 'UX_FRICTION',
  INTEGRATION_FAILURE: 'INTEGRATION_FAILURE',
  REGRESSION: 'REGRESSION',
  POLICY_GAP: 'POLICY_GAP',
  REPAIR_FAILURE: 'REPAIR_FAILURE',
  OTHER: 'OTHER',
});

// P0 CRITICAL: STOP / human gate. P1 HIGH: repair first. P2 NORMAL: next
// backlog. P3 LOW: can wait. Lower number = more urgent.
const PRIORITIES = Object.freeze(['P0', 'P1', 'P2', 'P3']);

const STATUSES = Object.freeze({
  OPEN: 'OPEN',
  IN_PROGRESS: 'IN_PROGRESS',
  RESOLVED: 'RESOLVED',
  WONT_FIX: 'WONT_FIX',
});

const RESOLVERS = Object.freeze(['human', 'automatic']);

// Used only when the caller does not state a priority. Never escalated by
// occurrence count alone: recurrence is shown in the summary, a human decides.
const DEFAULT_PRIORITY = Object.freeze({
  TECHNICAL_BUG: 'P2',
  RUNTIME_FAILURE: 'P2',
  CAPABILITY_MISMATCH: 'P1',
  WRONG_RESPONSE: 'P2',
  USER_COMPLAINT: 'P2',
  UX_FRICTION: 'P3',
  INTEGRATION_FAILURE: 'P2',
  REGRESSION: 'P1',
  POLICY_GAP: 'P1',
  REPAIR_FAILURE: 'P1',
  OTHER: 'P3',
});

// Types whose resolution always needs a human: a policy gap is a governance
// decision, and a user's opinion is never turned into a rule automatically.
const HUMAN_ONLY_TYPES = new Set(['POLICY_GAP', 'USER_COMPLAINT', 'WRONG_RESPONSE']);

// The only repairs an automatic resolver may declare: already contemplated,
// reversible, and without new permissions, spend, autonomy or policy.
const AUTO_REPAIR_KINDS = Object.freeze([
  'safe_retry',
  'known_fallback',
  'non_destructive_reinit',
  'format_repair',
  'approved_technical_fix',
  'safe_self_revert',
]);

const REPORT_KEYS = new Set([
  'type', 'priority', 'summary', 'component', 'requiresHumanDecision',
  'errorCode', 'relatedCapability', 'repairId', 'relatedIncidentId',
]);
const RESOLVE_KEYS = new Set(['resolution', 'prevention', 'resolvedBy', 'repairKind', 'repairId']);

const IDENTIFIER_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/;
const INCIDENT_ID_PATTERN = /^QI-\d{1,9}$/;
const MAX_TEXT_LENGTH = 160;
// Same family of markers executionLogger.js rejects, plus long digit runs and
// credential-looking assignments.
const SENSITIVE_TEXT_PATTERN = /(?:[A-Za-z]:\\|\/Users\/|\/home\/|-----BEGIN|bearer\s+|private[_-]?key|api[_-]?key|password|secret\s*[:=]|token\s*[:=]|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\b\+?\d[\d .()-]{7,}\d\b|\bat\s+\S+\s*\(|https?:\/\/)/i;
const DEFAULT_MAX_INCIDENTS = 500;
const SUMMARY_LIST_LIMIT = 5;

function fail(code) {
  const error = new TypeError(code);
  error.code = code;
  throw error;
}

function isPlainObject(value) {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function assertKnownKeys(input, allowed) {
  if (!isPlainObject(input)) fail('QUALITY_INVALID_INPUT');
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) fail('QUALITY_UNEXPECTED_FIELD');
  }
}

function identifier(value, { optional = false } = {}) {
  if (value === undefined || value === null) {
    if (optional) return null;
    fail('QUALITY_INVALID_IDENTIFIER');
  }
  if (typeof value !== 'string' || !IDENTIFIER_PATTERN.test(value)) fail('QUALITY_INVALID_IDENTIFIER');
  return value;
}

function shortText(value, { optional = false } = {}) {
  if (value === undefined || value === null) {
    if (optional) return null;
    fail('QUALITY_INVALID_TEXT');
  }
  if (typeof value !== 'string') fail('QUALITY_INVALID_TEXT');
  const text = value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text || text.length > MAX_TEXT_LENGTH) fail('QUALITY_INVALID_TEXT');
  if (SENSITIVE_TEXT_PATTERN.test(text)) fail('QUALITY_SENSITIVE_TEXT');
  return text;
}

function priorityRank(priority) {
  return PRIORITIES.indexOf(priority);
}

// Stable categories only (type, component, errorCode, capability): never the
// summary or any other free text, so private text cannot become an identity.
function fingerprintOf({ type, component, errorCode, relatedCapability }) {
  return [type, component, errorCode || '-', relatedCapability || '-'].join('|');
}

function cloneIncident(incident) {
  return Object.freeze({ ...incident });
}

function compactIncident(incident) {
  return Object.freeze({
    id: incident.id,
    type: incident.type,
    priority: incident.priority,
    status: incident.status,
    summary: incident.summary,
    component: incident.component,
    occurrenceCount: incident.occurrenceCount,
    lastSeenAt: incident.lastSeenAt,
    requiresHumanDecision: incident.requiresHumanDecision,
  });
}

function isActive(incident) {
  return incident.status === STATUSES.OPEN || incident.status === STATUSES.IN_PROGRESS;
}

function byUrgency(left, right) {
  return priorityRank(left.priority) - priorityRank(right.priority)
    || right.occurrenceCount - left.occurrenceCount
    || String(right.lastSeenAt).localeCompare(String(left.lastSeenAt));
}

class QualityIncidentRegistry {
  // repository: optional { loadSnapshot, saveSnapshot } (same snapshot shape
  // as the other local repositories). Without it the registry is in-memory
  // only and does not survive a restart.
  constructor({ repository = null, now = () => new Date().toISOString(), maxIncidents = DEFAULT_MAX_INCIDENTS } = {}) {
    this.repository = repository ? assertRepository(repository, 'QualityIncidentRepository') : null;
    this.now = now;
    this.maxIncidents = Number.isInteger(maxIncidents) && maxIncidents > 0 ? maxIncidents : DEFAULT_MAX_INCIDENTS;
    this.incidents = new Map();
    this.byFingerprint = new Map();
    this.sequence = 0;
    this.load();
  }

  get persistence() {
    return this.repository ? 'repository' : 'memory_only';
  }

  report(input) {
    assertKnownKeys(input, REPORT_KEYS);
    const type = input.type;
    if (!Object.hasOwn(INCIDENT_TYPES, type)) fail('QUALITY_INVALID_TYPE');
    const priority = input.priority === undefined ? DEFAULT_PRIORITY[type] : input.priority;
    if (!PRIORITIES.includes(priority)) fail('QUALITY_INVALID_PRIORITY');
    if (input.requiresHumanDecision !== undefined && typeof input.requiresHumanDecision !== 'boolean') {
      fail('QUALITY_INVALID_INPUT');
    }
    const fields = {
      type,
      priority,
      summary: shortText(input.summary),
      component: identifier(input.component),
      errorCode: identifier(input.errorCode, { optional: true }),
      relatedCapability: identifier(input.relatedCapability, { optional: true }),
      repairId: identifier(input.repairId, { optional: true }),
      relatedIncidentId: null,
    };
    let related = null;
    if (type === INCIDENT_TYPES.REPAIR_FAILURE) {
      related = this.incidents.get(input.relatedIncidentId);
      if (!related) fail('QUALITY_RELATED_INCIDENT_REQUIRED');
      fields.relatedIncidentId = related.id;
    } else if (input.relatedIncidentId !== undefined) {
      if (!this.incidents.has(input.relatedIncidentId)) fail('QUALITY_UNKNOWN_INCIDENT');
      fields.relatedIncidentId = input.relatedIncidentId;
    }
    // P0 always stops at a human gate; policy gaps are governance decisions.
    const requiresHumanDecision = input.requiresHumanDecision === true
      || priority === 'P0' || type === INCIDENT_TYPES.POLICY_GAP;

    const fingerprint = fingerprintOf(fields);
    const timestamp = this.now();
    const existingId = this.byFingerprint.get(fingerprint);
    const existing = existingId ? this.incidents.get(existingId) : null;
    let incident;
    if (existing) {
      incident = {
        ...existing,
        lastSeenAt: timestamp,
        occurrenceCount: existing.occurrenceCount + 1,
        // Raised to the most urgent report seen, never lowered here.
        priority: priorityRank(priority) < priorityRank(existing.priority) ? priority : existing.priority,
        requiresHumanDecision: existing.requiresHumanDecision || requiresHumanDecision,
      };
      if (existing.status === STATUSES.RESOLVED) {
        // Same stable cause came back: reopen, keeping the last resolution and
        // prevention as the audit of what did not hold.
        incident.status = STATUSES.OPEN;
        incident.reopenCount = existing.reopenCount + 1;
      }
    } else {
      if (this.incidents.size >= this.maxIncidents && !this.evictOneClosed()) fail('QUALITY_REGISTRY_FULL');
      this.sequence += 1;
      incident = {
        id: `QI-${this.sequence}`,
        fingerprint,
        ...fields,
        status: STATUSES.OPEN,
        firstSeenAt: timestamp,
        lastSeenAt: timestamp,
        occurrenceCount: 1,
        reopenCount: 0,
        resolution: null,
        prevention: null,
        resolvedBy: null,
        resolvedAt: null,
        requiresHumanDecision,
      };
    }
    const changes = [incident];
    // A repair that produced another failure must never be retried
    // automatically: the original incident goes back to a human.
    if (related) {
      changes.push({
        ...related,
        status: isActive(related) ? related.status : STATUSES.OPEN,
        requiresHumanDecision: true,
      });
    }
    this.commit(changes);
    return cloneIncident(incident);
  }

  markInProgress(id) {
    const incident = this.getActive(id);
    this.commit([{ ...incident, status: STATUSES.IN_PROGRESS }]);
    return cloneIncident(this.incidents.get(id));
  }

  resolve(id, input) {
    assertKnownKeys(input, RESOLVE_KEYS);
    const incident = this.getActive(id);
    const resolvedBy = input.resolvedBy;
    if (!RESOLVERS.includes(resolvedBy)) fail('QUALITY_INVALID_RESOLVER');
    if (resolvedBy === 'automatic') {
      if (incident.requiresHumanDecision || HUMAN_ONLY_TYPES.has(incident.type)) {
        fail('QUALITY_HUMAN_DECISION_REQUIRED');
      }
      if (!AUTO_REPAIR_KINDS.includes(input.repairKind)) fail('QUALITY_AUTO_REPAIR_NOT_ALLOWED');
    } else if (input.repairKind !== undefined) {
      fail('QUALITY_UNEXPECTED_FIELD');
    }
    const resolved = {
      ...incident,
      status: STATUSES.RESOLVED,
      resolution: shortText(input.resolution),
      prevention: shortText(input.prevention),
      resolvedBy,
      resolvedAt: this.now(),
      repairId: identifier(input.repairId, { optional: true }) || incident.repairId,
    };
    this.commit([resolved]);
    return cloneIncident(resolved);
  }

  // Deciding not to fix is always a human decision.
  markWontFix(id, input) {
    assertKnownKeys(input, new Set(['resolution']));
    const incident = this.getActive(id);
    const closed = {
      ...incident,
      status: STATUSES.WONT_FIX,
      resolution: shortText(input.resolution),
      resolvedBy: 'human',
      resolvedAt: this.now(),
    };
    this.commit([closed]);
    return cloneIncident(closed);
  }

  get(id) {
    const incident = this.incidents.get(id);
    return incident ? cloneIncident(incident) : null;
  }

  list() {
    return Object.freeze([...this.incidents.values()].map(cloneIncident));
  }

  // Compact direction view: what is urgent, what recurs, what was repaired,
  // and what is waiting for José Antonio.
  summary() {
    const all = [...this.incidents.values()];
    const active = all.filter(isActive);
    const openByPriority = Object.fromEntries(PRIORITIES.map((priority) => [
      priority,
      Object.freeze(active.filter((incident) => incident.priority === priority)
        .sort(byUrgency).map(compactIncident)),
    ]));
    return Object.freeze({
      persistence: this.persistence,
      totals: Object.freeze({
        total: all.length,
        active: active.length,
        resolved: all.filter((incident) => incident.status === STATUSES.RESOLVED).length,
        wontFix: all.filter((incident) => incident.status === STATUSES.WONT_FIX).length,
      }),
      openByPriority: Object.freeze(openByPriority),
      topRecurring: Object.freeze(all.slice()
        .sort((left, right) => right.occurrenceCount - left.occurrenceCount || byUrgency(left, right))
        .slice(0, SUMMARY_LIST_LIMIT).map(compactIncident)),
      recentlyResolved: Object.freeze(all.filter((incident) => incident.status === STATUSES.RESOLVED)
        .sort((left, right) => String(right.resolvedAt).localeCompare(String(left.resolvedAt)))
        .slice(0, SUMMARY_LIST_LIMIT)
        .map((incident) => Object.freeze({
          ...compactIncident(incident),
          resolution: incident.resolution,
          prevention: incident.prevention,
          resolvedBy: incident.resolvedBy,
        }))),
      pendingHumanDecision: Object.freeze(active.filter((incident) => incident.requiresHumanDecision)
        .sort(byUrgency).map(compactIncident)),
    });
  }

  getActive(id) {
    if (typeof id !== 'string' || !INCIDENT_ID_PATTERN.test(id)) fail('QUALITY_UNKNOWN_INCIDENT');
    const incident = this.incidents.get(id);
    if (!incident) fail('QUALITY_UNKNOWN_INCIDENT');
    if (!isActive(incident)) fail('QUALITY_INCIDENT_CLOSED');
    return incident;
  }

  evictOneClosed() {
    const closed = [...this.incidents.values()]
      .filter((incident) => !isActive(incident))
      .sort((left, right) => String(left.lastSeenAt).localeCompare(String(right.lastSeenAt)));
    if (closed.length === 0) return false;
    this.incidents.delete(closed[0].id);
    this.byFingerprint.delete(closed[0].fingerprint);
    return true;
  }

  commit(changes) {
    for (const incident of changes) {
      this.incidents.set(incident.id, Object.freeze(incident));
      this.byFingerprint.set(incident.fingerprint, incident.id);
    }
    if (!this.repository) return;
    try {
      this.repository.saveSnapshot({ sequence: this.sequence, incidents: [...this.incidents.values()] });
    } catch (error) {
      // In-memory state is kept; the caller learns only a fixed code.
      fail('QUALITY_PERSISTENCE_FAILED');
    }
  }

  load() {
    if (!this.repository) return;
    let snapshot;
    try {
      snapshot = this.repository.loadSnapshot();
    } catch (error) {
      fail('QUALITY_PERSISTENCE_FAILED');
    }
    const stored = snapshot && Array.isArray(snapshot.incidents) ? snapshot.incidents : [];
    for (const incident of stored) {
      if (!isPlainObject(incident) || typeof incident.id !== 'string' || !INCIDENT_ID_PATTERN.test(incident.id)
        || !Object.hasOwn(INCIDENT_TYPES, incident.type) || !PRIORITIES.includes(incident.priority)
        || !Object.hasOwn(STATUSES, incident.status) || typeof incident.fingerprint !== 'string') {
        continue;
      }
      this.incidents.set(incident.id, Object.freeze({ ...incident }));
      this.byFingerprint.set(incident.fingerprint, incident.id);
      this.sequence = Math.max(this.sequence, Number(incident.id.slice(3)));
    }
    if (snapshot && Number.isSafeInteger(snapshot.sequence)) this.sequence = Math.max(this.sequence, snapshot.sequence);
  }
}

// One-line rendering for direction: "QI-3 P1 OPEN x8 — summary".
function formatQualitySummary(summary) {
  const line = (incident) => `${incident.id} ${incident.priority} ${incident.status} x${incident.occurrenceCount} — ${incident.summary}`;
  const lines = [];
  for (const priority of PRIORITIES) {
    const items = summary.openByPriority[priority];
    lines.push(`${priority} abiertos: ${items.length}`);
    for (const incident of items) lines.push(`  ${line(incident)}`);
  }
  lines.push(`Pendientes de decisión humana: ${summary.pendingHumanDecision.length}`);
  for (const incident of summary.pendingHumanDecision) lines.push(`  ${line(incident)}`);
  lines.push('Más recurrentes:');
  for (const incident of summary.topRecurring) lines.push(`  ${line(incident)}`);
  lines.push('Reparadas recientemente:');
  for (const incident of summary.recentlyResolved) {
    lines.push(`  ${line(incident)} | ${incident.resolution} | Prevención: ${incident.prevention}`);
  }
  return lines.join('\n');
}

module.exports = {
  AUTO_REPAIR_KINDS,
  DEFAULT_PRIORITY,
  INCIDENT_TYPES,
  PRIORITIES,
  STATUSES,
  QualityIncidentRegistry,
  formatQualitySummary,
};

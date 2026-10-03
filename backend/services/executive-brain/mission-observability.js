'use strict';

// XATAI CORE V2 (03/10/2026): what the Mission Engine leaves behind — a
// compact execution trace, structured Quality Loop incidents and a minimal
// memory record. All three accept only identifiers and enums: objectives,
// email bodies, prompts, secrets and tokens never get here.

const TRACE_FIELDS = Object.freeze([
  'missionId', 'taskId', 'coordinator', 'agent', 'action', 'decision',
  'evidenceRef', 'verification', 'status', 'timestamp',
]);
const TRACE_VALUE_PATTERN = /^[A-Za-z0-9:_.#-]{1,128}$/;
const DEFAULT_TRACE_LIMIT = 500;

function fail(code) {
  const error = new TypeError(code);
  error.code = code;
  throw error;
}

function traceValue(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !TRACE_VALUE_PATTERN.test(value)) fail('TRACE_INVALID_FIELD');
  return value;
}

// In-memory bounded trace. sink (optional) receives each frozen entry, e.g.
// an adapter onto executionLogger; nothing is persisted by default.
function createMissionTrace({ now = () => new Date().toISOString(), limit = DEFAULT_TRACE_LIMIT, sink = null } = {}) {
  const entries = [];
  return Object.freeze({
    record(input = {}) {
      const unknown = Object.keys(input).filter((key) => !TRACE_FIELDS.includes(key));
      if (unknown.length > 0) fail('TRACE_UNEXPECTED_FIELD');
      if (!input.missionId) fail('TRACE_INVALID_FIELD');
      const entry = Object.freeze(Object.fromEntries(TRACE_FIELDS.map((field) => [
        field, field === 'timestamp' ? (input.timestamp || now()) : traceValue(input[field]),
      ])));
      entries.push(entry);
      if (entries.length > limit) entries.shift();
      if (typeof sink === 'function') sink(entry);
      return entry;
    },
    list(missionId = null) {
      return entries.filter((entry) => !missionId || entry.missionId === missionId);
    },
  });
}

// Structured Quality Loop codes. Only real system problems are incidents; a
// user who has not answered yet, a connection not authorized yet or a normal
// human gate are expected states and are never reported.
const MISSION_QUALITY_CODES = Object.freeze({
  agent_unavailable: Object.freeze({ type: 'RUNTIME_FAILURE', summary: 'Un agente asignado no pudo atender su tarea.' }),
  routing_impossible: Object.freeze({ type: 'CAPABILITY_MISMATCH', summary: 'Ninguna capacidad disponible puede atender una tarea planificada.' }),
  repeated_failure: Object.freeze({ type: 'RUNTIME_FAILURE', summary: 'Una tarea falló de forma repetida y se escaló a una persona.' }),
  verifier_failure: Object.freeze({ type: 'WRONG_RESPONSE', summary: 'El verificador rechazó el resultado de una tarea.' }),
  mission_failed: Object.freeze({ type: 'RUNTIME_FAILURE', summary: 'Una misión terminó en fallo.', priority: 'P1' }),
  capability_mismatch: Object.freeze({ type: 'CAPABILITY_MISMATCH', summary: 'Una capacidad marcada como disponible no respondió como se esperaba.' }),
});
const NON_INCIDENT_CODES = Object.freeze(['needs_information', 'needs_connection', 'needs_approval']);

function createMissionQualityReporter(registry) {
  return Object.freeze({
    // Returns the incident, or null when nothing is reported (no registry,
    // an expected human state, or a registry that refused the input).
    report(code, { relatedCapability = null } = {}) {
      if (!registry || typeof registry.report !== 'function') return null;
      if (NON_INCIDENT_CODES.includes(code) || !Object.hasOwn(MISSION_QUALITY_CODES, code)) return null;
      const spec = MISSION_QUALITY_CODES[code];
      try {
        return registry.report({
          type: spec.type,
          ...(spec.priority ? { priority: spec.priority } : {}),
          summary: spec.summary,
          component: 'mission-engine',
          errorCode: `mission.${code}`,
          relatedCapability: relatedCapability || undefined,
        });
      } catch (error) {
        return null;
      }
    },
  });
}

// Memory: only the mission outcome, structured decisions, safe operational
// learnings (codes), failure/repair pairs and explicit preferences. The
// objective text and every task output stay out.
const PREFERENCE_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;

function buildMissionMemoryRecord(state) {
  const preferences = (state.explicitPreferences || [])
    .filter((item) => item && PREFERENCE_PATTERN.test(item.key || '') && PREFERENCE_PATTERN.test(item.value || ''))
    .map((item) => Object.freeze({ key: item.key, value: item.value }));
  return Object.freeze({
    kind: 'xatai_mission_outcome',
    missionId: state.missionId,
    blueprintId: state.blueprintId || null,
    finalState: state.engine.state,
    verdict: state.verification ? state.verification.verdict : null,
    decisions: Object.freeze(state.tasks.map((item) => Object.freeze({
      taskId: item.taskId, agentId: item.assignedAgent, status: item.status, decision: item.gate.decision, reason: item.gate.reason,
    }))),
    repairs: Object.freeze(state.revisions.map((revision) => Object.freeze({
      taskId: revision.taskId, cause: revision.cause, action: revision.action,
    }))),
    learnings: Object.freeze([...new Set(state.tasks
      .filter((item) => item.status !== 'COMPLETED')
      .map((item) => item.gate.reason)
      .filter(Boolean))]),
    preferences: Object.freeze(preferences),
  });
}

// Adapter onto the existing MemoryEngine (saveLongTerm). PARTIAL: the engine
// has no per-user scope or schema of its own, so it is never wired by
// default; a caller must opt in explicitly.
function createMissionMemoryAdapter(memoryEngine) {
  if (!memoryEngine || typeof memoryEngine.saveLongTerm !== 'function') {
    return Object.freeze({ status: 'PARTIAL', save: () => null });
  }
  return Object.freeze({
    status: 'PARTIAL',
    save(state) {
      const record = buildMissionMemoryRecord(state);
      memoryEngine.saveLongTerm(record);
      return record;
    },
  });
}

module.exports = {
  MISSION_QUALITY_CODES,
  NON_INCIDENT_CODES,
  TRACE_FIELDS,
  buildMissionMemoryRecord,
  createMissionMemoryAdapter,
  createMissionQualityReporter,
  createMissionTrace,
};

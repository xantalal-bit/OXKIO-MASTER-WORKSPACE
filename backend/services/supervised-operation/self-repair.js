'use strict';
const { freeze } = require('./scope-session');
// Governed self-repair: DETECT (executor error) -> DIAGNOSE (sanitized code)
// -> CLASSIFY (failure class) -> CHANGE STRATEGY / RETRY (existing Convergence
// Sentinel, only for retryable classes) -> VERIFY (existing verifier) ->
// RECORD LEARNING (per owner and capability, codes only, never content) ->
// CONTINUE, or ESCALATE when a capability keeps failing across missions.
// Nothing here changes code, credentials or authority: those stay human gates.
const CONNECTION = new Set(['connection_required', 'connection_revoked', 'connection_expired', 'permission_required']);
const SECURITY = new Set(['provider_scope_invalid', 'adapter_scope_invalid', 'unrequested_source', 'source_url_missing', 'url_not_allowed', 'private_source_url', 'selection_invalid', 'unissued_item']);
const PRIVACY = new Set(['egress_privacy_blocked', 'secret_context']);
const TIMEOUT = new Set(['tool_timeout', 'attempt_expired', 'task_timeout']);
const INVALID = new Set(['provider_output_invalid', 'search_output_invalid', 'result_too_large']);
const CLASSES = Object.freeze({
 connection: { failureKind: null, retryable: false, wait: true },
 security: { failureKind: 'security_violation', retryable: false },
 privacy: { failureKind: 'privacy_gate', retryable: false },
 timeout: { failureKind: 'timeout', retryable: true },
 invalid_output: { failureKind: 'invalid_output', retryable: true },
 no_sources: { failureKind: 'no_sources', retryable: false },
 provider: { failureKind: 'tool_error', retryable: true },
});
const safeCode = error => (error && typeof error.code === 'string' && /^[a-z0-9_:.-]{1,64}$/i.test(error.code) ? error.code : 'runtime_failure');
function diagnose(error) {
 const code = safeCode(error);
 const kind = error && error.failureKind;
 const name = CONNECTION.has(code) || kind === 'auth' || kind === 'connection' || kind === 'permission' ? 'connection'
  : SECURITY.has(code) ? 'security' : PRIVACY.has(code) ? 'privacy'
   : TIMEOUT.has(code) || kind === 'timeout' ? 'timeout' : INVALID.has(code) ? 'invalid_output'
    : code === 'sources_not_found' ? 'no_sources' : 'provider';
 return freeze({ class: name, code, ...CLASSES[name] });
}
// An executor error rethrown with the class the Sentinel understands: unknown
// kinds (security, privacy, no sources) escalate at once instead of retrying.
function classified(error) {
 const d = diagnose(error);
 return Object.assign(new Error(d.code), { code: d.code, failureKind: d.failureKind, diagnosis: d.class });
}
// Only faults of the capability itself count toward non-convergence; a
// privacy refusal or a missing source says nothing about the provider.
const CAPABILITY_FAULTS = new Set(['tool_error', 'timeout', 'invalid_output', 'agent_error', 'verification_failed', 'security_violation']);
const lessonId = capability => 'lesson-' + capability.replace(/[^a-z0-9]/g, '-');
function createLearning({ store, now = () => new Date().toISOString(), threshold = 3, cooldownMs = 10 * 60 * 1000 }) {
 const read = (handle, capability) => { try { return store.get(handle, 'lesson', lessonId(capability)); } catch (error) { if (error.code === 'resource_not_found') return { capability, recovered: 0, escalations: 0, consecutiveEscalations: 0, strategies: {}, failures: {} }; throw error; } };
 // Records what happened to each task of a finished run, from engine state only.
 function record(handle, plan, state) {
  for (const task of state.tasks) {
   const step = plan.find(s => task.taskId.endsWith(':' + s.key)); if (!step) continue;
   const attempts = (state.attempts && state.attempts[task.taskId]) || [];
   if (task.status === 'COMPLETED' && attempts.length === 0) { const lesson = read(handle, step.capability); if (lesson.consecutiveEscalations) store.put(handle, 'lesson', lessonId(step.capability), { ...lesson, consecutiveEscalations: 0 }); continue; }
   if (attempts.length === 0 && task.status !== 'BLOCKED') continue;
   const lesson = read(handle, step.capability);
   for (const attempt of attempts) { const key = (attempt.failureKind || 'unknown') + ':' + (attempt.failureCode || 'none'); lesson.failures[key] = (lesson.failures[key] || 0) + 1; }
   if (task.status === 'COMPLETED') {
    const strategy = (task.contract && task.contract.attempt && task.contract.attempt.correctiveAction) || 'retry';
    lesson.recovered += 1; lesson.strategies[strategy] = (lesson.strategies[strategy] || 0) + 1; lesson.consecutiveEscalations = 0;
   } else if (['BLOCKED', 'FAILED', 'NEEDS_REVIEW'].includes(task.status) && attempts.some(a => CAPABILITY_FAULTS.has(a.failureKind))) {
    lesson.escalations += 1; lesson.consecutiveEscalations += 1; lesson.lastEscalationAt = now();
   }
   store.put(handle, 'lesson', lessonId(step.capability), lesson);
  }
 }
 // Non-convergence across missions: stop retrying a capability that keeps
 // escalating and report it, until the cooldown lets one probe through.
 function degraded(handle, plan) {
  for (const step of plan) {
   const lesson = read(handle, step.capability);
   if (lesson.consecutiveEscalations >= threshold && Date.parse(now()) - Date.parse(lesson.lastEscalationAt || 0) < cooldownMs) return freeze({ capability: step.capability, consecutiveEscalations: lesson.consecutiveEscalations });
  }
  return null;
 }
 function lessons(handle) { return freeze(store.list(handle, 'lesson')); }
 return Object.freeze({ record, degraded, lessons });
}
module.exports = { diagnose, classified, createLearning };

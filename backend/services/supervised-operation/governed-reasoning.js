'use strict';
const { PRIVACY_CLASSES, DEFAULT_PRIVACY_POLICY } = require('../executive-brain/privacy-gate');
const { authorizeEgress, classifyEgress, identifiesPerson } = require('./egress-privacy');
const { routeReasoning, ROUTES } = require('./reasoning-router');
const { freeze, fail } = require('./scope-session');
// Continuity across reasoning resources. Each candidate is an existing
// Executive Reasoning Provider (same contract, same sanitized error codes);
// no new orchestrator or model client lives here. The deterministic router
// (Multi-IA V1-A) orders and excludes candidates first; then, for each one in
// that order: Privacy Gate on the exact text that would leave -> reviewed
// price -> the owner's cost ledger reservation -> call -> settle -> caller's
// verifier -> one sealed execution record. A failed candidate is classified
// and the next one is tried with the same minimal context; when none succeeds
// the caller decides between waiting (transient failures) and its
// deterministic fallback (permanent ones).
const FAILURES = freeze({
 RESOURCE_UNAVAILABLE: 'RESOURCE_UNAVAILABLE', RATE_LIMIT: 'RATE_LIMIT', QUOTA_EXHAUSTED: 'QUOTA_EXHAUSTED',
 BUDGET_EXHAUSTED: 'BUDGET_EXHAUSTED', PROVIDER_ERROR: 'PROVIDER_ERROR', INVALID_OUTPUT: 'INVALID_OUTPUT',
 PRIVACY_BLOCKED: 'PRIVACY_BLOCKED', PRICING_UNREVIEWED: 'PRICING_UNREVIEWED', REQUEST_REJECTED: 'REQUEST_REJECTED',
 BUDGET_POLICY_REQUIRED: 'BUDGET_POLICY_REQUIRED', CIRCUIT_OPEN: 'CIRCUIT_OPEN', CAPABILITY_MISMATCH: 'CAPABILITY_MISMATCH',
});
// Roles of a model call. REVIEWER is the caller's deterministic verifier
// (accept); no second model reviews or approves an output in V1-A.
const ROLES = freeze({ EXECUTOR: 'EXECUTOR', FALLBACK: 'FALLBACK', REVIEWER: 'DETERMINISTIC_VERIFIER' });
// Failures that may clear by themselves (a rate window, a daily budget or
// quota reset, an upstream outage, an open circuit) without changing what is
// sent: the mission waits and resumes from its checkpoint. A rejected
// credential, a rejected request (wrong model or configuration), a missing
// budget policy or an output the verifier refuses will not: retrying would
// only repeat a call (and a paid one for outputs), so the deterministic
// analysis stands and the failure stays in the trace.
const TRANSIENT = new Set([FAILURES.RATE_LIMIT, FAILURES.QUOTA_EXHAUSTED, FAILURES.BUDGET_EXHAUSTED, FAILURES.PROVIDER_ERROR, FAILURES.CIRCUIT_OPEN]);
function classifyResult(result) {
 if (!result || result.status === 'not_configured') return FAILURES.RESOURCE_UNAVAILABLE;
 if (result.failureType === FAILURES.QUOTA_EXHAUSTED) return FAILURES.QUOTA_EXHAUSTED;
 switch (result.errorCode) {
  case 'reasoning_rate_limited': return FAILURES.RATE_LIMIT;
  case 'reasoning_auth_failed': return FAILURES.RESOURCE_UNAVAILABLE;
  case 'reasoning_invalid_output': return FAILURES.INVALID_OUTPUT;
  case 'reasoning_request_rejected': return FAILURES.REQUEST_REJECTED;
  default: return FAILURES.PROVIDER_ERROR;
 }
}
// requestFloor: the least class a person's request can have when it leaves.
// CONFIDENTIAL by default; INTERNAL only when a human explicitly authorized
// non-sensitive requests. Never PUBLIC. Private sources, a request that
// identifies someone else (a name, "mi jefe"), any identifier or personal
// special/financial data still raise the class to CONFIDENTIAL. The first
// person alone does not (canon 05/10/2026).
const REQUEST_FLOORS = new Set([PRIVACY_CLASSES.INTERNAL, PRIVACY_CLASSES.CONFIDENTIAL]);
// Budget gates that a wait will not clear: a human must set the policy.
const BUDGET_DETAIL = { fx_policy_required: FAILURES.BUDGET_POLICY_REQUIRED, provider_budget_unset: FAILURES.BUDGET_POLICY_REQUIRED };
// preference: explicit model or provider ids that go first when eligible.
// availability(providerId) -> { available, circuitOpen }: V1-B plugs a
// per-provider breaker here; by default every configured provider is available.
function createGovernedReasoner({ providers = [], privacyPolicy = DEFAULT_PRIVACY_POLICY, approvedDailyBudgetUsd = 0, requestFloor = PRIVACY_CLASSES.CONFIDENTIAL, preference = [], availability = () => ({}), clock = () => Date.now() } = {}) {
 if (!REQUEST_FLOORS.has(requestFloor)) fail('request_floor_invalid');
 const candidates = providers.filter(p => p && p.status === 'ready' && typeof p.reason === 'function' && typeof p.modelId === 'string');
 // Cognition is enabled only by explicit human configuration: at least one
 // configured provider and a positive approved budget. Otherwise the caller
 // keeps its deterministic behaviour and no text ever leaves.
 const enabled = candidates.length > 0 && approvedDailyBudgetUsd > 0;
 async function reason({ objective, egressText, publicText = '', derivedFromPrivate = false, request, basis, spend, missionId, taskId = null, taskType = null, requiredTier = null, accept = () => true, onAttempt = () => {} }) {
  if (!enabled) fail('reasoning_not_enabled');
  if (!spend || typeof missionId !== 'string' || typeof egressText !== 'string' || typeof publicText !== 'string' || typeof objective !== 'string') fail('reasoning_context_invalid');
  const floor = identifiesPerson(objective) ? PRIVACY_CLASSES.CONFIDENTIAL : requestFloor;
  // The class does not depend on the provider: computed once for the router;
  // the gate below still authorizes the exact text for each provider.
  const classified = classifyEgress(egressText, { derivedFromPrivate, floor, publicText });
  if (classified.privacyClass === PRIVACY_CLASSES.SECRET) fail('secret_context');
  const attempts = [];
  // detail: a fixed code (verifier defect, provider errorCode or budget
  // reason), never content.
  const record = (provider, failure, privacyClass, detail = null) => { const a = freeze({ resource: provider.modelId, region: provider.region || null, failure, privacyClass, ...(typeof detail === 'string' && /^[a-z_]{1,48}$/.test(detail) ? { detail } : {}) }); attempts.push(a); onAttempt(a); return a; };
  const estimates = new Map(candidates.map(p => [p.modelId, spend.estimate(p.modelId, basis)]));
  const route = routeReasoning({
   taskType, requiredTier, privacyClass: classified.privacyClass, policy: privacyPolicy, preference,
   budget: typeof spend.budget === 'function' ? spend.budget() : null,
   candidates: candidates.map(p => {
    const entry = p.catalog && p.catalog[p.modelId]; const a = availability(p.provider) || {};
    return { id: p.modelId, providerId: p.provider, region: p.region, tier: entry ? entry.tier : null, tasks: Array.isArray(p.tasks) ? p.tasks : null, estimatedUsd: estimates.get(p.modelId), available: a.available !== false, circuitOpen: a.circuitOpen === true };
   }),
  });
  if (route.route === ROUTES.BLOCKED) fail('secret_context');
  const byId = new Map(candidates.map(p => [p.modelId, p]));
  // Router exclusions are recorded after the routed candidates were tried:
  // they were never in the route, so the trace keeps the real attempts first.
  const excluded = () => { for (const x of route.excluded) record(byId.get(x.id), x.failure, classified.privacyClass, x.detail); };
  let calls = 0; let previous = null;
  const execution = (provider, fields) => {
   if (typeof spend.recordExecution !== 'function') return;
   // The paid call is already settled: a failed telemetry write never turns
   // into a retry (and a second charge).
   try { spend.recordExecution({ missionId, taskId, taskType, provider: provider.provider, model: provider.model, resource: provider.modelId, region: provider.region || null, reviewer: ROLES.REVIEWER, ...fields }); } catch { /* the ledger already holds the charge */ }
  };
  for (const provider of route.candidates.map(id => byId.get(id))) {
   const egress = authorizeEgress({ text: egressText, publicText, provider: { providerId: provider.provider, region: provider.region }, policy: privacyPolicy, derivedFromPrivate, floor });
   if (egress.privacyClass === PRIVACY_CLASSES.SECRET) fail('secret_context');
   if (!egress.allowed) { previous = record(provider, FAILURES.PRIVACY_BLOCKED, egress.privacyClass); continue; }
   const estimatedUsd = estimates.get(provider.modelId);
   if (estimatedUsd === null) { previous = record(provider, FAILURES.PRICING_UNREVIEWED, egress.privacyClass); continue; }
   let reservation;
   try { reservation = spend.reserve({ missionId, modelId: provider.modelId, estimatedUsd, approvedDailyBudgetUsd }); }
   catch (error) { if (error.code === 'planning_budget_gate') { previous = record(provider, BUDGET_DETAIL[error.detail] || FAILURES.BUDGET_EXHAUSTED, egress.privacyClass, error.detail); continue; } throw error; }
   // EXECUTOR is the first routed candidate that is called; any later call
   // replaces a routed candidate that failed (FALLBACK, with that reason).
   const role = calls === 0 && !previous ? ROLES.EXECUTOR : ROLES.FALLBACK; const fallbackReason = role === ROLES.FALLBACK && previous ? previous.failure : null; calls += 1;
   const started = clock();
   let result; let charged = 0;
   try { result = await provider.reason(request); }
   catch (error) { result = { status: 'error', errorCode: 'reasoning_unavailable' }; }
   finally { charged = spend.settle(reservation, (result && result.usage) || {}); }
   const latencyMs = Math.max(0, clock() - started);
   // Only an explicit true accepts; any other verdict is the defect code.
   const verdict = result && result.status === 'ok' ? accept(result.content) : null;
   const responseId = result && result.evidence && typeof result.evidence.responseId === 'string' ? result.evidence.responseId : null;
   const base = { role, fallbackReason, privacyClass: egress.privacyClass, estimatedCost: estimatedUsd, chargedCost: charged, latencyMs, responseId };
   if (verdict === true) {
    execution(provider, { ...base, status: 'ACCEPTED', verificationStatus: 'PASS', failureKind: null });
    excluded();
    return freeze({ content: result.content, resource: provider.modelId, region: provider.region || null, privacyClass: egress.privacyClass, role, usage: freeze({ ...(result.usage || {}) }), evidence: freeze({ ...(result.evidence || {}) }), chargedUsd: charged, attempts: freeze(attempts) });
   }
   const answered = result && result.status === 'ok'; const failure = answered ? FAILURES.INVALID_OUTPUT : classifyResult(result);
   execution(provider, { ...base, status: answered ? 'REJECTED' : 'FAILED', verificationStatus: answered ? 'REJECTED' : 'NOT_RUN', failureKind: failure });
   previous = record(provider, failure, egress.privacyClass, answered ? (typeof verdict === 'string' ? verdict : 'verifier_rejected') : result && result.errorCode);
  }
  excluded();
  const error = Object.assign(new Error('reasoning_resource_unavailable'), { code: 'reasoning_resource_unavailable', attempts: freeze(attempts), transient: attempts.some(a => TRANSIENT.has(a.failure)), route: route.route });
  throw error;
 }
 return Object.freeze({ enabled, reason, resources: freeze(candidates.map(p => freeze({ resource: p.modelId, region: p.region || null }))) });
}
module.exports = { FAILURES, ROLES, createGovernedReasoner, classifyResult };

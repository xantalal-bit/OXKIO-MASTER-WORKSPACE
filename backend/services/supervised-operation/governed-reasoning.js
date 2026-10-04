'use strict';
const { PRIVACY_CLASSES, DEFAULT_PRIVACY_POLICY } = require('../executive-brain/privacy-gate');
const { authorizeEgress, mentionsPerson } = require('./egress-privacy');
const { freeze, fail } = require('./scope-session');
// Continuity across reasoning resources. Each candidate is an existing
// Executive Reasoning Provider (same contract, same sanitized error codes);
// no new router or model client lives here. For every candidate, in order:
// Privacy Gate on the exact text that would leave -> reviewed price -> the
// owner's cost ledger reservation -> call -> settle -> caller's verifier.
// A failed candidate is classified and the next one is tried with the same
// minimal context; when none succeeds the caller decides between waiting
// (transient failures) and its deterministic fallback (permanent ones).
const FAILURES = freeze({
 RESOURCE_UNAVAILABLE: 'RESOURCE_UNAVAILABLE', RATE_LIMIT: 'RATE_LIMIT', QUOTA_EXHAUSTED: 'QUOTA_EXHAUSTED',
 BUDGET_EXHAUSTED: 'BUDGET_EXHAUSTED', PROVIDER_ERROR: 'PROVIDER_ERROR', INVALID_OUTPUT: 'INVALID_OUTPUT',
 PRIVACY_BLOCKED: 'PRIVACY_BLOCKED', PRICING_UNREVIEWED: 'PRICING_UNREVIEWED', REQUEST_REJECTED: 'REQUEST_REJECTED',
});
// Failures that may clear by themselves (a rate window, a daily budget or
// quota reset, an upstream outage) without changing what is sent: the mission
// waits and resumes from its checkpoint. A rejected credential, a rejected
// request (wrong model or configuration) or an output the verifier refuses
// will not: retrying would only repeat a call (and a paid one for outputs),
// so the deterministic analysis stands and the failure stays in the trace.
const TRANSIENT = new Set([FAILURES.RATE_LIMIT, FAILURES.QUOTA_EXHAUSTED, FAILURES.BUDGET_EXHAUSTED, FAILURES.PROVIDER_ERROR]);
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
// non-sensitive requests. Never PUBLIC. Private sources, a reference to a
// person or any identifier still raise the class to CONFIDENTIAL.
const REQUEST_FLOORS = new Set([PRIVACY_CLASSES.INTERNAL, PRIVACY_CLASSES.CONFIDENTIAL]);
function createGovernedReasoner({ providers = [], privacyPolicy = DEFAULT_PRIVACY_POLICY, approvedDailyBudgetUsd = 0, requestFloor = PRIVACY_CLASSES.CONFIDENTIAL } = {}) {
 if (!REQUEST_FLOORS.has(requestFloor)) fail('request_floor_invalid');
 const candidates = providers.filter(p => p && p.status === 'ready' && typeof p.reason === 'function' && typeof p.modelId === 'string');
 // Cognition is enabled only by explicit human configuration: at least one
 // configured provider and a positive approved budget. Otherwise the caller
 // keeps its deterministic behaviour and no text ever leaves.
 const enabled = candidates.length > 0 && approvedDailyBudgetUsd > 0;
 async function reason({ objective, egressText, publicText = '', derivedFromPrivate = false, request, basis, spend, missionId, accept = () => true, onAttempt = () => {} }) {
  if (!enabled) fail('reasoning_not_enabled');
  if (!spend || typeof missionId !== 'string' || typeof egressText !== 'string' || typeof publicText !== 'string' || typeof objective !== 'string') fail('reasoning_context_invalid');
  const floor = mentionsPerson(objective) ? PRIVACY_CLASSES.CONFIDENTIAL : requestFloor;
  const attempts = [];
  // detail: a fixed code (verifier defect or provider errorCode), never content.
  const record = (provider, failure, privacyClass, detail = null) => { const a = freeze({ resource: provider.modelId, region: provider.region || null, failure, privacyClass, ...(typeof detail === 'string' && /^[a-z_]{1,48}$/.test(detail) ? { detail } : {}) }); attempts.push(a); onAttempt(a); };
  for (const provider of candidates) {
   const egress = authorizeEgress({ text: egressText, publicText, provider: { providerId: provider.provider, region: provider.region }, policy: privacyPolicy, derivedFromPrivate, floor });
   if (egress.privacyClass === PRIVACY_CLASSES.SECRET) fail('secret_context');
   if (!egress.allowed) { record(provider, FAILURES.PRIVACY_BLOCKED, egress.privacyClass); continue; }
   const estimatedUsd = spend.estimate(provider.modelId, basis);
   if (estimatedUsd === null) { record(provider, FAILURES.PRICING_UNREVIEWED, egress.privacyClass); continue; }
   let reservation;
   try { reservation = spend.reserve({ missionId, modelId: provider.modelId, estimatedUsd, approvedDailyBudgetUsd }); }
   catch (error) { if (error.code === 'planning_budget_gate') { record(provider, FAILURES.BUDGET_EXHAUSTED, egress.privacyClass); continue; } throw error; }
   let result; let charged = 0;
   try { result = await provider.reason(request); }
   catch (error) { result = { status: 'error', errorCode: 'reasoning_unavailable' }; }
   finally { charged = spend.settle(reservation, (result && result.usage) || {}); }
   // Only an explicit true accepts; any other verdict is the defect code.
   const verdict = result && result.status === 'ok' ? accept(result.content) : null;
   if (verdict === true) {
    return freeze({ content: result.content, resource: provider.modelId, region: provider.region || null, privacyClass: egress.privacyClass, usage: freeze({ ...(result.usage || {}) }), evidence: freeze({ ...(result.evidence || {}) }), chargedUsd: charged, attempts: freeze(attempts) });
   }
   record(provider, result && result.status === 'ok' ? FAILURES.INVALID_OUTPUT : classifyResult(result), egress.privacyClass, result && result.status === 'ok' ? (typeof verdict === 'string' ? verdict : 'verifier_rejected') : result && result.errorCode);
  }
  const error = Object.assign(new Error('reasoning_resource_unavailable'), { code: 'reasoning_resource_unavailable', attempts: freeze(attempts), transient: attempts.some(a => TRANSIENT.has(a.failure)) });
  throw error;
 }
 return Object.freeze({ enabled, reason, resources: freeze(candidates.map(p => freeze({ resource: p.modelId, region: p.region || null }))) });
}
module.exports = { FAILURES, createGovernedReasoner, classifyResult };

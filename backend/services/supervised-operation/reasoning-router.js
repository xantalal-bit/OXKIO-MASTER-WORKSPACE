'use strict';
const { PRIVACY_CLASSES, DEFAULT_PRIVACY_POLICY, evaluateProviderRouting, isPrivacyClass } = require('../executive-brain/privacy-gate');
const { freeze } = require('./scope-session');
// Multi-IA V1-A (10/10/2026): deterministic ordering of reasoning candidates.
// Pure: no I/O, no clock, no model decides the route. It only excludes and
// orders; the governed reasoner still runs the Privacy Gate on the exact text
// before every transfer, reserves in the ledger (the budget authority), calls,
// settles and verifies. Privacy uses the same evaluateProviderRouting as that
// gate, so the router can never allow what the gate refuses.
const ROUTES = freeze({ ORDERED: 'ORDERED', LOCAL_ONLY: 'LOCAL_ONLY', BLOCKED: 'BLOCKED' });
// Same strings as governed-reasoning FAILURES, so an exclusion is traced like
// a failed attempt.
const EXCLUSIONS = freeze({
 PRIVACY_BLOCKED: 'PRIVACY_BLOCKED', PRICING_UNREVIEWED: 'PRICING_UNREVIEWED', BUDGET_EXHAUSTED: 'BUDGET_EXHAUSTED',
 BUDGET_POLICY_REQUIRED: 'BUDGET_POLICY_REQUIRED', CIRCUIT_OPEN: 'CIRCUIT_OPEN', CAPABILITY_MISMATCH: 'CAPABILITY_MISMATCH',
});
const remaining = value => (value === null || value === undefined ? Infinity : value);
// candidates: [{ id, providerId, region, tier, tasks, estimatedUsd (null = no
//   reviewed price), available, circuitOpen }] in configuration order.
// budget: ledger snapshot { status, monthly: { remainingUsd }, providers:
//   { [providerId]: { remainingUsd } } } or null (no budget beyond the ledger's).
// preference: explicit ids (model or provider) that go first when eligible.
function routeReasoning({ taskType = null, privacyClass, requiredTier = null, candidates = [], policy = DEFAULT_PRIVACY_POLICY, budget = null, preference = [] } = {}) {
 // 1. SECRET (or an unknown class, fail closed) never leaves.
 if (!isPrivacyClass(privacyClass) || privacyClass === PRIVACY_CLASSES.SECRET) {
  return freeze({ route: ROUTES.BLOCKED, reason: privacyClass === PRIVACY_CLASSES.SECRET ? 'secret_never_external' : 'unknown_privacy_class', candidates: [], excluded: [] });
 }
 const excluded = []; const eligible = [];
 const limited = budget && budget.status === 'LIMITED';
 candidates.forEach((c, order) => {
  const exclude = (failure, detail = null) => excluded.push(freeze({ id: c.id, failure, ...(detail ? { detail } : {}) }));
  // 2. Privacy: only a provider the policy approves for this class.
  if (!evaluateProviderRouting({ privacyClass, provider: { external: true, providerId: c.providerId, region: c.region }, policy }).allowed) return exclude(EXCLUSIONS.PRIVACY_BLOCKED);
  // 3. Reviewed pricing.
  if (!Number.isFinite(c.estimatedUsd) || c.estimatedUsd < 0) return exclude(EXCLUSIONS.PRICING_UNREVIEWED);
  // 4. Provider budget. A human budget that cannot be expressed in the
  // accounting currency (no audited FX policy) stops every paid call.
  if (budget && budget.status === 'FX_POLICY_REQUIRED') return exclude(EXCLUSIONS.BUDGET_POLICY_REQUIRED, 'fx_policy_required');
  if (limited) {
   const own = budget.providers && Object.hasOwn(budget.providers, c.providerId) ? budget.providers[c.providerId] : null;
   if (!own) return exclude(EXCLUSIONS.BUDGET_POLICY_REQUIRED, 'provider_budget_unset');
   if (c.estimatedUsd > remaining(own.remainingUsd)) return exclude(EXCLUSIONS.BUDGET_EXHAUSTED, 'provider_budget');
   // 5. Monthly global budget.
   if (c.estimatedUsd > remaining(budget.monthly && budget.monthly.remainingUsd)) return exclude(EXCLUSIONS.BUDGET_EXHAUSTED, 'monthly_budget');
  }
  // 6. Availability / circuit (V1-B connects a per-provider breaker here).
  if (c.available === false || c.circuitOpen === true) return exclude(EXCLUSIONS.CIRCUIT_OPEN);
  // 7. Required tier.
  if (requiredTier && c.tier !== requiredTier) return exclude(EXCLUSIONS.CAPABILITY_MISMATCH);
  eligible.push({ c, order });
 });
 if (!eligible.length) return freeze({ route: ROUTES.LOCAL_ONLY, reason: 'no_eligible_resource', candidates: [], excluded });
 const prefs = Array.isArray(preference) ? preference : [];
 const rank = c => { const i = prefs.findIndex(p => p === c.id || p === c.providerId); return i < 0 ? prefs.length : i; };
 const suited = c => (taskType && Array.isArray(c.tasks) && c.tasks.includes(taskType) ? 0 : 1);
 // Explicit preference, then suitability, then estimated cost; configuration
 // order and id break ties, so the same inputs always give the same route.
 eligible.sort((a, b) => rank(a.c) - rank(b.c) || suited(a.c) - suited(b.c) || a.c.estimatedUsd - b.c.estimatedUsd || a.order - b.order || (a.c.id < b.c.id ? -1 : a.c.id > b.c.id ? 1 : 0));
 return freeze({ route: ROUTES.ORDERED, candidates: eligible.map(e => e.c.id), excluded });
}
module.exports = { ROUTES, EXCLUSIONS, routeReasoning };

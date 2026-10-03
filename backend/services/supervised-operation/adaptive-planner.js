'use strict';
const { DEFAULT_PRIVACY_POLICY, PRIVACY_CLASSES } = require('../executive-brain/privacy-gate');
const { authorizeEgress } = require('./egress-privacy');
const { fail } = require('./scope-session');
// Optional natural-language reasoning through the existing Executive
// Reasoning Provider. No credentials, provider or paid call is created here.
// Gates, in order: provider ready -> Privacy Gate on the text that would leave
// (always at least CONFIDENTIAL: it is a person's request) -> reviewed price ->
// a positive approved daily budget -> the owner's persisted cost ledger. The
// default budget is 0: a closed human gate, so the deterministic fallback runs.
function createAdaptivePlanner({ provider, privacyPolicy = DEFAULT_PRIVACY_POLICY, approvedDailyBudgetUsd = 0, maxAttempts = 2 } = {}) {
 async function plan(input, { spend, missionId } = {}) {
  if (!provider || provider.status !== 'ready' || !spend || typeof missionId !== 'string') fail('planning_connection_required');
  const egress = authorizeEgress({ text: input.intention, provider: { providerId: provider.provider, region: provider.region }, policy: privacyPolicy, floor: PRIVACY_CLASSES.CONFIDENTIAL });
  if (egress.privacyClass === PRIVACY_CLASSES.SECRET) fail('secret_context');
  if (!egress.allowed) fail('planning_privacy_gate');
  const basis = { inputTokens: Math.ceil(input.intention.length / 3) + 500, outputTokens: 900 };
  const estimatedUsd = spend.estimate(provider.modelId, basis);
  if (estimatedUsd === null || !(approvedDailyBudgetUsd > 0)) fail('planning_budget_gate');
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
   const reservation = spend.reserve({ missionId, modelId: provider.modelId, estimatedUsd, approvedDailyBudgetUsd });
   let result;
   try {
    result = await provider.reason({ mission: input.intention, context: { capabilities: input.capabilities }, constraints: ['Select only supplied capabilities. Never invent tools, authority, sources or success. No external actions. Return a bounded acyclic dependency plan.'], output: { plan: [{ key: 'step-key', capability: 'supplied-id', dependsOn: [] }] } });
   } finally {
    spend.settle(reservation, (result && result.usage) || {});
   }
   if (!result || result.status !== 'ok') continue;
   const steps = result.content && result.content.plan;
   if (Array.isArray(steps) && steps.length > 0 && steps.length <= 12 && steps.every(step => step && input.capabilities.includes(step.capability))) return steps;
  }
  fail('planning_exhausted');
 }
 return Object.freeze({ plan });
}
module.exports = { createAdaptivePlanner };

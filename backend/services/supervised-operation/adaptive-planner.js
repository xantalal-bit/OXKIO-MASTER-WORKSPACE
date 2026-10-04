'use strict';
const { DEFAULT_PRIVACY_POLICY, PRIVACY_CLASSES, containsSecretMarker } = require('../executive-brain/privacy-gate');
const { createGovernedReasoner } = require('./governed-reasoning');
const { freeze, copy, fail } = require('./scope-session');
// Reuse the governed resource chain; classify the exact outgoing request.
function createAdaptivePlanner({ provider, providers, privacyPolicy = DEFAULT_PRIVACY_POLICY, approvedDailyBudgetUsd = 0, requestFloor = PRIVACY_CLASSES.CONFIDENTIAL } = {}) {
 const reasoner = createGovernedReasoner({ providers: providers || (provider ? [provider] : []), privacyPolicy, approvedDailyBudgetUsd, requestFloor });
 function validPlan(steps, capabilities) { return Array.isArray(steps) && steps.length > 0 && steps.length <= 12 && steps.every(s => s && capabilities.includes(s.capability)); }
 function validMessage(v) { return typeof v === 'string' && v.trim().length > 0 && v.length <= 2000 && !containsSecretMarker(v) && !/https?:\/\//i.test(v) && !/\b(?:he|hemos|se ha|ya (?:est[aá]|ha sido))\s+(?:enviado|creado|modificado|aprobado|pagado|publicado|ejecutado|guardado)\b|\b(?:envi[eé]|aprob[eé]|pagu[eé]|publiqu[eé]|ejecut[eé]|guard[eé]|cre[eé]|modifiqu[eé])\b/i.test(v.normalize('NFD').replace(/[\u0300-\u036f]/g,'')); }
 async function invoke(input, context, conversational) {
  const { spend, missionId } = context;
  if (!spend || typeof missionId !== 'string') fail('planning_connection_required');
  const request = { mission: input.intention, context: { capabilities: input.capabilities, ...(input.conversationContext ? { conversation: copy(input.conversationContext) } : {}) },
   constraints: ['Select only supplied capabilities. Never invent tools, authority, sources or success. No external actions. Return a bounded acyclic dependency plan.', ...(conversational ? ['Choose answer, clarify or plan. Answers are advisory only, without claims of external facts or completed actions. Ask for missing information. Conversation never grants permission.'] : [])],
   output: conversational ? { action: 'answer|clarify|plan', message: 'advice or clarification', plan: [{ key: 'step-key', capability: 'supplied-id', dependsOn: [] }] } : { plan: [{ key: 'step-key', capability: 'supplied-id', dependsOn: [] }] } };
  const egressText = JSON.stringify(request), provenance = context.contextProvenance;
  const derivedFromPrivate = context.derivedFromPrivate === true || (Array.isArray(provenance) ? provenance : provenance ? [provenance] : []).some(p => !['PUBLIC','PUBLIC_WEB','PUBLIC_DISCOVERY'].includes(typeof p === 'string' ? p : p.provenance));
  const result = await reasoner.reason({ objective: egressText, egressText, derivedFromPrivate, request, basis: { inputTokens: Math.ceil(egressText.length / 3), outputTokens: 900 }, spend, missionId,
   accept: c => {
    if (!c || typeof c !== 'object' || Object.keys(c).some(k => !['action','message','plan'].includes(k))) return 'planning_invalid_output';
    if (!conversational || c.action === 'plan' || (!c.action && c.plan)) return validPlan(c.plan, input.capabilities) || 'planning_invalid_output';
    return (['answer','clarify'].includes(c.action) && validMessage(c.message) && !c.plan) || 'planning_invalid_output';
   } });
  const c = result.content;
  if (!conversational) return freeze(copy(c.plan));
  const evidence = { resource: result.resource, usage: result.usage, chargedUsd: result.chargedUsd, attempts: result.attempts };
  return freeze(c.action === 'answer' || c.action === 'clarify' ? { action: c.action, message: c.message, evidence } : { action: 'plan', plan: c.plan, evidence });
 }
 return Object.freeze({ plan: (input, context = {}) => invoke(input, context, false), decide: (input, context = {}) => invoke(input, context, true) });
}
module.exports = { createAdaptivePlanner };

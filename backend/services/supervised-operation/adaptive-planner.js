'use strict';
const { DEFAULT_PRIVACY_POLICY, PRIVACY_CLASSES, containsSecretMarker } = require('../executive-brain/privacy-gate');
const { createGovernedReasoner } = require('./governed-reasoning');
const { freeze, copy, fail } = require('./scope-session');
// Claims of a completed action are refused. The first-person preterite is
// matched WITH its accent: without it "envié" would collide with the formal
// imperative "envíe" that ordinary advice uses ("cree un perfil, envíe...").
const COMPLETED = /\b(?:he|hemos|se ha|ya (?:esta|ha sido))\s+(?:enviado|creado|modificado|aprobado|pagado|publicado|ejecutado|guardado)\b/i;
const PRETERITE = /(?<!\p{L})(?:envié|aprobé|pagué|publiqué|ejecuté|guardé|creé|modifiqué)(?!\p{L})/iu;
const stripAccents = v => v.normalize('NFD').replace(/\p{M}/gu, '');
// Reuse the governed resource chain; classify the exact outgoing request.
function createAdaptivePlanner({ provider, providers, privacyPolicy = DEFAULT_PRIVACY_POLICY, approvedDailyBudgetUsd = 0, requestFloor = PRIVACY_CLASSES.CONFIDENTIAL } = {}) {
 const reasoner = createGovernedReasoner({ providers: providers || (provider ? [provider] : []), privacyPolicy, approvedDailyBudgetUsd, requestFloor });
 function validPlan(steps, capabilities) { return Array.isArray(steps) && steps.length > 0 && steps.length <= 12 && steps.every(s => s && capabilities.includes(s.capability)); }
 function validMessage(v) { return typeof v === 'string' && v.trim().length > 0 && v.length <= 2000 && !containsSecretMarker(v) && !/https?:\/\//i.test(v) && !COMPLETED.test(stripAccents(v)) && !PRETERITE.test(v.normalize('NFC')); }
 // The output schema shows every field, so a model may return an empty plan
 // next to an answer; only a non-empty plan is a plan.
 const noPlan = p => p === undefined || p === null || (Array.isArray(p) && p.length === 0);
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
    // Distinct fixed codes so a live rejection can be diagnosed without content.
    if (!c || typeof c !== 'object' || Object.keys(c).some(k => !['action','message','plan'].includes(k))) return 'planning_invalid_shape';
    if (!conversational || c.action === 'plan' || (!c.action && !noPlan(c.plan))) return validPlan(c.plan, input.capabilities) || 'planning_invalid_plan';
    if (!['answer','clarify'].includes(c.action) || !noPlan(c.plan)) return 'planning_invalid_action';
    return validMessage(c.message) || 'planning_invalid_message';
   } });
  const c = result.content;
  if (!conversational) return freeze(copy(c.plan));
  const evidence = { resource: result.resource, usage: result.usage, chargedUsd: result.chargedUsd, attempts: result.attempts };
  return freeze(c.action === 'answer' || c.action === 'clarify' ? { action: c.action, message: c.message, evidence } : { action: 'plan', plan: c.plan, evidence });
 }
 return Object.freeze({ plan: (input, context = {}) => invoke(input, context, false), decide: (input, context = {}) => invoke(input, context, true) });
}
module.exports = { createAdaptivePlanner };

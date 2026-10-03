'use strict';

const { AGENT_STATUS, COST_RANK, defaultRegistry } = require('./agent-registry');
const { ENABLED_AUTONOMY_CEILING, autonomyRank } = require('./xatai-core');
const { DEFAULT_PRIVACY_POLICY, evaluateProviderRouting } = require('./privacy-gate');
const { LEVELS: COST_LEVELS } = require('../runtime/cost-policy');
const { describeCapability } = require('./capability-registry');

// XATAI CORE V2 (03/10/2026): deterministic Agent Router. Given one task it
// picks the coordinator and agent, or says plainly why nobody can take it.
// No LLM: every rule below is a filter or an ordering over the Agent
// Registry. Filters run in a fixed order and the first one that leaves no
// candidate is the reason returned, so a BLOCKED answer always names the
// real cause (not authorized, not implemented, privacy, budget...).

const ROUTE_DECISIONS = Object.freeze({
  ROUTED: 'ROUTED',
  BLOCKED: 'BLOCKED',
  NEEDS_INFORMATION: 'NEEDS_INFORMATION',
});

function blocked(decision, reason) {
  return Object.freeze({
    decision, reason, coordinatorId: null, agentId: null,
    fallbackAgentIds: Object.freeze([]), requiresHumanGate: true,
  });
}

function unavailableReason(candidates) {
  return candidates.some((candidate) => candidate.status === AGENT_STATUS.BLOCKED)
    ? 'agent_blocked' : 'agent_not_implemented';
}

// task: { agentRole, requiredCapabilities, risk, privacyClass, kind, autonomyLevel }
// providerAssignment: the external model provider a model-backed agent would
// use ({ providerId, region }); none assigned means "no approved provider".
function routeTask({
  task,
  contract,
  registry = defaultRegistry,
  privacyPolicy = DEFAULT_PRIVACY_POLICY,
  providerAssignment = null,
  budgetRemainingUsd = 0,
  excludeAgentIds = [],
  preferAgentId = null,
  describeCapability: describe = describeCapability,
} = {}) {
  const required = Array.isArray(task && task.requiredCapabilities) ? task.requiredCapabilities : [];
  if (required.length === 0) return blocked(ROUTE_DECISIONS.NEEDS_INFORMATION, 'task_without_capabilities');
  if (!contract) return blocked(ROUTE_DECISIONS.BLOCKED, 'missing_contract');
  if (required.some((id) => contract.prohibitedActions.includes(id))) {
    return blocked(ROUTE_DECISIONS.BLOCKED, 'capability_prohibited');
  }
  if (required.some((id) => !contract.authorizedTools.includes(id))) {
    return blocked(ROUTE_DECISIONS.BLOCKED, 'capability_not_authorized');
  }

  // Privacy and cost are judged on what this task uses, not on everything
  // the agent could do: reading Gmail metadata sends nothing to a model even
  // if the same agent can also draft with one. Unknown capabilities count as
  // model-backed (fail closed).
  const MODEL_CLASSES = [COST_LEVELS.SMALL_MODEL, COST_LEVELS.PREMIUM_MODEL, COST_LEVELS.MULTI_AGENT];
  const taskUsesModel = required.some((id) => {
    const profile = describe(id);
    return !profile || MODEL_CLASSES.includes(profile.costClass);
  });
  const steps = [
    ['no_agent_for_capability', (agent) => required.every((id) => agent.capabilities.includes(id))
      && !required.some((id) => agent.prohibitedCapabilities.includes(id))],
    ['no_untried_agent', (agent) => !excludeAgentIds.includes(agent.id)],
    [null, (agent) => agent.status === AGENT_STATUS.AVAILABLE || agent.status === AGENT_STATUS.PARTIAL],
    ['agent_role_mismatch', (agent) => (task.kind === 'verification' ? agent.canVerify : agent.canExecute)],
    ['risk_not_accepted', (agent) => agent.riskClasses.includes(task.risk || 'low')],
    ['privacy_provider_not_allowed', (agent) => evaluateProviderRouting({
      privacyClass: task.privacyClass,
      provider: { external: agent.requiresExternalProvider && taskUsesModel, ...(providerAssignment || {}) },
      policy: privacyPolicy,
    }).allowed],
    ['budget_exhausted', () => !taskUsesModel || budgetRemainingUsd > 0],
  ];
  let candidates = registry.listAgents();
  for (const [reason, keep] of steps) {
    const next = candidates.filter(keep);
    if (next.length === 0) return blocked(ROUTE_DECISIONS.BLOCKED, reason || unavailableReason(candidates));
    candidates = next;
  }

  // An agent already working the task keeps it (a retry that is not
  // CHANGE_AGENT never switches agent); otherwise specialist first (exact
  // role), then the narrowest agent, then the cheapest.
  const ordered = [...candidates].sort((left, right) => (
    Number(right.id === preferAgentId) - Number(left.id === preferAgentId)
    || Number(right.role === task.agentRole) - Number(left.role === task.agentRole)
    || left.capabilities.length - right.capabilities.length
    || COST_RANK.indexOf(left.costClass) - COST_RANK.indexOf(right.costClass)
    || left.id.localeCompare(right.id)
  ));
  const chosen = ordered[0];
  const taskAutonomy = autonomyRank(task.autonomyLevel || contract.autonomyLevel);
  const needsApproval = required.some((id) => {
    const profile = describe(id);
    return !profile || profile.requiresApproval;
  });
  return Object.freeze({
    decision: ROUTE_DECISIONS.ROUTED,
    reason: chosen.role === task.agentRole ? 'specialist_match' : 'capability_match',
    coordinatorId: chosen.coordinator,
    agentId: chosen.id,
    fallbackAgentIds: Object.freeze(ordered.slice(1).map((agent) => agent.id)),
    requiresHumanGate: needsApproval || task.risk === 'high'
      || taskAutonomy === null || taskAutonomy > autonomyRank(ENABLED_AUTONOMY_CEILING),
  });
}

module.exports = { ROUTE_DECISIONS, routeTask };

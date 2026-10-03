'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { describeCapability } = require('./capability-registry');
const { AGENT_DECLARATIONS, createAgentRegistry } = require('./agent-registry');
const { ROUTE_DECISIONS, routeTask } = require('./agent-router');
const { createMissionContract } = require('./xatai-core');

const SIMULATED = new Set(['research.company', 'research.web', 'data.analyze']);
const simulatedDescribe = (id) => {
  const profile = describeCapability(id);
  return profile && SIMULATED.has(id) ? { ...profile, status: 'AVAILABLE' } : profile;
};

function contract(authorizedTools, overrides = {}) {
  return createMissionContract({
    objective: 'Objetivo.', constraints: ['c'], autonomyLevel: 'A1', authorizedTools,
    passCriteria: ['p'], stopCriteria: ['s'], requiredEvidence: ['e'], ...overrides,
  }, { describeCapability: simulatedDescribe });
}

const memoryTask = { agentRole: 'memory', requiredCapabilities: ['memory.search'], risk: 'low', privacyClass: 'INTERNAL' };

test('routes to the specialist agent and its coordinator, deterministically', () => {
  const route = routeTask({ task: memoryTask, contract: contract(['memory.search']) });
  assert.equal(route.decision, ROUTE_DECISIONS.ROUTED);
  assert.equal(route.agentId, 'memory-agent');
  assert.equal(route.coordinatorId, 'DATA_COORDINATOR');
  assert.equal(route.reason, 'specialist_match');
  assert.equal(route.requiresHumanGate, false);
  assert.deepEqual(routeTask({ task: memoryTask, contract: contract(['memory.search']) }), route);
});

test('fallbacks are listed and excluded agents are never chosen', () => {
  const extra = { ...AGENT_DECLARATIONS.find((agent) => agent.id === 'memory-agent'), id: 'memory-agent-b', role: 'memory-b' };
  const registry = createAgentRegistry({ declarations: [...AGENT_DECLARATIONS, extra] });
  const route = routeTask({ task: memoryTask, contract: contract(['memory.search']), registry });
  assert.deepEqual(route.fallbackAgentIds, ['memory-agent-b']);
  const fallback = routeTask({ task: memoryTask, contract: contract(['memory.search']), registry, excludeAgentIds: ['memory-agent'] });
  assert.equal(fallback.agentId, 'memory-agent-b');
  assert.equal(fallback.reason, 'capability_match');
  const none = routeTask({ task: memoryTask, contract: contract(['memory.search']), registry, excludeAgentIds: ['memory-agent', 'memory-agent-b'] });
  assert.equal(none.decision, ROUTE_DECISIONS.BLOCKED);
  assert.equal(none.reason, 'no_untried_agent');
});

test('blocked and not implemented agents are never used', () => {
  const research = routeTask({
    task: { agentRole: 'research', requiredCapabilities: ['research.company'], privacyClass: 'PUBLIC' },
    contract: createMissionContract({
      objective: 'O.', constraints: ['c'], autonomyLevel: 'A1', authorizedTools: ['research.company'],
      passCriteria: ['p'], stopCriteria: ['s'], requiredEvidence: ['e'],
    }),
  });
  assert.equal(research.decision, ROUTE_DECISIONS.BLOCKED);
  assert.equal(research.reason, 'agent_not_implemented');
  const workflow = routeTask({
    task: { agentRole: 'workflow', requiredCapabilities: ['mission.track'], privacyClass: 'INTERNAL' },
    contract: createMissionContract({
      objective: 'O.', constraints: ['c'], autonomyLevel: 'A1', authorizedTools: ['mission.track'],
      passCriteria: ['p'], stopCriteria: ['s'], requiredEvidence: ['e'],
    }),
  });
  // workflow-agent is PARTIAL (mission.plan works) but mission.track itself
  // is blocked; the Supervisor Decision later refuses that capability.
  assert.equal(workflow.agentId, 'workflow-agent');
});

test('capabilities outside the contract, prohibited or missing are never selected', () => {
  assert.equal(routeTask({ task: memoryTask, contract: contract(['approvals.read']) }).reason, 'capability_not_authorized');
  assert.equal(routeTask({ task: { ...memoryTask, requiredCapabilities: ['gmail.send'] }, contract: contract(['memory.search']) }).reason, 'capability_prohibited');
  const empty = routeTask({ task: { ...memoryTask, requiredCapabilities: [] }, contract: contract(['memory.search']) });
  assert.equal(empty.decision, ROUTE_DECISIONS.NEEDS_INFORMATION);
  assert.equal(routeTask({ task: memoryTask }).reason, 'missing_contract');
});

test('privacy first: SECRET never reaches a model-backed agent, CONFIDENTIAL needs an approved provider+region', () => {
  const registry = createAgentRegistry({ describeCapability: simulatedDescribe });
  const task = { agentRole: 'research', requiredCapabilities: ['research.company'], risk: 'low' };
  const c = contract(['research.company']);
  const policy = { confidentialProviders: [{ providerId: 'sim', region: 'eu' }], internalProviders: [{ providerId: 'sim' }] };
  const assigned = { providerId: 'sim', region: 'eu' };
  assert.equal(routeTask({ task: { ...task, privacyClass: 'SECRET' }, contract: c, registry, privacyPolicy: policy, providerAssignment: assigned, budgetRemainingUsd: 1 }).reason, 'privacy_provider_not_allowed');
  assert.equal(routeTask({ task: { ...task, privacyClass: 'CONFIDENTIAL' }, contract: c, registry, budgetRemainingUsd: 1 }).reason, 'privacy_provider_not_allowed');
  assert.equal(routeTask({ task: { ...task, privacyClass: 'CONFIDENTIAL' }, contract: c, registry, privacyPolicy: policy, providerAssignment: { providerId: 'sim', region: 'us' }, budgetRemainingUsd: 1 }).reason, 'privacy_provider_not_allowed');
  assert.equal(routeTask({ task: { ...task, privacyClass: 'CONFIDENTIAL' }, contract: c, registry, privacyPolicy: policy, providerAssignment: assigned, budgetRemainingUsd: 1 }).agentId, 'research-agent');
  // Deterministic local agents are fine with SECRET context.
  assert.equal(routeTask({ task: { ...memoryTask, privacyClass: 'SECRET' }, contract: contract(['memory.search']) }).agentId, 'memory-agent');
});

test('cost proportional: model-backed agents need budget, deterministic ones do not', () => {
  const registry = createAgentRegistry({ describeCapability: simulatedDescribe });
  const task = { agentRole: 'research', requiredCapabilities: ['research.company'], risk: 'low', privacyClass: 'PUBLIC' };
  assert.equal(routeTask({ task, contract: contract(['research.company']), registry, budgetRemainingUsd: 0 }).reason, 'budget_exhausted');
  assert.equal(routeTask({ task, contract: contract(['research.company']), registry, budgetRemainingUsd: 0.1 }).agentId, 'research-agent');
  assert.equal(routeTask({ task: memoryTask, contract: contract(['memory.search']), budgetRemainingUsd: 0 }).agentId, 'memory-agent');
});

test('risk and human gate: approval capabilities and high risk always require a human', () => {
  const draft = routeTask({
    task: { agentRole: 'email', requiredCapabilities: ['gmail.draft'], risk: 'medium', privacyClass: 'PUBLIC' },
    contract: contract(['gmail.draft']), budgetRemainingUsd: 1,
  });
  assert.equal(draft.agentId, 'email-agent');
  assert.equal(draft.requiresHumanGate, true);
  assert.equal(routeTask({ task: { ...memoryTask, risk: 'high' }, contract: contract(['memory.search']) }).reason, 'risk_not_accepted');
  const a3 = routeTask({ task: { ...memoryTask, autonomyLevel: 'A3' }, contract: contract(['memory.search']) });
  assert.equal(a3.requiresHumanGate, true);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { describeCapability } = require('./capability-registry');
const { BASELINE_PROHIBITED_ACTIONS } = require('./xatai-core');
const {
  AGENT_DECLARATIONS, AGENT_STATUS, COORDINATORS, HIERARCHY_LEVELS, SUPERVISOR_ID, createAgentRegistry, defaultRegistry,
} = require('./agent-registry');

function errorCode(fn) {
  try { fn(); } catch (error) { return error.code; }
  return null;
}

test('hierarchy: supervisor -> 7 coordinators -> 20 agents, every agent under a known coordinator', () => {
  assert.deepEqual(Object.keys(HIERARCHY_LEVELS), ['SUPERVISOR', 'COORDINATOR', 'AGENT', 'SUBAGENT']);
  assert.equal(defaultRegistry.listCoordinators().length, 7);
  assert.equal(defaultRegistry.listAgents().length, 20);
  for (const coordinator of defaultRegistry.listCoordinators()) {
    assert.equal(coordinator.parent, SUPERVISOR_ID);
    assert.equal(coordinator.level, 'COORDINATOR');
  }
  assert.deepEqual(defaultRegistry.hierarchyOf('email-agent'), [SUPERVISOR_ID, 'COMMUNICATION_COORDINATOR', 'email-agent']);
  const roles = defaultRegistry.listAgents().map((agent) => agent.role).sort();
  assert.deepEqual(roles, ['calendar', 'code', 'communication', 'cost', 'data-analysis', 'documents', 'drive', 'email', 'memory',
    'opportunity', 'proposal', 'quality', 'repository-analysis', 'research', 'security-privacy', 'test', 'verifier',
    'web-research', 'web-search', 'workflow']);
});

test('every agent declares the full governance contract', () => {
  const fields = ['id', 'role', 'coordinator', 'capabilities', 'allowedAutonomy', 'riskClasses', 'costClass',
    'requiresExternalProvider', 'canPlan', 'canExecute', 'canVerify', 'canCreateSubagents', 'maxSubagents',
    'prohibitedCapabilities', 'status'];
  for (const agent of defaultRegistry.listAgents()) {
    for (const field of fields) assert.ok(Object.hasOwn(agent, field), `${agent.id}.${field}`);
    assert.ok(Object.isFrozen(agent));
    for (const action of BASELINE_PROHIBITED_ACTIONS) assert.ok(agent.prohibitedCapabilities.includes(action));
    assert.ok(agent.capabilities.every((id) => !agent.prohibitedCapabilities.includes(id)));
    assert.equal(agent.allowedAutonomy, 'A1');
  }
});

test('status is derived from the capability registry, never faked', () => {
  const status = (id) => defaultRegistry.getAgent(id).status;
  assert.equal(status('email-agent'), AGENT_STATUS.AVAILABLE);
  assert.equal(status('memory-agent'), AGENT_STATUS.AVAILABLE);
  assert.equal(status('verifier-agent'), AGENT_STATUS.AVAILABLE);
  assert.equal(status('workflow-agent'), AGENT_STATUS.PARTIAL);
  // V2.1: research is real but limited to the official site (PARTIAL);
  // analysis, opportunity, proposal and communication run locally.
  assert.equal(status('research-agent'), AGENT_STATUS.PARTIAL);
  assert.equal(status('web-research-agent'), AGENT_STATUS.PARTIAL);
  for (const id of ['data-analysis-agent', 'opportunity-agent', 'proposal-agent', 'communication-agent']) {
    assert.equal(status(id), AGENT_STATUS.AVAILABLE, id);
  }
  for (const id of ['web-search-agent', 'repository-analysis-agent', 'code-agent', 'test-agent', 'documents-agent', 'drive-agent']) {
    assert.equal(status(id), AGENT_STATUS.NOT_IMPLEMENTED, id);
  }
  for (const agent of defaultRegistry.listAgents()) {
    if (agent.status === AGENT_STATUS.AVAILABLE) {
      assert.ok(agent.capabilities.every((id) => describeCapability(id).status === 'AVAILABLE'), agent.id);
    }
  }
});

test('only the verifier verifies, and the verifier never executes', () => {
  const verifiers = defaultRegistry.listAgents().filter((agent) => agent.canVerify);
  assert.deepEqual(verifiers.map((agent) => agent.id), ['verifier-agent']);
  assert.equal(verifiers[0].canExecute, false);
});

test('email and calendar agents can never hold send/create', () => {
  assert.ok(defaultRegistry.getAgent('email-agent').prohibitedCapabilities.includes('gmail.send'));
  assert.ok(defaultRegistry.getAgent('calendar-agent').prohibitedCapabilities.includes('calendar.create'));
  assert.equal(defaultRegistry.getAgent('email-agent').requiresExternalProvider, true);
});

test('agent actors are recognized so they can never act as a human', () => {
  for (const id of [SUPERVISOR_ID, ...COORDINATORS, 'email-agent', 'subagent:t-1:0']) {
    assert.equal(defaultRegistry.isAgentActor(id), true, id);
  }
  assert.equal(defaultRegistry.isAgentActor('human:jose'), false);
});

test('invalid declarations are rejected (fail closed)', () => {
  const base = AGENT_DECLARATIONS[0];
  assert.equal(errorCode(() => createAgentRegistry({ declarations: [base, base] })), 'AGENT_INVALID_ID');
  assert.equal(errorCode(() => createAgentRegistry({ declarations: [{ ...base, coordinator: 'ROGUE' }] })), 'AGENT_UNKNOWN_COORDINATOR');
  assert.equal(errorCode(() => createAgentRegistry({ declarations: [{ ...base, capabilities: ['gmail.send'] }] })), 'AGENT_PROHIBITED_CAPABILITY');
  assert.equal(errorCode(() => createAgentRegistry({ declarations: [{ ...base, allowedAutonomy: 'A9' }] })), 'AGENT_INVALID_AUTONOMY');
  assert.equal(errorCode(() => createAgentRegistry({ declarations: [{ ...base, maxSubagents: 0, canCreateSubagents: true }] })), 'AGENT_INVALID_SUBAGENTS');
});

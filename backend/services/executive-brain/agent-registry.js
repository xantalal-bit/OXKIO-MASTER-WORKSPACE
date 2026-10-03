'use strict';

const { CAPABILITY_STATUS, describeCapability } = require('./capability-registry');
const { LEVELS: COST_LEVELS } = require('../runtime/cost-policy');
const { AUTONOMY_LEVELS, BASELINE_PROHIBITED_ACTIONS } = require('./xatai-core');

// XATAI CORE V2 (03/10/2026): Agent Registry — the governance contract of the
// logical hierarchy SUPERVISOR -> COORDINATOR -> AGENT -> SUBAGENT. It
// declares who may do what; it starts no process and implements nothing.
//
// Status is never declared, it is derived from the Capability Registry: an
// agent is only as available as the capabilities it uses. Agents whose
// capabilities have no implementation are NOT_IMPLEMENTED, never faked.
// The legacy runtime holder (backend/agents/base/agentRegistry.js) keeps
// owning live agent instances; this registry is the declarative layer the
// Mission Engine and the router reason about.

const HIERARCHY_LEVELS = Object.freeze({
  SUPERVISOR: 'SUPERVISOR',
  COORDINATOR: 'COORDINATOR',
  AGENT: 'AGENT',
  SUBAGENT: 'SUBAGENT',
});

const AGENT_STATUS = CAPABILITY_STATUS;

const SUPERVISOR_ID = 'xatai-supervisor';

const COORDINATORS = Object.freeze([
  'RESEARCH_COORDINATOR',
  'CODE_COORDINATOR',
  'DATA_COORDINATOR',
  'COMMUNICATION_COORDINATOR',
  'WORKFLOW_COORDINATOR',
  'DOCUMENT_COORDINATOR',
  'EXECUTIVE_COORDINATOR',
]);

const COST_RANK = Object.freeze([
  COST_LEVELS.DETERMINISTIC, COST_LEVELS.SKILL, COST_LEVELS.SMALL_MODEL,
  COST_LEVELS.PREMIUM_MODEL, COST_LEVELS.MULTI_AGENT,
]);
const MODEL_COST_CLASSES = new Set([COST_LEVELS.SMALL_MODEL, COST_LEVELS.PREMIUM_MODEL, COST_LEVELS.MULTI_AGENT]);

function agent(id, role, coordinator, capabilities, options = {}) {
  return Object.freeze({
    id,
    role,
    coordinator,
    capabilities: Object.freeze(capabilities),
    allowedAutonomy: options.allowedAutonomy || 'A1',
    riskClasses: Object.freeze(options.riskClasses || ['low']),
    canPlan: options.canPlan === true,
    canExecute: options.canExecute !== false,
    canVerify: options.canVerify === true,
    canCreateSubagents: options.maxSubagents > 0,
    maxSubagents: options.maxSubagents || 0,
    prohibitedCapabilities: Object.freeze(options.prohibitedCapabilities || []),
  });
}

// canExecute means "may act as the executor of a task" (produce a result
// under its contract). Whether that result may have a material effect is
// decided by the Supervisor Decision, never by the agent.
const AGENT_DECLARATIONS = Object.freeze([
  agent('research-agent', 'research', 'RESEARCH_COORDINATOR', ['research.company'], { canPlan: true, maxSubagents: 3 }),
  agent('web-research-agent', 'web-research', 'RESEARCH_COORDINATOR', ['research.web'], { maxSubagents: 2 }),
  // V2.1: web.search (finding sources without a known URL) is declared and
  // NOT_IMPLEMENTED until a search provider is approved and connected.
  agent('web-search-agent', 'web-search', 'RESEARCH_COORDINATOR', ['web.search']),
  agent('repository-analysis-agent', 'repository-analysis', 'CODE_COORDINATOR', ['repository.analyze'], { canPlan: true, maxSubagents: 2 }),
  agent('code-agent', 'code', 'CODE_COORDINATOR', ['code.propose_patch'], {
    riskClasses: ['low', 'medium'], prohibitedCapabilities: ['deploy', 'production_change'],
  }),
  agent('test-agent', 'test', 'CODE_COORDINATOR', ['tests.run'], { riskClasses: ['low', 'medium'] }),
  agent('verifier-agent', 'verifier', 'EXECUTIVE_COORDINATOR', ['verification.review'], { canExecute: false, canVerify: true }),
  agent('email-agent', 'email', 'COMMUNICATION_COORDINATOR', ['gmail.read', 'gmail.draft'], {
    riskClasses: ['low', 'medium'], prohibitedCapabilities: ['gmail.send'],
  }),
  agent('calendar-agent', 'calendar', 'COMMUNICATION_COORDINATOR', ['calendar.read'], { prohibitedCapabilities: ['calendar.create'] }),
  agent('documents-agent', 'documents', 'DOCUMENT_COORDINATOR', ['documents.read']),
  agent('drive-agent', 'drive', 'DOCUMENT_COORDINATOR', ['drive.search']),
  agent('memory-agent', 'memory', 'DATA_COORDINATOR', ['memory.search']),
  agent('data-analysis-agent', 'data-analysis', 'DATA_COORDINATOR', ['data.analyze'], { maxSubagents: 2 }),
  agent('opportunity-agent', 'opportunity', 'DATA_COORDINATOR', ['opportunity.analyze']),
  agent('proposal-agent', 'proposal', 'COMMUNICATION_COORDINATOR', ['proposal.compose']),
  agent('communication-agent', 'communication', 'COMMUNICATION_COORDINATOR', ['communication.compose', 'commercial.handoff'], {
    riskClasses: ['low', 'medium'], prohibitedCapabilities: ['gmail.send'],
  }),
  agent('workflow-agent', 'workflow', 'WORKFLOW_COORDINATOR', ['mission.plan', 'mission.track'], { canPlan: true }),
  agent('quality-agent', 'quality', 'EXECUTIVE_COORDINATOR', ['quality.record']),
  agent('cost-agent', 'cost', 'EXECUTIVE_COORDINATOR', ['cost.estimate']),
  agent('security-privacy-agent', 'security-privacy', 'EXECUTIVE_COORDINATOR', ['privacy.classify']),
]);

function fail(code) {
  const error = new TypeError(code);
  error.code = code;
  throw error;
}

function deriveStatus(profiles) {
  const usable = (profile) => profile
    && (profile.status === AGENT_STATUS.AVAILABLE || profile.status === AGENT_STATUS.PARTIAL);
  if (profiles.length > 0 && profiles.every((profile) => profile && profile.status === AGENT_STATUS.AVAILABLE)) {
    return AGENT_STATUS.AVAILABLE;
  }
  if (profiles.some(usable)) return AGENT_STATUS.PARTIAL;
  if (profiles.some((profile) => profile && profile.status === AGENT_STATUS.BLOCKED)) return AGENT_STATUS.BLOCKED;
  return AGENT_STATUS.NOT_IMPLEMENTED;
}

function highestCostClass(profiles) {
  return profiles.reduce((current, profile) => {
    const candidate = profile && COST_RANK.includes(profile.costClass) ? profile.costClass : current;
    return COST_RANK.indexOf(candidate) > COST_RANK.indexOf(current) ? candidate : current;
  }, COST_LEVELS.DETERMINISTIC);
}

function validateDeclarations(declarations) {
  const ids = new Set();
  for (const declaration of declarations) {
    if (!declaration || typeof declaration.id !== 'string' || ids.has(declaration.id)) fail('AGENT_INVALID_ID');
    ids.add(declaration.id);
    if (!COORDINATORS.includes(declaration.coordinator)) fail('AGENT_UNKNOWN_COORDINATOR');
    if (!Object.hasOwn(AUTONOMY_LEVELS, declaration.allowedAutonomy)) fail('AGENT_INVALID_AUTONOMY');
    if (!Array.isArray(declaration.capabilities) || declaration.capabilities.length === 0) fail('AGENT_NO_CAPABILITIES');
    if (declaration.capabilities.some((id) => declaration.prohibitedCapabilities.includes(id)
      || BASELINE_PROHIBITED_ACTIONS.includes(id))) {
      fail('AGENT_PROHIBITED_CAPABILITY');
    }
    if (!Number.isInteger(declaration.maxSubagents) || declaration.maxSubagents < 0
      || declaration.canCreateSubagents !== declaration.maxSubagents > 0) {
      fail('AGENT_INVALID_SUBAGENTS');
    }
  }
}

// describeCapability is injectable only for controlled simulations (see
// xatai-core createMissionContract); production uses the canonical registry.
function createAgentRegistry({ describeCapability: describe = describeCapability, declarations = AGENT_DECLARATIONS } = {}) {
  validateDeclarations(declarations);
  const agents = new Map(declarations.map((declaration) => {
    const profiles = declaration.capabilities.map((id) => describe(id));
    const costClass = highestCostClass(profiles);
    return [declaration.id, Object.freeze({
      ...declaration,
      level: HIERARCHY_LEVELS.AGENT,
      prohibitedCapabilities: Object.freeze([...new Set([...BASELINE_PROHIBITED_ACTIONS, ...declaration.prohibitedCapabilities])]),
      costClass,
      requiresExternalProvider: MODEL_COST_CLASSES.has(costClass),
      requiresExternalConnection: profiles.some((profile) => profile && profile.requiresExternalConnection),
      requiresApproval: profiles.some((profile) => !profile || profile.requiresApproval),
      status: deriveStatus(profiles),
    })];
  }));
  const coordinators = new Map(COORDINATORS.map((id) => [id, Object.freeze({
    id,
    level: HIERARCHY_LEVELS.COORDINATOR,
    parent: SUPERVISOR_ID,
    agentIds: Object.freeze([...agents.values()].filter((item) => item.coordinator === id).map((item) => item.id)),
  })]));

  return Object.freeze({
    supervisorId: SUPERVISOR_ID,
    getAgent: (id) => agents.get(id) || null,
    listAgents: () => [...agents.values()],
    getCoordinator: (id) => coordinators.get(id) || null,
    listCoordinators: () => [...coordinators.values()],
    // Any id that belongs to the hierarchy is an agent actor: it can never
    // approve, certify or change a contract on behalf of a human.
    isAgentActor: (id) => id === SUPERVISOR_ID || coordinators.has(id) || agents.has(id)
      || (typeof id === 'string' && id.startsWith('subagent:')),
    hierarchyOf: (id) => {
      const found = agents.get(id);
      return found ? Object.freeze([SUPERVISOR_ID, found.coordinator, found.id]) : null;
    },
  });
}

const defaultRegistry = createAgentRegistry();

module.exports = {
  AGENT_DECLARATIONS,
  AGENT_STATUS,
  COORDINATORS,
  COST_RANK,
  HIERARCHY_LEVELS,
  SUPERVISOR_ID,
  createAgentRegistry,
  defaultRegistry,
};

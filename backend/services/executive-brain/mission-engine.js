'use strict';

const { randomUUID } = require('node:crypto');
const { describeCapability } = require('./capability-registry');
const { createAgentRegistry, defaultRegistry, HIERARCHY_LEVELS } = require('./agent-registry');
const { ROUTE_DECISIONS, routeTask } = require('./agent-router');
const {
  DEFAULT_PRIVACY_POLICY, PRIVACY_CLASSES, classifyContext, maxPrivacyClass,
} = require('./privacy-gate');
const { getBlueprint } = require('./mission-blueprints');
const {
  ENGINE_STATES, TASK_STATUS, TERMINAL_ENGINE_STATES, canTransition, transition,
} = require('./mission-engine-states');
const {
  createMissionQualityReporter, createMissionTrace,
} = require('./mission-observability');
const {
  CONVERGENCE_ACTIONS, SUPERVISOR_DECISIONS, VERIFICATION_VERDICTS,
  autonomyRank, createMissionContract, createVerificationRequest, decideSupervision,
  evaluateTaskConvergence, isRepeatedAttempt, runVerification, verifyMission,
} = require('./xatai-core');
const {
  MissionDomainError, cloneDomain, createMission: createQueueMission, freezeDomain, normalizeCriteria,
  normalizeRequiredText, validateIdentifier, validateTaskGraph,
} = require('../mission-queue/mission-contract');
const { addTask: addQueueTask } = require('../mission-queue/mission-state-machine');
const { DEFAULT_CATALOG, estimateCatalogCostUsd, normalizeCatalog } = require('../runtime/model-cost-catalog');
const {
  LEVELS: COST_LEVELS, normalizePolicy, remainingBudgetUsd, selectExecutionLevel,
} = require('../runtime/cost-policy');

// XATAI CORE V2 (03/10/2026): Mission Engine. It turns one approved mission
// contract into a plan of task contracts, routes each task through the
// agent hierarchy, gates it (privacy, cost, Supervisor Decision), runs only
// what the gate allows (A1: read/analyze/prepare, through injected
// executors, never a provider or a material action), verifies every result
// with an independent verifier, replans through the Convergence Sentinel and
// closes with a traceable verdict.
//
// It reuses, never duplicates: xatai-core (contract, autonomy, sentinel,
// verifier, supervisor decision), the capability registry, the cost policy
// and reviewed cost catalog, the Quality Incident Registry and the Mission Queue domain (a plan
// projects onto a PROPOSED Mission Queue record). executionEnabled is a
// constant false here: nothing in this module can switch it on.

const EXECUTION_POLICY = Object.freeze({ executionEnabled: false });
const MISSION_VERIFIER_ID = 'verifier-agent';
const DEFAULT_LIMITS = Object.freeze({ maxTaskAttempts: 3, missionRetryBudget: 4, taskTimeoutMs: 30000 });
const RISK_RANK = Object.freeze({ low: 0, medium: 1, high: 2 });
const EVIDENCE_PATTERN = /^[A-Za-z0-9:_.#-]{1,128}$/;
const HUMAN_ACTOR_PATTERN = /^human:[A-Za-z0-9_.-]{1,64}$/;

// Worst decision wins when several gates speak about one task.
const DECISION_RANK = Object.freeze({
  CAN_EXECUTE: 0, NEEDS_APPROVAL: 1, SAFE_DRAFT_ONLY: 2, NEEDS_CONNECTION: 3, NEEDS_INFORMATION: 4, BLOCKED: 5,
});
const DECISION_TO_TASK_STATUS = Object.freeze({
  NEEDS_APPROVAL: TASK_STATUS.NEEDS_APPROVAL,
  SAFE_DRAFT_ONLY: TASK_STATUS.NEEDS_APPROVAL,
  NEEDS_CONNECTION: TASK_STATUS.NEEDS_CONNECTION,
  NEEDS_INFORMATION: TASK_STATUS.NEEDS_INFORMATION,
  BLOCKED: TASK_STATUS.BLOCKED,
});
const WAITING_STATE_PRIORITY = Object.freeze([
  [TASK_STATUS.BLOCKED, ENGINE_STATES.BLOCKED],
  [TASK_STATUS.NEEDS_INFORMATION, ENGINE_STATES.NEEDS_INFORMATION],
  [TASK_STATUS.NEEDS_CONNECTION, ENGINE_STATES.NEEDS_CONNECTION],
  [TASK_STATUS.NEEDS_APPROVAL, ENGINE_STATES.NEEDS_APPROVAL],
]);
// Routing reasons that mean "the system cannot do this" (Quality Loop) as
// opposed to "a human has not authorized this yet" (normal gate).
const ROUTING_INCIDENTS = Object.freeze({
  no_agent_for_capability: 'routing_impossible',
  agent_not_implemented: 'routing_impossible',
  agent_blocked: 'agent_unavailable',
});
// Sentinel failure kinds that only a human can resolve.
const HUMAN_FAILURE_STATUS = Object.freeze({
  auth: TASK_STATUS.NEEDS_CONNECTION,
  connection: TASK_STATUS.NEEDS_CONNECTION,
  permission: TASK_STATUS.NEEDS_APPROVAL,
  budget: TASK_STATUS.NEEDS_APPROVAL,
});

function fail(code, message = code) {
  throw new MissionDomainError(code, message);
}

function worst(left, right) {
  return DECISION_RANK[right.decision] > DECISION_RANK[left.decision] ? right : left;
}

function textList(value) {
  return Array.isArray(value) ? value : [];
}

// ---------------------------------------------------------------- contracts

// Task Contract: a task never holds more than its mission. Capabilities must
// be a subset of the mission's, prohibitions a superset, autonomy at most the
// mission's, and the objective is the task's own fixed text.
function createTaskContract(missionContract, spec) {
  const authorized = textList(spec.authorizedCapabilities);
  if (authorized.some((id) => !missionContract.authorizedTools.includes(id))) {
    fail('task_capability_exceeds_mission', 'A task cannot hold a capability its mission does not authorize.');
  }
  if (authorized.some((id) => missionContract.prohibitedActions.includes(id))) {
    fail('task_capability_prohibited', 'A task cannot hold a prohibited capability.');
  }
  const autonomyLevel = spec.autonomyLevel || missionContract.autonomyLevel;
  const rank = autonomyRank(autonomyLevel);
  if (rank === null || rank > autonomyRank(missionContract.autonomyLevel)) {
    fail('task_autonomy_exceeds_mission', 'A task cannot run above its mission autonomy.');
  }
  const expectedEvidence = textList(spec.expectedEvidence);
  if (expectedEvidence.length === 0) fail('task_evidence_required', 'A task must declare its expected evidence.');
  return freezeDomain({
    taskId: validateIdentifier(spec.taskId, 'taskId'),
    missionId: spec.missionId,
    objective: normalizeRequiredText(spec.objective, 'objective', 500),
    inputs: [...textList(spec.inputs)],
    dependencies: [...textList(spec.dependencies)],
    authorizedCapabilities: [...authorized],
    prohibitedActions: [...new Set([...missionContract.prohibitedActions, ...textList(spec.prohibitedActions)])],
    assignedCoordinator: spec.assignedCoordinator || null,
    assignedAgent: spec.assignedAgent || null,
    autonomyLevel,
    expectedEvidence: [...expectedEvidence],
    passCriteria: normalizeCriteria(spec.passCriteria, 'passCriteria'),
    retryPolicy: { strategy: 'convergence_sentinel', maxAttempts: spec.maxAttempts || DEFAULT_LIMITS.maxTaskAttempts },
    timeoutPolicy: { timeoutMs: spec.timeoutMs || DEFAULT_LIMITS.taskTimeoutMs },
    humanGate: spec.humanGate || null,
    attempt: spec.attempt || null,
  });
}

// Subagent: an ephemeral worker inside one task. It inherits the task
// contract and can only narrow it: same objective, subset of capabilities,
// same or lower autonomy, every prohibition kept, within maxSubagents.
function createSubagentContract(taskContract, parentAgent, request = {}) {
  if (!parentAgent || !parentAgent.canCreateSubagents) fail('subagent_not_allowed', 'This agent cannot create subagents.');
  const index = Number.isInteger(request.index) ? request.index : 0;
  if (index < 0 || index >= parentAgent.maxSubagents) fail('subagent_limit_reached', 'Subagent limit reached.');
  if (request.objective !== undefined && request.objective !== taskContract.objective) {
    fail('subagent_objective_change', 'A subagent cannot change the task objective.');
  }
  const capabilities = request.capabilities === undefined ? taskContract.authorizedCapabilities : request.capabilities;
  if (!Array.isArray(capabilities) || capabilities.some((id) => !taskContract.authorizedCapabilities.includes(id))) {
    fail('subagent_capability_escalation', 'A subagent cannot widen the task capabilities.');
  }
  const autonomyLevel = request.autonomyLevel || taskContract.autonomyLevel;
  const rank = autonomyRank(autonomyLevel);
  if (rank === null || rank > autonomyRank(taskContract.autonomyLevel)) {
    fail('subagent_autonomy_escalation', 'A subagent cannot raise autonomy.');
  }
  if (request.prohibitedActions !== undefined
    && taskContract.prohibitedActions.some((id) => !request.prohibitedActions.includes(id))) {
    fail('subagent_constraint_removal', 'A subagent cannot drop a prohibition.');
  }
  return freezeDomain({
    subagentId: `subagent:${taskContract.taskId}:${index}`,
    level: HIERARCHY_LEVELS.SUBAGENT,
    parentAgentId: parentAgent.id,
    taskId: taskContract.taskId,
    objective: taskContract.objective,
    authorizedCapabilities: [...capabilities],
    prohibitedActions: [...taskContract.prohibitedActions],
    autonomyLevel,
    canCreateSubagents: false,
    canVerify: false,
  });
}

// ------------------------------------------------------------------- engine

function createMissionEngine({
  describeCapability: describe = describeCapability,
  registry = null,
  costCatalog = DEFAULT_CATALOG,
  costPolicy: costPolicyInput = {},
  costBasisFor = () => null,
  privacyPolicy = DEFAULT_PRIVACY_POLICY,
  providerAssignment = null,
  connections = {},
  qualityRegistry = null,
  trace = null,
  now = () => new Date().toISOString(),
  idFactory = () => randomUUID(),
  limits = {},
} = {}) {
  const agents = registry || (describe === describeCapability ? defaultRegistry : createAgentRegistry({ describeCapability: describe }));
  const missionTrace = trace || createMissionTrace({ now });
  const quality = createMissionQualityReporter(qualityRegistry);
  const settings = Object.freeze({ ...DEFAULT_LIMITS, ...limits });
  const costPolicy = normalizePolicy(costPolicyInput);
  const catalog = normalizeCatalog(costCatalog);

  const next = (state, mutate) => {
    const draft = cloneDomain(state);
    mutate(draft);
    return freezeDomain(draft);
  };
  const move = (draft, to, reason) => {
    const moved = transition(draft.engine, to, { reason, at: now() });
    draft.engine = { state: moved.state, history: [...moved.history] };
  };
  const record = (draft, task, action, extra = {}) => missionTrace.record({
    missionId: draft.missionId,
    taskId: task ? task.taskId : null,
    coordinator: task ? task.assignedCoordinator : null,
    agent: task ? task.assignedAgent : null,
    action,
    decision: extra.decision || (task ? task.gate.decision : null),
    evidenceRef: extra.evidenceRef || null,
    verification: extra.verification || null,
    status: extra.status || (task ? task.status : draft.engine.state),
  });
  const missionBudget = (draft) => Math.min(draft.limits.maxCostUsd, costPolicy.missionBudgetUsd);

  // ---- mission

  function createMission(input = {}) {
    const blueprint = input.blueprintId ? getBlueprint(input.blueprintId) : null;
    if (input.blueprintId && !blueprint) fail('unknown_blueprint', 'Unknown mission blueprint.');
    const contract = createMissionContract({
      missionId: input.missionId || `mission-${idFactory('mission')}`,
      objective: input.objective,
      constraints: input.constraints,
      knownContext: input.knownContext,
      missingInformation: input.missingInformation,
      autonomyLevel: input.autonomyLevel || 'A1',
      authorizedTools: input.authorizedCapabilities,
      prohibitedActions: input.prohibitedActions,
      passCriteria: input.passCriteria,
      stopCriteria: input.stopCriteria,
      requiredEvidence: input.requiredEvidence,
    }, { describeCapability: describe });
    const limitsInput = input.limits || {};
    const maxCostUsd = Number.isFinite(limitsInput.maxCostUsd) && limitsInput.maxCostUsd >= 0
      ? limitsInput.maxCostUsd : costPolicy.missionBudgetUsd;
    const maxRisk = Object.hasOwn(RISK_RANK, limitsInput.maxRisk) ? limitsInput.maxRisk : 'medium';
    const state = {
      missionId: contract.missionId,
      blueprintId: blueprint ? blueprint.id : null,
      contract,
      privacyClass: Object.hasOwn(PRIVACY_CLASSES, input.privacyClass) ? input.privacyClass : PRIVACY_CLASSES.INTERNAL,
      limits: { maxCostUsd, maxRisk },
      explicitPreferences: textList(input.explicitPreferences),
      engine: { state: ENGINE_STATES.CREATED, history: [] },
      tasks: [],
      order: [],
      revisions: [],
      humanDecisions: [],
      attempts: {},
      missionRetriesUsed: 0,
      estimatedSpentUsd: 0,
      verification: null,
      result: null,
      executionEnabled: false,
    };
    const created = freezeDomain(state);
    missionTrace.record({ missionId: created.missionId, action: 'mission_created', status: ENGINE_STATES.CREATED });
    return created;
  }

  // ---- planning (never executes)

  function gateTask(draft, spec, route, cost) {
    const contractView = { ...draft.contract, autonomyLevel: spec.autonomyLevel || draft.contract.autonomyLevel };
    let gate = { decision: SUPERVISOR_DECISIONS.CAN_EXECUTE, reason: 'safe_read_or_analysis' };
    if (route.decision !== ROUTE_DECISIONS.ROUTED) {
      return {
        decision: route.decision === ROUTE_DECISIONS.NEEDS_INFORMATION
          ? SUPERVISOR_DECISIONS.NEEDS_INFORMATION : SUPERVISOR_DECISIONS.BLOCKED,
        reason: route.reason,
      };
    }
    for (const capabilityId of spec.requiredCapabilities) {
      const verdict = decideSupervision({
        contract: contractView,
        capabilityId,
        connectionAvailable: connections[capabilityId] === true,
        policy: EXECUTION_POLICY,
        describeCapability: describe,
      });
      gate = worst(gate, verdict);
    }
    if (RISK_RANK[spec.risk] > RISK_RANK[draft.limits.maxRisk]) {
      gate = worst(gate, { decision: SUPERVISOR_DECISIONS.BLOCKED, reason: 'risk_limit_exceeded' });
    }
    if (cost.escalationReason === 'budget_exceeded' || cost.escalationReason === 'budget_or_value_gate_failed') {
      gate = worst(gate, { decision: SUPERVISOR_DECISIONS.BLOCKED, reason: cost.escalationReason });
    } else if (cost.escalationReason) {
      gate = worst(gate, { decision: SUPERVISOR_DECISIONS.NEEDS_APPROVAL, reason: cost.escalationReason });
    }
    if (route.requiresHumanGate) {
      gate = worst(gate, { decision: SUPERVISOR_DECISIONS.NEEDS_APPROVAL, reason: 'human_approval_required' });
    }
    return { decision: gate.decision, reason: gate.reason };
  }

  // Cost Gate: prices only ever come from the reviewed model-cost catalog
  // (entries without pricing provenance are dropped by normalizeCatalog). A
  // model-backed task without a reviewed price is UNKNOWN_COST and needs a
  // human; it is never assumed to be free. The CostController instance stays
  // owned by Executive Chat (enforced by the runtime ownership guard test); this
  // gate reuses the same catalog and the same selectExecutionLevel policy
  // without calling the controller.
  function estimateUsd(basis) {
    const modelId = basis && typeof basis.modelId === 'string' ? basis.modelId : null;
    const tokens = [basis && basis.inputTokens, basis && basis.outputTokens];
    if (!modelId || !Object.hasOwn(catalog, modelId)
      || tokens.every((value) => value === undefined)
      || tokens.some((value) => value !== undefined && !(Number.isFinite(value) && value >= 0))) {
      return null;
    }
    return estimateCatalogCostUsd(catalog, modelId, basis);
  }

  function evaluateTaskCost(draft, costClass, task) {
    const budgetRemainingUsd = remainingBudgetUsd(missionBudget(draft), draft.estimatedSpentUsd);
    const result = (estimateStatus, estimatedCostUsd, escalationReason) => ({
      costClass, estimateStatus, estimatedCostUsd, budgetRemainingUsd, escalationReason,
    });
    const estimate = estimateUsd(costClass === COST_LEVELS.DETERMINISTIC
      ? { modelId: 'local_deterministic', inputTokens: 0, outputTokens: 0 }
      : (costBasisFor(task) || {}));
    if (estimate === null) return result('UNKNOWN_COST', null, 'unknown_cost');
    if (costClass === COST_LEVELS.DETERMINISTIC) return result('ESTIMATED', estimate, null);
    if (costClass !== COST_LEVELS.SMALL_MODEL) return result('ESTIMATED', estimate, 'cost_class_requires_approval');
    if (estimate > budgetRemainingUsd) return result('ESTIMATED', estimate, 'budget_exceeded');
    const level = selectExecutionLevel({
      deterministicAvailable: false,
      smallModelEstimatedCostUsd: estimate,
      missionSpentUsd: draft.estimatedSpentUsd,
    }, costPolicy);
    if (!level.level) return result('ESTIMATED', estimate, 'budget_or_value_gate_failed');
    return result('ESTIMATED', estimate, null);
  }

  function buildTask(draft, spec, { excludeAgentIds = [], preferAgentId = null, attempt = null, agentPath = [] } = {}) {
    // The mission privacy class is a floor for every task in it.
    const privacy = classifyContext({
      declaredClass: maxPrivacyClass(spec.privacyClass, draft.privacyClass),
      capabilities: spec.requiredCapabilities,
      texts: draft.contract.knownContext,
    });
    const taskId = `${draft.missionId}:${spec.key}`;
    const budgetRemainingUsd = remainingBudgetUsd(missionBudget(draft), draft.estimatedSpentUsd);
    const route = routeTask({
      task: { ...spec, privacyClass: privacy.privacyClass, autonomyLevel: draft.contract.autonomyLevel },
      contract: draft.contract,
      registry: agents,
      privacyPolicy,
      providerAssignment,
      budgetRemainingUsd,
      excludeAgentIds,
      preferAgentId,
      describeCapability: describe,
    });
    const agent = route.agentId ? agents.getAgent(route.agentId) : null;
    const cost = evaluateTaskCost(draft, agent ? agent.costClass : COST_LEVELS.DETERMINISTIC, { ...spec, taskId });
    const gate = gateTask(draft, spec, route, cost);
    const contract = createTaskContract(draft.contract, {
      taskId,
      missionId: draft.missionId,
      objective: spec.objective,
      inputs: spec.dependsOn.map((key) => `${draft.missionId}:${key}`),
      dependencies: spec.dependsOn.map((key) => `${draft.missionId}:${key}`),
      authorizedCapabilities: spec.requiredCapabilities.filter((id) => draft.contract.authorizedTools.includes(id)
        && !draft.contract.prohibitedActions.includes(id)),
      assignedCoordinator: route.coordinatorId,
      assignedAgent: route.agentId,
      expectedEvidence: spec.expectedEvidence,
      passCriteria: spec.passCriteria,
      maxAttempts: settings.maxTaskAttempts,
      timeoutMs: settings.taskTimeoutMs,
      humanGate: { required: gate.decision !== SUPERVISOR_DECISIONS.CAN_EXECUTE, decision: gate.decision, reason: gate.reason },
      attempt: {
        ...(attempt || {
          hypothesis: 'h1', tool: spec.requiredCapabilities.join('+'), scope: 'full', prompt: 'p1', correctiveAction: null,
        }),
        agent: route.agentId,
      },
    });
    // The specialist the plan would use, shown even when routing is blocked
    // (e.g. NOT_IMPLEMENTED), so the plan says who would do it.
    const suggested = agents.listAgents().find((item) => item.role === spec.agentRole) || null;
    return {
      taskId,
      key: spec.key,
      kind: spec.kind,
      objective: spec.objective,
      agentRole: spec.agentRole,
      suggestedAgent: suggested ? suggested.id : null,
      suggestedCoordinator: suggested ? suggested.coordinator : null,
      requiredCapabilities: [...spec.requiredCapabilities],
      dependencies: contract.dependencies,
      risk: spec.risk,
      privacyClass: privacy.privacyClass,
      missionCriteria: [...spec.missionCriteria],
      assignedCoordinator: route.coordinatorId,
      assignedAgent: route.agentId,
      fallbackAgentIds: [...route.fallbackAgentIds],
      agentPath: route.agentId && agentPath[agentPath.length - 1] !== route.agentId
        ? [...agentPath, route.agentId] : [...agentPath],
      requiresApproval: gate.decision !== SUPERVISOR_DECISIONS.CAN_EXECUTE,
      requiresConnection: spec.requiredCapabilities.some((id) => {
        const profile = describe(id);
        return Boolean(profile && profile.requiresExternalConnection);
      }),
      route: { decision: route.decision, reason: route.reason },
      cost,
      gate,
      contract,
      status: gate.decision === SUPERVISOR_DECISIONS.CAN_EXECUTE ? TASK_STATUS.PLANNED : DECISION_TO_TASK_STATUS[gate.decision],
      verification: null,
      evidenceRefs: [],
      output: null,
      constraintViolations: [],
    };
  }

  function topologicalOrder(tasks, missionId) {
    // Canonical Mission Queue validation first (unknown dependency, self
    // dependency, cycle), then a stable order for display and execution.
    validateTaskGraph(tasks.map((item) => ({
      taskId: item.taskId, missionId, action: item.objective,
      status: 'PENDING', dependencies: item.dependencies, assignee: item.assignedAgent || 'unassigned',
      requiredApprovalIds: [], blocker: null, evidence: [], result: null,
      acceptanceCriteria: item.contract.passCriteria, createdAt: now(), updatedAt: now(),
      nextAction: 'pending', retryOfTaskId: null, interactionId: null, operationId: null, resourceKeys: [],
    })), missionId);
    const order = [];
    const placed = new Set();
    while (order.length < tasks.length) {
      const ready = tasks.filter((item) => !placed.has(item.taskId) && item.dependencies.every((id) => placed.has(id)));
      ready.forEach((item) => { placed.add(item.taskId); order.push(item.taskId); });
    }
    return order;
  }

  function aggregateWaitingState(tasks) {
    const open = tasks.filter((item) => item.status !== TASK_STATUS.COMPLETED);
    for (const [status, state] of WAITING_STATE_PRIORITY) {
      if (open.some((item) => item.status === status)) return state;
    }
    return ENGINE_STATES.BLOCKED;
  }

  function reportRouting(task) {
    const code = ROUTING_INCIDENTS[task.route.reason];
    if (code) quality.report(code, { relatedCapability: task.requiredCapabilities[0] });
  }

  // A mission is planned once, from CREATED, or again from NEEDS_INFORMATION
  // after a human supplied what was missing (no tasks exist yet then).
  function planMission(state, { blueprint = null } = {}) {
    const plannable = state.engine.state === ENGINE_STATES.CREATED
      || (state.engine.state === ENGINE_STATES.NEEDS_INFORMATION && state.tasks.length === 0);
    if (!plannable) fail('mission_already_planned', 'Only an unplanned mission can be planned.');
    const source = blueprint || getBlueprint(state.blueprintId);
    if (!source || !Array.isArray(source.tasks) || source.tasks.length === 0) {
      fail('mission_blueprint_required', 'A mission needs a blueprint with at least one task.');
    }
    return next(state, (draft) => {
      if (draft.contract.missingInformation.length > 0) {
        if (draft.engine.state === ENGINE_STATES.NEEDS_INFORMATION) return;
        move(draft, ENGINE_STATES.NEEDS_INFORMATION, 'missing_information');
        record(draft, null, 'plan_deferred', { decision: SUPERVISOR_DECISIONS.NEEDS_INFORMATION });
        return;
      }
      draft.tasks = source.tasks.map((spec) => buildTask(draft, {
        ...spec, dependsOn: spec.dependsOn || [], missionCriteria: spec.missionCriteria || [],
      }));
      draft.order = topologicalOrder(draft.tasks, draft.missionId);
      draft.tasks.sort((left, right) => draft.order.indexOf(left.taskId) - draft.order.indexOf(right.taskId));
      draft.tasks.forEach((item, index) => { item.order = index + 1; });
      move(draft, ENGINE_STATES.PLANNED, 'plan_created');
      draft.tasks.forEach((item) => {
        record(draft, item, 'task_planned');
        reportRouting(item);
      });
      const rootsRunnable = draft.tasks.some((item) => item.dependencies.length === 0
        && item.gate.decision === SUPERVISOR_DECISIONS.CAN_EXECUTE);
      move(draft, rootsRunnable ? ENGINE_STATES.READY : aggregateWaitingState(draft.tasks), 'plan_gated');
    });
  }

  // ---- replanning

  // A plan revision may change how a task is attempted or who does it, never
  // what the mission is for: objective, constraints, evidence and human
  // decisions are carried over untouched.
  function revisePlan(state, { taskId, action, cause, objective } = {}) {
    if (objective !== undefined && objective !== state.contract.objective) {
      fail('objective_change_forbidden', 'A plan revision cannot redefine the approved objective.');
    }
    if (!Object.hasOwn(CONVERGENCE_ACTIONS, action) || action === CONVERGENCE_ACTIONS.ESCALATE_HUMAN) {
      fail('invalid_revision_action', 'Unsupported plan revision action.');
    }
    return next(state, (draft) => applyRevision(draft, { taskId, action, cause }));
  }

  function applyRevision(draft, { taskId, action, cause }) {
    const index = draft.tasks.findIndex((item) => item.taskId === taskId);
    if (index === -1) fail('task_not_found', 'Task does not exist in mission.');
    const current = draft.tasks[index];
    const previous = current.contract.attempt || {};
    const counter = draft.revisions.filter((revision) => revision.taskId === taskId).length + 2;
    const attempt = { ...previous, correctiveAction: action };
    if (action === CONVERGENCE_ACTIONS.REFINE_PROMPT) attempt.prompt = `p${counter}`;
    if (action === CONVERGENCE_ACTIONS.REDUCE_SCOPE) attempt.scope = `reduced${counter}`;
    if (action === CONVERGENCE_ACTIONS.CHANGE_HYPOTHESIS) attempt.hypothesis = `h${counter}`;
    if (action === CONVERGENCE_ACTIONS.CHANGE_TOOL) attempt.tool = `${previous.tool}#alt${counter}`;
    const spec = BLUEPRINT_SPEC(current);
    // Agents that already failed this task are never routed to again; a
    // retry that is not CHANGE_AGENT keeps the current agent.
    const changeAgent = action === CONVERGENCE_ACTIONS.CHANGE_AGENT;
    const rebuilt = buildTask(draft, spec, {
      excludeAgentIds: changeAgent ? [...current.agentPath]
        : current.agentPath.filter((id) => id !== current.assignedAgent),
      preferAgentId: changeAgent ? null : current.assignedAgent,
      attempt,
      agentPath: current.agentPath,
    });
    rebuilt.order = current.order;
    draft.tasks[index] = rebuilt;
    draft.revisions.push({
      revision: draft.revisions.length + 1,
      taskId,
      action,
      cause: String(cause || 'unspecified').slice(0, 64),
      fromAgent: current.assignedAgent,
      toAgent: rebuilt.assignedAgent,
      objective: draft.contract.objective,
      at: now(),
    });
    record(draft, rebuilt, 'plan_revised', { decision: rebuilt.gate.decision });
  }

  // ---- execution (A1 only, injected executors, verified)

  function withTimeout(promise, timeoutMs) {
    let timer;
    const timeout = new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        const error = new Error('task_timeout');
        error.failureKind = 'timeout';
        reject(error);
      }, timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  function verifyTask(task, output) {
    const criteria = task.contract.passCriteria.map((criterion) => criterion.criterionId);
    const request = createVerificationRequest({
      claimedResult: output,
      evidence: textList(output.evidenceRefs),
      constraints: task.contract.prohibitedActions,
      checks: [
        { id: 'evidence_valid', run: (req) => (req.evidence.every((ref) => typeof ref === 'string' && EVIDENCE_PATTERN.test(ref))
          ? { verdict: VERIFICATION_VERDICTS.PASS }
          : { verdict: VERIFICATION_VERDICTS.NEEDS_REVIEW, reasons: ['evidence_format'] }) },
        { id: 'pass_criteria_met', run: () => (criteria.every((id) => textList(output.criteriaMet).includes(id))
          ? { verdict: VERIFICATION_VERDICTS.PASS }
          : { verdict: VERIFICATION_VERDICTS.FAIL, reasons: ['pass_criteria_not_demonstrated'] }) },
        { id: 'constraints_respected', run: () => (textList(output.constraintViolations).length === 0
          ? { verdict: VERIFICATION_VERDICTS.PASS }
          : { verdict: VERIFICATION_VERDICTS.FAIL, reasons: ['constraint_violated'] }) },
        { id: 'no_material_effect', run: () => (textList(output.materialEffects).length === 0
          ? { verdict: VERIFICATION_VERDICTS.PASS }
          : { verdict: VERIFICATION_VERDICTS.FAIL, reasons: ['material_effect_detected'] }) },
      ],
    });
    return runVerification(request, { verifierId: MISSION_VERIFIER_ID, executorId: task.assignedAgent });
  }

  async function executeTask(draft, task, executors) {
    task.status = TASK_STATUS.RUNNING;
    record(draft, task, 'task_started');
    const executor = executors[task.assignedAgent];
    let output = null;
    let failureKind = null;
    if (typeof executor !== 'function') {
      failureKind = 'agent_error';
      quality.report('agent_unavailable', { relatedCapability: task.requiredCapabilities[0] });
    } else {
      try {
        // The executor gets a frozen copy: it can read its contract, never
        // widen it.
        const contract = freezeDomain(cloneDomain(task.contract));
        output = await withTimeout(Promise.resolve().then(() => executor(contract)), task.contract.timeoutPolicy.timeoutMs);
        if (!output || typeof output !== 'object') {
          failureKind = 'invalid_output';
          output = null;
        } else if (output.waitingFor === 'agent' || output.waitingFor === 'tool') {
          task.status = TASK_STATUS.PLANNED;
          move(draft, output.waitingFor === 'agent' ? ENGINE_STATES.WAITING_AGENT : ENGINE_STATES.WAITING_TOOL, 'waiting');
          record(draft, task, 'task_waiting');
          return;
        }
      } catch (error) {
        failureKind = (error && error.failureKind) || 'tool_error';
      }
    }

    let verification = null;
    if (output) {
      verification = verifyTask(task, output);
      task.verification = verification;
      task.constraintViolations = textList(output.constraintViolations).map(String);
      if (verification.verdict === VERIFICATION_VERDICTS.PASS) {
        task.status = TASK_STATUS.COMPLETED;
        task.evidenceRefs = [...output.evidenceRefs];
        task.output = typeof output.summary === 'string' ? output.summary.slice(0, 2000) : null;
        draft.estimatedSpentUsd += task.cost.estimatedCostUsd || 0;
        record(draft, task, 'task_verified', {
          evidenceRef: task.evidenceRefs[0], verification: verification.verdict,
        });
        return;
      }
      if (verification.reasons.includes('constraint_violated') || verification.reasons.includes('material_effect_detected')) {
        task.status = TASK_STATUS.FAILED;
        record(draft, task, 'task_rejected', { verification: verification.verdict });
        quality.report('verifier_failure', { relatedCapability: task.requiredCapabilities[0] });
        return;
      }
      failureKind = 'verification_failed';
    }

    // Sentinel: never retry an identical attempt, respect both budgets and
    // never loop between agents.
    const attempts = draft.attempts[task.taskId] || [];
    attempts.push({ ...task.contract.attempt, agent: task.assignedAgent, outcome: 'fail', failureKind });
    draft.attempts[task.taskId] = attempts;
    const convergence = evaluateTaskConvergence({
      attempts,
      maxTaskAttempts: settings.maxTaskAttempts,
      missionRetriesUsed: draft.missionRetriesUsed,
      missionRetryBudget: settings.missionRetryBudget,
      agentPath: task.agentPath,
    });
    record(draft, task, 'task_failed', {
      verification: verification ? verification.verdict : null, decision: convergence.action || 'NONE',
    });
    if (convergence.action === CONVERGENCE_ACTIONS.ESCALATE_HUMAN || !convergence.action) {
      escalate(draft, task, failureKind, convergence.reason, verification);
      return;
    }
    move(draft, ENGINE_STATES.REPLANNING, failureKind);
    applyRevision(draft, { taskId: task.taskId, action: convergence.action, cause: failureKind });
    draft.missionRetriesUsed += 1;
    const index = draft.tasks.findIndex((item) => item.taskId === task.taskId);
    const revised = draft.tasks[index];
    if (isRepeatedAttempt(attempts, revised.contract.attempt)) {
      escalate(draft, revised, failureKind, 'identical_attempt', verification);
    } else if (revised.route.reason === 'no_untried_agent') {
      // CHANGE_AGENT with every capable agent already tried: escalate, never
      // go back to an agent that already failed this task.
      escalate(draft, revised, failureKind, 'no_untried_agent', verification);
    }
    move(draft, ENGINE_STATES.READY, 'plan_revised');
    move(draft, ENGINE_STATES.RUNNING, 'resume');
  }

  function escalate(draft, task, failureKind, reason, verification) {
    task.status = HUMAN_FAILURE_STATUS[failureKind] || TASK_STATUS.BLOCKED;
    task.gate = { decision: SUPERVISOR_DECISIONS[task.status], reason };
    if (!HUMAN_FAILURE_STATUS[failureKind]) {
      quality.report('repeated_failure', { relatedCapability: task.requiredCapabilities[0] });
      if (verification && verification.verdict === VERIFICATION_VERDICTS.FAIL) {
        quality.report('verifier_failure', { relatedCapability: task.requiredCapabilities[0] });
      }
    }
    record(draft, task, 'task_escalated', { decision: CONVERGENCE_ACTIONS.ESCALATE_HUMAN });
  }

  function missionVerdict(draft) {
    const active = draft.tasks;
    const criteria = draft.contract.passCriteria.map((criterion) => criterion.criterionId);
    const passed = active.filter((item) => item.verification && item.verification.verdict === VERIFICATION_VERDICTS.PASS);
    return verifyMission({
      tasks: active.map((item) => ({
        taskId: item.taskId,
        executorId: item.assignedAgent,
        verdict: item.status === TASK_STATUS.FAILED ? VERIFICATION_VERDICTS.FAIL
          : (item.status === TASK_STATUS.COMPLETED ? VERIFICATION_VERDICTS.PASS : null),
        evidenceRefs: item.evidenceRefs,
      })),
      verifierId: MISSION_VERIFIER_ID,
      constraintViolations: active.flatMap((item) => item.constraintViolations),
      passCriteriaDemonstrated: criteria.every((id) => passed.some((item) => item.missionCriteria.includes(id))),
    });
  }

  async function runMission(state, { executors = {} } = {}) {
    const startable = [ENGINE_STATES.READY, ENGINE_STATES.WAITING_AGENT, ENGINE_STATES.WAITING_TOOL];
    if (!startable.includes(state.engine.state)) return state;
    const draft = cloneDomain(state);
    move(draft, ENGINE_STATES.RUNNING, 'run');
    const completed = (id) => draft.tasks.some((item) => item.taskId === id && item.status === TASK_STATUS.COMPLETED);
    for (;;) {
      const task = draft.tasks.find((item) => item.status === TASK_STATUS.PLANNED
        && item.gate.decision === SUPERVISOR_DECISIONS.CAN_EXECUTE
        && item.dependencies.every(completed));
      if (!task) break;
      await executeTask(draft, task, executors);
      if (draft.engine.state !== ENGINE_STATES.RUNNING) break;
      if (draft.tasks.some((item) => item.status === TASK_STATUS.FAILED)) break;
    }
    if (draft.engine.state === ENGINE_STATES.RUNNING) settle(draft);
    return freezeDomain(draft);
  }

  function settle(draft) {
    const verification = missionVerdict(draft);
    draft.verification = verification;
    if (verification.verdict === 'FAIL') {
      move(draft, ENGINE_STATES.FAILED, verification.reasons[0]);
      draft.result = { verdict: verification.verdict, reasons: verification.reasons };
      quality.report('mission_failed');
    } else if (draft.tasks.every((item) => item.status === TASK_STATUS.COMPLETED)) {
      move(draft, ENGINE_STATES.VERIFYING, 'all_tasks_completed');
      if (verification.verdict === 'PASS') {
        move(draft, ENGINE_STATES.COMPLETED, 'verified');
        draft.result = { verdict: verification.verdict, reasons: [] };
      } else {
        move(draft, ENGINE_STATES.NEEDS_APPROVAL, 'verification_needs_review');
      }
    } else {
      move(draft, aggregateWaitingState(draft.tasks), 'waiting_on_gate');
    }
    record(draft, null, 'mission_settled', { verification: verification.verdict });
  }

  // ---- human gate

  function assertHuman(actorId) {
    if (typeof actorId !== 'string' || !HUMAN_ACTOR_PATTERN.test(actorId) || agents.isAgentActor(actorId)) {
      fail('human_actor_required', 'Only a human can decide here; agents never approve themselves.');
    }
  }

  // APPROVE is recorded and kept through every revision, but in V2 it never
  // triggers a material action: executionEnabled stays false and approved
  // drafts keep going through the existing approval queue. REJECT stops the
  // mission (fail closed): V2 never re-plans around a step a human refused.
  function recordHumanDecision(state, { actorId, taskId = null, decision, information = [] } = {}) {
    assertHuman(actorId);
    if (!['APPROVE', 'REJECT', 'PROVIDE_INFORMATION'].includes(decision)) fail('invalid_human_decision', 'Unknown decision.');
    if (TERMINAL_ENGINE_STATES.includes(state.engine.state)) fail('terminal_mission_immutable', 'Mission is closed.');
    if (decision === 'PROVIDE_INFORMATION') {
      // Information extends the known context; objective, capabilities and
      // prohibitions are rebuilt from the same contract, unchanged.
      const resolved = createMissionContract({
        ...state.contract,
        knownContext: [...state.contract.knownContext, ...textList(information)],
        missingInformation: [],
      }, { describeCapability: describe });
      return next(state, (draft) => {
        draft.contract = resolved;
        draft.humanDecisions.push({ actorId, taskId, decision, at: now() });
      });
    }
    return next(state, (draft) => {
      draft.humanDecisions.push({ actorId, taskId, decision, at: now() });
      if (decision === 'REJECT') {
        draft.tasks.filter((item) => !taskId || item.taskId === taskId).forEach((item) => {
          if (item.status !== TASK_STATUS.COMPLETED) item.status = TASK_STATUS.CANCELLED;
        });
        move(draft, ENGINE_STATES.CANCELLED, 'rejected_by_human');
        record(draft, null, 'mission_cancelled', { decision: 'REJECT' });
      } else {
        record(draft, taskId ? draft.tasks.find((item) => item.taskId === taskId) || null : null, 'human_approval', {
          decision: 'APPROVE',
        });
      }
    });
  }

  // Closing a mission that did not fully pass is a human act: the verdict
  // (PARTIAL_PASS, NEEDS_REVIEW, FAIL) is computed, never declared.
  function closeMission(state, { actorId } = {}) {
    assertHuman(actorId);
    if (TERMINAL_ENGINE_STATES.includes(state.engine.state)) fail('terminal_mission_immutable', 'Mission is closed.');
    if (!canTransition(state.engine.state, ENGINE_STATES.VERIFYING)) {
      fail('mission_not_closable', 'Only a mission waiting on a gate can be closed; cancel it otherwise.');
    }
    return next(state, (draft) => {
      const verification = missionVerdict(draft);
      draft.verification = verification;
      draft.humanDecisions.push({ actorId, taskId: null, decision: 'CLOSE', at: now() });
      move(draft, ENGINE_STATES.VERIFYING, 'closed_by_human');
      if (verification.verdict === 'PASS' || verification.verdict === 'PARTIAL_PASS') {
        move(draft, ENGINE_STATES.COMPLETED, verification.verdict.toLowerCase());
        draft.result = { verdict: verification.verdict, pendingTaskIds: verification.pendingTaskIds };
      } else if (verification.verdict === 'FAIL') {
        move(draft, ENGINE_STATES.FAILED, verification.reasons[0]);
        draft.result = { verdict: verification.verdict, reasons: verification.reasons };
        quality.report('mission_failed');
      } else {
        move(draft, ENGINE_STATES.NEEDS_APPROVAL, 'verification_needs_review');
      }
      record(draft, null, 'mission_closed', { verification: verification.verdict });
    });
  }

  // ---- Mission Queue projection (pure; nothing is persisted)

  function toMissionQueueDraft(state, scope, { projectId = 'oxkio-xatai' } = {}) {
    if (state.tasks.length === 0) fail('mission_tasks_required', 'Plan the mission before projecting it.');
    const options = { now: now(), idFactory: () => idFactory('event') };
    let projected = createQueueMission({
      missionId: state.missionId,
      title: state.contract.objective.slice(0, 200),
      objective: state.contract.objective,
      scope: 'Plan de misión XATAI (solo propuesta, sin ejecución).',
      clientId: scope.clientId,
      projectId,
      acceptanceCriteria: state.contract.passCriteria.map((criterion) => ({
        criterionId: criterion.criterionId, description: criterion.description,
      })),
      nextAction: 'Revisar el plan de misión.',
    }, scope, options);
    const events = [...projected.events];
    for (const item of state.tasks) {
      const added = addQueueTask(projected.mission, {
        taskId: item.taskId,
        missionId: state.missionId,
        action: item.objective,
        dependencies: item.dependencies,
        assignee: item.assignedAgent || 'unassigned',
        acceptanceCriteria: item.contract.passCriteria.map((criterion) => ({
          criterionId: criterion.criterionId, description: criterion.description,
        })),
        nextAction: `Decision: ${item.gate.decision}`,
      }, scope, options);
      projected = added;
      events.push(...added.events);
    }
    return freezeDomain({ mission: projected.mission, events });
  }

  return Object.freeze({
    registry: agents,
    trace: missionTrace,
    createMission,
    planMission,
    revisePlan,
    runMission,
    recordHumanDecision,
    closeMission,
    toMissionQueueDraft,
  });
}

// The spec a task was built from, recovered from the task itself so a
// revision rebuilds it with exactly the same objective and requirements.
function BLUEPRINT_SPEC(task) {
  return {
    key: task.key,
    kind: task.kind,
    objective: task.objective,
    agentRole: task.agentRole,
    requiredCapabilities: task.requiredCapabilities,
    dependsOn: task.dependencies.map((id) => id.slice(id.lastIndexOf(':') + 1)),
    risk: task.risk,
    privacyClass: task.privacyClass,
    expectedEvidence: task.contract.expectedEvidence,
    passCriteria: task.contract.passCriteria.map((criterion) => criterion.description),
    missionCriteria: task.missionCriteria,
  };
}

module.exports = {
  EXECUTION_POLICY,
  MISSION_VERIFIER_ID,
  createMissionEngine,
  createSubagentContract,
  createTaskContract,
};

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { describeCapability } = require('./capability-registry');
const { createAgentRegistry, AGENT_DECLARATIONS } = require('./agent-registry');
const { BLUEPRINTS } = require('./mission-blueprints');
const { ENGINE_STATES } = require('./mission-engine-states');
const { buildMissionMemoryRecord } = require('./mission-observability');
const {
  BASELINE_PROHIBITED_ACTIONS, createMissionContract,
} = require('./xatai-core');
const {
  EXECUTION_POLICY, createMissionEngine, createSubagentContract, createTaskContract,
} = require('./mission-engine');
const { DEFAULT_CATALOG } = require('../runtime/model-cost-catalog');
const { QualityIncidentRegistry } = require('../runtime/quality-incident-registry');
const { MISSION_STATES, TASK_STATES } = require('../mission-queue/mission-contract');
const { createEvidenceRegistry } = require('./evidence-registry');

// Controlled simulation: these capabilities are NOT_IMPLEMENTED in the
// canonical registry; tests stand them in as AVAILABLE to exercise the
// orchestration logic. Prices below are test fixtures, not provider prices.
const SIMULATED = new Set(['research.company', 'research.web', 'data.analyze', 'repository.analyze', 'code.propose_patch', 'tests.run']);
function simulatedDescribe(id) {
  const profile = describeCapability(id);
  if (!profile) return null;
  return SIMULATED.has(id) ? Object.freeze({ ...profile, status: 'AVAILABLE' }) : profile;
}
const SIM_CATALOG = Object.freeze({
  local_deterministic: DEFAULT_CATALOG.local_deterministic,
  'sim-small': {
    provider: 'sim', tier: 'small', inputUsdPerMillion: 0.2, outputUsdPerMillion: 0.8, residency: 'eu',
    privacy: 'test', pricingVersion: 'fixture-v1', pricingSource: 'test-fixture', reviewedAt: '2026-10-01',
  },
});
const SIM_PRIVACY = Object.freeze({
  publicExternalAllowed: true,
  internalProviders: [{ providerId: 'sim' }],
  confidentialProviders: [{ providerId: 'sim', region: 'eu' }],
});
const NOW = '2026-10-03T10:00:00.000Z';
const SCOPE = Object.freeze({ tenantId: 'tenant-1', userId: 'user-1', clientId: 'client-1' });

// Globally unique ids across tests, so evidence recorded in one test can
// never be in scope for a mission of another test.
let idCounter = 0;
function idFactory() {
  return (kind = 'id') => { idCounter += 1; return `${kind}-${idCounter}`; };
}

// Evidence is recorded only by a trusted tool registrar. The executor doubles
// below stand for an agent whose tool call produced evidence: the tool (not
// the agent) records it, then the agent reports the reference.
const EVIDENCE = createEvidenceRegistry({ trustedRegistrars: ['tool:sim'] });
const TOOL = EVIDENCE.registrar('tool:sim');
let evidenceCounter = 0;
function toolEvidence(contract, supports = contract.passCriteria.map((criterion) => criterion.criterionId)) {
  evidenceCounter += 1;
  const ref = `ev:${contract.taskId}:${evidenceCounter}`;
  TOOL.record({ ref, missionId: contract.missionId, taskId: contract.taskId, supports });
  return ref;
}

function simEngine(overrides = {}) {
  return createMissionEngine({
    describeCapability: simulatedDescribe,
    costCatalog: SIM_CATALOG,
    costBasisFor: () => ({ modelId: 'sim-small', inputTokens: 2000, outputTokens: 500 }),
    privacyPolicy: SIM_PRIVACY,
    providerAssignment: { providerId: 'sim', region: 'eu' },
    connections: { 'research.company': true, 'research.web': true, 'gmail.draft': true, 'gmail.read': true },
    now: () => NOW,
    idFactory: idFactory(), evidenceRegistry: EVIDENCE,
    ...overrides,
  });
}

function missionInput(blueprint, overrides = {}) {
  return {
    blueprintId: blueprint.id,
    objective: 'Objetivo de prueba aprobado.',
    constraints: [...blueprint.constraints],
    knownContext: ['company: ACME'],
    autonomyLevel: 'A1',
    authorizedCapabilities: [...new Set(blueprint.tasks.flatMap((task) => task.requiredCapabilities))],
    passCriteria: blueprint.passCriteria.map((criterion) => ({ ...criterion })),
    stopCriteria: [...blueprint.stopCriteria],
    requiredEvidence: [...blueprint.requiredEvidence],
    ...overrides,
  };
}

function passingExecutor(calls, summary = 'ok') {
  return async (contract) => {
    calls.push(contract.taskId);
    return { summary, evidenceRefs: [toolEvidence(contract)] };
  };
}

const TWO_STEP = Object.freeze({
  id: 'TWO_STEP',
  tasks: [
    { key: 'collect', objective: 'Recoger contexto de la memoria.', agentRole: 'memory', requiredCapabilities: ['memory.search'],
      dependsOn: [], privacyClass: 'INTERNAL', expectedEvidence: ['memory_refs'], passCriteria: ['Contexto recogido.'], missionCriteria: ['criterion-1'] },
    { key: 'plan', objective: 'Planificar el flujo de trabajo.', agentRole: 'workflow', requiredCapabilities: ['mission.plan'],
      dependsOn: ['collect'], privacyClass: 'INTERNAL', expectedEvidence: ['plan_ref'], passCriteria: ['Plan escrito.'], missionCriteria: ['criterion-1'] },
  ],
});

function twoStepMission(engine, overrides = {}) {
  return engine.createMission({
    objective: 'Preparar un plan interno.',
    constraints: ['Solo lectura.'],
    autonomyLevel: 'A1',
    authorizedCapabilities: ['memory.search', 'mission.plan'],
    passCriteria: ['Plan verificado.'],
    stopCriteria: ['Falta información.'],
    requiredEvidence: ['Referencias de memoria.'],
    ...overrides,
  });
}

function errorCode(fn) {
  try { fn(); } catch (error) { return error.code; }
  return null;
}

// ------------------------------------------------------------------ planning

test('plan: valid ordered plan with dependencies, agents, risk, gates and evidence', () => {
  const engine = simEngine();
  const planned = engine.planMission(engine.createMission(missionInput(BLUEPRINTS.COMPANY_PROPOSAL)));
  assert.equal(planned.tasks.length, 4);
  assert.deepEqual(planned.tasks.map((task) => task.key), ['company-research', 'web-research', 'opportunity-analysis', 'proposal-draft']);
  const analysis = planned.tasks.find((task) => task.key === 'opportunity-analysis');
  assert.deepEqual(analysis.dependencies, [`${planned.missionId}:company-research`, `${planned.missionId}:web-research`]);
  for (const task of planned.tasks) {
    assert.ok(task.order >= 1);
    assert.ok(task.requiredCapabilities.length > 0);
    assert.ok(['low', 'medium', 'high'].includes(task.risk));
    assert.equal(typeof task.requiresApproval, 'boolean');
    assert.equal(typeof task.requiresConnection, 'boolean');
    assert.ok(task.contract.passCriteria.length > 0);
    assert.ok(task.contract.expectedEvidence.length > 0);
    assert.ok(task.suggestedAgent);
  }
  assert.equal(planned.engine.state, ENGINE_STATES.READY);
  assert.equal(planned.executionEnabled, false);
});

test('plan: planning never executes anything', async () => {
  const engine = simEngine();
  const calls = [];
  const executors = Object.fromEntries(AGENT_DECLARATIONS.map((agent) => [agent.id, passingExecutor(calls)]));
  const planned = engine.planMission(engine.createMission(missionInput(BLUEPRINTS.COMPANY_PROPOSAL)));
  assert.equal(calls.length, 0);
  assert.ok(planned.tasks.every((task) => task.status !== 'COMPLETED' && task.output === null));
  assert.ok(executors);
});

test('plan: unknown dependency and dependency cycles are rejected by the canonical task graph', () => {
  const engine = simEngine();
  const base = TWO_STEP.tasks;
  const unknown = { id: 'X', tasks: [{ ...base[0], dependsOn: ['ghost'] }] };
  assert.equal(errorCode(() => engine.planMission(twoStepMission(engine), { blueprint: unknown })), 'task_dependency_not_found');
  const cycle = { id: 'X', tasks: [{ ...base[0], dependsOn: ['plan'] }, base[1]] };
  assert.equal(errorCode(() => engine.planMission(twoStepMission(engine), { blueprint: cycle })), 'task_dependency_cycle');
});

test('plan: missing information defers planning and asks; information then lets it plan', () => {
  const engine = simEngine();
  const created = engine.createMission(missionInput(BLUEPRINTS.COMPANY_PROPOSAL, {
    knownContext: [], missingInformation: ['¿Qué empresa quieres que analice?'],
  }));
  const deferred = engine.planMission(created);
  assert.equal(deferred.engine.state, ENGINE_STATES.NEEDS_INFORMATION);
  assert.equal(deferred.tasks.length, 0);
  const informed = engine.recordHumanDecision(deferred, {
    actorId: 'human:jose', decision: 'PROVIDE_INFORMATION', information: ['company: ACME'],
  });
  assert.equal(informed.contract.objective, deferred.contract.objective);
  const planned = engine.planMission(informed);
  assert.equal(planned.engine.state, ENGINE_STATES.READY);
});

test('plan: canonical registry is honest — not implemented agents block, nothing is faked', () => {
  const engine = createMissionEngine({ now: () => NOW, idFactory: idFactory(), evidenceRegistry: EVIDENCE });
  const planned = engine.planMission(engine.createMission(missionInput(BLUEPRINTS.REPOSITORY_REPAIR)));
  assert.equal(planned.engine.state, ENGINE_STATES.BLOCKED);
  assert.ok(planned.tasks.every((task) => task.gate.reason === 'agent_not_implemented' && task.assignedAgent === null));
  assert.deepEqual(planned.tasks.map((task) => task.suggestedAgent), ['repository-analysis-agent', 'code-agent', 'test-agent']);
});

// ------------------------------------------------------------ task contracts

test('task contract: never inherits more than the mission', () => {
  const mission = createMissionContract({
    objective: 'Objetivo.', constraints: ['c'], autonomyLevel: 'A1', authorizedTools: ['memory.search'],
    passCriteria: ['p'], stopCriteria: ['s'], requiredEvidence: ['e'],
  });
  const spec = {
    taskId: 'task-1', missionId: 'mission-1', objective: 'Tarea.', expectedEvidence: ['ref'], passCriteria: ['ok'],
  };
  assert.equal(errorCode(() => createTaskContract(mission, { ...spec, authorizedCapabilities: ['gmail.read'] })), 'task_capability_exceeds_mission');
  assert.equal(errorCode(() => createTaskContract(mission, { ...spec, authorizedCapabilities: ['memory.search'], autonomyLevel: 'A3' })), 'task_autonomy_exceeds_mission');
  assert.equal(errorCode(() => createTaskContract(mission, { ...spec, expectedEvidence: [] })), 'task_evidence_required');
  const contract = createTaskContract(mission, { ...spec, authorizedCapabilities: ['memory.search'], prohibitedActions: ['extra_ban'] });
  for (const action of BASELINE_PROHIBITED_ACTIONS) assert.ok(contract.prohibitedActions.includes(action));
  assert.ok(contract.prohibitedActions.includes('extra_ban'));
  assert.equal(contract.autonomyLevel, 'A1');
  assert.ok(Object.isFrozen(contract));
});

test('subagents: can only narrow the parent task, never widen, re-aim or self-replicate', () => {
  const registry = createAgentRegistry();
  const research = registry.getAgent('research-agent');
  const mission = createMissionContract({
    objective: 'Objetivo.', constraints: ['c'], autonomyLevel: 'A1', authorizedTools: ['memory.search', 'approvals.read'],
    passCriteria: ['p'], stopCriteria: ['s'], requiredEvidence: ['e'],
  });
  const task = createTaskContract(mission, {
    taskId: 'task-1', missionId: 'mission-1', objective: 'Tarea.', authorizedCapabilities: ['memory.search'],
    expectedEvidence: ['ref'], passCriteria: ['ok'],
  });
  const subagent = createSubagentContract(task, research, { index: 0 });
  assert.equal(subagent.level, 'SUBAGENT');
  assert.equal(subagent.canCreateSubagents, false);
  assert.equal(subagent.objective, task.objective);
  assert.equal(errorCode(() => createSubagentContract(task, research, { objective: 'Otro objetivo.' })), 'subagent_objective_change');
  assert.equal(errorCode(() => createSubagentContract(task, research, { capabilities: ['approvals.read'] })), 'subagent_capability_escalation');
  assert.equal(errorCode(() => createSubagentContract(task, research, { autonomyLevel: 'A2' })), 'subagent_autonomy_escalation');
  assert.equal(errorCode(() => createSubagentContract(task, research, { prohibitedActions: [] })), 'subagent_constraint_removal');
  assert.equal(errorCode(() => createSubagentContract(task, research, { index: research.maxSubagents })), 'subagent_limit_reached');
  assert.equal(errorCode(() => createSubagentContract(task, registry.getAgent('email-agent'))), 'subagent_not_allowed');
});

// ------------------------------------------------------------ gates

test('cost gate: unknown price is UNKNOWN_COST and needs a human, never free', () => {
  const engine = simEngine({ costBasisFor: () => null });
  const planned = engine.planMission(engine.createMission(missionInput(BLUEPRINTS.COMPANY_PROPOSAL)));
  const research = planned.tasks.find((task) => task.key === 'company-research');
  assert.equal(research.cost.estimateStatus, 'UNKNOWN_COST');
  assert.equal(research.cost.estimatedCostUsd, null);
  assert.equal(research.cost.escalationReason, 'unknown_cost');
  assert.equal(research.gate.decision, 'NEEDS_APPROVAL');
});

test('cost gate: reviewed catalog price is estimated; deterministic work costs the catalog zero', () => {
  const engine = simEngine();
  const planned = engine.planMission(engine.createMission(missionInput(BLUEPRINTS.COMPANY_PROPOSAL)));
  const research = planned.tasks.find((task) => task.key === 'company-research');
  assert.equal(research.cost.estimateStatus, 'ESTIMATED');
  assert.equal(research.cost.estimatedCostUsd, 0.0008);
  assert.equal(research.cost.costClass, 'small_model');
  assert.ok(research.cost.budgetRemainingUsd > 0);
  const deterministic = createMissionEngine({ now: () => NOW, idFactory: idFactory(), evidenceRegistry: EVIDENCE });
  const internal = deterministic.planMission(twoStepMission(deterministic), { blueprint: TWO_STEP });
  assert.equal(internal.tasks[0].cost.estimateStatus, 'ESTIMATED');
  assert.equal(internal.tasks[0].cost.estimatedCostUsd, 0);
});

test('cost gate: a task above the remaining mission budget is blocked', () => {
  const engine = simEngine();
  const planned = engine.planMission(engine.createMission(missionInput(BLUEPRINTS.COMPANY_PROPOSAL, { limits: { maxCostUsd: 0.0001 } })));
  const research = planned.tasks.find((task) => task.key === 'company-research');
  assert.equal(research.gate.decision, 'BLOCKED');
  assert.equal(research.gate.reason, 'budget_exceeded');
});

test('human gate: A2-A5 missions are plannable but never executable (SAFE_DRAFT_ONLY)', async () => {
  const engine = createMissionEngine({ now: () => NOW, idFactory: idFactory(), evidenceRegistry: EVIDENCE });
  const planned = engine.planMission(twoStepMission(engine, { autonomyLevel: 'A3' }), { blueprint: TWO_STEP });
  assert.ok(planned.tasks.every((task) => task.gate.decision === 'SAFE_DRAFT_ONLY'));
  assert.equal(planned.engine.state, ENGINE_STATES.NEEDS_APPROVAL);
  const calls = [];
  const ran = await engine.runMission(planned, { executors: { 'memory-agent': passingExecutor(calls) } });
  assert.equal(calls.length, 0);
  assert.equal(ran, planned);
  assert.equal(EXECUTION_POLICY.executionEnabled, false);
});

test('human gate: only humans decide; agents can never approve or close', () => {
  const engine = simEngine();
  const planned = engine.planMission(engine.createMission(missionInput(BLUEPRINTS.COMPANY_PROPOSAL)));
  for (const actorId of ['email-agent', 'verifier-agent', 'xatai-supervisor', 'RESEARCH_COORDINATOR', 'human:', 'subagent:x:0']) {
    assert.equal(errorCode(() => engine.recordHumanDecision(planned, { actorId, decision: 'APPROVE' })), 'human_actor_required');
    assert.equal(errorCode(() => engine.closeMission(planned, { actorId })), 'human_actor_required');
  }
  const approved = engine.recordHumanDecision(planned, { actorId: 'human:jose', decision: 'APPROVE' });
  assert.equal(approved.humanDecisions.length, 1);
  assert.equal(approved.executionEnabled, false);
});

// ------------------------------------------------------------ execution + sentinel

test('run: A1 read tasks execute through injected executors and verify independently -> PASS', async () => {
  const engine = createMissionEngine({ now: () => NOW, idFactory: idFactory(), evidenceRegistry: EVIDENCE });
  const planned = engine.planMission(twoStepMission(engine), { blueprint: TWO_STEP });
  assert.equal(planned.engine.state, ENGINE_STATES.READY);
  const calls = [];
  const ran = await engine.runMission(planned, {
    executors: { 'memory-agent': passingExecutor(calls), 'workflow-agent': passingExecutor(calls) },
  });
  assert.equal(calls.length, 2);
  assert.equal(ran.engine.state, ENGINE_STATES.COMPLETED);
  assert.equal(ran.verification.verdict, 'PASS');
  assert.ok(ran.tasks.every((task) => task.verification.verdict === 'PASS'));
  assert.deepEqual(ran.engine.history.slice(-2).map((entry) => entry.to), ['VERIFYING', 'COMPLETED']);
});

test('run: executor cannot certify itself and cannot mutate its contract', async () => {
  const engine = createMissionEngine({ now: () => NOW, idFactory: idFactory(), evidenceRegistry: EVIDENCE });
  const planned = engine.planMission(twoStepMission(engine), { blueprint: TWO_STEP });
  let mutated = false;
  const ran = await engine.runMission(planned, {
    executors: {
      'memory-agent': async (contract) => {
        try { contract.authorizedCapabilities.push('gmail.send'); } catch (error) { mutated = false; }
        return { evidenceRefs: [toolEvidence(contract)] };
      },
      'workflow-agent': passingExecutor([]),
    },
  });
  assert.equal(mutated, false);
  assert.ok(ran.tasks[0].contract.authorizedCapabilities.every((id) => id !== 'gmail.send'));
  assert.equal(ran.tasks[0].verification.verdict, 'PASS');
});

test('retry: a failed verification replans with a different attempt, keeps the objective, then passes', async () => {
  const engine = createMissionEngine({ now: () => NOW, idFactory: idFactory(), evidenceRegistry: EVIDENCE });
  const planned = engine.planMission(twoStepMission(engine), { blueprint: TWO_STEP });
  const seen = [];
  const ran = await engine.runMission(planned, {
    executors: {
      'memory-agent': async (contract) => {
        seen.push(contract.attempt);
        return seen.length === 1
          ? { evidenceRefs: ['ev:invented'], criteriaMet: ['criterion-1'] }
          : { evidenceRefs: [toolEvidence(contract)] };
      },
      'workflow-agent': passingExecutor([]),
    },
  });
  assert.equal(seen.length, 2);
  assert.notDeepEqual(seen[0], seen[1]);
  assert.equal(seen[1].correctiveAction, 'CHANGE_HYPOTHESIS');
  assert.equal(ran.revisions.length, 1);
  assert.equal(ran.revisions[0].cause, 'verification_failed');
  assert.equal(ran.revisions[0].objective, planned.contract.objective);
  assert.equal(ran.missionRetriesUsed, 1);
  assert.equal(ran.engine.state, ENGINE_STATES.COMPLETED);
  assert.ok(ran.engine.history.some((entry) => entry.to === 'REPLANNING'));
});

test('retry: task attempt budget exhausted escalates to a human and reports a repeated failure', async () => {
  const quality = new QualityIncidentRegistry({ now: () => NOW });
  const engine = createMissionEngine({ now: () => NOW, idFactory: idFactory(), evidenceRegistry: EVIDENCE, qualityRegistry: quality });
  const planned = engine.planMission(twoStepMission(engine), { blueprint: TWO_STEP });
  let calls = 0;
  const ran = await engine.runMission(planned, {
    executors: { 'memory-agent': async () => { calls += 1; return { evidenceRefs: ['ev:1'], criteriaMet: [] }; } },
  });
  assert.equal(calls, 3);
  assert.equal(ran.tasks[0].status, 'BLOCKED');
  assert.equal(ran.engine.state, ENGINE_STATES.BLOCKED);
  const incident = quality.findByCause({ type: 'RUNTIME_FAILURE', component: 'mission-engine', errorCode: 'mission.repeated_failure', relatedCapability: 'memory.search' });
  assert.ok(incident);
});

test('retry: mission-wide retry budget stops retries across tasks', async () => {
  const engine = createMissionEngine({ now: () => NOW, idFactory: idFactory(), evidenceRegistry: EVIDENCE, limits: { missionRetryBudget: 1 } });
  const planned = engine.planMission(twoStepMission(engine), { blueprint: TWO_STEP });
  let calls = 0;
  const ran = await engine.runMission(planned, {
    executors: { 'memory-agent': async () => { calls += 1; return { evidenceRefs: ['ev:1'], criteriaMet: [] }; } },
  });
  assert.equal(calls, 2);
  assert.equal(ran.tasks[0].gate.reason, 'mission_retry_budget_exhausted');
});

test('change agent: falls back to another capable agent and never cycles back (A -> B, never A)', async () => {
  const extra = Object.freeze({
    ...AGENT_DECLARATIONS.find((agent) => agent.id === 'memory-agent'),
    id: 'memory-agent-b', role: 'memory-b',
  });
  const registry = createAgentRegistry({ declarations: [...AGENT_DECLARATIONS, extra] });
  const engine = createMissionEngine({ now: () => NOW, idFactory: idFactory(), evidenceRegistry: EVIDENCE, registry });
  const planned = engine.planMission(twoStepMission(engine), { blueprint: TWO_STEP });
  assert.equal(planned.tasks[0].assignedAgent, 'memory-agent');
  assert.deepEqual(planned.tasks[0].fallbackAgentIds, ['memory-agent-b']);
  const invoked = [];
  const failing = (id) => async () => { invoked.push(id); throw Object.assign(new Error('x'), { failureKind: 'agent_error' }); };
  const ran = await engine.runMission(planned, {
    executors: { 'memory-agent': failing('memory-agent'), 'memory-agent-b': failing('memory-agent-b') },
  });
  // A fails -> CHANGE_AGENT to B; B fails -> CHANGE_TOOL keeps B; budget
  // exhausted -> human. A is never invoked again after B.
  assert.deepEqual(invoked, ['memory-agent', 'memory-agent-b', 'memory-agent-b']);
  assert.deepEqual(ran.tasks[0].agentPath, ['memory-agent', 'memory-agent-b']);
  assert.equal(ran.tasks[0].status, 'BLOCKED');
  assert.deepEqual(ran.revisions.map((revision) => [revision.action, revision.toAgent]), [
    ['CHANGE_AGENT', 'memory-agent-b'], ['CHANGE_TOOL', 'memory-agent-b'],
  ]);
});

test('replanning: never redefines the approved objective and preserves human decisions', () => {
  const engine = createMissionEngine({ now: () => NOW, idFactory: idFactory(), evidenceRegistry: EVIDENCE });
  const planned = engine.planMission(twoStepMission(engine), { blueprint: TWO_STEP });
  const approved = engine.recordHumanDecision(planned, { actorId: 'human:jose', decision: 'APPROVE' });
  const taskId = approved.tasks[0].taskId;
  assert.equal(errorCode(() => engine.revisePlan(approved, { taskId, action: 'REDUCE_SCOPE', objective: 'Otro.' })), 'objective_change_forbidden');
  assert.equal(errorCode(() => engine.revisePlan(approved, { taskId, action: 'ESCALATE_HUMAN' })), 'invalid_revision_action');
  const revised = engine.revisePlan(approved, { taskId, action: 'REDUCE_SCOPE', cause: 'too_broad' });
  assert.equal(revised.contract.objective, planned.contract.objective);
  assert.deepEqual(revised.contract.constraints, planned.contract.constraints);
  assert.deepEqual(revised.humanDecisions, approved.humanDecisions);
  assert.equal(revised.tasks[0].contract.attempt.scope, 'reduced2');
  assert.equal(revised.tasks[0].objective, planned.tasks[0].objective);
});

// ------------------------------------------------------------ verdicts

test('mission FAIL: a constraint violation is rejected by the verifier and fails the mission', async () => {
  const quality = new QualityIncidentRegistry({ now: () => NOW });
  const engine = createMissionEngine({ now: () => NOW, idFactory: idFactory(), evidenceRegistry: EVIDENCE, qualityRegistry: quality });
  const planned = engine.planMission(twoStepMission(engine), { blueprint: TWO_STEP });
  const ran = await engine.runMission(planned, {
    executors: {
      'memory-agent': async () => ({ evidenceRefs: ['ev:1'], criteriaMet: ['criterion-1'], constraintViolations: ['wrote_outside_scope'] }),
    },
  });
  assert.equal(ran.engine.state, ENGINE_STATES.FAILED);
  assert.equal(ran.verification.verdict, 'FAIL');
  assert.equal(ran.tasks[0].status, 'FAILED');
  assert.ok(quality.findByCause({ type: 'WRONG_RESPONSE', component: 'mission-engine', errorCode: 'mission.verifier_failure', relatedCapability: 'memory.search' }));
  assert.ok(quality.findByCause({ type: 'RUNTIME_FAILURE', component: 'mission-engine', errorCode: 'mission.mission_failed' }));
  assert.throws(() => engine.recordHumanDecision(ran, { actorId: 'human:jose', decision: 'APPROVE' }), /closed/);
});

test('mission PARTIAL_PASS: a human closes a mission with work still pending, and it says so', async () => {
  const engine = simEngine();
  const planned = engine.planMission(engine.createMission(missionInput(BLUEPRINTS.COMPANY_PROPOSAL)));
  const calls = [];
  const executors = Object.fromEntries(AGENT_DECLARATIONS.map((agent) => [agent.id, passingExecutor(calls)]));
  const ran = await engine.runMission(planned, { executors });
  assert.equal(ran.engine.state, ENGINE_STATES.NEEDS_APPROVAL);
  assert.equal(ran.verification.verdict, 'PARTIAL_PASS');
  const closed = engine.closeMission(ran, { actorId: 'human:jose' });
  assert.equal(closed.engine.state, ENGINE_STATES.COMPLETED);
  assert.equal(closed.result.verdict, 'PARTIAL_PASS');
  assert.deepEqual(closed.result.pendingTaskIds, [`${planned.missionId}:proposal-draft`]);
});

test('mission NEEDS_REVIEW: no verified evidence is never closed as a pass', () => {
  const engine = createMissionEngine({ now: () => NOW, idFactory: idFactory(), evidenceRegistry: EVIDENCE });
  const ready = engine.planMission(twoStepMission(engine), { blueprint: TWO_STEP });
  assert.equal(errorCode(() => engine.closeMission(ready, { actorId: 'human:jose' })), 'mission_not_closable');
  const planned = engine.planMission(engine.createMission(missionInput(BLUEPRINTS.REPOSITORY_REPAIR)));
  assert.equal(planned.engine.state, ENGINE_STATES.BLOCKED);
  const closed = engine.closeMission(planned, { actorId: 'human:jose' });
  assert.equal(closed.verification.verdict, 'NEEDS_REVIEW');
  assert.equal(closed.engine.state, ENGINE_STATES.NEEDS_APPROVAL);
});

// ------------------------------------------------------------ projection, trace, memory, quality

test('projection: a plan becomes a valid PROPOSED Mission Queue record without persistence', () => {
  const engine = simEngine();
  const planned = engine.planMission(engine.createMission(missionInput(BLUEPRINTS.COMPANY_PROPOSAL)));
  const { mission, events } = engine.toMissionQueueDraft(planned, SCOPE);
  assert.equal(mission.status, MISSION_STATES.PROPOSED);
  assert.equal(mission.tasks.length, 4);
  assert.ok(mission.tasks.every((task) => task.status === TASK_STATES.PENDING));
  assert.equal(mission.tasks.find((task) => task.taskId.endsWith(':proposal-draft')).assignee, 'email-agent');
  assert.equal(events.length, 5);
});

test('trace: compact, identifiers only, rejects free text and unknown fields', async () => {
  const engine = createMissionEngine({ now: () => NOW, idFactory: idFactory(), evidenceRegistry: EVIDENCE });
  const planned = engine.planMission(twoStepMission(engine), { blueprint: TWO_STEP });
  await engine.runMission(planned, {
    executors: { 'memory-agent': passingExecutor([], 'Texto privado del correo: hola'), 'workflow-agent': passingExecutor([]) },
  });
  const entries = engine.trace.list(planned.missionId);
  assert.ok(entries.length >= 6);
  for (const entry of entries) {
    assert.deepEqual(Object.keys(entry).sort(), ['action', 'agent', 'coordinator', 'decision', 'evidenceRef', 'missionId', 'status', 'taskId', 'timestamp', 'verification']);
    assert.ok(!JSON.stringify(entry).includes('privado'));
  }
  assert.ok(entries.some((entry) => entry.action === 'task_verified' && entry.evidenceRef && entry.verification === 'PASS'));
  assert.throws(() => engine.trace.record({ missionId: 'm-1', action: 'texto con espacios' }), /TRACE_INVALID_FIELD/);
  assert.throws(() => engine.trace.record({ missionId: 'm-1', body: 'x' }), /TRACE_UNEXPECTED_FIELD/);
});

test('memory: stores outcome, decisions and repairs, never the objective or outputs', async () => {
  const engine = createMissionEngine({ now: () => NOW, idFactory: idFactory(), evidenceRegistry: EVIDENCE });
  const planned = engine.planMission(twoStepMission(engine, {
    objective: 'Objetivo con dato sensible jose@example.com', explicitPreferences: [{ key: 'language', value: 'es' }, { key: 'bad key', value: 'x' }],
  }), { blueprint: TWO_STEP });
  const ran = await engine.runMission(planned, {
    executors: { 'memory-agent': passingExecutor([], 'salida privada'), 'workflow-agent': passingExecutor([]) },
  });
  const memory = buildMissionMemoryRecord(ran);
  const text = JSON.stringify(memory);
  assert.ok(!text.includes('jose@example.com'));
  assert.ok(!text.includes('salida privada'));
  assert.equal(memory.verdict, 'PASS');
  assert.deepEqual(memory.preferences, [{ key: 'language', value: 'es' }]);
});

test('quality: routing impossible is an incident; a normal human gate is not', () => {
  const quality = new QualityIncidentRegistry({ now: () => NOW });
  const engine = createMissionEngine({ now: () => NOW, idFactory: idFactory(), evidenceRegistry: EVIDENCE, qualityRegistry: quality });
  engine.planMission(engine.createMission(missionInput(BLUEPRINTS.REPOSITORY_REPAIR)));
  assert.ok(quality.findByCause({ type: 'CAPABILITY_MISMATCH', component: 'mission-engine', errorCode: 'mission.routing_impossible', relatedCapability: 'repository.analyze' }));

  const quiet = new QualityIncidentRegistry({ now: () => NOW });
  const gated = simEngine({ qualityRegistry: quiet, connections: {} });
  const planned = gated.planMission(gated.createMission(missionInput(BLUEPRINTS.COMPANY_PROPOSAL)));
  assert.ok(planned.tasks.some((task) => task.gate.decision === 'NEEDS_CONNECTION'));
  assert.equal(quiet.list().length, 0);
});

test('change agent: with no untried capable agent the task escalates instead of looping', async () => {
  const engine = createMissionEngine({ now: () => NOW, idFactory: idFactory(), evidenceRegistry: EVIDENCE });
  const planned = engine.planMission(twoStepMission(engine), { blueprint: TWO_STEP });
  let calls = 0;
  const ran = await engine.runMission(planned, {
    executors: { 'memory-agent': async () => { calls += 1; throw Object.assign(new Error('x'), { failureKind: 'agent_error' }); } },
  });
  assert.equal(calls, 1);
  assert.equal(ran.tasks[0].status, 'BLOCKED');
  assert.equal(ran.tasks[0].gate.reason, 'no_untried_agent');
  assert.equal(ran.engine.state, ENGINE_STATES.BLOCKED);
});

test('timeout policy: a hanging executor is cut off and handled by the sentinel', async () => {
  const engine = createMissionEngine({ now: () => NOW, idFactory: idFactory(), evidenceRegistry: EVIDENCE, limits: { taskTimeoutMs: 20, maxTaskAttempts: 1 } });
  const planned = engine.planMission(twoStepMission(engine), { blueprint: TWO_STEP });
  const ran = await engine.runMission(planned, {
    executors: { 'memory-agent': () => new Promise(() => {}) },
  });
  assert.equal(ran.attempts[planned.tasks[0].taskId][0].failureKind, 'timeout');
  assert.equal(ran.tasks[0].status, 'BLOCKED');
});

test('waiting: an executor waiting on a tool parks the mission in WAITING_TOOL and it resumes later', async () => {
  const engine = createMissionEngine({ now: () => NOW, idFactory: idFactory(), evidenceRegistry: EVIDENCE });
  const planned = engine.planMission(twoStepMission(engine), { blueprint: TWO_STEP });
  let ready = false;
  const executors = {
    'memory-agent': async (contract) => (ready
      ? { evidenceRefs: [toolEvidence(contract)] }
      : { waitingFor: 'tool' }),
    'workflow-agent': passingExecutor([]),
  };
  const parked = await engine.runMission(planned, { executors });
  assert.equal(parked.engine.state, ENGINE_STATES.WAITING_TOOL);
  ready = true;
  const resumed = await engine.runMission(parked, { executors });
  assert.equal(resumed.engine.state, ENGINE_STATES.COMPLETED);
});

test('human gate: a human rejection cancels the mission and nothing runs afterwards', async () => {
  const engine = simEngine();
  const planned = engine.planMission(engine.createMission(missionInput(BLUEPRINTS.COMPANY_PROPOSAL)));
  const rejected = engine.recordHumanDecision(planned, { actorId: 'human:jose', decision: 'REJECT' });
  assert.equal(rejected.engine.state, ENGINE_STATES.CANCELLED);
  assert.ok(rejected.tasks.every((task) => task.status === 'CANCELLED'));
  const calls = [];
  const ran = await engine.runMission(rejected, { executors: Object.fromEntries(AGENT_DECLARATIONS.map((agent) => [agent.id, passingExecutor(calls)])) });
  assert.equal(calls.length, 0);
  assert.equal(ran, rejected);
});

test('escalation to a human authority keeps decision and status aligned', async () => {
  const engine = createMissionEngine({ now: () => NOW, idFactory: idFactory(), evidenceRegistry: EVIDENCE });
  const planned = engine.planMission(twoStepMission(engine), { blueprint: TWO_STEP });
  const ran = await engine.runMission(planned, {
    executors: { 'memory-agent': async () => { throw Object.assign(new Error('x'), { failureKind: 'connection' }); } },
  });
  assert.deepEqual([ran.tasks[0].status, ran.tasks[0].gate.decision], ['NEEDS_CONNECTION', 'NEEDS_CONNECTION']);
  assert.equal(ran.engine.state, ENGINE_STATES.NEEDS_CONNECTION);
});

'use strict';

// Regression tests for the three defects found in the independent review of
// PR #21 (HEAD 8c20d89): invented evidence, cumulative budget and execution
// context transport. Each block reproduces the defect and proves it closed.

const test = require('node:test');
const assert = require('node:assert/strict');
const { describeCapability } = require('./capability-registry');
const { AGENT_DECLARATIONS, createAgentRegistry } = require('./agent-registry');
const { createEvidenceRegistry, digestOutput } = require('./evidence-registry');
const { createMissionEngine } = require('./mission-engine');
const { DEFAULT_CATALOG } = require('../runtime/model-cost-catalog');

const NOW = '2026-10-03T12:00:00.000Z';
let idCounter = 0;
const idFactory = () => (kind = 'id') => { idCounter += 1; return `${kind}-r${idCounter}`; };

// Controlled simulation only: stand-ins for capabilities that do not exist
// yet, a proposal agent for the chained mission, and fixture prices.
const SIM_PROPOSAL = Object.freeze({
  id: 'sim.proposal', mode: 'analyze', status: 'AVAILABLE', risk: 'low', costClass: 'small_model',
  tools: [], requiresApproval: false, requiresExternalConnection: false, reason: null,
});
const SIMULATED = new Set(['research.company', 'research.web', 'data.analyze']);
function simulatedDescribe(id) {
  if (id === 'sim.proposal') return SIM_PROPOSAL;
  const profile = describeCapability(id);
  return profile && SIMULATED.has(id) ? Object.freeze({ ...profile, status: 'AVAILABLE' }) : profile;
}
const PROPOSAL_AGENT = Object.freeze({
  ...AGENT_DECLARATIONS.find((agent) => agent.id === 'email-agent'),
  id: 'proposal-agent', role: 'proposal', capabilities: Object.freeze(['sim.proposal']), prohibitedCapabilities: Object.freeze([]),
});
const CATALOG = Object.freeze({
  local_deterministic: DEFAULT_CATALOG.local_deterministic,
  'sim-small': {
    provider: 'sim', tier: 'small', inputUsdPerMillion: 0.2, outputUsdPerMillion: 0.8, residency: 'eu',
    privacy: 'test', pricingVersion: 'fixture-v1', pricingSource: 'test-fixture', reviewedAt: '2026-10-01',
  },
});
// 1750 input + 500 output tokens at the fixture price = 0.00075 USD.
const BASIS_075 = Object.freeze({ modelId: 'sim-small', inputTokens: 1750, outputTokens: 500 });

function kit() {
  const evidence = createEvidenceRegistry({ trustedRegistrars: ['tool:sim'] });
  const tool = evidence.registrar('tool:sim');
  let counter = 0;
  const record = (contract, overrides = {}) => {
    counter += 1;
    const ref = `ev:${contract.taskId}:${counter}`;
    tool.record({
      ref, missionId: contract.missionId, taskId: contract.taskId,
      supports: contract.passCriteria.map((criterion) => criterion.criterionId), ...overrides,
    });
    return ref;
  };
  return { evidence, tool, record };
}

function engineWith(evidence, overrides = {}) {
  return createMissionEngine({
    describeCapability: simulatedDescribe,
    registry: createAgentRegistry({ describeCapability: simulatedDescribe, declarations: [...AGENT_DECLARATIONS, PROPOSAL_AGENT] }),
    costCatalog: CATALOG,
    costBasisFor: () => BASIS_075,
    privacyPolicy: { internalProviders: [{ providerId: 'sim' }], confidentialProviders: [{ providerId: 'sim', region: 'eu' }] },
    providerAssignment: { providerId: 'sim', region: 'eu' },
    connections: { 'research.company': true, 'research.web': true },
    evidenceRegistry: evidence,
    now: () => NOW,
    idFactory: idFactory(),
    ...overrides,
  });
}

function task(key, agentRole, capability, dependsOn = [], extra = {}) {
  return {
    key, objective: `Tarea ${key}.`, agentRole, requiredCapabilities: [capability], dependsOn,
    privacyClass: 'INTERNAL', expectedEvidence: ['ref'], passCriteria: ['Resultado demostrado.'], missionCriteria: ['criterion-1'],
    ...extra,
  };
}

function plan(engine, tasks, { limits, knownContext = ['company: ACME'] } = {}) {
  const created = engine.createMission({
    objective: 'Misión de regresión.', constraints: ['Solo lectura.'], knownContext, autonomyLevel: 'A1',
    authorizedCapabilities: [...new Set(tasks.flatMap((item) => item.requiredCapabilities))],
    passCriteria: ['Misión demostrada.'], stopCriteria: ['Falta información.'], requiredEvidence: ['Evidencia.'], limits,
  });
  return engine.planMission(created, { blueprint: { tasks } });
}

// =============================================================== DEFECT 1

test('defect 1 (P1): "I did nothing" + ev:invented + every criteriaMet never reaches COMPLETED/PASS', async () => {
  const { evidence } = kit();
  const engine = engineWith(evidence, { limits: { maxTaskAttempts: 1 } });
  const planned = plan(engine, [task('a', 'memory', 'memory.search')]);
  const ran = await engine.runMission(planned, {
    executors: {
      'memory-agent': async (contract) => ({
        summary: 'I did nothing',
        evidenceRefs: ['ev:invented'],
        criteriaMet: contract.passCriteria.map((criterion) => criterion.criterionId),
      }),
    },
  });
  assert.notEqual(ran.tasks[0].status, 'COMPLETED');
  assert.notEqual(ran.engine.state, 'COMPLETED');
  assert.notEqual(ran.verification.verdict, 'PASS');
  assert.equal(ran.tasks[0].verification.verdict, 'NEEDS_REVIEW');
  assert.ok(ran.tasks[0].verification.reasons.includes('evidence_unresolved'));
  assert.ok(ran.tasks[0].verification.reasons.includes('pass_criteria_not_evidenced'));
});

test('defect 1 (P1): evidence recorded by a trusted tool for this task and criterion does PASS', async () => {
  const { evidence, record } = kit();
  const engine = engineWith(evidence);
  const planned = plan(engine, [task('a', 'memory', 'memory.search')]);
  const ran = await engine.runMission(planned, {
    executors: { 'memory-agent': async (contract) => ({ summary: 'Contexto recogido.', evidenceRefs: [record(contract)] }) },
  });
  assert.equal(ran.tasks[0].status, 'COMPLETED');
  assert.equal(ran.verification.verdict, 'PASS');
  assert.equal(ran.engine.state, 'COMPLETED');
});

test('defect 1 audit: evidence of another task or mission is a manipulation and fails the task', async () => {
  const { evidence, tool } = kit();
  const engine = engineWith(evidence);
  const planned = plan(engine, [task('a', 'memory', 'memory.search')]);
  tool.record({ ref: 'ev:other-task', missionId: planned.missionId, taskId: `${planned.missionId}:zzz`, supports: ['criterion-1'] });
  tool.record({ ref: 'ev:other-mission', missionId: 'mission-elsewhere', taskId: planned.tasks[0].taskId, supports: ['criterion-1'] });
  for (const ref of ['ev:other-task', 'ev:other-mission']) {
    const ran = await engine.runMission(planned, { executors: { 'memory-agent': async () => ({ evidenceRefs: [ref] }) } });
    assert.equal(ran.tasks[0].status, 'FAILED', ref);
    assert.ok(ran.tasks[0].verification.reasons.includes('evidence_scope_mismatch'), ref);
    assert.equal(ran.engine.state, 'FAILED', ref);
  }
});

test('defect 1 audit: evidence that does not support every criterion is not enough', async () => {
  const { evidence, record } = kit();
  const engine = engineWith(evidence, { limits: { maxTaskAttempts: 1 } });
  const planned = plan(engine, [task('a', 'memory', 'memory.search', [], { passCriteria: ['Uno.', 'Dos.'] })]);
  const ran = await engine.runMission(planned, {
    executors: { 'memory-agent': async (contract) => ({ evidenceRefs: [record(contract, { supports: ['criterion-1'] })], criteriaMet: ['criterion-1', 'criterion-2'] }) },
  });
  assert.notEqual(ran.tasks[0].status, 'COMPLETED');
  assert.ok(ran.tasks[0].verification.reasons.includes('pass_criteria_not_evidenced'));
});

test('defect 1 audit: agents can never be registrars, refs cannot be overwritten, no registry means no PASS', async () => {
  assert.throws(() => createEvidenceRegistry({ trustedRegistrars: ['email-agent'] }), /EVIDENCE_INVALID_REGISTRAR/);
  const { evidence, tool } = kit();
  assert.throws(() => evidence.registrar('tool:other'), /EVIDENCE_UNTRUSTED_REGISTRAR/);
  tool.record({ ref: 'ev:once', missionId: 'mission-x', taskId: 'mission-x:a', supports: ['criterion-1'] });
  assert.throws(() => tool.record({ ref: 'ev:once', missionId: 'mission-y', taskId: 'mission-y:a', supports: ['criterion-1'] }), /EVIDENCE_DUPLICATE_REF/);
  assert.equal(evidence.resolve('ev:once').missionId, 'mission-x');
  assert.ok(Object.isFrozen(evidence.resolve('ev:once')));

  // Default engine (no registry injected): nothing can ever resolve.
  const engine = createMissionEngine({ now: () => NOW, idFactory: idFactory(), limits: { maxTaskAttempts: 1 } });
  const planned = plan(engine, [task('a', 'memory', 'memory.search')]);
  let seen = null;
  const ran = await engine.runMission(planned, {
    executors: { 'memory-agent': async (contract, context) => { seen = { contract, context }; return { evidenceRefs: ['ev:once'] }; } },
  });
  assert.notEqual(ran.tasks[0].status, 'COMPLETED');
  // The executor receives no handle to any evidence store.
  assert.ok(!/registrar|record|resolve/.test(Object.keys(seen.contract).concat(Object.keys(seen.context)).join(',')));
});

test('defect 1 audit: the mission verdict re-resolves evidence and ignores a tampered COMPLETED status', async () => {
  const { evidence, record } = kit();
  const engine = engineWith(evidence, { connections: { 'research.company': true, 'research.web': true } });
  const planned = plan(engine, [task('a', 'memory', 'memory.search'), task('b', 'research', 'research.company', [], { privacyClass: 'PUBLIC' })]);
  // b has no executor: it ends BLOCKED, a passes with real evidence.
  const ran = await engine.runMission(planned, {
    executors: { 'memory-agent': async (contract) => ({ evidenceRefs: [record(contract)] }) },
  });
  assert.equal(ran.verification.verdict, 'PARTIAL_PASS');
  const tampered = JSON.parse(JSON.stringify(ran));
  const b = tampered.tasks.find((item) => item.key === 'b');
  Object.assign(b, { status: 'COMPLETED', evidenceRefs: ['ev:fake'], verification: { verdict: 'PASS', reasons: [], checks: [] } });
  const closed = engine.closeMission(tampered, { actorId: 'human:jose' });
  assert.equal(closed.verification.verdict, 'NEEDS_REVIEW');
  assert.notEqual(closed.engine.state, 'COMPLETED');
});

test('defect 1 audit: evidence bound to the tool output rejects a falsified result text', async () => {
  const { evidence, record } = kit();
  const engine = engineWith(evidence);
  const real = 'ACME: 120 empleados (fuente simulada).';
  const run = (reported) => engine.runMission(plan(engine, [task('a', 'memory', 'memory.search')]), {
    executors: {
      'memory-agent': async (contract) => ({ summary: reported, evidenceRefs: [record(contract, { outputDigest: digestOutput(real) })] }),
    },
  });
  const forged = await run('ACME: 5000 empleados, cliente garantizado.');
  assert.equal(forged.tasks[0].status, 'FAILED');
  assert.ok(forged.tasks[0].verification.reasons.includes('output_not_evidenced'));
  const honest = await run(real);
  assert.equal(honest.tasks[0].status, 'COMPLETED');
  assert.equal(honest.tasks[0].output, real);
  assert.throws(() => kit().tool.record({ ref: 'ev:d', missionId: 'mission-x', taskId: 'mission-x:a', supports: ['c'], outputDigest: 'md5:x' }), /EVIDENCE_INVALID_DIGEST/);
});

// =============================================================== DEFECT 2

test('defect 2 (P1): budget 0.001 with two 0.00075 tasks — A runs, B is refused before executing', async () => {
  const { evidence, record } = kit();
  const engine = engineWith(evidence);
  const planned = plan(engine, [
    task('a', 'research', 'research.company', [], { privacyClass: 'PUBLIC' }),
    task('b', 'web-research', 'research.web', [], { privacyClass: 'PUBLIC' }),
  ], { limits: { maxCostUsd: 0.001 } });
  // Each task alone fits the budget, so planning lets both through.
  assert.ok(planned.tasks.every((item) => item.gate.decision === 'CAN_EXECUTE'));
  const calls = [];
  const executor = (name) => async (contract) => { calls.push(name); return { evidenceRefs: [record(contract)] }; };
  const ran = await engine.runMission(planned, { executors: { 'research-agent': executor('A'), 'web-research-agent': executor('B') } });
  assert.deepEqual(calls, ['A']);
  const b = ran.tasks.find((item) => item.key === 'b');
  assert.deepEqual([b.status, b.gate.decision, b.gate.reason], ['BLOCKED', 'BLOCKED', 'budget_exceeded']);
  assert.equal(ran.estimatedSpentUsd, 0.00075);
  assert.ok(ran.estimatedSpentUsd <= 0.001);
  assert.equal(ran.reservedUsd, 0);
  assert.equal(ran.actualSpentUsd, null);
  assert.deepEqual(ran.costLedger.map((entry) => [entry.taskId.endsWith(':a'), entry.status, entry.estimatedUsd, entry.actualUsd]), [
    [true, 'CONSUMED', 0.00075, null],
  ]);
});

test('defect 2 (P1): a failed attempt still consumes budget and the next attempt is refused', async () => {
  const { evidence } = kit();
  const engine = engineWith(evidence);
  const planned = plan(engine, [task('a', 'research', 'research.company', [], { privacyClass: 'PUBLIC' })], { limits: { maxCostUsd: 0.002 } });
  let calls = 0;
  const ran = await engine.runMission(planned, {
    executors: { 'research-agent': async () => { calls += 1; return { evidenceRefs: ['ev:invented'] }; } },
  });
  // Attempt budget allows 3; the cost of the two failed attempts stops the third.
  assert.equal(calls, 2);
  assert.equal(ran.estimatedSpentUsd, 0.0015);
  assert.deepEqual(ran.costLedger.map((entry) => [entry.attempt, entry.status]), [[1, 'CONSUMED'], [2, 'CONSUMED']]);
  assert.equal(ran.tasks[0].gate.reason, 'budget_exceeded');
});

test('defect 2 audit: errors and timeouts are charged once; work that never ran is never charged', async () => {
  const { evidence } = kit();
  const engine = engineWith(evidence, { limits: { taskTimeoutMs: 20, maxTaskAttempts: 2 } });
  const planned = plan(engine, [task('a', 'research', 'research.company', [], { privacyClass: 'PUBLIC' })]);
  let calls = 0;
  const ran = await engine.runMission(planned, {
    executors: {
      'research-agent': () => {
        calls += 1;
        if (calls === 1) throw Object.assign(new Error('x'), { failureKind: 'tool_error' });
        return new Promise(() => {});
      },
    },
  });
  assert.equal(calls, 2);
  assert.equal(ran.costLedger.length, 2);
  assert.equal(ran.estimatedSpentUsd, 0.0015);

  const idle = await engine.runMission(plan(engine, [task('a', 'research', 'research.company', [], { privacyClass: 'PUBLIC' })]), { executors: {} });
  assert.deepEqual(idle.costLedger, []);
  assert.equal(idle.estimatedSpentUsd, 0);
});

test('defect 2 audit: unknown price is never zero and never runs', async () => {
  const { evidence } = kit();
  const engine = engineWith(evidence, { costBasisFor: () => null });
  const planned = plan(engine, [task('a', 'research', 'research.company', [], { privacyClass: 'PUBLIC' })]);
  assert.equal(planned.tasks[0].cost.estimateStatus, 'UNKNOWN_COST');
  assert.equal(planned.tasks[0].cost.estimatedCostUsd, null);
  let calls = 0;
  const ran = await engine.runMission(planned, { executors: { 'research-agent': async () => { calls += 1; return {}; } } });
  assert.equal(calls, 0);
  assert.deepEqual(ran.costLedger, []);
});

test('defect 2 audit: re-running an older state snapshot cannot reset what was already spent', async () => {
  const { evidence, record } = kit();
  const engine = engineWith(evidence);
  const planned = plan(engine, [task('a', 'research', 'research.company', [], { privacyClass: 'PUBLIC' })], { limits: { maxCostUsd: 0.001 } });
  let calls = 0;
  const executors = { 'research-agent': async (contract) => { calls += 1; return { evidenceRefs: [record(contract)] }; } };
  const first = await engine.runMission(planned, { executors });
  assert.equal(first.engine.state, 'COMPLETED');
  const replay = await engine.runMission(planned, { executors });
  assert.equal(calls, 1);
  assert.equal(replay.tasks[0].gate.reason, 'budget_exceeded');
});

// =============================================================== DEFECT 3

function chainExecutors(record, seen, outputs) {
  const make = (agentId, summary) => async (contract, context) => {
    seen[contract.taskId.slice(contract.taskId.lastIndexOf(':') + 1)] = context;
    return { summary: summary(context), evidenceRefs: [record(contract)] };
  };
  return {
    'research-agent': make('research-agent', () => outputs.a),
    'data-analysis-agent': make('data-analysis-agent', (context) => `Análisis de [${context.dependencies[0].output}]`),
    'proposal-agent': make('proposal-agent', (context) => `Propuesta basada en [${context.dependencies[0].output}]`),
    'memory-agent': make('memory-agent', () => 'Independiente.'),
  };
}

test('defect 3 (P2): A -> B -> C — each task receives exactly the verified result of its dependency', async () => {
  const { evidence, record } = kit();
  const engine = engineWith(evidence);
  const planned = plan(engine, [
    task('a', 'research', 'research.company', [], { privacyClass: 'PUBLIC' }),
    task('b', 'data-analysis', 'data.analyze', ['a']),
    task('c', 'proposal', 'sim.proposal', ['b']),
    task('d', 'memory', 'memory.search'),
  ]);
  const seen = {};
  const outputs = { a: 'ACME Iberia: logística, 120 empleados (ficticio).' };
  const ran = await engine.runMission(planned, { executors: chainExecutors(record, seen, outputs) });
  assert.equal(ran.engine.state, 'COMPLETED');
  const byKey = Object.fromEntries(ran.tasks.map((item) => [item.key, item]));

  assert.deepEqual(seen.a.dependencies, []);
  assert.deepEqual(seen.b.dependencies, [{ taskId: byKey.a.taskId, output: outputs.a, evidenceRefs: byKey.a.evidenceRefs }]);
  assert.equal(seen.c.dependencies.length, 1);
  assert.equal(seen.c.dependencies[0].taskId, byKey.b.taskId);
  assert.equal(seen.c.dependencies[0].output, `Análisis de [${outputs.a}]`);
  assert.equal(byKey.c.output, `Propuesta basada en [Análisis de [${outputs.a}]]`);
  assert.equal(seen.b.missionId, planned.missionId);
  assert.deepEqual(seen.b.constraints, ['Solo lectura.']);
  assert.ok(seen.b.prohibitedActions.includes('gmail.send'));
});

test('defect 3 (P2): a task never receives results from tasks that are not its declared dependencies', async () => {
  const { evidence, record } = kit();
  const engine = engineWith(evidence);
  const planned = plan(engine, [
    task('a', 'research', 'research.company', [], { privacyClass: 'PUBLIC' }),
    task('b', 'data-analysis', 'data.analyze', ['a']),
    task('c', 'proposal', 'sim.proposal', ['b']),
    task('d', 'memory', 'memory.search'),
  ]);
  const seen = {};
  const outputs = { a: 'DATO-SOLO-PARA-B' };
  await engine.runMission(planned, { executors: chainExecutors(record, seen, outputs) });
  // C depends on B only: A's raw output and evidence never reach C directly.
  assert.ok(!seen.c.dependencies.some((dependency) => dependency.taskId.endsWith(':a')));
  // D has no dependencies: it sees nothing from A, B or C although they completed.
  assert.deepEqual(seen.d.dependencies, []);
  assert.ok(!JSON.stringify(seen.d).includes('DATO-SOLO-PARA-B'));
  assert.ok(!JSON.stringify(seen.d).includes('Análisis'));
});

test('defect 3 audit: context is immutable, least-privilege, privacy-bounded and cannot widen permissions', async () => {
  const { evidence, record } = kit();
  const engine = engineWith(evidence);
  const planned = plan(engine, [
    task('a', 'research', 'research.company', [], { privacyClass: 'CONFIDENTIAL' }),
    task('b', 'data-analysis', 'data.analyze', ['a']),
  ], { knownContext: ['company: ACME', 'password: hunter2'] });
  // A CONFIDENTIAL dependency makes its dependent CONFIDENTIAL too.
  assert.equal(planned.tasks.find((item) => item.key === 'b').privacyClass, 'SECRET');
  // SECRET context never reaches a model-backed agent: routing blocks it.
  assert.ok(planned.tasks.every((item) => item.gate.reason === 'privacy_provider_not_allowed'));

  const clean = plan(engine, [
    task('a', 'research', 'research.company', [], { privacyClass: 'CONFIDENTIAL' }),
    task('b', 'data-analysis', 'data.analyze', ['a']),
  ]);
  assert.equal(clean.tasks.find((item) => item.key === 'b').privacyClass, 'CONFIDENTIAL');
  const seen = {};
  let mutation = null;
  const ran = await engine.runMission(clean, {
    executors: {
      'research-agent': async (contract) => ({
        summary: 'api_key=SHOULD-NOT-FLOW', evidenceRefs: [record(contract)],
        authorizedCapabilities: ['gmail.send'], prohibitedActions: [],
      }),
      'data-analysis-agent': async (contract, context) => {
        seen.b = { contract, context };
        try { context.dependencies.push({ taskId: 'x', output: 'y' }); } catch (error) { mutation = error.name; }
        return { evidenceRefs: [record(contract)] };
      },
    },
  });
  assert.equal(mutation, 'TypeError');
  assert.deepEqual(seen.b.context.dependencies.map((dependency) => [dependency.withheld, dependency.output]), [['secret_marker', undefined]]);
  assert.ok(!JSON.stringify(seen.b.context).includes('SHOULD-NOT-FLOW'));
  // Executor output never changes any contract.
  for (const item of ran.tasks) {
    assert.ok(!item.contract.authorizedCapabilities.includes('gmail.send'));
    assert.ok(item.contract.prohibitedActions.includes('gmail.send'));
  }
  assert.deepEqual(Object.keys(seen.b.context).sort(), [
    'budget', 'constraints', 'dependencies', 'humanDecisions', 'knownContext', 'missionId', 'privacyClass', 'prohibitedActions', 'taskId',
  ]);
});

test('defect 3 audit: secrets in known context are dropped and human decisions carry no identity', async () => {
  const { evidence, record } = kit();
  const engine = engineWith(evidence);
  const planned = plan(engine, [task('a', 'memory', 'memory.search')], { knownContext: ['company: ACME', 'token= abc123'] });
  const approved = engine.recordHumanDecision(planned, { actorId: 'human:jose', decision: 'APPROVE' });
  let context = null;
  await engine.runMission(approved, { executors: { 'memory-agent': async (contract, ctx) => { context = ctx; return { evidenceRefs: [record(contract)] }; } } });
  assert.deepEqual(context.knownContext, ['company: ACME']);
  assert.deepEqual(context.humanDecisions, [{ decision: 'APPROVE', taskId: null }]);
  assert.ok(!JSON.stringify(context).includes('human:jose'));
});

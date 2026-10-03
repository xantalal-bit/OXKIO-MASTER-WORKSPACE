'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const { describeCapability } = require('./capability-registry');
const { AGENT_DECLARATIONS } = require('./agent-registry');
const { BLUEPRINTS } = require('./mission-blueprints');
const { handleMissionRequest } = require('./mission-chat');
const { EXECUTION_POLICY, createMissionEngine } = require('./mission-engine');
const { DEFAULT_CATALOG } = require('../runtime/model-cost-catalog');
const { QualityIncidentRegistry } = require('../runtime/quality-incident-registry');
const { createEvidenceRegistry, digestOutput } = require('./evidence-registry');

const EVIDENCE = createEvidenceRegistry({ trustedRegistrars: ['tool:sim'] });
const TOOL = EVIDENCE.registrar('tool:sim');
let evidenceCounter = 0;

// XATAI CORE V2 multi-agent simulation. The capabilities below do not exist
// yet (NOT_IMPLEMENTED in the canonical registry); the simulation stands
// them in to prove the orchestration: hierarchy, routing, gates, verifier.
// Executors are in-memory test doubles; prices are test fixtures.
const SIMULATED = new Set(['research.company', 'research.web', 'data.analyze', 'repository.analyze', 'code.propose_patch', 'tests.run']);
const simulatedDescribe = (id) => {
  const profile = describeCapability(id);
  return profile && SIMULATED.has(id) ? Object.freeze({ ...profile, status: 'AVAILABLE' }) : profile;
};
const NOW = '2026-10-03T10:00:00.000Z';

let engineCounter = 0;
function simulationEngine(qualityRegistry = null) {
  let counter = 0;
  engineCounter += 1;
  const prefix = `e${engineCounter}`;
  return createMissionEngine({
    describeCapability: simulatedDescribe,
    costCatalog: {
      local_deterministic: DEFAULT_CATALOG.local_deterministic,
      'sim-small': {
        provider: 'sim', tier: 'small', inputUsdPerMillion: 0.2, outputUsdPerMillion: 0.8, residency: 'eu',
        privacy: 'test', pricingVersion: 'fixture-v1', pricingSource: 'test-fixture', reviewedAt: '2026-10-01',
      },
    },
    costBasisFor: () => ({ modelId: 'sim-small', inputTokens: 2000, outputTokens: 500 }),
    privacyPolicy: { internalProviders: [{ providerId: 'sim' }], confidentialProviders: [{ providerId: 'sim', region: 'eu' }] },
    providerAssignment: { providerId: 'sim', region: 'eu' },
    connections: { 'research.company': true, 'research.web': true, 'gmail.draft': true },
    qualityRegistry,
    evidenceRegistry: EVIDENCE,
    now: () => NOW,
    idFactory: (kind = 'id') => { counter += 1; return `${kind}-${prefix}-${counter}`; },
  });
}

function recordingExecutors(calls) {
  return Object.fromEntries(AGENT_DECLARATIONS.map((agent) => [agent.id, async (contract) => {
    calls.push({ agent: agent.id, taskId: contract.taskId });
    // The simulated tool behind the agent records the evidence.
    evidenceCounter += 1;
    const ref = `ev:${contract.taskId}:${evidenceCounter}`;
    const summary = `Resultado simulado de ${contract.taskId}`;
    TOOL.record({
      ref, missionId: contract.missionId, taskId: contract.taskId,
      supports: contract.passCriteria.map((criterion) => criterion.criterionId), outputDigest: digestOutput(summary),
    });
    return { summary, evidenceRefs: [ref] };
  }]));
}

// Network guard: any outbound request during the simulation fails the test.
function guardNetwork(t) {
  const attempts = [];
  const originalFetch = globalThis.fetch;
  const originals = [[http, 'request'], [http, 'get'], [https, 'request'], [https, 'get']].map(([mod, key]) => [mod, key, mod[key]]);
  globalThis.fetch = async () => { attempts.push('fetch'); throw new Error('network_forbidden'); };
  originals.forEach(([mod, key]) => { mod[key] = () => { attempts.push(key); throw new Error('network_forbidden'); }; });
  t.after(() => {
    globalThis.fetch = originalFetch;
    originals.forEach(([mod, key, fn]) => { mod[key] = fn; });
  });
  return attempts;
}

test('simulation: "Analiza una empresa y prepara una propuesta comercial" coordinates several agents and stops at NEEDS_APPROVAL', async (t) => {
  const network = guardNetwork(t);
  const engine = simulationEngine();
  const calls = [];
  const answer = await handleMissionRequest(engine, 'Analiza una empresa y prepara una propuesta comercial.', {
    context: { company: 'ACME Iberia' }, executors: recordingExecutors(calls), includeDetails: true,
  });
  const { state } = answer;
  const byKey = Object.fromEntries(state.tasks.map((task) => [task.key, task]));

  // Mission -> Research Coordinator -> research + web-research agents
  assert.deepEqual([byKey['company-research'].assignedCoordinator, byKey['company-research'].assignedAgent], ['RESEARCH_COORDINATOR', 'research-agent']);
  assert.deepEqual([byKey['web-research'].assignedCoordinator, byKey['web-research'].assignedAgent], ['RESEARCH_COORDINATOR', 'web-research-agent']);
  // -> Data/Analysis agent
  assert.deepEqual([byKey['opportunity-analysis'].assignedCoordinator, byKey['opportunity-analysis'].assignedAgent], ['DATA_COORDINATOR', 'data-analysis-agent']);
  // -> Communication Coordinator -> email agent, gated
  assert.deepEqual([byKey['proposal-draft'].assignedCoordinator, byKey['proposal-draft'].assignedAgent], ['COMMUNICATION_COORDINATOR', 'email-agent']);
  assert.equal(byKey['proposal-draft'].status, 'NEEDS_APPROVAL');
  // Three agents worked, each result verified by the independent verifier.
  assert.deepEqual(calls.map((call) => call.agent), ['research-agent', 'web-research-agent', 'data-analysis-agent']);
  for (const key of ['company-research', 'web-research', 'opportunity-analysis']) {
    assert.equal(byKey[key].status, 'COMPLETED');
    assert.equal(byKey[key].verification.verdict, 'PASS');
  }
  assert.ok(!calls.some((call) => call.agent === 'email-agent'), 'the email agent never ran: nothing drafted, nothing sent');
  // -> verifier-agent -> NEEDS_APPROVAL
  assert.equal(state.verification.verdict, 'PARTIAL_PASS');
  assert.equal(state.engine.state, 'NEEDS_APPROVAL');
  assert.equal(answer.kind, 'APPROVAL');
  assert.deepEqual(answer.approvals.map((item) => item.what), ['Preparar un borrador de respuesta']);
  assert.equal(answer.executionEnabled, false);
  assert.equal(state.executionEnabled, false);
  assert.ok(state.estimatedSpentUsd > 0 && state.estimatedSpentUsd <= 0.25);
  assert.deepEqual(network, []);
});

test('simulation: "Analiza este repositorio, encuentra el fallo, propón reparación y valida tests" stays within A1', async (t) => {
  const network = guardNetwork(t);
  const engine = simulationEngine();
  const calls = [];
  const answer = await handleMissionRequest(engine, 'Analiza este repositorio, encuentra el fallo, propón reparación y valida tests.', {
    context: { repository: 'oxkio' }, executors: recordingExecutors(calls), includeDetails: true,
  });
  const byKey = Object.fromEntries(answer.state.tasks.map((task) => [task.key, task]));
  assert.deepEqual(Object.values(byKey).map((task) => [task.assignedCoordinator, task.assignedAgent]), [
    ['CODE_COORDINATOR', 'repository-analysis-agent'], ['CODE_COORDINATOR', 'code-agent'], ['CODE_COORDINATOR', 'test-agent'],
  ]);
  // Analysis is A1 (read/analyze) and runs; proposing a patch needs approval;
  // running tests is an execute-mode capability: plannable, never executed.
  assert.deepEqual(calls.map((call) => call.agent), ['repository-analysis-agent']);
  assert.equal(byKey['repository-analysis'].verification.verdict, 'PASS');
  assert.deepEqual([byKey['patch-proposal'].gate.decision, byKey['patch-proposal'].status], ['NEEDS_APPROVAL', 'NEEDS_APPROVAL']);
  assert.deepEqual([byKey['test-validation'].gate.decision, byKey['test-validation'].gate.reason], ['SAFE_DRAFT_ONLY', 'execution_disabled']);
  assert.equal(answer.kind, 'APPROVAL');
  assert.deepEqual(network, []);
});

test('simulation: canonical registry runs the same request honestly as BLOCKED, with one clear reason', async () => {
  const quality = new QualityIncidentRegistry({ now: () => NOW });
  const engine = createMissionEngine({ now: () => NOW, qualityRegistry: quality });
  const calls = [];
  const answer = await handleMissionRequest(engine, 'Analiza una empresa y prepara una propuesta comercial.', {
    context: { company: 'ACME Iberia' }, executors: recordingExecutors(calls),
  });
  assert.equal(answer.kind, 'BLOCKED');
  assert.equal(answer.message, 'Todavía no puedo hacer una parte de esta misión: esa función aún no está desarrollada.');
  assert.equal(answer.details, undefined);
  assert.equal(calls.length, 0);
  assert.ok(quality.list().length >= 1);
  assert.ok(quality.list().every((incident) => incident.component === 'mission-engine'));
});

test('zero material execution: every task contract keeps the baseline prohibitions and executionEnabled=false', async () => {
  const engine = simulationEngine();
  for (const blueprint of Object.values(BLUEPRINTS)) {
    const created = engine.createMission({
      blueprintId: blueprint.id,
      objective: 'Simulación de seguridad.',
      constraints: [...blueprint.constraints],
      knownContext: ['context: ok'],
      autonomyLevel: 'A1',
      authorizedCapabilities: [...new Set(blueprint.tasks.flatMap((task) => task.requiredCapabilities))],
      passCriteria: blueprint.passCriteria.map((criterion) => ({ ...criterion })),
      stopCriteria: [...blueprint.stopCriteria],
      requiredEvidence: [...blueprint.requiredEvidence],
    });
    const ran = await engine.runMission(engine.planMission(created), { executors: recordingExecutors([]) });
    assert.equal(ran.executionEnabled, false);
    for (const task of ran.tasks) {
      for (const action of ['gmail.send', 'calendar.create', 'deploy', 'production_change', 'iam_change', 'secret_access',
        'data_deletion', 'spend', 'enable_execution']) {
        assert.ok(task.contract.prohibitedActions.includes(action), `${task.key} ${action}`);
      }
    }
  }
  assert.equal(EXECUTION_POLICY.executionEnabled, false);
  assert.throws(() => { EXECUTION_POLICY.executionEnabled = true; }, TypeError);
});

test('zero material execution: a result claiming a material effect fails verification and the mission', async () => {
  const engine = simulationEngine();
  const answer = await handleMissionRequest(engine, 'Analiza este repositorio, encuentra el fallo, propón reparación y valida tests.', {
    context: { repository: 'oxkio' },
    includeDetails: true,
    executors: {
      'repository-analysis-agent': async (contract) => ({
        evidenceRefs: ['ev:1'], criteriaMet: contract.passCriteria.map((criterion) => criterion.criterionId), materialEffects: ['git_push'],
      }),
    },
  });
  assert.equal(answer.kind, 'FAILED');
  assert.equal(answer.state.verification.verdict, 'FAIL');
});

test('no sends, deploys, IAM or secret access: Mission Engine modules never load providers, credentials or I/O', () => {
  const files = ['mission-engine.js', 'mission-engine-states.js', 'mission-blueprints.js', 'mission-observability.js',
    'mission-chat.js', 'agent-registry.js', 'agent-router.js', 'privacy-gate.js', 'xatai-core.js', 'evidence-registry.js'];
  const forbidden = /require\((['"])(?:[^'"]*(?:gmail-draft-provider|gmail-private-provider|calendar-private-provider|actionExecutor|executionLogger|approvalQueue|secret-runtime|executive-reasoning-provider|postgres|firebase)[^'"]*|node:(?:child_process|fs|http|https|net)|child_process|fs|http|https|net|openai|googleapis|pg|@google-cloud\/secret-manager)\1\)/;
  for (const file of files) {
    const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
    assert.equal(forbidden.test(source), false, file);
    assert.equal(/executionEnabled\s*[:=]\s*true/.test(source), false, file);
  }
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  AUTONOMY_LEVELS,
  BASELINE_PROHIBITED_ACTIONS,
  CONVERGENCE_ACTIONS,
  ENABLED_AUTONOMY_CEILING,
  SUPERVISOR_DECISIONS,
  VERIFICATION_VERDICTS,
  createMissionContract,
  createVerificationRequest,
  decideSupervision,
  evaluateConvergence,
  isAutonomyEnabled,
  isRepeatedAttempt,
  runVerification,
} = require('./xatai-core');

const BASE_CONTRACT = Object.freeze({
  objective: 'Responder al correo seleccionado con un borrador verificado.',
  constraints: ['No inventar datos.'],
  knownContext: ['Correo seleccionado.'],
  autonomyLevel: 'A1',
  authorizedTools: ['gmail.read', 'gmail.draft', 'approvals.read'],
  passCriteria: ['El verificador aprueba el borrador.'],
  stopCriteria: ['Falta una decisión de José.'],
  requiredEvidence: ['Citas literales del correo.'],
});

function contract(overrides = {}) {
  return createMissionContract({ ...BASE_CONTRACT, ...overrides });
}

function errorCode(fn) {
  try { fn(); } catch (error) { return error.code; }
  return null;
}

// --- Mission Contract -----------------------------------------------------

test('a mission contract carries every required field, frozen', () => {
  const value = contract({ missionId: 'mission-001', missingInformation: ['Plazo de renovación.'] });
  assert.equal(value.objective, BASE_CONTRACT.objective);
  assert.deepEqual(value.constraints, BASE_CONTRACT.constraints);
  assert.deepEqual(value.knownContext, BASE_CONTRACT.knownContext);
  assert.deepEqual(value.missingInformation, ['Plazo de renovación.']);
  assert.equal(value.autonomyLevel, 'A1');
  assert.deepEqual(value.authorizedTools, BASE_CONTRACT.authorizedTools);
  assert.equal(value.passCriteria[0].description, 'El verificador aprueba el borrador.');
  assert.equal(value.stopCriteria[0].description, 'Falta una decisión de José.');
  assert.deepEqual(value.requiredEvidence, BASE_CONTRACT.requiredEvidence);
  assert.equal(value.missionId, 'mission-001');
  assert.ok(Object.isFrozen(value));
  assert.ok(Object.isFrozen(value.authorizedTools));
});

test('baseline prohibitions are always present and cannot be authorized as tools', () => {
  const value = contract({ prohibitedActions: ['custom_action'] });
  for (const action of BASELINE_PROHIBITED_ACTIONS) assert.ok(value.prohibitedActions.includes(action), action);
  assert.ok(value.prohibitedActions.includes('custom_action'));
  assert.equal(errorCode(() => contract({ authorizedTools: ['gmail.read', 'gmail.send'] })), 'prohibited_tool_authorized');
  assert.equal(errorCode(() => contract({ authorizedTools: ['calendar.create'] })), 'prohibited_tool_authorized');
});

test('a contract rejects unknown tools, missing fields and invalid autonomy', () => {
  assert.equal(errorCode(() => contract({ authorizedTools: ['not.a.capability'] })), 'unknown_authorized_tool');
  assert.equal(errorCode(() => contract({ authorizedTools: [] })), 'invalid_authorizedTools');
  assert.equal(errorCode(() => contract({ objective: '' })), 'invalid_objective');
  assert.equal(errorCode(() => contract({ constraints: [] })), 'invalid_constraints');
  assert.equal(errorCode(() => contract({ passCriteria: [] })), 'invalid_passCriteria');
  assert.equal(errorCode(() => contract({ stopCriteria: undefined })), 'invalid_stopCriteria');
  assert.equal(errorCode(() => contract({ requiredEvidence: [] })), 'invalid_requiredEvidence');
  assert.equal(errorCode(() => contract({ autonomyLevel: 'A9' })), 'invalid_autonomyLevel');
  assert.equal(errorCode(() => contract({ missionId: 'bad id with spaces' })), 'invalid_missionId');
});

// --- Autonomy levels ------------------------------------------------------

test('A0-A5 are all represented but only A0-A1 are enabled in V1', () => {
  assert.deepEqual(Object.keys(AUTONOMY_LEVELS), ['A0', 'A1', 'A2', 'A3', 'A4', 'A5']);
  assert.equal(ENABLED_AUTONOMY_CEILING, 'A1');
  assert.equal(isAutonomyEnabled('A0'), true);
  assert.equal(isAutonomyEnabled('A1'), true);
  for (const level of ['A2', 'A3', 'A4', 'A5', 'A9', undefined]) assert.equal(isAutonomyEnabled(level), false, String(level));
});

// --- Convergence Sentinel -------------------------------------------------

test('the sentinel picks a corrective action per failure kind and never repeats a tried one', () => {
  const invalid = evaluateConvergence({ attempts: [{ outcome: 'fail', failureKind: 'invalid_output' }] });
  assert.equal(invalid.action, CONVERGENCE_ACTIONS.REFINE_PROMPT);
  const second = evaluateConvergence({
    attempts: [
      { outcome: 'fail', failureKind: 'invalid_output' },
      { outcome: 'fail', failureKind: 'invalid_output', correctiveAction: 'REFINE_PROMPT' },
    ],
  });
  assert.equal(second.action, CONVERGENCE_ACTIONS.REDUCE_SCOPE);
  assert.equal(evaluateConvergence({ attempts: [{ outcome: 'fail', failureKind: 'verification_failed' }] }).action,
    CONVERGENCE_ACTIONS.CHANGE_HYPOTHESIS);
  assert.equal(evaluateConvergence({ attempts: [{ outcome: 'fail', failureKind: 'tool_error' }] }).action,
    CONVERGENCE_ACTIONS.CHANGE_TOOL);
  assert.equal(evaluateConvergence({ attempts: [{ outcome: 'fail', failureKind: 'agent_error' }] }).action,
    CONVERGENCE_ACTIONS.CHANGE_AGENT);
});

test('the sentinel escalates to a human for authority failures, exhausted budget or unknown failures', () => {
  for (const failureKind of ['auth', 'connection', 'permission', 'budget']) {
    const result = evaluateConvergence({ attempts: [{ outcome: 'fail', failureKind }] });
    assert.equal(result.action, CONVERGENCE_ACTIONS.ESCALATE_HUMAN, failureKind);
    assert.equal(result.reason, 'human_authority_required');
  }
  const exhausted = evaluateConvergence({
    attempts: [{ outcome: 'fail', failureKind: 'invalid_output' }, { outcome: 'fail', failureKind: 'invalid_output' }],
    maxAttempts: 2,
  });
  assert.equal(exhausted.action, CONVERGENCE_ACTIONS.ESCALATE_HUMAN);
  assert.equal(exhausted.reason, 'attempt_budget_exhausted');
  assert.equal(evaluateConvergence({ attempts: [{ outcome: 'fail', failureKind: 'mystery' }] }).reason, 'unknown_failure');
  const allTried = evaluateConvergence({
    attempts: [
      { outcome: 'fail', failureKind: 'tool_error', correctiveAction: 'CHANGE_TOOL' },
      { outcome: 'fail', failureKind: 'tool_error', correctiveAction: 'CHANGE_AGENT' },
    ],
    maxAttempts: 5,
  });
  assert.equal(allTried.action, CONVERGENCE_ACTIONS.ESCALATE_HUMAN);
  assert.equal(allTried.reason, 'strategies_exhausted');
});

test('the sentinel reports convergence on pass and detects an identical failed attempt', () => {
  assert.deepEqual({ ...evaluateConvergence({ attempts: [{ outcome: 'pass' }] }) }, { converged: true, action: null, reason: 'passed' });
  const failed = { hypothesis: 'h1', tool: 'gmail.read', agent: 'a', scope: 's', prompt: 'p', outcome: 'fail' };
  assert.equal(isRepeatedAttempt([failed], { ...failed, outcome: undefined }), true);
  assert.equal(isRepeatedAttempt([failed], { ...failed, hypothesis: 'h2' }), false);
  assert.equal(isRepeatedAttempt([{ ...failed, outcome: 'pass' }], failed), false);
});

// --- Verifier Contract ----------------------------------------------------

function request(checks, evidence = ['cita literal']) {
  return createVerificationRequest({ claimedResult: 'draft', evidence, constraints: ['No inventar'], checks });
}
const passCheck = { id: 'ok', run: () => ({ verdict: 'PASS' }) };

test('the verifier passes only independent, evidenced, all-passing checks', () => {
  const pass = runVerification(request([passCheck]), { verifierId: 'verifier', executorId: 'model' });
  assert.equal(pass.verdict, VERIFICATION_VERDICTS.PASS);
  const failed = runVerification(request([passCheck, { id: 'bad', run: () => ({ verdict: 'FAIL', reasons: ['unsupported_fact'] }) }]),
    { verifierId: 'verifier', executorId: 'model' });
  assert.equal(failed.verdict, VERIFICATION_VERDICTS.FAIL);
  assert.deepEqual(failed.reasons, ['unsupported_fact']);
});

test('the executor never certifies itself and a claim without evidence is never PASS', () => {
  const self = runVerification(request([passCheck]), { verifierId: 'model', executorId: 'model' });
  assert.equal(self.verdict, VERIFICATION_VERDICTS.NEEDS_REVIEW);
  assert.deepEqual(self.reasons, ['verifier_not_independent']);
  assert.equal(runVerification(request([passCheck]), { verifierId: 'verifier' }).verdict, VERIFICATION_VERDICTS.NEEDS_REVIEW);
  const noEvidence = runVerification(request([passCheck], []), { verifierId: 'verifier', executorId: 'model' });
  assert.equal(noEvidence.verdict, VERIFICATION_VERDICTS.NEEDS_REVIEW);
  assert.deepEqual(noEvidence.reasons, ['missing_evidence']);
});

test('a throwing or ambiguous check is NEEDS_REVIEW, and a request needs at least one check', () => {
  const thrown = runVerification(request([{ id: 'boom', run: () => { throw new Error('x'); } }]),
    { verifierId: 'verifier', executorId: 'model' });
  assert.equal(thrown.verdict, VERIFICATION_VERDICTS.NEEDS_REVIEW);
  assert.deepEqual(thrown.reasons, ['check_error']);
  const ambiguous = runVerification(request([{ id: 'maybe', run: () => ({ verdict: 'probably' }) }]),
    { verifierId: 'verifier', executorId: 'model' });
  assert.equal(ambiguous.verdict, VERIFICATION_VERDICTS.NEEDS_REVIEW);
  assert.equal(errorCode(() => createVerificationRequest({ checks: [] })), 'invalid_checks');
});

// --- Supervisor Decision --------------------------------------------------

test('the supervisor decision covers all six outcomes', () => {
  const base = contract();
  const decide = (signals) => decideSupervision({ contract: base, ...signals }).decision;
  assert.equal(decide({ capabilityId: 'approvals.read', connectionAvailable: true }), SUPERVISOR_DECISIONS.CAN_EXECUTE);
  assert.equal(decide({ capabilityId: 'gmail.draft' }), SUPERVISOR_DECISIONS.NEEDS_APPROVAL);
  assert.equal(decide({ capabilityId: 'gmail.draft', connectionAvailable: false }), SUPERVISOR_DECISIONS.NEEDS_CONNECTION);
  assert.equal(decide({ capabilityId: 'gmail.draft', missingInformation: ['plazo'] }), SUPERVISOR_DECISIONS.NEEDS_INFORMATION);
  assert.equal(decide({ capabilityId: 'gmail.send' }), SUPERVISOR_DECISIONS.BLOCKED);
  const a3 = contract({ autonomyLevel: 'A3' });
  assert.equal(decideSupervision({ contract: a3, capabilityId: 'gmail.draft' }).decision, SUPERVISOR_DECISIONS.SAFE_DRAFT_ONLY);
});

test('prohibited, unauthorized, unavailable, blocked or unverified work is never executable', () => {
  const base = contract({ authorizedTools: ['gmail.draft', 'tasks.read', 'mission.close'] });
  const reason = (signals) => decideSupervision({ contract: base, ...signals }).reason;
  assert.equal(reason({ capabilityId: 'gmail.send' }), 'prohibited_action');
  assert.equal(reason({ capabilityId: 'gmail.read' }), 'tool_not_authorized');
  assert.equal(reason({ capabilityId: 'tasks.read' }), 'capability_unavailable');
  assert.equal(reason({ capabilityId: 'mission.close' }), 'capability_unavailable');
  assert.equal(reason({ capabilityId: 'gmail.draft', blockedReason: 'budget_blocked' }), 'budget_blocked');
  assert.equal(reason({ capabilityId: 'gmail.draft', verification: { verdict: 'FAIL' } }), 'verification_failed');
  assert.equal(decideSupervision({ contract: base, capabilityId: 'gmail.draft', verification: { verdict: 'NEEDS_REVIEW' } }).decision,
    SUPERVISOR_DECISIONS.NEEDS_INFORMATION);
  assert.equal(decideSupervision({ capabilityId: 'gmail.draft' }).decision, SUPERVISOR_DECISIONS.BLOCKED);
  const withMissing = contract({ missingInformation: ['dato'] });
  assert.equal(decideSupervision({ contract: withMissing, capabilityId: 'gmail.draft' }).decision,
    SUPERVISOR_DECISIONS.NEEDS_INFORMATION);
});

test('executionEnabled stays false: switching it on never yields CAN_EXECUTE in V1', () => {
  const base = contract();
  const decision = decideSupervision({ contract: base, capabilityId: 'approvals.read', policy: { executionEnabled: true } });
  assert.equal(decision.decision, SUPERVISOR_DECISIONS.SAFE_DRAFT_ONLY);
  assert.equal(decision.reason, 'execution_disabled');
});

// ---------------------------------------------------------------- XATAI CORE V2

const {
  MISSION_VERDICTS, detectAgentCycle, evaluateTaskConvergence, verifyMission,
} = require('./xatai-core');

test('V2 sentinel: an agent path that returns to a tried agent is a cycle', () => {
  assert.equal(detectAgentCycle(['a', 'b', 'a']), true);
  assert.equal(detectAgentCycle(['a', 'a', 'b']), false);
  assert.equal(detectAgentCycle(['a', 'b', 'c']), false);
  const verdict = evaluateTaskConvergence({
    attempts: [{ outcome: 'fail', failureKind: 'agent_error' }], agentPath: ['a', 'b', 'a'],
  });
  assert.deepEqual([verdict.action, verdict.reason], ['ESCALATE_HUMAN', 'agent_cycle_detected']);
});

test('V2 sentinel: task budget and mission budget both stop retries', () => {
  const fail1 = { outcome: 'fail', failureKind: 'invalid_output' };
  assert.equal(evaluateTaskConvergence({ attempts: [fail1] }).action, 'REFINE_PROMPT');
  assert.equal(evaluateTaskConvergence({ attempts: [fail1, fail1], maxTaskAttempts: 2 }).reason, 'attempt_budget_exhausted');
  const mission = evaluateTaskConvergence({ attempts: [fail1], missionRetriesUsed: 4, missionRetryBudget: 4 });
  assert.deepEqual([mission.action, mission.reason], ['ESCALATE_HUMAN', 'mission_retry_budget_exhausted']);
  // Human-authority failures escalate even with budget left.
  assert.equal(evaluateTaskConvergence({ attempts: [{ outcome: 'fail', failureKind: 'budget' }] }).reason, 'human_authority_required');
  assert.equal(evaluateTaskConvergence({ attempts: [{ outcome: 'pass' }] }).converged, true);
});

test('V2 verifier: mission verdicts PASS, PARTIAL_PASS, FAIL and NEEDS_REVIEW', () => {
  const pass = (taskId, executorId = 'memory-agent') => ({ taskId, executorId, verdict: 'PASS', evidenceRefs: [`ev:${taskId}`] });
  assert.equal(verifyMission({ tasks: [pass('t1'), pass('t2')], verifierId: 'verifier-agent', passCriteriaDemonstrated: true }).verdict, MISSION_VERDICTS.PASS);
  assert.equal(verifyMission({ tasks: [pass('t1')], verifierId: 'verifier-agent' }).verdict, 'NEEDS_REVIEW');
  const partial = verifyMission({ tasks: [pass('t1'), { taskId: 't2', verdict: null }], verifierId: 'verifier-agent' });
  assert.deepEqual([partial.verdict, partial.pendingTaskIds], ['PARTIAL_PASS', ['t2']]);
  assert.equal(verifyMission({ tasks: [pass('t1'), { taskId: 't2', verdict: 'FAIL' }], verifierId: 'verifier-agent' }).verdict, 'FAIL');
  assert.equal(verifyMission({ tasks: [pass('t1')], verifierId: 'verifier-agent', constraintViolations: ['x'], passCriteriaDemonstrated: true }).verdict, 'FAIL');
  assert.equal(verifyMission({ tasks: [{ taskId: 't1', verdict: null }], verifierId: 'verifier-agent' }).verdict, 'NEEDS_REVIEW');
  assert.equal(verifyMission({ tasks: [{ taskId: 't1', verdict: 'PASS', evidenceRefs: [] }], verifierId: 'verifier-agent', passCriteriaDemonstrated: true }).verdict, 'NEEDS_REVIEW');
  const selfCertified = verifyMission({ tasks: [pass('t1', 'verifier-agent')], verifierId: 'verifier-agent', passCriteriaDemonstrated: true });
  assert.deepEqual([selfCertified.verdict, selfCertified.reasons], ['NEEDS_REVIEW', ['verifier_not_independent']]);
  assert.equal(verifyMission({ tasks: [pass('t1')], passCriteriaDemonstrated: true }).verdict, 'NEEDS_REVIEW');
});

test('V2: capability lookup is injectable for controlled simulation, canonical by default', () => {
  const input = { ...BASE_CONTRACT, authorizedTools: ['research.web'] };
  const canonical = createMissionContract(input);
  assert.equal(decideSupervision({ contract: canonical, capabilityId: 'research.web' }).reason, 'capability_unavailable');
  const simulated = (id) => (id === 'research.web'
    ? { id, mode: 'read', status: 'AVAILABLE', requiresApproval: false, requiresExternalConnection: false } : null);
  const contractSim = createMissionContract(input, { describeCapability: simulated });
  assert.equal(decideSupervision({ contract: contractSim, capabilityId: 'research.web', describeCapability: simulated }).decision, 'CAN_EXECUTE');
  assert.equal(errorCode(() => createMissionContract({ ...BASE_CONTRACT, authorizedTools: ['ghost.capability'] })), 'unknown_authorized_tool');
});

'use strict';

const { CAPABILITY_STATUS, describeCapability } = require('./capability-registry');
const {
  MissionDomainError,
  normalizeCriteria,
  normalizeOptionalIdentifier,
  normalizeRequiredText,
} = require('../mission-queue/mission-contract');

// XATAI CORE V1 (30/09/2026): the governance layer of the canonical runtime.
// Every mission follows OBJETIVO -> CONTEXTO -> RESTRICCIONES -> RIESGO ->
// PLAN -> DELEGACION -> EJECUCION -> EVIDENCIA -> VERIFICACION -> MEMORIA ->
// SIGUIENTE ACCION. This module only represents and decides; it never
// executes. It reuses the capability registry (what exists), the Mission
// Queue normalizers (how mission text/criteria are validated) and leaves
// execution to the existing proposal/approval queue, which keeps
// executionEnabled=false.

const AUTONOMY_LEVELS = Object.freeze({
  A0: Object.freeze({ rank: 0, description: 'Conversa y observa.' }),
  A1: Object.freeze({ rank: 1, description: 'Investiga, razona y prepara.' }),
  A2: Object.freeze({ rank: 2, description: 'Ejecuta acciones seguras y reversibles.' }),
  A3: Object.freeze({ rank: 3, description: 'Coordina agentes y workflows.' }),
  A4: Object.freeze({ rank: 4, description: 'Diagnostica y autorrepara dentro de límites.' }),
  A5: Object.freeze({ rank: 5, description: 'Misión completa dentro de un contrato aprobado.' }),
});
// A2-A5 are represented so contracts can state them, but V1 never grants
// them: anything above this ceiling is capped to SAFE_DRAFT_ONLY.
const ENABLED_AUTONOMY_CEILING = 'A1';

// Irreversible or external actions that no V1 contract may authorize.
const BASELINE_PROHIBITED_ACTIONS = Object.freeze([
  'gmail.send', 'calendar.create', 'deploy', 'production_change', 'iam_change',
  'secret_access', 'data_deletion', 'spend', 'enable_execution',
]);

const CONVERGENCE_ACTIONS = Object.freeze({
  REFINE_PROMPT: 'REFINE_PROMPT',
  REDUCE_SCOPE: 'REDUCE_SCOPE',
  CHANGE_HYPOTHESIS: 'CHANGE_HYPOTHESIS',
  CHANGE_TOOL: 'CHANGE_TOOL',
  CHANGE_AGENT: 'CHANGE_AGENT',
  ESCALATE_HUMAN: 'ESCALATE_HUMAN',
});

const VERIFICATION_VERDICTS = Object.freeze({ PASS: 'PASS', FAIL: 'FAIL', NEEDS_REVIEW: 'NEEDS_REVIEW' });

const SUPERVISOR_DECISIONS = Object.freeze({
  CAN_EXECUTE: 'CAN_EXECUTE',
  NEEDS_APPROVAL: 'NEEDS_APPROVAL',
  NEEDS_CONNECTION: 'NEEDS_CONNECTION',
  NEEDS_INFORMATION: 'NEEDS_INFORMATION',
  BLOCKED: 'BLOCKED',
  SAFE_DRAFT_ONLY: 'SAFE_DRAFT_ONLY',
});

function fail(code, message) {
  throw new MissionDomainError(code, message);
}

function textList(value, fieldName, { required = false, maxLength = 300 } = {}) {
  const input = value === undefined ? [] : value;
  if (!Array.isArray(input)) fail(`invalid_${fieldName}`, `${fieldName} must be an array.`);
  if (required && input.length === 0) fail(`invalid_${fieldName}`, `${fieldName} cannot be empty.`);
  return Object.freeze(input.map((item) => normalizeRequiredText(item, fieldName, maxLength)));
}

function autonomyRank(level) {
  return Object.hasOwn(AUTONOMY_LEVELS, level) ? AUTONOMY_LEVELS[level].rank : null;
}

function isAutonomyEnabled(level) {
  const rank = autonomyRank(level);
  return rank !== null && rank <= autonomyRank(ENABLED_AUTONOMY_CEILING);
}

// Mission Contract: what a mission may and may not do. Authorized tools must
// exist in the capability registry and can never include a prohibited one;
// the baseline prohibitions are always present whatever the caller passes.
function createMissionContract(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('invalid_contract', 'Mission contract payload is required.');
  }
  if (autonomyRank(input.autonomyLevel) === null) {
    fail('invalid_autonomyLevel', 'autonomyLevel must be one of A0-A5.');
  }
  const prohibitedActions = Object.freeze([
    ...new Set([...BASELINE_PROHIBITED_ACTIONS, ...textList(input.prohibitedActions, 'prohibitedActions', { maxLength: 80 })]),
  ]);
  const authorizedTools = textList(input.authorizedTools, 'authorizedTools', { required: true, maxLength: 80 });
  authorizedTools.forEach((toolId) => {
    if (!describeCapability(toolId)) fail('unknown_authorized_tool', `${toolId} is not a registered capability.`);
    if (prohibitedActions.includes(toolId)) fail('prohibited_tool_authorized', `${toolId} is a prohibited action.`);
  });
  return Object.freeze({
    missionId: normalizeOptionalIdentifier(input.missionId, 'missionId'),
    objective: normalizeRequiredText(input.objective, 'objective', 500),
    constraints: textList(input.constraints, 'constraints', { required: true }),
    knownContext: textList(input.knownContext, 'knownContext'),
    missingInformation: textList(input.missingInformation, 'missingInformation'),
    autonomyLevel: input.autonomyLevel,
    authorizedTools,
    prohibitedActions,
    passCriteria: Object.freeze(normalizeCriteria(input.passCriteria, 'passCriteria')),
    stopCriteria: Object.freeze(normalizeCriteria(input.stopCriteria, 'stopCriteria')),
    requiredEvidence: textList(input.requiredEvidence, 'requiredEvidence', { required: true }),
  });
}

// Convergence Sentinel: an attempt is identified by what it changes
// (hypothesis, tool, agent, scope, prompt). Retrying an identical attempt
// that already failed is never allowed; each failure kind maps to the first
// corrective action not yet tried, and once none is left (or the failure is
// one only a human can fix) the answer is ESCALATE_HUMAN.
const FAILURE_STRATEGIES = Object.freeze({
  invalid_output: ['REFINE_PROMPT', 'REDUCE_SCOPE', 'CHANGE_AGENT'],
  verification_failed: ['CHANGE_HYPOTHESIS', 'REFINE_PROMPT', 'REDUCE_SCOPE'],
  too_broad: ['REDUCE_SCOPE', 'REFINE_PROMPT'],
  timeout: ['REDUCE_SCOPE', 'CHANGE_TOOL'],
  tool_error: ['CHANGE_TOOL', 'CHANGE_AGENT'],
  agent_error: ['CHANGE_AGENT', 'CHANGE_TOOL'],
  // Credentials, permissions, connections and budget are human authority.
  auth: [],
  connection: [],
  permission: [],
  budget: [],
});

function attemptFingerprint(attempt = {}) {
  return JSON.stringify(['hypothesis', 'tool', 'agent', 'scope', 'prompt'].map((key) => String(attempt[key] ?? '')));
}

function isRepeatedAttempt(attempts, next) {
  const fingerprint = attemptFingerprint(next);
  return (Array.isArray(attempts) ? attempts : [])
    .some((attempt) => attempt && attempt.outcome !== 'pass' && attemptFingerprint(attempt) === fingerprint);
}

function evaluateConvergence({ attempts = [], maxAttempts = 3 } = {}) {
  const history = Array.isArray(attempts) ? attempts : [];
  const last = history[history.length - 1];
  if (last && last.outcome === 'pass') return Object.freeze({ converged: true, action: null, reason: 'passed' });
  if (!last) return Object.freeze({ converged: false, action: null, reason: 'no_attempts' });
  const escalate = (reason) => Object.freeze({ converged: false, action: CONVERGENCE_ACTIONS.ESCALATE_HUMAN, reason });
  if (history.length >= maxAttempts) return escalate('attempt_budget_exhausted');
  const strategy = FAILURE_STRATEGIES[last.failureKind];
  if (!strategy) return escalate('unknown_failure');
  const tried = new Set(history.map((attempt) => attempt.correctiveAction).filter(Boolean));
  const next = strategy.find((action) => !tried.has(action));
  if (!next) return escalate(strategy.length === 0 ? 'human_authority_required' : 'strategies_exhausted');
  return Object.freeze({ converged: false, action: CONVERGENCE_ACTIONS[next], reason: last.failureKind });
}

// Verifier Contract: an independent check of a claimed result. The executor
// never certifies itself (same id -> NEEDS_REVIEW), a claim without evidence
// is never PASS, and a check that throws is NEEDS_REVIEW, not a silent pass.
function createVerificationRequest({ claimedResult, evidence = [], constraints = [], checks = [] } = {}) {
  if (!Array.isArray(checks) || checks.length === 0
    || !checks.every((check) => check && typeof check.id === 'string' && typeof check.run === 'function')) {
    fail('invalid_checks', 'A verification request needs at least one check with id and run().');
  }
  return Object.freeze({
    claimedResult,
    evidence: Object.freeze(Array.isArray(evidence) ? [...evidence] : []),
    constraints: Object.freeze(Array.isArray(constraints) ? [...constraints] : []),
    checks: Object.freeze([...checks]),
  });
}

function runVerification(request, { verifierId, executorId } = {}) {
  const verdict = (value, reasons, results = []) => Object.freeze({
    verdict: value, reasons: Object.freeze(reasons), checks: Object.freeze(results),
  });
  if (!verifierId || !executorId || verifierId === executorId) {
    return verdict(VERIFICATION_VERDICTS.NEEDS_REVIEW, ['verifier_not_independent']);
  }
  if (request.evidence.length === 0) return verdict(VERIFICATION_VERDICTS.NEEDS_REVIEW, ['missing_evidence']);
  const results = request.checks.map((check) => {
    try {
      const outcome = check.run(request) || {};
      const value = Object.values(VERIFICATION_VERDICTS).includes(outcome.verdict)
        ? outcome.verdict : VERIFICATION_VERDICTS.NEEDS_REVIEW;
      return Object.freeze({ id: check.id, verdict: value, reasons: Object.freeze([...(outcome.reasons || [])]) });
    } catch (error) {
      return Object.freeze({ id: check.id, verdict: VERIFICATION_VERDICTS.NEEDS_REVIEW, reasons: Object.freeze(['check_error']) });
    }
  });
  const reasons = results.flatMap((result) => result.reasons);
  if (results.some((result) => result.verdict === VERIFICATION_VERDICTS.FAIL)) {
    return verdict(VERIFICATION_VERDICTS.FAIL, reasons, results);
  }
  if (results.some((result) => result.verdict === VERIFICATION_VERDICTS.NEEDS_REVIEW)) {
    return verdict(VERIFICATION_VERDICTS.NEEDS_REVIEW, reasons, results);
  }
  return verdict(VERIFICATION_VERDICTS.PASS, [], results);
}

// Supervisor Decision: the single structured answer about what may happen
// next with one capability under one contract. Order matters: prohibitions
// and missing capabilities block first, then missing information and
// connections, then the autonomy ceiling and executionEnabled=false.
function decideSupervision({
  contract,
  capabilityId,
  connectionAvailable = true,
  missingInformation = [],
  verification = null,
  blockedReason = null,
  policy = { executionEnabled: false },
} = {}) {
  const decide = (decision, reason) => Object.freeze({ decision, reason, capabilityId: capabilityId || null });
  if (!contract) return decide(SUPERVISOR_DECISIONS.BLOCKED, 'missing_contract');
  if (contract.prohibitedActions.includes(capabilityId)) return decide(SUPERVISOR_DECISIONS.BLOCKED, 'prohibited_action');
  if (!contract.authorizedTools.includes(capabilityId)) return decide(SUPERVISOR_DECISIONS.BLOCKED, 'tool_not_authorized');
  // A known blocking condition reported by the caller (budget gate, provider
  // failure without a human fix) is never softened into another decision.
  if (blockedReason) return decide(SUPERVISOR_DECISIONS.BLOCKED, String(blockedReason).slice(0, 80));
  const capability = describeCapability(capabilityId);
  if (!capability || capability.status === CAPABILITY_STATUS.NOT_IMPLEMENTED
    || capability.status === CAPABILITY_STATUS.BLOCKED) {
    return decide(SUPERVISOR_DECISIONS.BLOCKED, 'capability_unavailable');
  }
  if ([...contract.missingInformation, ...missingInformation].length > 0) {
    return decide(SUPERVISOR_DECISIONS.NEEDS_INFORMATION, 'missing_information');
  }
  if (capability.requiresExternalConnection && connectionAvailable !== true) {
    return decide(SUPERVISOR_DECISIONS.NEEDS_CONNECTION, 'connection_unavailable');
  }
  if (verification && verification.verdict === VERIFICATION_VERDICTS.FAIL) {
    return decide(SUPERVISOR_DECISIONS.BLOCKED, 'verification_failed');
  }
  if (verification && verification.verdict === VERIFICATION_VERDICTS.NEEDS_REVIEW) {
    return decide(SUPERVISOR_DECISIONS.NEEDS_INFORMATION, 'verification_needs_review');
  }
  if (!isAutonomyEnabled(contract.autonomyLevel)) return decide(SUPERVISOR_DECISIONS.SAFE_DRAFT_ONLY, 'autonomy_not_enabled');
  if (capability.mode === 'execute' || (policy && policy.executionEnabled !== false)) {
    // V1 never executes: execute-mode capabilities, or any attempt to run
    // with executionEnabled switched on, stay as a safe draft.
    return decide(SUPERVISOR_DECISIONS.SAFE_DRAFT_ONLY, 'execution_disabled');
  }
  if (capability.requiresApproval) return decide(SUPERVISOR_DECISIONS.NEEDS_APPROVAL, 'human_approval_required');
  return decide(SUPERVISOR_DECISIONS.CAN_EXECUTE, 'safe_read_or_analysis');
}

module.exports = {
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
};

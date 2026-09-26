'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { CostController } = require('./cost-controller');
const { TELEMETRY_SCHEMA_VERSION, SupervisedAutonomyTelemetry } = require('./supervised-autonomy-telemetry');

const PAID_CATALOG = {
  paid: {
    provider: 'test', tier: 'small', inputUsdPerMillion: 1, outputUsdPerMillion: 2,
    residency: 'eu', privacy: 'internal', pricingVersion: 'paid-test-v1',
    pricingSource: 'https://example.invalid/pricing', reviewedAt: '2026-09-21',
  },
};

function controller() {
  return new CostController({ catalog: PAID_CATALOG, now: () => '2026-09-24T12:00:00.000Z' });
}

function decide(overrides = {}) {
  return controller().decide({ mission: { smallModelEstimatedCostUsd: 0.01 }, ...overrides });
}

function assertRejected(telemetry, input, code) {
  const before = telemetry.snapshot();
  assert.throws(() => telemetry.record(input), (error) => {
    assert.ok(error instanceof TypeError);
    assert.equal(error.message, code);
    return true;
  });
  assert.deepEqual(telemetry.snapshot(), before);
}

test('records a real CostController decision', () => {
  const telemetry = new SupervisedAutonomyTelemetry();
  telemetry.record({ outcome: 'completed', costDecision: decide() });
  const snapshot = telemetry.snapshot();
  assert.equal(snapshot.schemaVersion, TELEMETRY_SCHEMA_VERSION);
  assert.equal(TELEMETRY_SCHEMA_VERSION, 2);
  assert.equal(snapshot.outcomes.completedCount, 1);
  assert.equal(snapshot.outcomes.totalAttempts, 1);
  assert.equal(snapshot.outcomes.autonomousCompletionRate, 1);
});

test('rejects fabricated, cloned, shallow-copied and look-alike frozen decisions', () => {
  const telemetry = new SupervisedAutonomyTelemetry();
  const real = decide();
  const deepFreeze = (value) => {
    if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(deepFreeze); }
    return value;
  };
  const fabricated = {
    decision: { level: 'small_model', reason: 'x', availableBudgetUsd: 0.25 },
    executionPattern: { pattern: 'single_shot', reason: 'x' },
    evidence: {}, source: 'policy', cacheKey: null,
    costEstimate: { status: 'not_requested', estimatedCostUsd: null, modelId: null, pricingVersion: null },
  };
  for (const costDecision of [fabricated, deepFreeze(structuredClone(fabricated)), structuredClone(real), { ...real }, deepFreeze(structuredClone(real))]) {
    assertRejected(telemetry, { outcome: 'completed', costDecision }, 'TELEMETRY_UNTRUSTED_COST_DECISION');
  }
});

test('each telemetry attempt is recorded exactly once', () => {
  const telemetry = new SupervisedAutonomyTelemetry();
  const costDecision = decide();
  telemetry.record({ outcome: 'failed', costDecision });
  assertRejected(telemetry, { outcome: 'completed', costDecision }, 'TELEMETRY_DUPLICATE_ATTEMPT');
  assert.equal(telemetry.snapshot().outcomes.totalAttempts, 1);
  assert.equal(telemetry.snapshot().outcomes.failedCount, 1);
});

test('sums estimated cost only from the controller-owned costEstimate', () => {
  const telemetry = new SupervisedAutonomyTelemetry();
  const costDecision = decide({ costBasis: { modelId: 'paid', inputTokens: 1000, outputTokens: 500 } });
  assert.equal(costDecision.costEstimate.estimatedCostUsd, 0.002);
  telemetry.record({ outcome: 'completed', costDecision });
  assert.deepEqual(telemetry.snapshot().cost, {
    estimatedCostUsd: 0.002, estimatedCostCount: 1, unknownCostCount: 0, notRequestedCostCount: 0,
  });
});

test('accumulates ten estimates of 0.1 USD without floating drift', () => {
  const telemetry = new SupervisedAutonomyTelemetry();
  for (let i = 0; i < 10; i += 1) {
    const costDecision = decide({ costBasis: { modelId: 'paid', inputTokens: 100000 } });
    assert.equal(costDecision.costEstimate.estimatedCostUsd, 0.1);
    telemetry.record({ outcome: 'completed', costDecision });
  }
  assert.equal(telemetry.snapshot().cost.estimatedCostUsd, 1);
  assert.equal(telemetry.snapshot().cost.estimatedCostCount, 10);
});

test('unknown_model increments unknownCostCount without adding cost', () => {
  const telemetry = new SupervisedAutonomyTelemetry();
  telemetry.record({ outcome: 'completed', costDecision: decide({ costBasis: { modelId: 'missing', inputTokens: 1000 } }) });
  assert.deepEqual(telemetry.snapshot().cost, {
    estimatedCostUsd: 0, estimatedCostCount: 0, unknownCostCount: 1, notRequestedCostCount: 0,
  });
});

test('not_requested increments notRequestedCostCount without adding cost', () => {
  const telemetry = new SupervisedAutonomyTelemetry();
  telemetry.record({ outcome: 'blocked', costDecision: decide() });
  assert.deepEqual(telemetry.snapshot().cost, {
    estimatedCostUsd: 0, estimatedCostCount: 0, unknownCostCount: 0, notRequestedCostCount: 1,
  });
});

test('cache hits count reused decisions only and imply no savings', () => {
  const telemetry = new SupervisedAutonomyTelemetry();
  const shared = controller();
  const request = {
    mission: { smallModelEstimatedCostUsd: 0.01 },
    cacheContext: { inputFingerprint: 'safe-fingerprint', policyVersion: 1 },
    costBasis: { modelId: 'paid', inputTokens: 1000 },
  };
  const fresh = shared.decide(request);
  const hit = shared.decide(request);
  assert.equal(fresh.source, 'policy');
  assert.equal(hit.source, 'cache');
  telemetry.record({ outcome: 'completed', costDecision: fresh });
  telemetry.record({ outcome: 'completed', costDecision: hit });
  const snapshot = telemetry.snapshot();
  assert.equal(snapshot.cacheHits, 1);
  assert.deepEqual(snapshot.sourceHistogram, { policy: 1, cache: 1 });
  assert.equal(snapshot.cost.estimatedCostUsd, 0.002);
  assert.equal(JSON.stringify(snapshot).toLowerCase().includes('saving'), false);
  assert.equal(JSON.stringify(snapshot).toLowerCase().includes('avoided'), false);
});

test('histograms and cross tables aggregate pattern, level, source and outcome', () => {
  const telemetry = new SupervisedAutonomyTelemetry();
  telemetry.record({ outcome: 'completed', costDecision: decide({ mission: { deterministicAvailable: true } }) });
  telemetry.record({ outcome: 'human_intervention', costDecision: decide({ mission: { sensitiveAction: true, smallModelEstimatedCostUsd: 0.01 } }) });
  telemetry.record({ outcome: 'failed', costDecision: decide({ mission: { smallModelEstimatedCostUsd: 0.01 } }) });
  telemetry.record({ outcome: 'blocked', costDecision: decide({ mission: {} }) });
  const snapshot = telemetry.snapshot();

  assert.deepEqual(snapshot.executionPatternHistogram, {
    deterministic: 1, single_shot: 2, react: 0, planner_executor: 0, reflexive: 0, verifier_gated: 1,
  });
  assert.deepEqual(snapshot.decisionLevelHistogram, {
    deterministic: 1, skill: 0, small_model: 2, premium_model: 0, multi_agent: 0, none: 1,
  });
  assert.deepEqual(snapshot.sourceHistogram, { policy: 4, cache: 0 });

  const empty = { completed: 0, human_intervention: 0, blocked: 0, failed: 0 };
  assert.deepEqual(snapshot.outcomeByPattern.deterministic, { ...empty, completed: 1 });
  assert.deepEqual(snapshot.outcomeByPattern.verifier_gated, { ...empty, human_intervention: 1 });
  assert.deepEqual(snapshot.outcomeByPattern.single_shot, { ...empty, failed: 1, blocked: 1 });
  assert.deepEqual(snapshot.outcomeByPattern.react, empty);
  assert.deepEqual(snapshot.outcomeByLevel.small_model, { ...empty, human_intervention: 1, failed: 1 });
  assert.deepEqual(snapshot.outcomeByLevel.none, { ...empty, blocked: 1 });
  assert.deepEqual(snapshot.outcomeByLevel.deterministic, { ...empty, completed: 1 });
});

test('a null decision level is bucketed as none', () => {
  const telemetry = new SupervisedAutonomyTelemetry();
  const costDecision = decide({ mission: {} });
  assert.equal(costDecision.decision.level, null);
  telemetry.record({ outcome: 'blocked', costDecision });
  assert.equal(telemetry.snapshot().decisionLevelHistogram.none, 1);
  assert.equal(telemetry.snapshot().outcomeByLevel.none.blocked, 1);
});

test('approval gating is counted without changing the outcome', () => {
  const telemetry = new SupervisedAutonomyTelemetry();
  telemetry.record({ outcome: 'completed', costDecision: decide(), approvalGated: true });
  const { outcomes } = telemetry.snapshot();
  assert.equal(outcomes.completedCount, 1);
  assert.equal(outcomes.humanInterventionCount, 0);
  assert.equal(outcomes.approvalGatedCount, 1);
});

test('malformed records and decisions fail closed leaving state intact', () => {
  const telemetry = new SupervisedAutonomyTelemetry();
  telemetry.record({ outcome: 'completed', costDecision: decide() });
  assertRejected(telemetry, undefined, 'TELEMETRY_INVALID_RECORD');
  assertRejected(telemetry, 'completed', 'TELEMETRY_INVALID_RECORD');
  assertRejected(telemetry, { outcome: 'completed' }, 'TELEMETRY_INVALID_COST_DECISION');
  assertRejected(telemetry, { outcome: 'completed', costDecision: null }, 'TELEMETRY_INVALID_COST_DECISION');
  assertRejected(telemetry, { outcome: 'completed', costDecision: 'decision' }, 'TELEMETRY_INVALID_COST_DECISION');
  assertRejected(telemetry, { outcome: 'completed', costDecision: {} }, 'TELEMETRY_UNTRUSTED_COST_DECISION');
  assertRejected(telemetry, { outcome: 'done', costDecision: decide() }, 'TELEMETRY_INVALID_OUTCOME');
  assertRejected(telemetry, { outcome: 'completed', costDecision: decide(), approvalGated: 'yes' }, 'TELEMETRY_INVALID_APPROVAL_GATED');
});

test('rejects caller-supplied USD fields such as actualCostUsd or callerSavingsUsd', () => {
  const telemetry = new SupervisedAutonomyTelemetry();
  for (const field of ['actualCostUsd', 'callerSavingsUsd', 'callerEstimatedUsd', 'avoidedEstimatedCostUsd', 'missionId']) {
    assertRejected(telemetry, { outcome: 'completed', costDecision: decide(), [field]: 5 }, 'TELEMETRY_UNEXPECTED_FIELD');
  }
  assert.equal(telemetry.snapshot().outcomes.totalAttempts, 0);
});

test('snapshots are deep-frozen, stable in shape and share no references', () => {
  const telemetry = new SupervisedAutonomyTelemetry();
  telemetry.record({ outcome: 'completed', costDecision: decide() });
  const first = telemetry.snapshot();
  const second = telemetry.snapshot();
  assert.deepEqual(Object.keys(first), [
    'schemaVersion', 'outcomes', 'cost', 'cacheHits', 'executionPatternHistogram',
    'decisionLevelHistogram', 'sourceHistogram', 'outcomeByPattern', 'outcomeByLevel',
  ]);
  assert.ok(Object.isFrozen(first.outcomeByPattern.single_shot));
  assert.throws(() => { first.outcomeByPattern.single_shot.completed = 99; }, TypeError);
  assert.throws(() => { first.cost.estimatedCostUsd = 99; }, TypeError);
  assert.throws(() => { first.executionPatternHistogram.react = 99; }, TypeError);
  for (const key of ['outcomes', 'cost', 'executionPatternHistogram', 'decisionLevelHistogram', 'sourceHistogram', 'outcomeByPattern', 'outcomeByLevel']) {
    assert.notEqual(first[key], second[key]);
  }
  assert.notEqual(first.outcomeByLevel.small_model, second.outcomeByLevel.small_model);
  assert.deepEqual(first, second);
  telemetry.record({ outcome: 'failed', costDecision: decide() });
  assert.equal(first.outcomes.failedCount, 0);
  assert.equal(telemetry.snapshot().outcomes.failedCount, 1);
});

test('snapshot retains no mission data, identifiers or cost provenance', () => {
  const telemetry = new SupervisedAutonomyTelemetry();
  const mission = {
    missionId: 'mission-PRIVACY-7f3a',
    prompt: 'PROMPT-FICTICIO confidencial para prueba',
    authToken: 'tok_FAKE_9c1d2e',
    smallModelEstimatedCostUsd: 0.01,
  };
  const costDecision = controller().decide({
    mission,
    cacheContext: { inputFingerprint: 'fp-privacy', policyVersion: 1 },
    costBasis: { modelId: 'paid', inputTokens: 1000 },
  });
  telemetry.record({ outcome: 'completed', costDecision });
  const serialized = JSON.stringify(telemetry.snapshot());
  const forbidden = [
    mission.missionId, mission.prompt, mission.authToken, 'missionId', 'prompt', 'evidence',
    costDecision.evidence.evidenceHash, costDecision.cacheKey, 'cacheKey',
    'paid', 'paid-test-v1', 'modelId', 'pricingVersion',
  ];
  for (const value of forbidden) assert.equal(serialized.includes(value), false, `snapshot leaks ${value}`);
});

test('telemetry, metrics, CostController and pattern router are used productively only by the approved Executive Chat owner', () => {
  const root = path.resolve(__dirname, '..', '..', '..');
  const runtimeDir = __dirname;
  const modules = ['agent-productivity-metrics', 'supervised-autonomy-telemetry', 'cost-controller', 'execution-pattern-router'];
  // Explicit file list, never directories or patterns. Besides runtime-internal
  // composition, the only productive references allowed are:
  // - backend/api/server.js: composition/injection only (one instance each);
  // - backend/api/routes/executive-chat.js: the single functional owner that
  //   calls decide() and record() (handleExecutiveChatRequest).
  // Any other caller (Mission Queue, Approval Queue, another endpoint,
  // orchestrator, supervisor, dashboard, worker, scheduler...) must fail here.
  const serverFile = path.join(root, 'backend', 'api', 'server.js');
  const ownerFile = path.join(root, 'backend', 'api', 'routes', 'executive-chat.js');
  const allowed = new Set([
    path.join(runtimeDir, 'cost-controller.js'),
    path.join(runtimeDir, 'supervised-autonomy-telemetry.js'),
    serverFile,
    ownerFile,
  ]);
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.(c|m)?js$/.test(entry.name) || /\.test\.(c|m)?js$/.test(entry.name)) continue;
      const source = fs.readFileSync(full, 'utf8');
      if (modules.some((name) => source.includes(name)) && !allowed.has(full)) offenders.push(path.relative(root, full));
    }
  };
  for (const dir of ['app', 'backend', 'scripts', 'simulador-ia', 'KNOWLEDGE-CURATOR']) {
    const full = path.join(root, dir);
    if (fs.existsSync(full)) walk(full);
  }
  assert.deepEqual(offenders, []);

  // server.js composes and injects; it never decides or records itself.
  const serverSource = fs.readFileSync(serverFile, 'utf8');
  assert.doesNotMatch(serverSource, /\.decide\(|\.record\(/);
  // The owner is the only place that calls decide() and record().
  const ownerSource = fs.readFileSync(ownerFile, 'utf8');
  assert.equal(ownerSource.match(/costController\.decide\(/g).length, 1);
  assert.equal(ownerSource.match(/supervisedAutonomyTelemetry\.record\(/g).length, 1);
  assert.doesNotMatch(ownerSource, /execution-pattern-router/);
});

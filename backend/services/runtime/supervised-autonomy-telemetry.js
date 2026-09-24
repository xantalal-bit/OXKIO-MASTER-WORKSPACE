'use strict';

const { LEVELS } = require('./cost-policy');
const { PATTERNS } = require('./execution-pattern-router');
const { COST_ESTIMATE_STATUS, isCostDecision } = require('./cost-controller');
const { OUTCOMES, validateOutcomeRecord, AgentProductivityMetrics } = require('./agent-productivity-metrics');

const TELEMETRY_SCHEMA_VERSION = 2;

// Scope of V2: a telemetry attempt starts only AFTER a valid
// CostController.decide() result exists, and must be recorded exactly once
// with its final outcome. totalAttempts therefore means "attempts routed
// through a valid decide() and recorded here". It does NOT cover HTTP
// requests, incoming intents, authentication failures or any failure before
// routing; those need separate pre-routing observability.

// Costs are summed as whole units of 1e-8 USD (the catalog precision) so the
// running total never accumulates floating-point drift.
const COST_UNITS_PER_USD = 1e8;
const NO_LEVEL = 'none';
const SOURCES = Object.freeze(['policy', 'cache']);
const RECORD_KEYS = new Set(['outcome', 'costDecision', 'approvalGated']);

const PATTERN_KEYS = Object.freeze(Object.values(PATTERNS));
const LEVEL_KEYS = Object.freeze([...Object.values(LEVELS), NO_LEVEL]);
const OUTCOME_KEYS = Object.freeze(Object.values(OUTCOMES));
const COST_STATUSES = new Set(Object.values(COST_ESTIMATE_STATUS));

function fail(code) {
  const error = new TypeError(code);
  error.code = code;
  throw error;
}

function isPlainObject(value) {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isDeepFrozen(value) {
  if (typeof value !== 'object' || value === null) return true;
  return Object.isFrozen(value) && Object.values(value).every(isDeepFrozen);
}

function zeroCounters(keys) {
  return Object.fromEntries(keys.map((key) => [key, 0]));
}

function zeroTable(rowKeys) {
  return Object.fromEntries(rowKeys.map((key) => [key, zeroCounters(OUTCOME_KEYS)]));
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

// Reads only enum fields and the controller-owned cost estimate. Returns the
// minimal facts to record; never retains the decision object itself.
function readCostDecision(costDecision) {
  if (typeof costDecision !== 'object' || costDecision === null) fail('TELEMETRY_INVALID_COST_DECISION');
  // Provenance first, so untrusted (possibly cyclic) objects are never walked.
  if (!isCostDecision(costDecision)) fail('TELEMETRY_UNTRUSTED_COST_DECISION');
  if (!isDeepFrozen(costDecision)) fail('TELEMETRY_INVALID_COST_DECISION');

  const { decision, executionPattern, source, costEstimate } = costDecision;
  if (!isPlainObject(decision) || !isPlainObject(executionPattern) || !isPlainObject(costEstimate)) {
    fail('TELEMETRY_INVALID_COST_DECISION');
  }
  const level = decision.level === null ? NO_LEVEL : decision.level;
  if (typeof level !== 'string' || !LEVEL_KEYS.includes(level)) fail('TELEMETRY_INVALID_DECISION_LEVEL');
  const { pattern } = executionPattern;
  if (typeof pattern !== 'string' || !PATTERN_KEYS.includes(pattern)) fail('TELEMETRY_INVALID_EXECUTION_PATTERN');
  if (!SOURCES.includes(source)) fail('TELEMETRY_INVALID_SOURCE');

  const { status, estimatedCostUsd } = costEstimate;
  if (!COST_STATUSES.has(status)) fail('TELEMETRY_INVALID_COST_STATUS');
  let costUnits = 0;
  if (status === COST_ESTIMATE_STATUS.ESTIMATED) {
    if (!Number.isFinite(estimatedCostUsd) || estimatedCostUsd < 0) fail('TELEMETRY_INVALID_COST_ESTIMATE');
    costUnits = Math.round(estimatedCostUsd * COST_UNITS_PER_USD);
    if (!Number.isSafeInteger(costUnits)) fail('TELEMETRY_INVALID_COST_ESTIMATE');
  } else if (estimatedCostUsd !== null) {
    fail('TELEMETRY_INVALID_COST_ESTIMATE');
  }
  return { level, pattern, source, status, costUnits };
}

class SupervisedAutonomyTelemetry {
  constructor() {
    this.metrics = new AgentProductivityMetrics();
    this.recordedDecisions = new WeakSet();
    this.cost = { estimatedCostUnits: 0, estimatedCostCount: 0, unknownCostCount: 0, notRequestedCostCount: 0 };
    this.cacheHits = 0;
    this.executionPatternHistogram = zeroCounters(PATTERN_KEYS);
    this.decisionLevelHistogram = zeroCounters(LEVEL_KEYS);
    this.sourceHistogram = zeroCounters(SOURCES);
    this.outcomeByPattern = zeroTable(PATTERN_KEYS);
    this.outcomeByLevel = zeroTable(LEVEL_KEYS);
  }

  // Validates everything first; on any failure throws a TypeError with a fixed
  // code and leaves every counter untouched.
  record(input) {
    if (!isPlainObject(input)) fail('TELEMETRY_INVALID_RECORD');
    for (const key of Object.keys(input)) {
      if (!RECORD_KEYS.has(key)) fail('TELEMETRY_UNEXPECTED_FIELD');
    }
    const { outcome, costDecision, approvalGated = false } = input;
    validateOutcomeRecord(outcome, { approvalGated });
    const facts = readCostDecision(costDecision);
    if (this.recordedDecisions.has(costDecision)) fail('TELEMETRY_DUPLICATE_ATTEMPT');
    const nextCostUnits = this.cost.estimatedCostUnits + facts.costUnits;
    if (!Number.isSafeInteger(nextCostUnits)) fail('TELEMETRY_COST_OVERFLOW');

    // Mutation phase: nothing below can throw.
    this.recordedDecisions.add(costDecision);
    this.metrics.recordOutcome(outcome, { approvalGated });
    if (facts.status === COST_ESTIMATE_STATUS.ESTIMATED) {
      this.cost.estimatedCostUnits = nextCostUnits;
      this.cost.estimatedCostCount += 1;
    } else if (facts.status === COST_ESTIMATE_STATUS.UNKNOWN_MODEL) {
      this.cost.unknownCostCount += 1;
    } else {
      this.cost.notRequestedCostCount += 1;
    }
    // A cache hit only means the routing decision was reused; it carries no
    // saved or avoided money.
    if (facts.source === 'cache') this.cacheHits += 1;
    this.executionPatternHistogram[facts.pattern] += 1;
    this.decisionLevelHistogram[facts.level] += 1;
    this.sourceHistogram[facts.source] += 1;
    this.outcomeByPattern[facts.pattern][outcome] += 1;
    this.outcomeByLevel[facts.level][outcome] += 1;
  }

  snapshot() {
    const { estimatedCostUnits, ...costCounts } = this.cost;
    return deepFreeze(structuredClone({
      schemaVersion: TELEMETRY_SCHEMA_VERSION,
      outcomes: { ...this.metrics.snapshot() },
      cost: { estimatedCostUsd: estimatedCostUnits / COST_UNITS_PER_USD, ...costCounts },
      cacheHits: this.cacheHits,
      executionPatternHistogram: this.executionPatternHistogram,
      decisionLevelHistogram: this.decisionLevelHistogram,
      sourceHistogram: this.sourceHistogram,
      outcomeByPattern: this.outcomeByPattern,
      outcomeByLevel: this.outcomeByLevel,
    }));
  }
}

module.exports = { TELEMETRY_SCHEMA_VERSION, SupervisedAutonomyTelemetry };

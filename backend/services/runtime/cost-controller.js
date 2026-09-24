'use strict';

const { DEFAULT_POLICY, selectExecutionLevel } = require('./cost-policy');
const { buildCostDecisionEvidence, stableHash } = require('./cost-decision-evidence');
const { buildDecisionCacheKey, CostDecisionCache } = require('./cost-decision-cache');
const { DEFAULT_CATALOG, normalizeCatalog, estimateCatalogCostUsd } = require('./model-cost-catalog');
const { selectExecutionPattern } = require('./execution-pattern-router');

const COST_ESTIMATE_STATUS = Object.freeze({
  ESTIMATED: 'estimated',
  UNKNOWN_MODEL: 'unknown_model',
  NOT_REQUESTED: 'not_requested',
});

// Every mission field read by selectExecutionLevel() or selectExecutionPattern().
// Adding a routing signal to either selector requires adding it here, otherwise
// the cache could serve a decision computed without that signal.
const ROUTING_SIGNALS = Object.freeze([
  'deterministicAvailable', 'reusableSkillAvailable', 'smallModelSufficient',
  'missionSpentUsd', 'dailySpentUsd', 'smallModelEstimatedCostUsd',
  'premiumModelEstimatedCostUsd', 'expectedValueUsd', 'multiAgentEstimatedCostUsd',
  'multiAgentExpectedQualityGain',
  'requiresIndependentVerification', 'sensitiveAction', 'requiresPlanning',
  'specialistHandoffs', 'parallelSubtasks', 'requiresIterativeTools',
  'unknownToolSteps', 'requiresSelfCritique', 'qualityRefinementPasses',
]);

const FINGERPRINTABLE_TYPES = new Set(['undefined', 'boolean', 'number', 'string', 'bigint']);

// Type-tagged canonical form so values the selectors treat differently
// (true vs "true", Infinity vs null, "2" vs 2) never collide. Non-primitive
// values cannot be fingerprinted safely and disable caching (fail closed).
function canonicalSignals(source, fields) {
  const canonical = [];
  for (const field of fields) {
    const value = source[field];
    if (value === null) { canonical.push([field, 'null']); continue; }
    const type = typeof value;
    if (!FINGERPRINTABLE_TYPES.has(type)) return null;
    canonical.push([field, type, String(value)]);
  }
  return canonical;
}

function buildRoutingFingerprint(mission, policy) {
  const missionSignals = canonicalSignals(mission || {}, ROUTING_SIGNALS);
  const policySignals = canonicalSignals(policy || {}, Object.keys(DEFAULT_POLICY));
  if (!missionSignals || !policySignals) return null;
  return stableHash({ mission: missionSignals, policy: policySignals });
}

function isUsableTokenCount(value) {
  return value === undefined || (Number.isFinite(value) && value >= 0);
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

// Every value handed out or stored is an independent frozen copy, so neither
// the caller nor the cache can observe mutations made through the other.
function frozenCopy(value) {
  return deepFreeze(structuredClone(value));
}

class CostController {
  constructor({ policy = {}, cache = null, catalog = DEFAULT_CATALOG, now = () => new Date().toISOString() } = {}) {
    this.policy = { ...policy };
    this.cache = cache || new CostDecisionCache();
    this.catalog = normalizeCatalog(catalog);
    this.now = now;
  }

  // USD is derived only from the controller-owned reviewed catalog. Callers
  // supply modelId and token counts; any caller-computed USD is ignored.
  estimateCost(costBasis = {}) {
    const basis = costBasis || {};
    const modelId = typeof basis.modelId === 'string' && basis.modelId.length > 0 ? basis.modelId : null;
    const notRequested = { status: COST_ESTIMATE_STATUS.NOT_REQUESTED, estimatedCostUsd: null, modelId, pricingVersion: null };
    if (!modelId) return notRequested;
    if (!Object.hasOwn(this.catalog, modelId)) {
      return { status: COST_ESTIMATE_STATUS.UNKNOWN_MODEL, estimatedCostUsd: null, modelId, pricingVersion: null };
    }
    const { inputTokens, outputTokens } = basis;
    const hasTokens = inputTokens !== undefined || outputTokens !== undefined;
    if (!hasTokens || !isUsableTokenCount(inputTokens) || !isUsableTokenCount(outputTokens)) return notRequested;
    const estimatedCostUsd = estimateCatalogCostUsd(this.catalog, modelId, { inputTokens, outputTokens });
    return {
      status: COST_ESTIMATE_STATUS.ESTIMATED,
      estimatedCostUsd,
      modelId,
      pricingVersion: this.catalog[modelId].pricingVersion,
    };
  }

  cacheKeyFor(cacheContext, mission) {
    const contextKey = buildDecisionCacheKey(cacheContext);
    if (!contextKey) return { contextKey: null, cacheKey: null };
    const routingFingerprint = buildRoutingFingerprint(mission, this.policy);
    if (!routingFingerprint) return { contextKey, cacheKey: null };
    return { contextKey, cacheKey: stableHash({ contextKey, routingFingerprint }) };
  }

  decide({ mission = {}, cacheContext = {}, costBasis = {} } = {}) {
    const costEstimate = this.estimateCost(costBasis);
    const { contextKey, cacheKey } = this.cacheKeyFor(cacheContext, mission);
    if (cacheKey) {
      const cached = this.cache.get(cacheKey);
      if (cached) {
        // Only the routing outcome is reused; evidence always describes the
        // current request (its mission, its timestamp), never the one that
        // originally populated the entry.
        const { decision, executionPattern } = cached;
        const evidence = this.buildEvidence(mission, decision);
        return frozenCopy({ decision, executionPattern, evidence, source: 'cache', cacheKey, costEstimate });
      }
    }

    // Cost level and execution architecture are deliberately selected in the
    // same controller so callers cannot independently escalate either model
    // spend or agentic complexity. The pattern router remains deterministic
    // and does not grant execution permission or bypass human approval gates.
    const decision = selectExecutionLevel(mission, this.policy);
    const executionPattern = selectExecutionPattern(mission);
    const evidence = this.buildEvidence(mission, decision);

    if (cacheKey) {
      // The cache holds no cost: costEstimate is always computed for the
      // current request, and a cache hit avoids no model call.
      this.cache.set(cacheKey, frozenCopy({ decision, executionPattern }), { group: contextKey });
    }

    return frozenCopy({ decision, executionPattern, evidence, source: 'policy', cacheKey, costEstimate });
  }

  buildEvidence(mission, decision) {
    return buildCostDecisionEvidence({ mission, policy: this.policy, decision, timestamp: this.now() });
  }

  // Invalidates every routing variant cached under this cache context.
  invalidate(cacheContext = {}) {
    const contextKey = buildDecisionCacheKey(cacheContext);
    return contextKey ? this.cache.invalidateGroup(contextKey) > 0 : false;
  }

  clearCache() {
    return this.cache.clear();
  }

  metrics() {
    return this.cache.snapshotMetrics();
  }
}

module.exports = { COST_ESTIMATE_STATUS, ROUTING_SIGNALS, CostController };

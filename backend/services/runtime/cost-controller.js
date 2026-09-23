'use strict';

const { selectExecutionLevel } = require('./cost-policy');
const { buildCostDecisionEvidence } = require('./cost-decision-evidence');
const { buildDecisionCacheKey, CostDecisionCache } = require('./cost-decision-cache');
const { DEFAULT_CATALOG, normalizeCatalog, estimateCatalogCostUsd } = require('./model-cost-catalog');
const { selectExecutionPattern } = require('./execution-pattern-router');

class CostController {
  constructor({ policy = {}, cache = null, catalog = DEFAULT_CATALOG, now = () => new Date().toISOString() } = {}) {
    this.policy = { ...policy };
    this.cache = cache || new CostDecisionCache();
    this.catalog = normalizeCatalog(catalog);
    this.now = now;
  }

  decide({ mission = {}, cacheContext = {}, costBasis = {} } = {}) {
    const cacheKey = buildDecisionCacheKey(cacheContext);
    if (cacheKey) {
      const cached = this.cache.get(cacheKey);
      if (cached) return { ...cached, source: 'cache', cacheKey };
    }

    // Cost level and execution architecture are deliberately selected in the
    // same controller so callers cannot independently escalate either model
    // spend or agentic complexity. The pattern router remains deterministic
    // and does not grant execution permission or bypass human approval gates.
    const decision = selectExecutionLevel(mission, this.policy);
    const executionPattern = selectExecutionPattern(mission);
    const evidence = buildCostDecisionEvidence({
      mission,
      policy: this.policy,
      decision,
      timestamp: this.now(),
    });
    const result = { decision, executionPattern, evidence, source: 'policy' };

    if (cacheKey) {
      // Savings are derived only from the controller-owned reviewed catalog.
      // Unknown models fail closed to zero instead of trusting caller-supplied USD.
      const estimatedCostUsd = estimateCatalogCostUsd(this.catalog, costBasis.modelId, {
        inputTokens: costBasis.inputTokens,
        outputTokens: costBasis.outputTokens,
      });
      this.cache.set(cacheKey, result, { estimatedCostUsd: estimatedCostUsd === null ? 0 : estimatedCostUsd });
    }

    return { ...result, cacheKey };
  }

  invalidate(cacheContext = {}) {
    const key = buildDecisionCacheKey(cacheContext);
    return key ? this.cache.invalidate(key) : false;
  }

  clearCache() {
    return this.cache.clear();
  }

  metrics() {
    return this.cache.snapshotMetrics();
  }
}

module.exports = { CostController };

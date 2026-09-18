'use strict';

const { selectExecutionLevel } = require('./cost-policy');
const { buildCostDecisionEvidence } = require('./cost-decision-evidence');
const { buildDecisionCacheKey, CostDecisionCache } = require('./cost-decision-cache');

class CostController {
  constructor({ policy = {}, cache = null, now = () => new Date().toISOString() } = {}) {
    this.policy = { ...policy };
    this.cache = cache || new CostDecisionCache();
    this.now = now;
  }

  decide({ mission = {}, cacheContext = {}, estimatedAvoidedCostUsd = 0 } = {}) {
    const cacheKey = buildDecisionCacheKey(cacheContext);
    if (cacheKey) {
      const cached = this.cache.get(cacheKey);
      if (cached) return { ...cached, source: 'cache', cacheKey };
    }

    const decision = selectExecutionLevel(mission, this.policy);
    const evidence = buildCostDecisionEvidence({
      mission,
      policy: this.policy,
      decision,
      timestamp: this.now(),
    });
    const result = { decision, evidence, source: 'policy' };

    if (cacheKey) {
      this.cache.set(cacheKey, result, { estimatedCostUsd: estimatedAvoidedCostUsd });
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

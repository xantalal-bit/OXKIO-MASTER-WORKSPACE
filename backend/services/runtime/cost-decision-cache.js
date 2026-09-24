'use strict';

const crypto = require('node:crypto');

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 256;

function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  return [...new Set(tags.filter((tag) => typeof tag === 'string' && tag.length > 0))].sort();
}

function buildDecisionCacheKey({ taskType = null, capability = null, privacyClass = null, residency = null, policyVersion = 1, inputFingerprint = null, tags = [] } = {}) {
  if (!inputFingerprint || typeof inputFingerprint !== 'string') return null;
  return stableHash({ taskType, capability, privacyClass, residency, policyVersion, inputFingerprint, tags: normalizeTags(tags) });
}

class CostDecisionCache {
  constructor({ ttlMs = DEFAULT_TTL_MS, maxEntries = DEFAULT_MAX_ENTRIES, now = () => Date.now() } = {}) {
    this.ttlMs = Number.isFinite(ttlMs) && ttlMs >= 0 ? ttlMs : DEFAULT_TTL_MS;
    this.maxEntries = Number.isInteger(maxEntries) && maxEntries > 0 ? maxEntries : DEFAULT_MAX_ENTRIES;
    this.now = now;
    this.entries = new Map();
    this.metrics = { hits: 0, misses: 0, writes: 0, evictions: 0, invalidations: 0, avoidedEstimatedCostUsd: 0 };
  }

  get(key) {
    if (!key) { this.metrics.misses += 1; return null; }
    const entry = this.entries.get(key);
    if (!entry) { this.metrics.misses += 1; return null; }
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      this.metrics.misses += 1;
      return null;
    }
    this.metrics.hits += 1;
    this.metrics.avoidedEstimatedCostUsd += entry.estimatedCostUsd;
    return entry.value;
  }

  set(key, value, { estimatedCostUsd = 0, group = null } = {}) {
    if (!key) return false;
    if (this.entries.size >= this.maxEntries && !this.entries.has(key)) {
      const oldestKey = this.entries.keys().next().value;
      this.entries.delete(oldestKey);
      this.metrics.evictions += 1;
    }
    this.entries.delete(key);
    this.entries.set(key, {
      value,
      expiresAt: this.now() + this.ttlMs,
      estimatedCostUsd: Number.isFinite(estimatedCostUsd) && estimatedCostUsd > 0 ? estimatedCostUsd : 0,
      group: typeof group === 'string' && group.length > 0 ? group : null,
    });
    this.metrics.writes += 1;
    return true;
  }

  invalidate(key) {
    if (!key) return false;
    const deleted = this.entries.delete(key);
    if (deleted) this.metrics.invalidations += 1;
    return deleted;
  }

  // Removes every entry written under one group (e.g. all routing variants of
  // a cache context) so context-level invalidation cannot leave stale variants.
  invalidateGroup(group) {
    if (typeof group !== 'string' || group.length === 0) return 0;
    let count = 0;
    for (const [key, entry] of this.entries) {
      if (entry.group !== group) continue;
      this.entries.delete(key);
      count += 1;
    }
    this.metrics.invalidations += count;
    return count;
  }

  clear() {
    const count = this.entries.size;
    this.entries.clear();
    this.metrics.invalidations += count;
    return count;
  }

  snapshotMetrics() {
    return Object.freeze({ ...this.metrics, size: this.entries.size });
  }
}

module.exports = { DEFAULT_TTL_MS, DEFAULT_MAX_ENTRIES, buildDecisionCacheKey, CostDecisionCache };

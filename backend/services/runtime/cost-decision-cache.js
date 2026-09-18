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
  return stableHash({
    taskType,
    capability,
    privacyClass,
    residency,
    policyVersion,
    inputFingerprint,
    tags: normalizeTags(tags),
  });
}

class CostDecisionCache {
  constructor({ ttlMs = DEFAULT_TTL_MS, maxEntries = DEFAULT_MAX_ENTRIES, now = () => Date.now() } = {}) {
    this.ttlMs = Number.isFinite(ttlMs) && ttlMs >= 0 ? ttlMs : DEFAULT_TTL_MS;
    this.maxEntries = Number.isInteger(maxEntries) && maxEntries > 0 ? maxEntries : DEFAULT_MAX_ENTRIES;
    this.now = now;
    this.entries = new Map();
  }

  get(key) {
    if (!key) return null;
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key, value) {
    if (!key) return false;
    if (this.entries.size >= this.maxEntries && !this.entries.has(key)) {
      const oldestKey = this.entries.keys().next().value;
      this.entries.delete(oldestKey);
    }
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
    return true;
  }

  clear() {
    this.entries.clear();
  }
}

module.exports = {
  DEFAULT_TTL_MS,
  DEFAULT_MAX_ENTRIES,
  buildDecisionCacheKey,
  CostDecisionCache,
};

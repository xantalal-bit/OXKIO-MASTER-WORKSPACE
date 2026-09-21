'use strict';

// Vendor-neutral pricing/capability catalog. Values are policy inputs, not
// provider billing truth; callers should version/update them from reviewed
// pricing evidence before production routing.
const DEFAULT_CATALOG = Object.freeze({
  local_deterministic: Object.freeze({
    provider: 'local',
    tier: 'deterministic',
    inputUsdPerMillion: 0,
    outputUsdPerMillion: 0,
    residency: 'local',
    privacy: 'local_only',
  }),
});

function finiteNonNegative(value, fallback = null) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function normalizeCatalog(catalog = DEFAULT_CATALOG) {
  const normalized = {};
  for (const [id, entry] of Object.entries(catalog || {})) {
    if (!entry || typeof entry !== 'object') continue;
    const input = finiteNonNegative(entry.inputUsdPerMillion);
    const output = finiteNonNegative(entry.outputUsdPerMillion);
    if (input === null || output === null) continue;
    normalized[id] = Object.freeze({
      provider: String(entry.provider || 'unknown'),
      tier: String(entry.tier || 'unknown'),
      inputUsdPerMillion: input,
      outputUsdPerMillion: output,
      residency: String(entry.residency || 'unknown'),
      privacy: String(entry.privacy || 'unknown'),
    });
  }
  return Object.freeze(normalized);
}

function estimateCatalogCostUsd(catalog, modelId, { inputTokens = 0, outputTokens = 0 } = {}) {
  const entry = normalizeCatalog(catalog)[modelId];
  if (!entry) return null;
  const input = finiteNonNegative(inputTokens, 0);
  const output = finiteNonNegative(outputTokens, 0);
  return Number(((input * entry.inputUsdPerMillion + output * entry.outputUsdPerMillion) / 1_000_000).toFixed(8));
}

module.exports = { DEFAULT_CATALOG, normalizeCatalog, estimateCatalogCostUsd };

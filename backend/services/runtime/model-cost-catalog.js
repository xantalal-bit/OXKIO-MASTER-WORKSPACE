'use strict';

// Vendor-neutral pricing/capability catalog. Values are policy inputs, not
// provider billing truth. Non-local entries must carry reviewed provenance
// before they can participate in cost routing or per-request cost estimates.
const DEFAULT_CATALOG = Object.freeze({
  local_deterministic: Object.freeze({
    provider: 'local',
    tier: 'deterministic',
    inputUsdPerMillion: 0,
    outputUsdPerMillion: 0,
    residency: 'local',
    privacy: 'local_only',
    pricingVersion: 'builtin-zero-v1',
    pricingSource: 'internal',
    reviewedAt: '2026-09-21',
  }),
});

function finiteNonNegative(value, fallback = null) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function hasPricingProvenance(id, entry) {
  if (id === 'local_deterministic' && entry.provider === 'local') return true;
  return Boolean(
    typeof entry.pricingVersion === 'string' && entry.pricingVersion.trim()
    && typeof entry.pricingSource === 'string' && entry.pricingSource.trim()
    && /^\d{4}-\d{2}-\d{2}$/.test(String(entry.reviewedAt || ''))
  );
}

function normalizeCatalog(catalog = DEFAULT_CATALOG) {
  const normalized = {};
  for (const [id, entry] of Object.entries(catalog || {})) {
    if (!entry || typeof entry !== 'object') continue;
    const input = finiteNonNegative(entry.inputUsdPerMillion);
    const output = finiteNonNegative(entry.outputUsdPerMillion);
    if (input === null || output === null || !hasPricingProvenance(id, entry)) continue;
    normalized[id] = Object.freeze({
      provider: String(entry.provider || 'unknown'),
      tier: String(entry.tier || 'unknown'),
      inputUsdPerMillion: input,
      outputUsdPerMillion: output,
      residency: String(entry.residency || 'unknown'),
      privacy: String(entry.privacy || 'unknown'),
      pricingVersion: String(entry.pricingVersion || 'builtin-zero-v1'),
      pricingSource: String(entry.pricingSource || 'internal'),
      reviewedAt: String(entry.reviewedAt || '2026-09-21'),
    });
  }
  return Object.freeze(normalized);
}

function estimateCatalogCostUsd(catalog, modelId, { inputTokens = 0, outputTokens = 0 } = {}) {
  const normalized = normalizeCatalog(catalog);
  // Own-property lookup only: inherited names such as "toString" are not models.
  if (typeof modelId !== 'string' || !Object.hasOwn(normalized, modelId)) return null;
  const entry = normalized[modelId];
  const input = finiteNonNegative(inputTokens, 0);
  const output = finiteNonNegative(outputTokens, 0);
  return Number(((input * entry.inputUsdPerMillion + output * entry.outputUsdPerMillion) / 1_000_000).toFixed(8));
}

module.exports = { DEFAULT_CATALOG, normalizeCatalog, estimateCatalogCostUsd };

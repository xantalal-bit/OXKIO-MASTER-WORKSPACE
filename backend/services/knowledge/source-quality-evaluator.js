'use strict';

function evaluateSourceQuality(candidate, sourceConfig) {
  const reasons = [];
  const expectedRepository = `${sourceConfig.owner}/${sourceConfig.repository}`;
  const expectedPrefix = `https://github.com/${expectedRepository}/releases/`;

  if (!sourceConfig.enabled) reasons.push('source-disabled');
  if (sourceConfig.trustLevel !== 'official-owned') reasons.push('source-not-official-owned');
  if (!candidate.externalId) reasons.push('missing-external-id');
  if (candidate.repository !== expectedRepository) reasons.push('repository-not-authorized');
  if (!candidate.sourceUrl || !candidate.sourceUrl.startsWith(expectedPrefix)) reasons.push('non-canonical-source-url');
  if (!candidate.content || candidate.content.trim().length < 20) reasons.push('content-too-short');
  if (!candidate.publishedAt || Number.isNaN(Date.parse(candidate.publishedAt))) reasons.push('invalid-publication-date');
  if (!candidate.contentHash) reasons.push('missing-content-hash');

  const approved = reasons.length === 0;

  return {
    approved,
    confidence: approved ? 1 : Math.max(0, Number((1 - reasons.length * 0.15).toFixed(2))),
    trustLevel: sourceConfig.trustLevel,
    reasons: approved ? ['official-owned-source', 'canonical-url', 'traceable-release'] : reasons,
  };
}

module.exports = { evaluateSourceQuality };

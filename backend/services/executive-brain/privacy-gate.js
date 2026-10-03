'use strict';

// XATAI CORE V2 (03/10/2026): Privacy / Security Gate. Before a task is
// routed to an agent or a provider, its context is classified and the
// routing is checked against a minimal policy. The gate only decides; it
// never connects to a provider, reads a credential or moves data.
//
// - SECRET never leaves to an external provider, whatever the policy says.
// - CONFIDENTIAL needs an explicitly allowed provider AND region.
// - INTERNAL needs an explicitly allowed provider (region optional).
// - PUBLIC may go to an external provider unless the policy forbids it.
//
// The default policy allows no external provider for INTERNAL/CONFIDENTIAL:
// approving one is a human decision. No provider is wired here (the OpenAI
// EU endpoint remains blocked and untouched).

const PRIVACY_CLASSES = Object.freeze({
  PUBLIC: 'PUBLIC',
  INTERNAL: 'INTERNAL',
  CONFIDENTIAL: 'CONFIDENTIAL',
  SECRET: 'SECRET',
});
const RANK = Object.freeze({ PUBLIC: 0, INTERNAL: 1, CONFIDENTIAL: 2, SECRET: 3 });

const DEFAULT_PRIVACY_POLICY = Object.freeze({
  publicExternalAllowed: true,
  internalProviders: Object.freeze([]),
  confidentialProviders: Object.freeze([]),
});

// Capabilities that touch the user's private data make the task at least
// CONFIDENTIAL; repository and code work is at least INTERNAL.
const CONFIDENTIAL_CAPABILITY_PREFIXES = Object.freeze([
  'gmail.', 'calendar.', 'documents.', 'drive.', 'memory.', 'tasks.', 'approvals.', 'dashboard.', 'executive.',
]);
const INTERNAL_CAPABILITY_PREFIXES = Object.freeze(['repository.', 'code.', 'tests.', 'data.', 'mission.']);

// Same family of credential markers executionLogger and the Quality Incident
// Registry reject: anything that looks like a credential makes it SECRET.
const SECRET_MARKER_PATTERN = /(?:-----BEGIN|bearer\s+[A-Za-z0-9._-]{8,}|private[_-]?key|api[_-]?key|password\s*[:=]|secret\s*[:=]|token\s*[:=]|\bsk-[A-Za-z0-9_-]{16,})/i;

function isPrivacyClass(value) {
  return Object.hasOwn(RANK, value);
}

function maxClass(left, right) {
  return RANK[right] > RANK[left] ? right : left;
}

// Most restrictive of two declared classes; an unknown value counts as
// CONFIDENTIAL (fail closed).
function maxPrivacyClass(left, right) {
  const known = (value) => (isPrivacyClass(value) ? value : PRIVACY_CLASSES.CONFIDENTIAL);
  return maxClass(known(left), known(right));
}

function containsSecretMarker(text) {
  return typeof text === 'string' && SECRET_MARKER_PATTERN.test(text);
}

// The declared class is a floor: inference can only raise it, never lower it.
// An unknown declared value is treated as CONFIDENTIAL (fail closed).
function classifyContext({ declaredClass = PRIVACY_CLASSES.PUBLIC, capabilities = [], texts = [] } = {}) {
  let level = isPrivacyClass(declaredClass) ? declaredClass : PRIVACY_CLASSES.CONFIDENTIAL;
  const reasons = [];
  if (!isPrivacyClass(declaredClass)) reasons.push('unknown_declared_class');
  for (const capabilityId of Array.isArray(capabilities) ? capabilities : []) {
    const id = String(capabilityId);
    if (CONFIDENTIAL_CAPABILITY_PREFIXES.some((prefix) => id.startsWith(prefix))) {
      if (RANK[level] < RANK.CONFIDENTIAL) reasons.push('private_data_capability');
      level = maxClass(level, PRIVACY_CLASSES.CONFIDENTIAL);
    } else if (INTERNAL_CAPABILITY_PREFIXES.some((prefix) => id.startsWith(prefix))) {
      if (RANK[level] < RANK.INTERNAL) reasons.push('internal_capability');
      level = maxClass(level, PRIVACY_CLASSES.INTERNAL);
    }
  }
  if ((Array.isArray(texts) ? texts : []).some(containsSecretMarker)) {
    level = PRIVACY_CLASSES.SECRET;
    reasons.push('secret_marker');
  }
  return Object.freeze({ privacyClass: level, reasons: Object.freeze([...new Set(reasons)]) });
}

function providerMatches(entry, provider, { requireRegion }) {
  if (!entry || entry.providerId !== provider.providerId) return false;
  if (requireRegion) return Boolean(provider.region) && entry.region === provider.region;
  return !entry.region || entry.region === provider.region;
}

// provider: { external: boolean, providerId?: string, region?: string }.
// A provider that is not external (local deterministic code) is always fine.
function evaluateProviderRouting({ privacyClass, provider = {}, policy = DEFAULT_PRIVACY_POLICY } = {}) {
  const decide = (allowed, reason) => Object.freeze({ allowed, reason, privacyClass });
  if (!isPrivacyClass(privacyClass)) return decide(false, 'unknown_privacy_class');
  if (!provider || provider.external !== true) return decide(true, 'local_processing');
  const rules = { ...DEFAULT_PRIVACY_POLICY, ...(policy || {}) };
  switch (privacyClass) {
    case PRIVACY_CLASSES.SECRET:
      return decide(false, 'secret_never_external');
    case PRIVACY_CLASSES.CONFIDENTIAL:
      return (rules.confidentialProviders || []).some((entry) => providerMatches(entry, provider, { requireRegion: true }))
        ? decide(true, 'confidential_provider_allowed')
        : decide(false, 'confidential_provider_not_allowed');
    case PRIVACY_CLASSES.INTERNAL:
      return (rules.internalProviders || []).some((entry) => providerMatches(entry, provider, { requireRegion: false }))
        ? decide(true, 'internal_provider_allowed')
        : decide(false, 'internal_provider_not_allowed');
    default:
      return rules.publicExternalAllowed === false
        ? decide(false, 'public_external_disabled')
        : decide(true, 'public_external_allowed');
  }
}

module.exports = {
  DEFAULT_PRIVACY_POLICY,
  PRIVACY_CLASSES,
  classifyContext,
  containsSecretMarker,
  evaluateProviderRouting,
  isPrivacyClass,
  maxPrivacyClass,
};

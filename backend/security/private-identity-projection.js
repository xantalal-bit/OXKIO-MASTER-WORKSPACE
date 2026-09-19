'use strict';

const CLIENTE_CERO_CLIENT_ID = 'cliente-cero';

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isClienteCeroFirebaseIdentity(firebaseIdentity) {
  return isPlainObject(firebaseIdentity)
    && firebaseIdentity.clientId === CLIENTE_CERO_CLIENT_ID
    && typeof firebaseIdentity.uid === 'string'
    && firebaseIdentity.uid.trim().length > 0;
}

function buildCapabilityGapIdentity(firebaseIdentity) {
  return {
    clientId: isPlainObject(firebaseIdentity) && typeof firebaseIdentity.clientId === 'string'
      ? firebaseIdentity.clientId
      : 'unknown',
    userId: isPlainObject(firebaseIdentity) && typeof firebaseIdentity.uid === 'string'
      ? firebaseIdentity.uid
      : 'unknown',
    expectedClientId: CLIENTE_CERO_CLIENT_ID,
    authorization: { status: 'not_available', provider: null },
  };
}

// Never fall back to the hardcoded Cliente Cero identity for a caller whose
// authorized Firebase clientId is not literally 'cliente-cero'. Every other
// caller (family beta included) gets a capability-gap identity that fails
// closed on every downstream isAuthorizedExecutiveIdentity/isInternallyAuthorized check.
function buildPrivateIdentity(firebaseIdentity, { getClienteCeroIdentity }) {
  if (!isClienteCeroFirebaseIdentity(firebaseIdentity)) {
    return buildCapabilityGapIdentity(firebaseIdentity);
  }
  const privateIdentity = getClienteCeroIdentity();
  return {
    ...privateIdentity,
    userId: firebaseIdentity.uid,
  };
}

async function capabilityGapReader() {
  return {
    privateContextMetadata: null,
    expectedClientId: CLIENTE_CERO_CLIENT_ID,
    privatePayload: null,
    capabilityGap: true,
  };
}

// Only Cliente Cero's own real OAuth-backed Gmail/Calendar readers may be built.
// Any other identity gets safe no-op readers that never call a real integration.
function buildDashboardReaders(firebaseIdentity, {
  getClienteCeroIdentity,
  buildGmailPrivateContext,
  buildCalendarPrivateContext,
}) {
  if (!isClienteCeroFirebaseIdentity(firebaseIdentity)) {
    return { gmailReader: capabilityGapReader, calendarReader: capabilityGapReader };
  }
  const identity = buildPrivateIdentity(firebaseIdentity, { getClienteCeroIdentity });
  return {
    gmailReader: () => buildGmailPrivateContext({ ...identity, maxMessages: 5 }),
    calendarReader: () => buildCalendarPrivateContext({
      ...identity,
      range: 'next7Days',
      maxResults: 10,
    }),
  };
}

module.exports = {
  CLIENTE_CERO_CLIENT_ID,
  buildCapabilityGapIdentity,
  buildDashboardReaders,
  buildPrivateIdentity,
  capabilityGapReader,
  isClienteCeroFirebaseIdentity,
};

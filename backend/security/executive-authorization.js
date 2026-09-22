'use strict';

const ADMIN_ROLE = 'admin';
const FAMILY_ROLE = 'family_member';
const CLIENTE_CERO_ID = 'cliente-cero';
const FAMILY_CLIENT_ID_PREFIX = 'family:';

function normalizeIdentityText(value) {
  return String(value || '')
    .replace(/[\uFEFF\u200B\u200C\u200D\u2060]/g, '')
    .trim()
    .replace(/^["'`]+/, '')
    .replace(/["'`]+$/, '')
    .trim();
}

function parseAllowlist(value) {
  return new Set(
    String(value || '')
      .split(',')
      .map((item) => normalizeIdentityText(item))
      .filter(Boolean)
  );
}

function authorizeExecutiveClaims(claims, options = {}) {
  if (!claims || typeof claims !== 'object') {
    return { ok: false, code: 'auth_identity_unavailable' };
  }

  const uid = normalizeIdentityText(
    typeof claims.uid === 'string'
      ? claims.uid
      : (typeof claims.sub === 'string'
        ? claims.sub
        : (typeof claims.user_id === 'string' ? claims.user_id : ''))
  );
  if (!uid) return { ok: false, code: 'auth_identity_unavailable' };

  const email = typeof claims.email === 'string' && normalizeIdentityText(claims.email)
    ? normalizeIdentityText(claims.email).toLowerCase()
    : null;
  const emailVerified = claims.email_verified === true || claims.emailVerified === true;
  const adminUids = options.adminUids instanceof Set
    ? options.adminUids
    : parseAllowlist(options.adminUids);
  const adminEmails = options.adminEmails instanceof Set
    ? options.adminEmails
    : parseAllowlist(options.adminEmails);
  const uidAllowed = adminUids.has(uid);
  const verifiedEmailAllowed = Boolean(email && emailVerified && adminEmails.has(email));
  if (uidAllowed || verifiedEmailAllowed) {
    return {
      ok: true,
      identity: Object.freeze({
        uid,
        email,
        emailVerified,
        role: ADMIN_ROLE,
        clientId: CLIENTE_CERO_ID,
        authorized: true,
      }),
    };
  }

  // Family beta identities are authorized separately, never through the admin
  // allowlist, and each gets its own clientId so family members are isolated
  // from Cliente Cero and from each other. Empty by default (fail closed).
  const familyUids = options.familyUids instanceof Set
    ? options.familyUids
    : parseAllowlist(options.familyUids);
  const familyEmails = options.familyEmails instanceof Set
    ? options.familyEmails
    : parseAllowlist(options.familyEmails);
  const familyUidAllowed = familyUids.has(uid);
  const familyVerifiedEmailAllowed = Boolean(email && emailVerified && familyEmails.has(email));
  if (familyUidAllowed || familyVerifiedEmailAllowed) {
    return {
      ok: true,
      identity: Object.freeze({
        uid,
        email,
        emailVerified,
        role: FAMILY_ROLE,
        clientId: `${FAMILY_CLIENT_ID_PREFIX}${uid}`,
        authorized: true,
      }),
    };
  }

  return { ok: false, code: 'auth_forbidden' };
}

function createExecutiveAuthorizer(env = process.env) {
  const adminUids = parseAllowlist(env.OXKIO_ADMIN_FIREBASE_UIDS);
  const adminEmails = new Set(
    [...parseAllowlist(env.OXKIO_ADMIN_FIREBASE_EMAILS)]
      .map((email) => email.toLowerCase())
  );
  const familyUids = parseAllowlist(env.OXKIO_FAMILY_FIREBASE_UIDS);
  const familyEmails = new Set(
    [...parseAllowlist(env.OXKIO_FAMILY_FIREBASE_EMAILS)]
      .map((email) => email.toLowerCase())
  );

  return (claims) => authorizeExecutiveClaims(claims, {
    adminUids,
    adminEmails,
    familyUids,
    familyEmails,
  });
}

module.exports = {
  ADMIN_ROLE,
  FAMILY_CLIENT_ID_PREFIX,
  FAMILY_ROLE,
  authorizeExecutiveClaims,
  createExecutiveAuthorizer,
  parseAllowlist,
};

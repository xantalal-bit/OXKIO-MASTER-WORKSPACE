'use strict';

const ADMIN_ROLE = 'admin';
const CLIENTE_CERO_ID = 'cliente-cero';

function parseAllowlist(value) {
  return new Set(
    String(value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

function authorizeExecutiveClaims(claims, options = {}) {
  if (!claims || typeof claims !== 'object') {
    return { ok: false, code: 'auth_identity_unavailable' };
  }

  const uid = typeof claims.uid === 'string' ? claims.uid.trim() : '';
  if (!uid) return { ok: false, code: 'auth_identity_unavailable' };

  const email = typeof claims.email === 'string' && claims.email.trim()
    ? claims.email.trim().toLowerCase()
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

  if (!uidAllowed && !verifiedEmailAllowed) {
    return { ok: false, code: 'auth_forbidden' };
  }

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

function createExecutiveAuthorizer(env = process.env) {
  const adminUids = parseAllowlist(env.OXKIO_ADMIN_FIREBASE_UIDS);
  const adminEmails = new Set(
    [...parseAllowlist(env.OXKIO_ADMIN_FIREBASE_EMAILS)]
      .map((email) => email.toLowerCase())
  );

  return (claims) => authorizeExecutiveClaims(claims, { adminUids, adminEmails });
}

module.exports = {
  authorizeExecutiveClaims,
  createExecutiveAuthorizer,
  parseAllowlist,
};

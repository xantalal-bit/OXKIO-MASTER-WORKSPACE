'use strict';

const ADMIN_ROLE = 'admin';
const CLIENTE_CERO_ID = 'cliente-cero';

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

  return (claims) => authorizeExecutiveClaims(claims, {
    adminUids,
    adminEmails,
  });
}

module.exports = {
  authorizeExecutiveClaims,
  createExecutiveAuthorizer,
  parseAllowlist,
};

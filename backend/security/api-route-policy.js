'use strict';

// The only /api/* routes a non-Cliente-Cero identity (family beta included)
// may reach. Everything else under /api/ defaults to Cliente-Cero-only.
//
// This exists because server.js has a large surface of legacy inline
// handlers (Gmail inbox/analyze, raw memory search, rule engine, approval
// history/pending, /api/chat, /api/execute, knowledge-supervisor discovery,
// simulator export, execution logs, projects...) that were never given a
// per-route identity check of their own: they relied entirely on the outer
// Firebase authentication gate, which was safe only while that gate
// admitted nobody but Cliente Cero. A single default-deny choke point is
// far less error-prone than adding an isAuthorizedExecutiveIdentity check
// to each legacy handler individually.
const FAMILY_SAFE_API_ROUTES = new Set([
  '/api/executive/identity',
  '/api/executive/chat',
  // Quality Loop: any authenticated user may report a problem. The route
  // only records a compact incident and never reveals internal metrics.
  '/api/quality/feedback',
]);

function isFamilySafeApiRoute(pathname) {
  return FAMILY_SAFE_API_ROUTES.has(pathname);
}

// /oauth/google starts the single-tenant Google OAuth linking flow that
// writes to the one global Gmail/Calendar token store. It must stay
// Cliente-Cero-only: any other identity completing that consent flow could
// overwrite Jose's stored Gmail/Calendar credentials.
function isPrivateApiRoute(pathname) {
  return typeof pathname === 'string'
    && (pathname.startsWith('/api/') || pathname === '/oauth/google')
    && !isFamilySafeApiRoute(pathname);
}

// True when this request must be blocked before reaching any route handler:
// it targets a private /api/* route and the caller is not Cliente Cero.
// Only ever evaluated for requests that already passed Firebase
// authentication (identity is the Firebase-authenticated caller's private
// identity projection) so it never affects the pre-auth 405 path for
// GET /api/approve and GET /api/execute-approved.
function isApiRouteDeniedForIdentity(pathname, isAuthorizedExecutiveIdentity, privateIdentity) {
  return isPrivateApiRoute(pathname) && !isAuthorizedExecutiveIdentity(privateIdentity);
}

module.exports = {
  FAMILY_SAFE_API_ROUTES,
  isApiRouteDeniedForIdentity,
  isFamilySafeApiRoute,
  isPrivateApiRoute,
};

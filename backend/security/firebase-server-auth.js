'use strict';

const AUTH_ERROR_STATUS = Object.freeze({
  auth_token_required: 401,
  auth_token_invalid: 401,
  auth_token_expired: 401,
  auth_identity_unavailable: 401,
  auth_forbidden: 403,
  auth_service_unavailable: 503,
  auth_internal_error: 500,
});

function extractBearerToken(req) {
  const header = req && req.headers && req.headers.authorization;
  if (typeof header !== 'string' || !header.trim()) {
    return { ok: false, code: 'auth_token_required' };
  }

  const match = /^Bearer ([^\s]+)$/i.exec(header.trim());
  if (!match) return { ok: false, code: 'auth_token_invalid' };
  return { ok: true, token: match[1] };
}

function classifyVerificationError(error) {
  const code = String(error && error.code || '');
  if (code === 'auth/id-token-expired') return 'auth_token_expired';
  if (
    code === 'app/network-error'
    || code === 'app/invalid-credential'
    || code === 'app/invalid-argument'
    || code === 'auth/internal-error'
    || code === 'auth/insufficient-permission'
  ) {
    return 'auth_service_unavailable';
  }
  return 'auth_token_invalid';
}

async function authenticateFirebaseRequest(req, {
  verifyIdToken,
  authorizeIdentity,
} = {}) {
  const extracted = extractBearerToken(req);
  if (!extracted.ok) return extracted;
  if (typeof verifyIdToken !== 'function') {
    return { ok: false, code: 'auth_service_unavailable' };
  }

  let claims;
  try {
    claims = await verifyIdToken(extracted.token);
  } catch (error) {
    return { ok: false, code: classifyVerificationError(error) };
  }

  if (!claims || typeof claims !== 'object' || typeof claims.uid !== 'string') {
    return { ok: false, code: 'auth_identity_unavailable' };
  }
  if (typeof authorizeIdentity !== 'function') {
    return { ok: false, code: 'auth_service_unavailable' };
  }

  try {
    const authorization = authorizeIdentity(claims);
    if (!authorization || authorization.ok !== true || !authorization.identity) {
      return {
        ok: false,
        code: authorization && authorization.code === 'auth_identity_unavailable'
          ? 'auth_identity_unavailable'
          : 'auth_forbidden',
      };
    }
    return { ok: true, identity: authorization.identity };
  } catch (error) {
    return { ok: false, code: 'auth_internal_error' };
  }
}

function sendFirebaseAuthError(res, result) {
  const code = result && Object.hasOwn(AUTH_ERROR_STATUS, result.code)
    ? result.code
    : 'auth_internal_error';
  const messages = {
    auth_token_required: 'Authentication is required.',
    auth_token_invalid: 'Authentication token is invalid.',
    auth_token_expired: 'Authentication token has expired.',
    auth_identity_unavailable: 'Authenticated identity is unavailable.',
    auth_forbidden: 'This identity is not authorized.',
    auth_service_unavailable: 'Authentication service is unavailable.',
    auth_internal_error: 'Authentication could not be completed.',
  };
  res.writeHead(AUTH_ERROR_STATUS[code], {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify({ ok: false, code, message: messages[code] }));
}

function createFirebaseAdminVerifier({ env = process.env, admin } = {}) {
  const projectId = String(env.FIREBASE_PROJECT_ID || '').trim();
  const clientEmail = String(env.FIREBASE_CLIENT_EMAIL || '').trim();
  const privateKey = String(env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
  const hasIndividualCredentials = Boolean(projectId && clientEmail && privateKey);
  const hasApplicationDefaultCredentials = Boolean(
    projectId
    && (env.GOOGLE_APPLICATION_CREDENTIALS || env.GOOGLE_CLOUD_PROJECT)
  );
  if (!hasIndividualCredentials && !hasApplicationDefaultCredentials) return null;

  try {
    const adminApp = admin || require('firebase-admin/app');
    const adminAuth = require('firebase-admin/auth');
    const appName = 'oxkio-server-auth';
    const existing = adminApp.getApps().find((app) => app.name === appName);
    const credential = hasIndividualCredentials
      ? adminApp.cert({ projectId, clientEmail, privateKey })
      : adminApp.applicationDefault();
    const app = existing || adminApp.initializeApp({ credential, projectId }, appName);
    return (token) => adminAuth.getAuth(app).verifyIdToken(token);
  } catch (error) {
    return null;
  }
}

module.exports = {
  AUTH_ERROR_STATUS,
  authenticateFirebaseRequest,
  createFirebaseAdminVerifier,
  extractBearerToken,
  sendFirebaseAuthError,
};

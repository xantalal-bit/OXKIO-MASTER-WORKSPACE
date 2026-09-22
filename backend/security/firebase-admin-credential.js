'use strict';

// Shared Firebase Admin credential resolution, extracted from
// firebase-server-auth.js so the request-time ID-token verifier and offline
// admin tooling (e.g. scripts/firebase-admin/set-oxkio-membership.js) use
// the exact same credential source instead of two parallel ways to
// authenticate to the same project.

function resolveFirebaseAdminCredential({ env = process.env, admin } = {}) {
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
    const credential = hasIndividualCredentials
      ? adminApp.cert({ projectId, clientEmail, privateKey })
      : adminApp.applicationDefault();
    return { adminApp, projectId, credential };
  } catch (error) {
    return null;
  }
}

function getOrCreateAdminApp({ appName, env = process.env, admin } = {}) {
  const resolved = resolveFirebaseAdminCredential({ env, admin });
  if (!resolved) return null;
  const { adminApp, projectId, credential } = resolved;
  try {
    const existing = adminApp.getApps().find((app) => app.name === appName);
    return existing || adminApp.initializeApp({ credential, projectId }, appName);
  } catch (error) {
    return null;
  }
}

module.exports = {
  resolveFirebaseAdminCredential,
  getOrCreateAdminApp,
};

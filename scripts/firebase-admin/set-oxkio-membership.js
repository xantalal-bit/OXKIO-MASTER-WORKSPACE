'use strict';

// Offline admin tool to grant or revoke Family Beta membership via Firebase
// custom claims. This is the ONLY place oxkio_member/oxkio_role should ever
// be set — firebase/firestore.rules trusts request.auth.token.oxkio_member
// precisely because it can only reach a user's ID token through this script
// (or the Admin SDK call it wraps), never from client-controlled data.
//
// Reuses the same credential resolution as backend/security/
// firebase-server-auth.js (backend/security/firebase-admin-credential.js)
// instead of a second, parallel way to authenticate to the project.
//
// Usage (not run against real users by this change — see the delivery
// report for the manual steps to run this for the first real user):
//   node scripts/firebase-admin/set-oxkio-membership.js authorize <uid> family_member
//   node scripts/firebase-admin/set-oxkio-membership.js authorize <uid> admin
//   node scripts/firebase-admin/set-oxkio-membership.js revoke <uid>
//
// <uid> must be a Firebase Auth UID (find it in the Firebase Console, Auth
// tab, or via admin.auth().getUserByEmail(email) if you only have the
// email). This script deliberately takes a UID, not an email, so it never
// has to guess which account an email currently resolves to.

const { getOrCreateAdminApp } = require('../../backend/security/firebase-admin-credential');

const VALID_ROLES = new Set(['admin', 'family_member']);

function buildAuthorizeClaims(role) {
  if (!VALID_ROLES.has(role)) {
    throw new Error(`Rol invalido: "${role}". Debe ser "admin" o "family_member".`);
  }
  return { oxkio_member: true, oxkio_role: role };
}

function buildRevokeClaims() {
  return { oxkio_member: false };
}

async function applyMembership({ uid, action, role, env = process.env, admin } = {}) {
  if (!uid || typeof uid !== 'string') {
    throw new Error('Falta el UID de Firebase Auth.');
  }
  const claims = action === 'authorize'
    ? buildAuthorizeClaims(role)
    : action === 'revoke'
      ? buildRevokeClaims()
      : null;
  if (!claims) {
    throw new Error(`Accion invalida: "${action}". Debe ser "authorize" o "revoke".`);
  }

  const app = getOrCreateAdminApp({ appName: 'oxkio-membership-admin', env, admin });
  if (!app) {
    throw new Error(
      'No hay credenciales de Firebase Admin disponibles '
      + '(FIREBASE_PROJECT_ID/CLIENT_EMAIL/PRIVATE_KEY o GOOGLE_APPLICATION_CREDENTIALS).'
    );
  }

  const adminAuth = require('firebase-admin/auth');
  const auth = adminAuth.getAuth(app);
  const user = await auth.getUser(uid);
  const nextClaims = { ...(user.customClaims || {}), ...claims };
  await auth.setCustomUserClaims(uid, nextClaims);
  return { uid, appliedClaims: claims, resultingClaims: nextClaims };
}

async function main() {
  const [action, uid, role] = process.argv.slice(2);
  try {
    const result = await applyMembership({ uid, action, role });
    console.log(`OK: ${result.uid} -> ${JSON.stringify(result.appliedClaims)}`);
    console.log(
      'El usuario debe volver a iniciar sesion (o forzar refresh del ID token) '
      + 'para que el claim nuevo llegue a Firestore.'
    );
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = { buildAuthorizeClaims, buildRevokeClaims, applyMembership };

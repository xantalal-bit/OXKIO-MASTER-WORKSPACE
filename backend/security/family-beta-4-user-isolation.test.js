'use strict';

// End-to-end isolation matrix for OXKIO FAMILY BETA V0.1: 1 admin (Cliente
// Cero / Jose) + 3 family_member users, configured simultaneously from one
// authorizer instance the way a real deployment would (OXKIO_ADMIN_FIREBASE_UIDS
// + OXKIO_FAMILY_FIREBASE_UIDS). Composes the real pieces
// (executive-authorization -> private-identity-projection -> api-route-policy
// / isAuthorizedExecutiveIdentity) with no test-only shortcuts, mirroring
// exactly how backend/api/server.js wires a real request. Test numbers map
// to the 28 scenarios required for the Family Beta V0.1 closure block.

const assert = require('node:assert/strict');
const test = require('node:test');
const { createExecutiveAuthorizer } = require('./executive-authorization');
const { buildPrivateIdentity, buildDashboardReaders } = require('./private-identity-projection');
const { isApiRouteDeniedForIdentity } = require('./api-route-policy');
const { isAuthorizedExecutiveIdentity } = require('../api/routes/executive-approval');

function getClienteCeroIdentity() {
  return {
    clientId: 'cliente-cero',
    userId: 'usuario-cliente-cero',
    expectedClientId: 'cliente-cero',
    authorization: { status: 'granted', provider: 'google-oauth' },
  };
}

const PRIVATE_ROUTES = Object.freeze([
  '/api/dashboard', '/api/gmail/inbox', '/api/gmail/analyze', '/api/memory',
  '/api/search-memory', '/api/pending-approvals', '/api/approval-history',
  '/api/approve', '/api/execute-approved', '/api/chat', '/api/add-rule',
  '/api/execute', '/api/executive/security-context',
]);

const authorize = createExecutiveAuthorizer({
  OXKIO_ADMIN_FIREBASE_UIDS: 'admin-uid',
  OXKIO_FAMILY_FIREBASE_UIDS: 'family-uid-a,family-uid-b,family-uid-c',
});

function sessionFor(uid) {
  const authResult = authorize({ uid });
  assert.equal(authResult.ok, true, `expected ${uid} to authenticate`);
  return {
    firebaseIdentity: authResult.identity,
    privateIdentity: buildPrivateIdentity(authResult.identity, { getClienteCeroIdentity }),
  };
}

const admin = sessionFor('admin-uid');
const familyA = sessionFor('family-uid-a');
const familyB = sessionFor('family-uid-b');
const familyC = sessionFor('family-uid-c');

test('1. Admin accede a su contexto autorizado', () => {
  assert.equal(isAuthorizedExecutiveIdentity(admin.privateIdentity), true);
  for (const route of PRIVATE_ROUTES) {
    assert.equal(isApiRouteDeniedForIdentity(route, isAuthorizedExecutiveIdentity, admin.privateIdentity), false, route);
  }
});

test('2-4. Familiar A, B y C no acceden al contexto admin', () => {
  for (const [label, session] of [['A', familyA], ['B', familyB], ['C', familyC]]) {
    assert.equal(isAuthorizedExecutiveIdentity(session.privateIdentity), false, `familiar ${label}`);
    assert.notEqual(session.privateIdentity.clientId, 'cliente-cero');
  }
});

test('5-10. Aislamiento cruzado A/B/C: ningun familiar comparte clientId con otro', () => {
  const clientIds = [familyA, familyB, familyC].map((s) => s.privateIdentity.clientId);
  assert.equal(new Set(clientIds).size, 3, 'los tres clientId deben ser distintos entre si');
  assert.notEqual(familyA.privateIdentity.clientId, familyB.privateIdentity.clientId);
  assert.notEqual(familyA.privateIdentity.clientId, familyC.privateIdentity.clientId);
  assert.notEqual(familyB.privateIdentity.clientId, familyC.privateIdentity.clientId);
});

test('11. Los 4 usuarios (admin + A + B + C) pueden usar /api/executive/chat e /api/executive/identity', () => {
  for (const session of [admin, familyA, familyB, familyC]) {
    assert.equal(isApiRouteDeniedForIdentity('/api/executive/chat', isAuthorizedExecutiveIdentity, session.privateIdentity), false);
    assert.equal(isApiRouteDeniedForIdentity('/api/executive/identity', isAuthorizedExecutiveIdentity, session.privateIdentity), false);
  }
});

test('12-15 y legacy: ningun familiar ve dashboard, approvals, approve, execute-approved, ni ninguna ruta privada legacy', () => {
  for (const [label, session] of [['A', familyA], ['B', familyB], ['C', familyC]]) {
    for (const route of PRIVATE_ROUTES) {
      assert.equal(
        isApiRouteDeniedForIdentity(route, isAuthorizedExecutiveIdentity, session.privateIdentity),
        true,
        `familiar ${label} debe ser denegado en ${route}`,
      );
    }
  }
});

test('16-17. Ningun familiar toca las integraciones reales de Gmail/Calendar (capability-gap readers, sin llamar a la API real)', async () => {
  for (const [label, session] of [['A', familyA], ['B', familyB], ['C', familyC]]) {
    let realCallMade = false;
    const readers = buildDashboardReaders(session.firebaseIdentity, {
      getClienteCeroIdentity,
      buildGmailPrivateContext: async () => { realCallMade = true; return {}; },
      buildCalendarPrivateContext: async () => { realCallMade = true; return {}; },
    });
    const gmailResult = await readers.gmailReader();
    const calendarResult = await readers.calendarReader();
    assert.equal(realCallMade, false, `familiar ${label} must never reach the real Gmail/Calendar integration`);
    assert.equal(gmailResult.capabilityGap, true);
    assert.equal(calendarResult.capabilityGap, true);
  }
});

test('18. Ningun familiar accede a la memoria de Cliente Cero (denegado tanto en la API dedicada como en las legacy)', () => {
  for (const [label, session] of [['A', familyA], ['B', familyB], ['C', familyC]]) {
    assert.equal(isApiRouteDeniedForIdentity('/api/memory', isAuthorizedExecutiveIdentity, session.privateIdentity), true, label);
    assert.equal(isApiRouteDeniedForIdentity('/api/search-memory', isAuthorizedExecutiveIdentity, session.privateIdentity), true, label);
  }
});

test('19. UID desconocido (ni admin ni family) -> auth_forbidden (equivalente a 403)', () => {
  assert.deepEqual(authorize({ uid: 'stranger-uid' }), { ok: false, code: 'auth_forbidden' });
});

// 20. Token Firebase invalido -> 401: cubierto por
// backend/security/firebase-server-auth.test.js (classifyVerificationError /
// AUTH_ERROR_STATUS), sin cambios en este bloque. No se duplica aqui.

test('21. Allowlist familiar vacia -> los 3 familiares quedan denegados por defecto (fail-closed)', () => {
  const closedAuthorize = createExecutiveAuthorizer({ OXKIO_ADMIN_FIREBASE_UIDS: 'admin-uid' });
  for (const uid of ['family-uid-a', 'family-uid-b', 'family-uid-c']) {
    assert.deepEqual(closedAuthorize({ uid }), { ok: false, code: 'auth_forbidden' });
  }
  assert.equal(closedAuthorize({ uid: 'admin-uid' }).identity.clientId, 'cliente-cero');
});

test('22. Admin sigue funcionando sin cambios (no regresion) con la allowlist familiar poblada', () => {
  assert.equal(admin.privateIdentity.clientId, 'cliente-cero');
  assert.equal(admin.firebaseIdentity.role, 'admin');
  assert.equal(isAuthorizedExecutiveIdentity(admin.privateIdentity), true);
});

// 23. executionEnabled=false y 24. allowRealSend=false: constantes de
// configuracion verificadas por grep (backend/api/server.js:
// "executionEnabled: false"; backend/config/systemConfig.js:
// "allowRealSend: false") y por la suite preexistente
// server-execution-composition.test.js ("production keeps global execution
// disabled and enables only Gmail draft composition"), sin tocar en este
// bloque.

// 25-28 (no regresion executive-chat / frontend auth / PWA / dashboard
// admin): cubiertas por la suite completa (executive-chat.test.js,
// server-pwa-assets.test.js, server-execution-composition.test.js) ejecutada
// en este mismo bloque de cambios sin fallos nuevos.

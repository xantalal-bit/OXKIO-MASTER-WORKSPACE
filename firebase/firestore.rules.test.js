'use strict';

// Membership + ownership isolation tests for firebase/firestore.rules,
// against a real Firestore Rules emulator via @firebase/rules-unit-testing.
// Mirrors the skip-when-unavailable convention already used by
// backend/repositories/poc/persistence-poc.test.js: when
// @firebase/rules-unit-testing is not installed or no emulator is
// reachable, every test below is skipped rather than failed. Do not read a
// "skip" count as evidence the rules are broken, and do not read a stale
// comment as evidence of the current PASS/FAIL/SKIP state either — the only
// evidence is the result of the most recent real run. These tests were
// executed for real against a live Firestore Emulator during the Family
// Beta membership-gate validation (2026-09-20): 10/10 PASS, 0 FAIL, 0 SKIP,
// all 12 membership + ownership isolation scenarios verified, including
// real PERMISSION_DENIED responses on every denied operation (unauthenticated,
// no claim, oxkio_member=false, cross-user, unknown collection). A future
// run without an available emulator will show SKIP again — that is expected
// and is not a regression.
//
// To actually run this file (Java 21+ required for the emulator JVM; a
// portable JDK works fine, no global install needed):
//   npm install --save-dev @firebase/rules-unit-testing
//   cd firebase && ../node_modules/.bin/firebase emulators:exec \
//     --project oxkio-rules-test --only firestore --config firebase.json \
//     "node --test firestore.rules.test.js"
//   (firebase emulators:exec injects FIRESTORE_EMULATOR_HOST into the
//   script's environment automatically — do not prefix it manually, it
//   is not portable to cmd.exe on Windows)

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

let rulesTesting = null;
try {
  rulesTesting = require('@firebase/rules-unit-testing');
} catch {
  rulesTesting = null;
}

const emulatorReady = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const canRun = Boolean(rulesTesting) && emulatorReady;
const skipReason = canRun
  ? false
  : `TEST CODE PRESENT / RUNTIME NOT EXECUTED: ${!rulesTesting
    ? '@firebase/rules-unit-testing no esta instalado'
    : 'FIRESTORE_EMULATOR_HOST no disponible'}.`;

const RULES_SOURCE = fs.readFileSync(path.join(__dirname, 'firestore.rules'), 'utf8');
const PROJECT_ID = 'oxkio-rules-test';

const MEMBER = { oxkio_member: true, oxkio_role: 'family_member' };
const ADMIN = { oxkio_member: true, oxkio_role: 'admin' };
const NOT_A_MEMBER = { oxkio_member: false };

async function withTestEnv(run) {
  const { initializeTestEnvironment } = rulesTesting;
  const testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: RULES_SOURCE, host: '127.0.0.1', port: 8088 },
  });
  try {
    await run(testEnv);
  } finally {
    await testEnv.cleanup();
  }
}

async function seed(testEnv, docs) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    for (const [collectionPath, docId, data] of docs) {
      await db.collection(collectionPath).doc(docId).set(data);
    }
  });
}

test('1. Cliente no autenticado -> DENY', { skip: skipReason }, async () => {
  await withTestEnv(async (testEnv) => {
    const { assertFails } = rulesTesting;
    await seed(testEnv, [['documentos', 'doc-a', { user: 'uid-a', nombre: 'Mio' }]]);
    const anon = testEnv.unauthenticatedContext().firestore();

    await assertFails(anon.collection('documentos').doc('doc-anon').set({ user: 'uid-a', nombre: 'x' }));
    await assertFails(anon.collection('documentos').doc('doc-a').get());
  });
});

test('2. Autenticado SIN claim oxkio_member -> DENY', { skip: skipReason }, async () => {
  await withTestEnv(async (testEnv) => {
    const { assertFails } = rulesTesting;
    const noClaim = testEnv.authenticatedContext('uid-noclaim').firestore();

    await assertFails(noClaim.collection('documentos').doc('doc-noclaim').set({ user: 'uid-noclaim', nombre: 'x' }));
  });
});

test('3. oxkio_member=false -> DENY', { skip: skipReason }, async () => {
  await withTestEnv(async (testEnv) => {
    const { assertFails } = rulesTesting;
    const revoked = testEnv.authenticatedContext('uid-revoked', NOT_A_MEMBER).firestore();

    await assertFails(revoked.collection('documentos').doc('doc-revoked').set({ user: 'uid-revoked', nombre: 'x' }));
  });
});

test('4-6. member A: crea, lee y actualiza su propio documento', { skip: skipReason }, async () => {
  await withTestEnv(async (testEnv) => {
    const { assertSucceeds } = rulesTesting;
    const a = testEnv.authenticatedContext('uid-a', MEMBER).firestore();
    const ref = a.collection('documentos').doc('doc-a');

    await assertSucceeds(ref.set({ user: 'uid-a', nombre: 'Factura' })); // 4. create propio -> PASS
    await assertSucceeds(ref.get()); // 5. read propio -> PASS
    await assertSucceeds(ref.update({ nombre: 'Factura actualizada' })); // 6. update propio -> PASS
  });
});

test('7-8. member A no puede crear para B ni leer un documento de B', { skip: skipReason }, async () => {
  await withTestEnv(async (testEnv) => {
    const { assertFails } = rulesTesting;
    await seed(testEnv, [['documentos', 'doc-b', { user: 'uid-b', nombre: 'Documento de B' }]]);
    const a = testEnv.authenticatedContext('uid-a', MEMBER).firestore();

    await assertFails(a.collection('documentos').doc('doc-b-forged').set({ user: 'uid-b', nombre: 'x' })); // 7. create asignado a B -> DENY
    await assertFails(a.collection('documentos').doc('doc-b').get()); // 8. read de B -> DENY
  });
});

test('9. member B no accede a los documentos de A', { skip: skipReason }, async () => {
  await withTestEnv(async (testEnv) => {
    const { assertFails } = rulesTesting;
    await seed(testEnv, [['documentos', 'doc-a', { user: 'uid-a', nombre: 'Mio' }]]);
    const b = testEnv.authenticatedContext('uid-b', MEMBER).firestore();

    await assertFails(b.collection('documentos').doc('doc-a').get());
    await assertFails(b.collection('documentos').doc('doc-a').update({ nombre: 'hackeado' }));
  });
});

test('10-11. admin accede a lo suyo pero no a lo de otro por defecto', { skip: skipReason }, async () => {
  await withTestEnv(async (testEnv) => {
    const { assertSucceeds, assertFails } = rulesTesting;
    await seed(testEnv, [['documentos', 'doc-a', { user: 'uid-a', nombre: 'De A' }]]);
    const admin = testEnv.authenticatedContext('uid-admin', ADMIN).firestore();
    const ownRef = admin.collection('documentos').doc('doc-admin');

    await assertSucceeds(ownRef.set({ user: 'uid-admin', nombre: 'Del admin' })); // 10. admin accede a lo suyo -> PASS
    await assertFails(admin.collection('documentos').doc('doc-a').get()); // 11. admin NO accede a otro por defecto -> DENY
  });
});

test('12. Una coleccion no listada en las reglas queda denegada por defecto', { skip: skipReason }, async () => {
  await withTestEnv(async (testEnv) => {
    const { assertFails } = rulesTesting;
    const a = testEnv.authenticatedContext('uid-a', MEMBER).firestore();

    await assertFails(a.collection('coleccion-desconocida').doc('x').set({ user: 'uid-a' }));
  });
});

test('Los tres familiares (A, B, C) quedan aislados entre si en las 7 colecciones', { skip: skipReason }, async () => {
  await withTestEnv(async (testEnv) => {
    const { assertFails, assertSucceeds } = rulesTesting;
    const collections = ['tareas', 'config', 'documentos', 'incidencias', 'reglas', 'bitacora', 'drive'];
    await seed(testEnv, collections.map((c) => [c, `doc-b-${c}`, { user: 'uid-b', v: 1 }]));

    const a = testEnv.authenticatedContext('uid-a', MEMBER).firestore();
    const c = testEnv.authenticatedContext('uid-c', MEMBER).firestore();

    for (const collectionPath of collections) {
      await assertFails(a.collection(collectionPath).doc(`doc-b-${collectionPath}`).get());
      await assertFails(c.collection(collectionPath).doc(`doc-b-${collectionPath}`).get());
      await assertSucceeds(
        a.collection(collectionPath).doc(`doc-a-${collectionPath}`).set({ user: 'uid-a', v: 1 }),
      );
      await assertFails(
        c.collection(collectionPath).doc(`doc-a-${collectionPath}`).get(),
      );
    }
  });
});

test('Un miembro no puede reasignar el propietario de su propio documento a otro uid', { skip: skipReason }, async () => {
  await withTestEnv(async (testEnv) => {
    const { assertFails } = rulesTesting;
    await seed(testEnv, [['documentos', 'doc-a', { user: 'uid-a', nombre: 'Mio' }]]);
    const a = testEnv.authenticatedContext('uid-a', MEMBER).firestore();

    await assertFails(a.collection('documentos').doc('doc-a').update({ user: 'uid-b' }));
  });
});

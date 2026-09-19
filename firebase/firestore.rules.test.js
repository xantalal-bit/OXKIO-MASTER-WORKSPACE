'use strict';

// Cross-user isolation tests for firebase/firestore.rules, against a real
// Firestore Rules emulator via @firebase/rules-unit-testing. Mirrors the
// skip-when-unavailable convention already used by
// backend/repositories/poc/persistence-poc.test.js: this package is not a
// project dependency and no emulator runs in this environment, so every
// test below is present but not executed here — TEST CODE PRESENT /
// RUNTIME NOT EXECUTED. Do not read the "pass" count for this file as
// evidence the rules were verified; read the skip reason instead.
//
// To actually run this file:
//   npm install --save-dev @firebase/rules-unit-testing
//   firebase emulators:exec --project oxkio-rules-test \
//     --only firestore --config firebase/firebase.json \
//     "FIRESTORE_EMULATOR_HOST=127.0.0.1:8088 node --test firebase/firestore.rules.test.js"

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

test('1-4. Usuario A: crea, lee y actualiza su propio documento; borrado permitido para su propietario', { skip: skipReason }, async () => {
  await withTestEnv(async (testEnv) => {
    const { assertSucceeds } = rulesTesting;
    const a = testEnv.authenticatedContext('uid-a').firestore();
    const ref = a.collection('documentos').doc('doc-a');

    await assertSucceeds(ref.set({ user: 'uid-a', nombre: 'Factura' })); // 1. create propio -> PASS
    await assertSucceeds(ref.get()); // 2. read propio -> PASS
    await assertSucceeds(ref.update({ nombre: 'Factura actualizada' })); // 3. update propio -> PASS
    await assertSucceeds(ref.delete()); // 4. delete propio -> PASS (politica: propietario puede borrar)
  });
});

test('5-8. Usuario A no puede crear, leer, actualizar ni borrar un documento de B', { skip: skipReason }, async () => {
  await withTestEnv(async (testEnv) => {
    const { assertFails } = rulesTesting;
    await seed(testEnv, [['documentos', 'doc-b', { user: 'uid-b', nombre: 'Documento de B' }]]);
    const a = testEnv.authenticatedContext('uid-a').firestore();
    const bDoc = a.collection('documentos').doc('doc-b');

    await assertFails(a.collection('documentos').doc('doc-b-forged').set({ user: 'uid-b', nombre: 'x' })); // 5. create asignado a B -> DENY
    await assertFails(bDoc.get()); // 6. read de B -> DENY
    await assertFails(bDoc.update({ nombre: 'hackeado' })); // 7. update de B -> DENY
    await assertFails(bDoc.delete()); // 8. delete de B -> DENY
  });
});

test('9. Usuario A no puede reasignar el propietario de su propio documento a B', { skip: skipReason }, async () => {
  await withTestEnv(async (testEnv) => {
    const { assertFails } = rulesTesting;
    await seed(testEnv, [['documentos', 'doc-a', { user: 'uid-a', nombre: 'Mio' }]]);
    const a = testEnv.authenticatedContext('uid-a').firestore();

    await assertFails(a.collection('documentos').doc('doc-a').update({ user: 'uid-b' }));
  });
});

test('10. Un cliente no autenticado es denegado en toda operacion', { skip: skipReason }, async () => {
  await withTestEnv(async (testEnv) => {
    const { assertFails } = rulesTesting;
    await seed(testEnv, [['documentos', 'doc-a', { user: 'uid-a', nombre: 'Mio' }]]);
    const anon = testEnv.unauthenticatedContext().firestore();

    await assertFails(anon.collection('documentos').doc('doc-anon').set({ user: 'uid-a', nombre: 'x' }));
    await assertFails(anon.collection('documentos').doc('doc-a').get());
  });
});

test('11. Los tres familiares (A, B, C) quedan aislados entre si en las 7 colecciones', { skip: skipReason }, async () => {
  await withTestEnv(async (testEnv) => {
    const { assertFails, assertSucceeds } = rulesTesting;
    const collections = ['tareas', 'config', 'documentos', 'incidencias', 'reglas', 'bitacora', 'drive'];
    await seed(testEnv, collections.map((c) => [c, `doc-b-${c}`, { user: 'uid-b', v: 1 }]));

    const a = testEnv.authenticatedContext('uid-a').firestore();
    const c = testEnv.authenticatedContext('uid-c').firestore();

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

test('12. Una coleccion no listada en las reglas queda denegada por defecto', { skip: skipReason }, async () => {
  await withTestEnv(async (testEnv) => {
    const { assertFails } = rulesTesting;
    const a = testEnv.authenticatedContext('uid-a').firestore();

    await assertFails(a.collection('coleccion-desconocida').doc('x').set({ user: 'uid-a' }));
  });
});

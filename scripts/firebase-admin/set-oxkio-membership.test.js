'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { buildAuthorizeClaims, buildRevokeClaims, applyMembership } = require('./set-oxkio-membership');

test('buildAuthorizeClaims grants family_member membership', () => {
  assert.deepEqual(buildAuthorizeClaims('family_member'), {
    oxkio_member: true,
    oxkio_role: 'family_member',
  });
});

test('buildAuthorizeClaims grants admin membership', () => {
  assert.deepEqual(buildAuthorizeClaims('admin'), {
    oxkio_member: true,
    oxkio_role: 'admin',
  });
});

test('buildAuthorizeClaims rejects any role outside the fixed set', () => {
  assert.throws(() => buildAuthorizeClaims('superadmin'), /Rol invalido/);
  assert.throws(() => buildAuthorizeClaims(''), /Rol invalido/);
  assert.throws(() => buildAuthorizeClaims(undefined), /Rol invalido/);
});

test('buildRevokeClaims sets oxkio_member to false', () => {
  assert.deepEqual(buildRevokeClaims(), { oxkio_member: false });
});

test('applyMembership rejects a missing uid without touching Firebase', async () => {
  await assert.rejects(
    () => applyMembership({ uid: '', action: 'authorize', role: 'family_member' }),
    /Falta el UID/,
  );
});

test('applyMembership rejects an unknown action without touching Firebase', async () => {
  await assert.rejects(
    () => applyMembership({ uid: 'uid-a', action: 'delete-everything' }),
    /Accion invalida/,
  );
});

test('applyMembership merges the new claim onto existing custom claims and preserves the rest', async () => {
  const setCalls = [];
  const fakeAuth = {
    getUser: async (uid) => ({ uid, customClaims: { unrelated_flag: true } }),
    setCustomUserClaims: async (uid, claims) => { setCalls.push({ uid, claims }); },
  };
  const fakeAdminAuthModule = { getAuth: () => fakeAuth };
  const modulePath = require.resolve('firebase-admin/auth');
  const originalCache = require.cache[modulePath];
  require.cache[modulePath] = { id: modulePath, filename: modulePath, loaded: true, exports: fakeAdminAuthModule };

  try {
    const result = await applyMembership({
      uid: 'uid-a',
      action: 'authorize',
      role: 'admin',
      env: { FIREBASE_PROJECT_ID: 'p', GOOGLE_APPLICATION_CREDENTIALS: '/tmp/does-not-matter.json' },
      admin: {
        getApps: () => [],
        initializeApp: () => ({ name: 'oxkio-membership-admin' }),
        applicationDefault: () => ({}),
        cert: () => ({}),
      },
    });

    assert.equal(setCalls.length, 1);
    assert.equal(setCalls[0].uid, 'uid-a');
    assert.deepEqual(setCalls[0].claims, {
      unrelated_flag: true,
      oxkio_member: true,
      oxkio_role: 'admin',
    });
    assert.deepEqual(result.resultingClaims, setCalls[0].claims);
  } finally {
    if (originalCache) require.cache[modulePath] = originalCache;
    else delete require.cache[modulePath];
  }
});

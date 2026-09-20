'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  createGoogleOAuthTokenStore,
  createFileTokenStore,
  createSecretManagerTokenStore,
  withRefreshTokenPreservation,
  mergeTokens,
} = require('./google-oauth-token-store');

async function withTempFile(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oxkio-token-store-'));
  const tokensPath = path.join(directory, 'tokens.json');
  try {
    return await run(tokensPath);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function sampleTokens(overrides = {}) {
  return {
    access_token: 'fake-access-token',
    refresh_token: 'fake-refresh-token',
    expiry_date: 2_000_000_000_000,
    scope: 'https://www.googleapis.com/auth/gmail.compose',
    token_type: 'Bearer',
    ...overrides,
  };
}

function fakeSecretManagerClient({ accessImpl, addImpl } = {}) {
  const calls = { accessSecretVersion: [], addSecretVersion: [] };
  return {
    calls,
    async accessSecretVersion(request) {
      calls.accessSecretVersion.push(request);
      if (accessImpl) return accessImpl(request);
      throw new Error('accessSecretVersion not implemented in fake');
    },
    async addSecretVersion(request) {
      calls.addSecretVersion.push(request);
      if (addImpl) return addImpl(request);
      throw new Error('addSecretVersion not implemented in fake');
    },
  };
}

// 1. file store sigue cargando tokens localmente.
test('file store loads tokens from local disk', async () => {
  await withTempFile(async (tokensPath) => {
    fs.writeFileSync(tokensPath, JSON.stringify(sampleTokens()));
    const store = createFileTokenStore({ tokensPath });
    const loaded = await store.load();
    assert.deepEqual(loaded, sampleTokens());
  });
});

test('file store returns null when the file is absent, empty, or not a plausible token object', async () => {
  await withTempFile(async (tokensPath) => {
    const store = createFileTokenStore({ tokensPath });
    assert.equal(await store.load(), null);

    fs.writeFileSync(tokensPath, '');
    assert.equal(await store.load(), null);

    fs.writeFileSync(tokensPath, JSON.stringify({ unrelated: true }));
    assert.equal(await store.load(), null);
  });
});

// 2. file store sigue guardando tokens localmente.
test('file store saves tokens to local disk as JSON', async () => {
  await withTempFile(async (tokensPath) => {
    const store = createFileTokenStore({ tokensPath });
    await store.save(sampleTokens());
    const raw = fs.readFileSync(tokensPath, 'utf8');
    assert.deepEqual(JSON.parse(raw), sampleTokens());
  });
});

// 3. secret manager load lee latest.
test('secret manager store reads the latest version by name', async () => {
  const client = fakeSecretManagerClient({
    accessImpl: (request) => {
      assert.equal(request.name, 'projects/p/secrets/google-oauth-tokens/versions/latest');
      return [{ payload: { data: Buffer.from(JSON.stringify(sampleTokens()), 'utf8') } }];
    },
  });
  const store = createSecretManagerTokenStore({
    secretName: 'projects/p/secrets/google-oauth-tokens',
    secretManagerClient: client,
  });
  const loaded = await store.load();
  assert.deepEqual(loaded, sampleTokens());
  assert.equal(client.calls.accessSecretVersion.length, 1);
});

// 4. secret manager save usa addSecretVersion.
test('secret manager store writes via addSecretVersion against the secret resource', async () => {
  const client = fakeSecretManagerClient({
    addImpl: (request) => {
      assert.equal(request.parent, 'projects/p/secrets/google-oauth-tokens');
      return [{ name: 'projects/p/secrets/google-oauth-tokens/versions/7' }];
    },
  });
  const store = createSecretManagerTokenStore({
    secretName: 'projects/p/secrets/google-oauth-tokens',
    secretManagerClient: client,
  });
  await store.save(sampleTokens());
  assert.equal(client.calls.addSecretVersion.length, 1);
});

// 5. payload JSON correcto.
test('secret manager store serializes and deserializes the exact same JSON payload', async () => {
  let storedPayload = null;
  const client = fakeSecretManagerClient({
    addImpl: (request) => {
      storedPayload = request.payload.data;
      return [{}];
    },
    accessImpl: () => [{ payload: { data: storedPayload } }],
  });
  const store = createSecretManagerTokenStore({
    secretName: 'projects/p/secrets/google-oauth-tokens',
    secretManagerClient: client,
  });
  await store.save(sampleTokens({ extra_field: 'kept-verbatim' }));
  const loaded = await store.load();
  assert.deepEqual(loaded, sampleTokens({ extra_field: 'kept-verbatim' }));
});

// 6. ningun token aparece en logs/errors.
test('no token value ever appears in a thrown error message or code', async () => {
  const secretValues = ['fake-access-token', 'fake-refresh-token', 'super-secret-payload'];
  const client = fakeSecretManagerClient({
    accessImpl: () => { throw new Error(`upstream failure containing ${secretValues[0]} and ${secretValues[1]}`); },
  });
  const store = createSecretManagerTokenStore({
    secretName: 'projects/p/secrets/google-oauth-tokens',
    secretManagerClient: client,
  });
  await assert.rejects(store.load(), (error) => {
    const serialized = `${error.code} ${error.message}`;
    secretValues.forEach((secret) => assert.equal(serialized.includes(secret), false));
    assert.equal(error.code, 'google_oauth_token_secret_unavailable');
    return true;
  });
});

test('corrupt content is treated as "no usable tokens" (null), not a store-access failure, on both backends', async () => {
  await withTempFile(async (tokensPath) => {
    fs.writeFileSync(tokensPath, '{not valid json');
    const fileStore = createFileTokenStore({ tokensPath });
    assert.equal(await fileStore.load(), null);
  });

  const client = fakeSecretManagerClient({
    accessImpl: () => [{ payload: { data: Buffer.from('{not valid json', 'utf8') } }],
  });
  const secretStore = createSecretManagerTokenStore({
    secretName: 'projects/p/secrets/google-oauth-tokens',
    secretManagerClient: client,
  });
  assert.equal(await secretStore.load(), null);
});

test('secret manager load() returns null (not an error) when the secret has no version yet', async () => {
  const client = fakeSecretManagerClient({
    accessImpl: () => {
      const error = new Error('not found');
      error.code = 5; // gRPC NOT_FOUND
      throw error;
    },
  });
  const store = createSecretManagerTokenStore({
    secretName: 'projects/p/secrets/google-oauth-tokens',
    secretManagerClient: client,
  });
  assert.equal(await store.load(), null);
});

test('a first-ever save to a still-empty secret is not blocked by the refresh-token preservation check', async () => {
  const addCalls = [];
  const client = fakeSecretManagerClient({
    accessImpl: () => {
      const error = new Error('not found');
      error.code = 5;
      throw error;
    },
    addImpl: (request) => { addCalls.push(request); return [{}]; },
  });
  const store = withRefreshTokenPreservation(createSecretManagerTokenStore({
    secretName: 'projects/p/secrets/google-oauth-tokens',
    secretManagerClient: client,
  }));
  await store.save(sampleTokens());
  assert.equal(addCalls.length, 1);
});

// 7. falta secret name -> fail closed.
test('missing secret name fails closed on both load and save', async () => {
  const store = createSecretManagerTokenStore({ secretManagerClient: fakeSecretManagerClient() });
  await assert.rejects(store.load(), (error) => {
    assert.equal(error.code, 'google_oauth_token_secret_not_configured');
    return true;
  });
  await assert.rejects(store.save(sampleTokens()), (error) => {
    assert.equal(error.code, 'google_oauth_token_secret_not_configured');
    return true;
  });
});

// 8. Secret Manager error -> fail closed.
test('a Secret Manager API failure fails closed with a safe code, on load and save', async () => {
  const client = fakeSecretManagerClient({
    accessImpl: () => { throw new Error('network failure'); },
    addImpl: () => { throw new Error('permission denied'); },
  });
  const store = createSecretManagerTokenStore({
    secretName: 'projects/p/secrets/google-oauth-tokens',
    secretManagerClient: client,
  });
  await assert.rejects(store.load(), (error) => {
    assert.equal(error.code, 'google_oauth_token_secret_unavailable');
    return true;
  });
  await assert.rejects(store.save(sampleTokens()), (error) => {
    assert.equal(error.code, 'google_oauth_token_secret_unavailable');
    return true;
  });
});

// 9. refresh sin refresh_token preserva el anterior.
test('mergeTokens keeps the previous refresh_token when the incoming update omits it', () => {
  const previous = sampleTokens({ refresh_token: 'original-refresh-token' });
  const incoming = { access_token: 'new-access-token', expiry_date: 3_000_000_000_000, scope: previous.scope, token_type: 'Bearer' };
  const merged = mergeTokens(previous, incoming);
  assert.equal(merged.refresh_token, 'original-refresh-token');
  assert.equal(merged.access_token, 'new-access-token');
});

test('withRefreshTokenPreservation applies the same policy through save() for either backend', async () => {
  await withTempFile(async (tokensPath) => {
    const store = withRefreshTokenPreservation(createFileTokenStore({ tokensPath }));
    await store.save(sampleTokens({ refresh_token: 'original-refresh-token' }));
    await store.save({ access_token: 'rotated-access-token', expiry_date: 3_000_000_000_000, scope: sampleTokens().scope, token_type: 'Bearer' });
    const loaded = await store.load();
    assert.equal(loaded.refresh_token, 'original-refresh-token');
    assert.equal(loaded.access_token, 'rotated-access-token');
  });
});

// 10. refresh con nuevo refresh_token sustituye correctamente al anterior.
test('mergeTokens replaces the refresh_token when the incoming update provides a new one', () => {
  const previous = sampleTokens({ refresh_token: 'original-refresh-token' });
  const incoming = { ...previous, refresh_token: 'rotated-refresh-token' };
  const merged = mergeTokens(previous, incoming);
  assert.equal(merged.refresh_token, 'rotated-refresh-token');
});

// 11. backend secret_manager NO cae al fichero local si falla.
test('secret_manager backend never touches the filesystem, even when it fails', async () => {
  let fsTouched = false;
  const spyFs = new Proxy({}, {
    get() {
      fsTouched = true;
      throw new Error('filesystem must not be touched by the secret_manager backend');
    },
  });
  const client = fakeSecretManagerClient({
    accessImpl: () => { throw new Error('boom'); },
  });
  const store = createGoogleOAuthTokenStore({
    env: {
      OXKIO_GOOGLE_OAUTH_TOKEN_STORE: 'secret_manager',
      OXKIO_GOOGLE_OAUTH_TOKENS_SECRET: 'projects/p/secrets/google-oauth-tokens',
    },
    fsModule: spyFs,
    secretManagerClient: client,
  });
  await assert.rejects(store.load(), (error) => {
    assert.equal(error.code, 'google_oauth_token_secret_unavailable');
    return true;
  });
  assert.equal(fsTouched, false);
});

test('createGoogleOAuthTokenStore defaults to file backend when unset, and rejects unknown backends', async () => {
  await withTempFile(async (tokensPath) => {
    const store = createGoogleOAuthTokenStore({ env: {}, tokensPath });
    assert.equal(store.backend, 'file');
  });
  assert.throws(
    () => createGoogleOAuthTokenStore({ env: { OXKIO_GOOGLE_OAUTH_TOKEN_STORE: 'dropbox' } }),
    (error) => {
      assert.equal(error.code, 'google_oauth_token_store_backend_invalid');
      return true;
    },
  );
});

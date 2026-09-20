'use strict';

// Google OAuth token persistence, abstracted behind a minimal load()/save()
// contract so backend/integrations/googleOAuth.js does not care where the
// tokens actually live. Two backends today:
//
// - FILE: backend/auth/googleTokens.json on local disk. Local/dev only —
//   this path is excluded from the Docker image (.dockerignore: backend/auth)
//   and would not survive a Cloud Run instance recycling anyway.
// - SECRET_MANAGER: Google Secret Manager, read/written through the API at
//   runtime (never mounted as a Cloud Run env var, since access_token and
//   refresh_token are mutable — Google can rotate them at any time, and an
//   env var is fixed for the life of a revision).
//
// Selected explicitly via OXKIO_GOOGLE_OAUTH_TOKEN_STORE ("file" or
// "secret_manager"); absent/unrecognized-as-cloud defaults to "file" so
// today's local behavior is unchanged unless someone opts in.

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPlausibleOAuthTokens(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && (isNonEmptyString(value.access_token) || isNonEmptyString(value.refresh_token)),
  );
}

function buildTokenStoreError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

// Google's token refresh response can omit refresh_token (it only ever
// re-issues one when it decides to rotate it). Never let a refresh silently
// erase the one already on file — merge new fields onto the previous
// document, keeping the old refresh_token when the incoming one is absent.
function mergeTokens(previous, incoming) {
  const merged = { ...incoming };
  if (!isNonEmptyString(merged.refresh_token) && previous && isNonEmptyString(previous.refresh_token)) {
    merged.refresh_token = previous.refresh_token;
  }
  return merged;
}

function withRefreshTokenPreservation(store) {
  return Object.freeze({
    backend: store.backend,
    load: store.load,
    async save(tokens) {
      const previous = await store.load();
      const merged = mergeTokens(previous, tokens);
      return store.save(merged);
    },
  });
}

function createFileTokenStore({ tokensPath, fsModule } = {}) {
  const fs = fsModule || require('fs');
  const resolvedPath = tokensPath || require('path').join(__dirname, '../auth/googleTokens.json');

  async function load() {
    if (!fs.existsSync(resolvedPath)) return null;
    let raw;
    try {
      raw = fs.readFileSync(resolvedPath, 'utf8');
    } catch (error) {
      throw buildTokenStoreError(
        'google_oauth_token_file_unreadable',
        'Google OAuth token file could not be read.',
      );
    }
    if (!raw || !raw.trim()) return null;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      // Corrupt content is "no usable tokens" (same as a missing file), not
      // a store-access failure — the file itself was readable just fine.
      return null;
    }
    return isPlausibleOAuthTokens(parsed) ? parsed : null;
  }

  async function save(tokens) {
    fs.writeFileSync(resolvedPath, JSON.stringify(tokens, null, 2));
    return tokens;
  }

  return Object.freeze({ backend: 'file', load, save });
}

function createSecretManagerTokenStore({ secretName, secretManagerClient } = {}) {
  let cachedClient = secretManagerClient || null;

  function getClient() {
    if (cachedClient) return cachedClient;
    // Lazy require: this dependency is only needed when the secret_manager
    // backend is actually selected, so local/file-only runs never need it
    // installed.
    const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
    cachedClient = new SecretManagerServiceClient();
    return cachedClient;
  }

  function assertConfigured() {
    if (!isNonEmptyString(secretName)) {
      throw buildTokenStoreError(
        'google_oauth_token_secret_not_configured',
        'OXKIO_GOOGLE_OAUTH_TOKENS_SECRET is not configured.',
      );
    }
  }

  async function load() {
    assertConfigured();
    const client = getClient();
    let response;
    try {
      [response] = await client.accessSecretVersion({ name: `${secretName}/versions/latest` });
    } catch (error) {
      // gRPC NOT_FOUND (5): the secret has no version yet (e.g. a freshly
      // created, still-empty secret, before the first save() ever ran).
      // Mirrors the file store returning null for a missing file — "no
      // tokens saved yet" is not a failure. Any other error (permission
      // denied, unavailable, etc.) still fails closed.
      if (error && error.code === 5) return null;
      throw buildTokenStoreError(
        'google_oauth_token_secret_unavailable',
        'Google OAuth token secret could not be read.',
      );
    }
    const payload = response && response.payload && response.payload.data
      ? response.payload.data.toString('utf8')
      : '';
    if (!payload.trim()) return null;
    let parsed;
    try {
      parsed = JSON.parse(payload);
    } catch (error) {
      // Corrupt payload is "no usable tokens" — the secret itself was read
      // just fine, so this is not a store-access failure.
      return null;
    }
    return isPlausibleOAuthTokens(parsed) ? parsed : null;
  }

  async function save(tokens) {
    assertConfigured();
    const client = getClient();
    const payload = Buffer.from(JSON.stringify(tokens), 'utf8');
    try {
      await client.addSecretVersion({ parent: secretName, payload: { data: payload } });
    } catch (error) {
      throw buildTokenStoreError(
        'google_oauth_token_secret_unavailable',
        'Google OAuth token secret could not be updated.',
      );
    }
    return tokens;
  }

  return Object.freeze({ backend: 'secret_manager', load, save });
}

function createGoogleOAuthTokenStore({
  env = process.env,
  tokensPath,
  fsModule,
  secretManagerClient,
} = {}) {
  const backend = isNonEmptyString(env.OXKIO_GOOGLE_OAUTH_TOKEN_STORE)
    ? env.OXKIO_GOOGLE_OAUTH_TOKEN_STORE.trim()
    : 'file';

  if (backend === 'file') {
    return withRefreshTokenPreservation(createFileTokenStore({ tokensPath, fsModule }));
  }
  if (backend === 'secret_manager') {
    return withRefreshTokenPreservation(createSecretManagerTokenStore({
      secretName: env.OXKIO_GOOGLE_OAUTH_TOKENS_SECRET,
      secretManagerClient,
    }));
  }
  throw buildTokenStoreError(
    'google_oauth_token_store_backend_invalid',
    `Unknown OXKIO_GOOGLE_OAUTH_TOKEN_STORE value: "${backend}".`,
  );
}

module.exports = {
  createGoogleOAuthTokenStore,
  createFileTokenStore,
  createSecretManagerTokenStore,
  withRefreshTokenPreservation,
  mergeTokens,
  isPlausibleOAuthTokens,
};

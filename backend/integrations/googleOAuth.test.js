'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  GOOGLE_OAUTH_SCOPES,
  createGoogleOAuthClient,
  getAuthUrl,
  getGmailClient,
  getCalendarClient,
  inspectGoogleOAuthReadiness,
  saveTokens,
  loadTokens,
} = require('./googleOAuth');
const {
  createSecretRuntime,
  createSyntheticSecretProvider,
} = require('../security/secret-runtime');

const COMPLETE_ENV = Object.freeze({
  GOOGLE_CLIENT_ID: 'fake-client-id',
  GOOGLE_CLIENT_SECRET: 'fake-client-secret',
  GOOGLE_REDIRECT_URI: 'https://example.test/oauth/callback',
});
const COMPOSE_SCOPE = 'https://www.googleapis.com/auth/gmail.compose';
const SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
const READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
const NOW = 2_000_000_000_000;

async function withTokenFile(contents, run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oxkio-google-oauth-'));
  const tokensPath = path.join(directory, 'tokens.json');
  if (contents !== null) {
    fs.writeFileSync(tokensPath, typeof contents === 'string' ? contents : JSON.stringify(contents));
  }
  try {
    return await run(tokensPath);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

async function inspect(tokensPath, overrides = {}) {
  return inspectGoogleOAuthReadiness({
    env: COMPLETE_ENV,
    tokensPath,
    now: NOW,
    ...overrides,
  });
}

function validTokens(overrides = {}) {
  return {
    access_token: 'fake-access-token',
    refresh_token: 'fake-refresh-token',
    expiry_date: NOW + 60_000,
    scope: COMPOSE_SCOPE,
    ...overrides,
  };
}

test('reports ready metadata without exposing OAuth values or scopes', async () => {
  await withTokenFile(validTokens(), async (tokensPath) => {
    const result = await inspect(tokensPath);

    assert.deepEqual(result, {
      configured: true,
      tokenPresent: true,
      accessTokenPresent: true,
      refreshTokenPresent: true,
      expired: false,
      requiredScopesPresent: true,
      excessiveScopesPresent: false,
      readyForDraftCreate: true,
      code: 'ready',
    });
    const serialized = JSON.stringify(result);
    ['fake-client', 'fake-access', 'fake-refresh', 'gmail.compose'].forEach((secret) => {
      assert.equal(serialized.includes(secret), false);
    });
  });
});

test('rejects each missing OAuth variable safely', async () => {
  for (const missingKey of Object.keys(COMPLETE_ENV)) {
    await withTokenFile(validTokens(), async (tokensPath) => {
      const env = { ...COMPLETE_ENV };
      delete env[missingKey];
      const result = await inspect(tokensPath, { env });
      assert.equal(result.configured, false);
      assert.equal(result.readyForDraftCreate, false);
      assert.equal(result.code, 'google_oauth_not_configured');
    });
  }
});

test('treats a missing or corrupt token file as "no tokens yet", never as a store failure', async () => {
  await withTokenFile(null, async (tokensPath) => {
    const result = await inspect(tokensPath);
    assert.equal(result.tokenPresent, false);
    assert.equal(result.code, 'google_oauth_tokens_missing');
  });
  for (const corrupt of ['', '{', '[]', 'null']) {
    await withTokenFile(corrupt, async (tokensPath) => {
      const result = await inspect(tokensPath);
      assert.equal(result.tokenPresent, false);
      assert.equal(result.code, 'google_oauth_tokens_missing');
    });
  }
});

test('a token store that fails to load is classified as google_oauth_token_store_unavailable, fail-closed', async () => {
  const brokenStore = {
    load: async () => { throw new Error('boom'); },
    save: async () => { throw new Error('boom'); },
  };
  const result = await inspectGoogleOAuthReadiness({ env: COMPLETE_ENV, now: NOW, tokenStore: brokenStore });
  assert.equal(result.configured, true);
  assert.equal(result.tokenPresent, false);
  assert.equal(result.readyForDraftCreate, false);
  assert.equal(result.code, 'google_oauth_token_store_unavailable');
});

test('accepts access or refresh credentials and classifies expiry safely', async () => {
  const cases = [
    { tokens: validTokens({ refresh_token: undefined }), ready: true, expired: false, code: 'ready' },
    { tokens: validTokens({ access_token: undefined }), ready: true, expired: false, code: 'ready' },
    { tokens: validTokens({ expiry_date: NOW - 1 }), ready: true, expired: true, code: 'ready' },
    {
      tokens: validTokens({ expiry_date: NOW - 1, refresh_token: undefined }),
      ready: false,
      expired: true,
      code: 'oauth_refresh_unavailable',
    },
  ];

  for (const testCase of cases) {
    await withTokenFile(testCase.tokens, async (tokensPath) => {
      const result = await inspect(tokensPath);
      assert.equal(result.readyForDraftCreate, testCase.ready);
      assert.equal(result.expired, testCase.expired);
      assert.equal(result.code, testCase.code);
    });
  }
});

test('a stored object with neither access_token nor refresh_token is treated as no tokens at all', async () => {
  await withTokenFile({ expiry_date: NOW + 60_000, scope: COMPOSE_SCOPE }, async (tokensPath) => {
    const result = await inspect(tokensPath);
    assert.equal(result.tokenPresent, false);
    assert.equal(result.readyForDraftCreate, false);
    assert.equal(result.code, 'google_oauth_tokens_missing');
  });
});

test('requires gmail.compose and flags gmail.send without exposing scope names', async () => {
  await withTokenFile(validTokens({ scope: READONLY_SCOPE }), async (tokensPath) => {
    const result = await inspect(tokensPath);
    assert.equal(result.requiredScopesPresent, false);
    assert.equal(result.code, 'gmail_compose_scope_missing');
  });
  await withTokenFile(validTokens({ scope: `${COMPOSE_SCOPE} ${SEND_SCOPE}` }), async (tokensPath) => {
    const result = await inspect(tokensPath);
    assert.equal(result.requiredScopesPresent, true);
    assert.equal(result.excessiveScopesPresent, true);
    assert.equal(result.readyForDraftCreate, true);
    assert.equal(JSON.stringify(result).includes('gmail.send'), false);
  });
});

test('getGmailClient fails before construction for missing or corrupt tokens, on file or secret_manager backend', async () => {
  for (const contents of [null, '{']) {
    await withTokenFile(contents, async (tokensPath) => {
      let gmailConstructions = 0;
      await assert.rejects(getGmailClient({
        env: COMPLETE_ENV,
        tokensPath,
        now: NOW,
        oauthClient: { setCredentials() {} },
        googleApi: { gmail() { gmailConstructions += 1; } },
      }), (error) => {
        assert.equal(error.code, 'google_oauth_tokens_missing');
        assert.equal(error.message, 'Google OAuth is not ready.');
        return true;
      });
      assert.equal(gmailConstructions, 0);
    });
  }

  let gmailConstructions = 0;
  await assert.rejects(getGmailClient({
    env: {
      ...COMPLETE_ENV,
      OXKIO_GOOGLE_OAUTH_TOKEN_STORE: 'secret_manager',
      OXKIO_GOOGLE_OAUTH_TOKENS_SECRET: 'projects/p/secrets/google-oauth-tokens',
    },
    now: NOW,
    secretManagerClient: { accessSecretVersion: async () => { throw new Error('unavailable'); } },
    oauthClient: { setCredentials() {} },
    googleApi: { gmail() { gmailConstructions += 1; } },
  }), (error) => {
    assert.equal(error.code, 'google_oauth_token_store_unavailable');
    return true;
  });
  assert.equal(gmailConstructions, 0);
});

test('getGmailClient constructs an injected client without refresh or network (file backend)', async () => {
  await withTokenFile(validTokens(), async (tokensPath) => {
    let credentialSets = 0;
    let refreshCalls = 0;
    let gmailConstructions = 0;
    const fakeGmail = { users: { drafts: { create: async () => { throw new Error('must not run'); } } } };
    const oauthClient = {
      setCredentials() { credentialSets += 1; },
      refreshAccessToken() { refreshCalls += 1; },
    };
    const googleApi = {
      gmail(options) {
        gmailConstructions += 1;
        assert.equal(options.auth, oauthClient);
        return fakeGmail;
      },
    };

    const result = await getGmailClient({
      env: COMPLETE_ENV,
      tokensPath,
      now: NOW,
      oauthClient,
      googleApi,
    });

    assert.equal(result, fakeGmail);
    assert.equal(credentialSets, 1);
    assert.equal(gmailConstructions, 1);
    assert.equal(refreshCalls, 0);
  });
});

test('getGmailClient constructs an injected client from the secret_manager backend, never touching disk', async () => {
  let gmailConstructions = 0;
  const fakeGmail = {};
  const secretManagerClient = {
    accessSecretVersion: async () => [{ payload: { data: Buffer.from(JSON.stringify(validTokens()), 'utf8') } }],
  };
  const oauthClient = { setCredentials() {} };
  const googleApi = {
    gmail(options) {
      gmailConstructions += 1;
      assert.equal(options.auth, oauthClient);
      return fakeGmail;
    },
  };

  const result = await getGmailClient({
    env: {
      ...COMPLETE_ENV,
      OXKIO_GOOGLE_OAUTH_TOKEN_STORE: 'secret_manager',
      OXKIO_GOOGLE_OAUTH_TOKENS_SECRET: 'projects/p/secrets/google-oauth-tokens',
    },
    now: NOW,
    secretManagerClient,
    oauthClient,
    googleApi,
  });

  assert.equal(result, fakeGmail);
  assert.equal(gmailConstructions, 1);
});

test('constructs OAuth through the neutral secret provider and fails closed without it', () => {
  const syntheticSecret = 'synthetic-oauth-client-secret-3b';
  const secretRuntime = createSecretRuntime({
    provider: createSyntheticSecretProvider({ GOOGLE_CLIENT_SECRET: syntheticSecret }),
  });
  const constructions = [];
  class OAuth2 {
    constructor(clientId, clientSecret, redirectUri) {
      constructions.push({ clientId, clientSecret, redirectUri });
    }
  }

  createGoogleOAuthClient({ env: COMPLETE_ENV, secretRuntime, googleApi: { auth: { OAuth2 } } });
  assert.deepEqual(constructions, [{
    clientId: COMPLETE_ENV.GOOGLE_CLIENT_ID,
    clientSecret: syntheticSecret,
    redirectUri: COMPLETE_ENV.GOOGLE_REDIRECT_URI,
  }]);

  const missingRuntime = createSecretRuntime({ provider: createSyntheticSecretProvider({}) });
  assert.throws(
    () => createGoogleOAuthClient({
      env: COMPLETE_ENV,
      secretRuntime: missingRuntime,
      googleApi: { auth: { OAuth2 } },
    }),
    (error) => {
      assert.equal(error.code, 'google_oauth_not_configured');
      assert.equal(error.message.includes(syntheticSecret), false);
      return true;
    },
  );
  assert.equal(constructions.length, 1);
});

test('future authorization scopes exclude send and retain required read/compose scopes', () => {
  assert.deepEqual(GOOGLE_OAUTH_SCOPES, [READONLY_SCOPE, COMPOSE_SCOPE, CALENDAR_SCOPE]);
  assert.equal(GOOGLE_OAUTH_SCOPES.includes(SEND_SCOPE), false);
});

test('getAuthUrl carries a provided state through to Google and omits it when absent', () => {
  const withState = new URL(getAuthUrl({ env: COMPLETE_ENV, state: 'oauth-state-value' }));
  assert.equal(withState.searchParams.get('state'), 'oauth-state-value');

  const withoutState = new URL(getAuthUrl({ env: COMPLETE_ENV }));
  assert.equal(withoutState.searchParams.has('state'), false);
});

test('saveTokens/loadTokens round-trip through the file store by default (no OXKIO_GOOGLE_OAUTH_TOKEN_STORE)', async () => {
  await withTokenFile(null, async (tokensPath) => {
    await saveTokens(validTokens(), { env: COMPLETE_ENV, tokensPath });
    const loaded = await loadTokens({
      oauthClient: { setCredentials() {} },
      env: COMPLETE_ENV,
      tokensPath,
    });
    assert.deepEqual(loaded, validTokens());
  });
});

test('saveTokens routes to the secret_manager store when explicitly selected, never touching disk', async () => {
  const calls = [];
  const secretManagerClient = {
    async accessSecretVersion() {
      // Simulates a freshly created, still-empty secret: gRPC NOT_FOUND (5),
      // which the store treats as "no tokens saved yet", not a failure.
      const error = new Error('not found');
      error.code = 5;
      throw error;
    },
    async addSecretVersion(request) {
      calls.push(request);
      return [{}];
    },
  };
  await saveTokens(validTokens(), {
    env: {
      ...COMPLETE_ENV,
      OXKIO_GOOGLE_OAUTH_TOKEN_STORE: 'secret_manager',
      OXKIO_GOOGLE_OAUTH_TOKENS_SECRET: 'projects/p/secrets/google-oauth-tokens',
    },
    secretManagerClient,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].parent, 'projects/p/secrets/google-oauth-tokens');
});

function fakeEmitterOAuthClient() {
  const listeners = {};
  return {
    setCredentials() {},
    on(event, handler) { listeners[event] = handler; },
    emit(event, payload) { listeners[event] && listeners[event](payload); },
  };
}

test('a "tokens" event from the OAuth client is persisted via saveTokens (Gmail)', async () => {
  await withTokenFile(validTokens(), async (tokensPath) => {
    const oauthClient = fakeEmitterOAuthClient();
    await getGmailClient({
      env: COMPLETE_ENV,
      tokensPath,
      now: NOW,
      oauthClient,
      googleApi: { gmail: () => ({}) },
    });

    oauthClient.emit('tokens', { access_token: 'rotated-access-token', expiry_date: NOW + 120_000, scope: COMPOSE_SCOPE, token_type: 'Bearer' });
    await new Promise((resolve) => setImmediate(resolve));

    const persisted = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));
    assert.equal(persisted.access_token, 'rotated-access-token');
    // Google's refresh response above omits refresh_token — the original
    // one must survive, never be overwritten with null/undefined.
    assert.equal(persisted.refresh_token, validTokens().refresh_token);
  });
});

test('a "tokens" event carrying a new refresh_token replaces the previous one (Calendar)', async () => {
  await withTokenFile(validTokens(), async (tokensPath) => {
    const oauthClient = fakeEmitterOAuthClient();
    await getCalendarClient({
      env: COMPLETE_ENV,
      tokensPath,
      googleApi: { auth: { OAuth2: class { constructor() { return oauthClient; } } }, calendar: () => ({}) },
    });

    oauthClient.emit('tokens', { access_token: 'rotated-access-token', refresh_token: 'rotated-refresh-token', expiry_date: NOW + 120_000, scope: COMPOSE_SCOPE, token_type: 'Bearer' });
    await new Promise((resolve) => setImmediate(resolve));

    const persisted = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));
    assert.equal(persisted.refresh_token, 'rotated-refresh-token');
  });
});

test('getCalendarClient loads persisted tokens through the store and constructs an injected client', async () => {
  await withTokenFile(validTokens(), async (tokensPath) => {
    let credentialSets = 0;
    const oauthClient = { setCredentials() { credentialSets += 1; } };
    const fakeCalendar = {};
    const googleApi = {
      auth: { OAuth2: class { constructor() { return oauthClient; } } },
      calendar(options) {
        assert.equal(options.auth, oauthClient);
        return fakeCalendar;
      },
    };
    const result = await getCalendarClient({ env: COMPLETE_ENV, tokensPath, googleApi });
    assert.equal(result, fakeCalendar);
    assert.equal(credentialSets, 1);
  });
});

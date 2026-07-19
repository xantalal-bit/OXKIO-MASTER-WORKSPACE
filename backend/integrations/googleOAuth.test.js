'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  GOOGLE_OAUTH_SCOPES,
  getGmailClient,
  inspectGoogleOAuthReadiness,
} = require('./googleOAuth');

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

function withTokenFile(contents, run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oxkio-google-oauth-'));
  const tokensPath = path.join(directory, 'tokens.json');
  if (contents !== null) {
    fs.writeFileSync(tokensPath, typeof contents === 'string' ? contents : JSON.stringify(contents));
  }
  try {
    return run(tokensPath);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function inspect(tokensPath, overrides = {}) {
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

test('reports ready metadata without exposing OAuth values or scopes', () => {
  withTokenFile(validTokens(), (tokensPath) => {
    const result = inspect(tokensPath);

    assert.deepEqual(result, {
      configured: true,
      tokenPresent: true,
      tokenParseable: true,
      accessTokenPresent: true,
      refreshTokenPresent: true,
      expired: false,
      requiredScopesPresent: true,
      excessiveScopesPresent: false,
      readyForDraftCreate: true,
      code: null,
    });
    const serialized = JSON.stringify(result);
    ['fake-client', 'fake-access', 'fake-refresh', 'gmail.compose'].forEach((secret) => {
      assert.equal(serialized.includes(secret), false);
    });
  });
});

test('rejects each missing OAuth variable safely', () => {
  for (const missingKey of Object.keys(COMPLETE_ENV)) {
    withTokenFile(validTokens(), (tokensPath) => {
      const env = { ...COMPLETE_ENV };
      delete env[missingKey];
      const result = inspect(tokensPath, { env });
      assert.equal(result.configured, false);
      assert.equal(result.readyForDraftCreate, false);
      assert.equal(result.code, 'oauth_not_configured');
    });
  }
});

test('classifies missing and invalid token files', () => {
  withTokenFile(null, (tokensPath) => {
    const result = inspect(tokensPath);
    assert.equal(result.tokenPresent, false);
    assert.equal(result.code, 'oauth_token_missing');
  });
  for (const invalid of ['', '{', '[]', 'null']) {
    withTokenFile(invalid, (tokensPath) => {
      const result = inspect(tokensPath);
      assert.equal(result.tokenPresent, true);
      assert.equal(result.tokenParseable, false);
      assert.equal(result.code, 'oauth_token_invalid');
    });
  }
});

test('accepts access or refresh credentials and classifies expiry safely', () => {
  const cases = [
    { tokens: validTokens({ refresh_token: undefined }), ready: true, expired: false, code: null },
    { tokens: validTokens({ access_token: undefined }), ready: true, expired: false, code: null },
    { tokens: validTokens({ expiry_date: NOW - 1 }), ready: true, expired: true, code: null },
    {
      tokens: validTokens({ expiry_date: NOW - 1, refresh_token: undefined }),
      ready: false,
      expired: true,
      code: 'oauth_refresh_unavailable',
    },
    {
      tokens: validTokens({ access_token: undefined, refresh_token: undefined }),
      ready: false,
      expired: false,
      code: 'oauth_access_unavailable',
    },
  ];

  for (const testCase of cases) {
    withTokenFile(testCase.tokens, (tokensPath) => {
      const result = inspect(tokensPath);
      assert.equal(result.readyForDraftCreate, testCase.ready);
      assert.equal(result.expired, testCase.expired);
      assert.equal(result.code, testCase.code);
    });
  }
});

test('requires gmail.compose and flags gmail.send without exposing scope names', () => {
  withTokenFile(validTokens({ scope: READONLY_SCOPE }), (tokensPath) => {
    const result = inspect(tokensPath);
    assert.equal(result.requiredScopesPresent, false);
    assert.equal(result.code, 'gmail_compose_scope_missing');
  });
  withTokenFile(validTokens({ scope: `${COMPOSE_SCOPE} ${SEND_SCOPE}` }), (tokensPath) => {
    const result = inspect(tokensPath);
    assert.equal(result.requiredScopesPresent, true);
    assert.equal(result.excessiveScopesPresent, true);
    assert.equal(result.readyForDraftCreate, true);
    assert.equal(JSON.stringify(result).includes('gmail.send'), false);
  });
});

test('getGmailClient fails before construction for missing or invalid tokens', () => {
  for (const contents of [null, '{']) {
    withTokenFile(contents, (tokensPath) => {
      let gmailConstructions = 0;
      assert.throws(() => getGmailClient({
        env: COMPLETE_ENV,
        tokensPath,
        now: NOW,
        oauthClient: { setCredentials() {} },
        googleApi: { gmail() { gmailConstructions += 1; } },
      }), (error) => {
        assert.equal(['oauth_token_missing', 'oauth_token_invalid'].includes(error.code), true);
        assert.equal(error.message, 'Google OAuth is not ready.');
        return true;
      });
      assert.equal(gmailConstructions, 0);
    });
  }
});

test('getGmailClient constructs an injected client without refresh or network', () => {
  withTokenFile(validTokens(), (tokensPath) => {
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

    const result = getGmailClient({
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

test('future authorization scopes exclude send and retain required read/compose scopes', () => {
  assert.deepEqual(GOOGLE_OAUTH_SCOPES, [READONLY_SCOPE, COMPOSE_SCOPE, CALENDAR_SCOPE]);
  assert.equal(GOOGLE_OAUTH_SCOPES.includes(SEND_SCOPE), false);
});

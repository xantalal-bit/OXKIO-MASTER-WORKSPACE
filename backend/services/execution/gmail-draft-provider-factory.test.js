'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { createAuthorizedGmailDraftProvider } = require('./gmail-draft-provider-factory');

test('disabled execution never inspects or constructs a Gmail client', async () => {
  let clientCalls = 0;
  const result = await createAuthorizedGmailDraftProvider({
    executionEnabled: false,
    oauthReadiness: { readyForDraftCreate: true },
    getGmailClient() { clientCalls += 1; },
  });

  assert.deepEqual(result, {
    ok: true,
    connected: false,
    code: 'execution_disabled',
    provider: null,
  });
  assert.equal(clientCalls, 0);
});

test('enabled execution fails closed when OAuth is not ready', async () => {
  let clientCalls = 0;
  const result = await createAuthorizedGmailDraftProvider({
    executionEnabled: true,
    oauthReadiness: { readyForDraftCreate: false, code: 'google_oauth_tokens_missing' },
    getGmailClient() { clientCalls += 1; },
  });

  assert.deepEqual(result, {
    ok: false,
    connected: false,
    code: 'google_oauth_tokens_missing',
    provider: null,
  });
  assert.equal(clientCalls, 0);
});

test('enabled and ready execution builds SAFE_DRAFT_ONLY provider without Gmail calls', async () => {
  let clientCalls = 0;
  let draftCalls = 0;
  const gmail = {
    users: {
      drafts: {
        async create() { draftCalls += 1; },
      },
    },
  };
  const result = await createAuthorizedGmailDraftProvider({
    executionEnabled: true,
    oauthReadiness: { readyForDraftCreate: true, code: 'ready' },
    async getGmailClient() {
      clientCalls += 1;
      return gmail;
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.connected, true);
  assert.equal(result.code, null);
  assert.equal(result.provider.gmail, gmail);
  assert.equal(result.provider.mode, 'SAFE_DRAFT_ONLY');
  assert.equal(result.provider.allowRealSend, false);
  assert.equal(clientCalls, 1);
  assert.equal(draftCalls, 0);
});

test('factory accepts activation and clients only through internal dependencies', async () => {
  let clientCalls = 0;
  const result = await createAuthorizedGmailDraftProvider({
    executionEnabled: false,
    oauthReadiness: { readyForDraftCreate: true },
    getGmailClient() { clientCalls += 1; },
    request: {
      body: {
        executionEnabled: true,
        gmail: { users: { drafts: { create() {} } } },
      },
    },
  });

  assert.equal(result.connected, false);
  assert.equal(result.provider, null);
  assert.equal(clientCalls, 0);
});

test('factory source has no send capability or draft creation call', () => {
  const source = fs.readFileSync(path.join(__dirname, 'gmail-draft-provider-factory.js'), 'utf8');
  const forbidden = [
    new RegExp(['drafts', 'send'].join('\\.')),
    new RegExp(['messages', 'send'].join('\\.')),
    new RegExp(['drafts', 'create'].join('\\.')),
  ];
  forbidden.forEach((pattern) => assert.equal(pattern.test(source), false));
});

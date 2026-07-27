'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  GmailDraftProvider,
  LIMITS,
  buildMimeMessage,
  encodeBase64Url,
} = require('./gmail-draft-provider');

function buildInput(payloadOverrides = {}) {
  return {
    approvalId: 'approval-1',
    interactionId: 'interaction-1',
    executionId: 'execution-1',
    actionType: 'propose_email',
    executionPayload: {
      to: 'recipient@example.com',
      subject: 'Asunto seguro',
      body: 'Contenido seguro',
      replyMessageId: null,
      threadId: null,
      ...payloadOverrides,
    },
  };
}

function buildGmail(result = {
  data: { id: 'draft-1', message: { id: 'message-1' }, private: 'do-not-leak' },
}) {
  const calls = [];
  const gmail = {
    users: {
      drafts: {
        async create(request) {
          calls.push(request);
          return result;
        },
      },
    },
  };
  return { gmail, calls };
}

function buildProvider(gmail, overrides = {}) {
  return new GmailDraftProvider({
    gmail,
    mode: 'SAFE_DRAFT_ONLY',
    allowRealSend: false,
    ...overrides,
  });
}

test('requires SAFE_DRAFT_ONLY and allowRealSend false before using Gmail', async () => {
  const { gmail, calls } = buildGmail();
  const unsafeProviders = [
    new GmailDraftProvider({ gmail, mode: 'UNSAFE', allowRealSend: false }),
    new GmailDraftProvider({ gmail, mode: 'SAFE_DRAFT_ONLY', allowRealSend: true }),
    new GmailDraftProvider({ gmail, mode: 'SAFE_DRAFT_ONLY' }),
  ];

  for (const provider of unsafeProviders) {
    const result = await provider.execute(buildInput());
    assert.equal(result.success, false);
    assert.equal(result.code, 'unsafe_gmail_mode');
    assert.equal(result.retryable, false);
  }
  assert.equal(calls.length, 0);
});

test('validates recipient, headers, body, identifiers, types, and limits locally', async () => {
  const { gmail, calls } = buildGmail();
  const provider = buildProvider(gmail);
  const invalidPayloads = [
    { to: '' },
    { to: 'not-an-email' },
    { to: 'recipient@example.com\r\nBcc: attacker@example.com' },
    { to: [] },
    { to: {} },
    { subject: '' },
    { subject: 'Safe\r\nBcc: attacker@example.com' },
    { subject: [] },
    { subject: {} },
    { body: '' },
    { body: [] },
    { body: {} },
    { replyMessageId: '' },
    { replyMessageId: [] },
    { replyMessageId: 'id\r\nInjected: value' },
    { threadId: '' },
    { threadId: {} },
    { threadId: 'id\nInjected: value' },
    { to: `${'a'.repeat(LIMITS.to)}@example.com` },
    { subject: 's'.repeat(LIMITS.subject + 1) },
    { body: 'b'.repeat(LIMITS.body + 1) },
    { replyMessageId: 'r'.repeat(LIMITS.id + 1) },
    { threadId: 't'.repeat(LIMITS.id + 1) },
  ];

  for (const overrides of invalidPayloads) {
    const result = await provider.execute(buildInput(overrides));
    assert.equal(result.success, false);
    assert.equal(result.retryable, false);
  }
  assert.equal(calls.length, 0);
});

test('builds minimal RFC 2822 MIME and correct base64url without mutating input', async () => {
  const { gmail, calls } = buildGmail();
  const provider = buildProvider(gmail);
  const input = buildInput({
    replyMessageId: '<message@example.com>',
    threadId: 'thread-1',
  });
  const before = JSON.parse(JSON.stringify(input));
  const result = await provider.execute(input);

  assert.equal(result.success, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].userId, 'me');
  assert.equal(calls[0].requestBody.message.threadId, 'thread-1');
  const raw = calls[0].requestBody.message.raw;
  assert.match(raw, /^[A-Za-z0-9_-]+$/);
  const decoded = Buffer.from(raw, 'base64url').toString('utf8');
  assert.equal(decoded, [
    'To: recipient@example.com',
    'Subject: Asunto seguro',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    'In-Reply-To: <message@example.com>',
    'References: <message@example.com>',
    '',
    'Contenido seguro',
  ].join('\r\n'));
  assert.equal(encodeBase64Url(decoded), raw);
  assert.equal(buildMimeMessage(input.executionPayload), decoded);
  assert.deepEqual(input, before);
});

test('omits threadId and reply headers when they are absent', async () => {
  const { gmail, calls } = buildGmail();
  const result = await buildProvider(gmail).execute(buildInput());

  assert.equal(result.success, true);
  assert.equal(Object.hasOwn(calls[0].requestBody.message, 'threadId'), false);
  const decoded = Buffer.from(calls[0].requestBody.message.raw, 'base64url').toString('utf8');
  assert.equal(decoded.includes('In-Reply-To:'), false);
  assert.equal(decoded.includes('References:'), false);
});

test('returns only safe success metadata and never leaks provider response or message data', async () => {
  const { gmail } = buildGmail({
    data: {
      id: 'draft-safe',
      message: { id: 'message-safe', raw: 'private-raw', payload: 'private-payload' },
      token: 'private-token',
    },
  });
  const result = await buildProvider(gmail).execute(buildInput());

  assert.deepEqual(result, {
    success: true,
    provider: 'gmail',
    mode: 'SAFE_DRAFT_ONLY',
    externalId: 'draft-safe',
    secondaryExternalId: 'message-safe',
    metadata: { actionType: 'propose_email' },
  });
  const serialized = JSON.stringify(result);
  for (const secret of ['private-raw', 'private-payload', 'private-token', 'recipient@example.com', 'Asunto seguro', 'Contenido seguro']) {
    assert.equal(serialized.includes(secret), false);
  }
});

test('classifies authorization, throttling, server, OAuth, and generic errors safely', async () => {
  const cases = [
    { error: { response: { status: 401 } }, code: 'gmail_unauthorized', retryable: false },
    { error: { status: 403 }, code: 'gmail_unauthorized', retryable: false },
    { error: { response: { status: 429 } }, code: 'gmail_rate_limited', retryable: true },
    { error: { response: { status: 500 } }, code: 'gmail_unavailable', retryable: true },
    { error: { status: 503 }, code: 'gmail_unavailable', retryable: true },
    { error: { code: 'google_oauth_not_configured' }, code: 'oauth_unavailable', retryable: false },
    {
      error: {
        code: 'ECONNREFUSED',
        config: { url: 'https://oauth2.googleapis.com/token' },
      },
      code: 'oauth_unavailable',
      retryable: true,
    },
    { error: new Error('sensitive provider detail'), code: 'gmail_draft_failed', retryable: false },
  ];

  for (const testCase of cases) {
    const calls = [];
    const gmail = {
      users: {
        drafts: {
          async create(request) {
            calls.push(request);
            throw testCase.error;
          },
        },
      },
    };
    const result = await buildProvider(gmail).execute(buildInput());

    assert.equal(calls.length, 1);
    assert.equal(result.success, false);
    assert.equal(result.code, testCase.code);
    assert.equal(result.retryable, testCase.retryable);
    assert.equal(JSON.stringify(result).includes('sensitive provider detail'), false);
    assert.equal(JSON.stringify(result).includes('Contenido seguro'), false);
  }
});

test('does not call Gmail for local validation failures or missing capability', async () => {
  let calls = 0;
  const gmail = { users: { drafts: { create: async () => { calls += 1; } } } };
  const invalid = await buildProvider(gmail).execute(buildInput({ to: 'invalid' }));
  const unavailable = await buildProvider({ users: { drafts: {} } }).execute(buildInput());

  assert.equal(invalid.success, false);
  assert.equal(unavailable.code, 'gmail_capability_unavailable');
  assert.equal(calls, 0);
});

test('production provider contains exactly the create capability and no delivery references', () => {
  const source = fs.readFileSync(path.join(__dirname, 'gmail-draft-provider.js'), 'utf8');
  const createPattern = new RegExp(['drafts', 'create'].join('\\.'));
  const forbiddenPatterns = [
    new RegExp(['drafts', 'send'].join('\\.')),
    new RegExp(['messages', 'send'].join('\\.')),
    new RegExp(['gmail', 'send'].join('\\.')),
    new RegExp(['send', 'Email'].join(''), 'i'),
    new RegExp(['send', 'Mail'].join(''), 'i'),
  ];

  assert.equal(createPattern.test(source), true);
  forbiddenPatterns.forEach((pattern) => assert.equal(pattern.test(source), false));
});

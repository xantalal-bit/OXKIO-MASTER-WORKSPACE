'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_MESSAGES,
  assertGmailPrivateIdentity,
  buildGmailPrivateContext,
  listReadonlyGmailMessages,
  normalizeGmailMessage,
} = require('./gmail-private-provider');
const { preparePrivateContextAdapter } = require('./private-context-adapter');

function buildProviderInput(overrides = {}) {
  return {
    clientId: 'client-alpha',
    userId: 'user-alpha',
    expectedClientId: 'client-alpha',
    authorization: { status: 'granted', provider: 'google-oauth' },
    sourceId: 'gmail-primary',
    maxMessages: 5,
    ...overrides,
  };
}

function buildGmailMessage(overrides = {}) {
  return {
    id: 'message-1',
    threadId: 'thread-1',
    snippet: 'Snippet privado ficticio',
    payload: {
      headers: [
        { name: 'From', value: 'Cliente Ficticio <cliente@example.test>' },
        { name: 'Subject', value: 'Asunto privado ficticio' },
        { name: 'Date', value: 'Sat, 04 Jul 2026 10:00:00 +0200' },
      ],
    },
    labelIds: ['INBOX'],
    internalDate: '1783152000000',
    raw: 'secret-raw-message',
    token: 'secret-token',
    credentials: 'secret-credentials',
    ...overrides,
  };
}

test('rejects Gmail private context without explicit identity', async () => {
  await assert.rejects(
    () => buildGmailPrivateContext({ enabled: true }, {
      listReadonlyGmailMessages() {
        throw new Error('gmail should not be read without explicit identity');
      },
    }),
    (error) => (
      error.code === 'gmail_private_identity_required'
        && error.message === 'gmail_private_identity_required'
    ),
  );
});

test('requires granted google-oauth authorization for Gmail private identity', () => {
  assert.throws(
    () => assertGmailPrivateIdentity(buildProviderInput({
      authorization: { status: 'pending', provider: 'google-oauth' },
    })),
    (error) => error.code === 'gmail_private_identity_required',
  );

  assert.throws(
    () => assertGmailPrivateIdentity(buildProviderInput({
      authorization: { status: 'granted' },
    })),
    (error) => error.code === 'gmail_private_identity_required',
  );
});

test('builds readonly Gmail private context with explicit identity', async () => {
  let calledWith = null;
  const context = await buildGmailPrivateContext(buildProviderInput(), {
    listReadonlyGmailMessages(options) {
      calledWith = options;

      return [buildGmailMessage()];
    },
  });

  assert.deepEqual(calledWith, {
    maxMessages: 5,
    labelIds: undefined,
  });
  assert.equal(context.privateContextMetadata.clientId, 'client-alpha');
  assert.equal(context.privateContextMetadata.userId, 'user-alpha');
  assert.equal(context.privateContextMetadata.scope, 'private:user');
  assert.equal(context.privateContextMetadata.sensitivity, 'confidential');
  assert.equal(context.privateContextMetadata.sourceType, 'gmail');
  assert.equal(context.privateContextMetadata.sourceId, 'gmail-primary');
  assert.equal(context.privateContextMetadata.authorization.status, 'granted');
  assert.equal(context.privateContextMetadata.authorization.provider, 'google-oauth');
  assert.equal(context.privateContextMetadata.purpose, 'executive-briefing');
  assert.equal(context.privateContextMetadata.retentionPolicy, 'CLIENT_CONTROLLED');
  assert.equal(context.privateContextMetadata.promotionPolicy, 'NEVER_PROMOTE');
  assert.equal(context.expectedClientId, 'client-alpha');
  assert.equal(context.privatePayload.source, 'gmail');
  assert.equal(context.privatePayload.messages.length, 1);
});

test('Gmail private metadata passes through G004/G005 adapter', async () => {
  const context = await buildGmailPrivateContext(buildProviderInput(), {
    listReadonlyGmailMessages() {
      return [buildGmailMessage()];
    },
  });

  const adapted = preparePrivateContextAdapter({
    privateContext: context.privateContextMetadata,
    expectedClientId: context.expectedClientId,
    payload: context.privatePayload,
    requiredPurpose: 'executive-briefing',
  });

  assert.equal(adapted.private, true);
  assert.equal(adapted.persistable, false);
  assert.equal(adapted.promotable, false);
  assert.equal(adapted.promotionPolicy, 'NEVER_PROMOTE');
  assert.equal(adapted.sourceType, 'gmail');
  assert.equal(adapted.payload.messages.length, 1);
});

test('limits Gmail messages to provider hard limit', async () => {
  let requestedMaxMessages = null;
  const messages = Array.from({ length: MAX_MESSAGES + 5 }, (_, index) => buildGmailMessage({
    id: `message-${index}`,
    threadId: `thread-${index}`,
  }));
  const context = await buildGmailPrivateContext(buildProviderInput({ maxMessages: 100 }), {
    listReadonlyGmailMessages(options) {
      requestedMaxMessages = options.maxMessages;
      return messages;
    },
  });

  assert.equal(requestedMaxMessages, MAX_MESSAGES);
  assert.equal(context.privatePayload.maxMessages, MAX_MESSAGES);
  assert.equal(context.privatePayload.messages.length, MAX_MESSAGES);
});

test('normalizes Gmail messages by whitelist', () => {
  const message = normalizeGmailMessage(buildGmailMessage({
    body: 'contenido privado completo',
    attachments: [{ filename: 'secret.pdf' }],
  }));

  assert.deepEqual(Object.keys(message), ['id', 'threadId', 'from', 'subject', 'date', 'snippet', 'unread', 'important']);
  assert.equal(message.id, 'message-1');
  assert.equal(message.threadId, 'thread-1');
  assert.equal(message.from, 'Cliente Ficticio <cliente@example.test>');
  assert.equal(message.subject, 'Asunto privado ficticio');
  assert.equal(message.date, 'Sat, 04 Jul 2026 10:00:00 +0200');
  assert.equal(message.snippet, 'Snippet privado ficticio');
  assert.equal(message.unread, false);
  assert.equal(message.important, false);
  assert.equal(JSON.stringify(message).includes('secret-token'), false);
  assert.equal(JSON.stringify(message).includes('secret-raw-message'), false);
  assert.equal(JSON.stringify(message).includes('secret.pdf'), false);
});

test('normalizes Gmail messages without altering Unicode text', () => {
  const message = normalizeGmailMessage(buildGmailMessage({
    snippet: 'Necesito más detalle ✅',
    payload: {
      headers: [
        { name: 'From', value: 'José García <jose@example.test>' },
        { name: 'Subject', value: 'Presupuesto 25€ 🚀' },
        { name: 'Date', value: 'Sat, 04 Jul 2026 10:00:00 +0200' },
      ],
    },
  }));

  assert.equal(message.from, 'José García <jose@example.test>');
  assert.equal(message.subject, 'Presupuesto 25€ 🚀');
  assert.equal(message.snippet, 'Necesito más detalle ✅');
});

test('does not mutate Gmail input data', async () => {
  const rawMessage = buildGmailMessage();
  const originalMessage = structuredClone(rawMessage);
  const input = buildProviderInput();
  const originalInput = structuredClone(input);

  await buildGmailPrivateContext(input, {
    listReadonlyGmailMessages() {
      return [rawMessage];
    },
  });

  assert.deepEqual(input, originalInput);
  assert.deepEqual(rawMessage, originalMessage);
});

test('real Gmail readonly reader uses metadata-only Gmail API calls', async () => {
  const calls = [];
  const messages = await listReadonlyGmailMessages({ maxMessages: 20 }, {
    getGmailClient() {
      return {
        users: {
          messages: {
            async list(options) {
              calls.push({ fn: 'list', options });

              return {
                data: {
                  messages: [
                    { id: 'message-1' },
                    { id: 'message-2' },
                  ],
                },
              };
            },
            async get(options) {
              calls.push({ fn: 'get', options });

              return {
                data: buildGmailMessage({
                  id: options.id,
                  threadId: `thread-${options.id}`,
                }),
              };
            },
          },
        },
      };
    },
  });

  assert.equal(calls[0].fn, 'list');
  assert.deepEqual(calls[0].options, {
    userId: 'me',
    maxResults: MAX_MESSAGES,
    labelIds: ['INBOX'],
  });
  assert.equal(calls[1].fn, 'get');
  assert.deepEqual(calls[1].options, {
    userId: 'me',
    id: 'message-1',
    format: 'metadata',
    metadataHeaders: ['From', 'Subject', 'Date'],
  });
  assert.equal(messages.length, 2);
  assert.deepEqual(Object.keys(messages[0]), ['id', 'threadId', 'from', 'subject', 'date', 'snippet', 'unread', 'important']);
});

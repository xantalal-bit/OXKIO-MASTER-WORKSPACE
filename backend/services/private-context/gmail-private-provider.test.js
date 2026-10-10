'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_MESSAGES,
  assertGmailPrivateIdentity,
  buildGmailPrivateContext,
  listReadonlyGmailMessages,
  normalizeGmailMessage,
  readReadonlyGmailMessageText,
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

  assert.deepEqual(Object.keys(message), ['id', 'threadId', 'from', 'subject', 'date', 'snippet', 'unread', 'important', 'starred', 'category', 'bulk']);
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

test('keeps only whether List-Unsubscribe is present, never its value, and stays idempotent', () => {
  const headers = [
    { name: 'From', value: 'Boletín Ficticio <news@example.test>' },
    { name: 'Subject', value: 'Novedades' },
    { name: 'list-unsubscribe', value: '<https://example.test/unsub?token=secret-unsub>' },
  ];
  const bulk = normalizeGmailMessage(buildGmailMessage({ payload: { headers } }));
  assert.equal(bulk.bulk, true);
  assert.equal(JSON.stringify(bulk).includes('secret-unsub'), false);
  assert.deepEqual(normalizeGmailMessage(bulk), bulk);
  const person = normalizeGmailMessage(buildGmailMessage());
  assert.equal(person.bulk, false);
  assert.deepEqual(normalizeGmailMessage(person), person);
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
    metadataHeaders: ['From', 'Subject', 'Date', 'List-Unsubscribe'],
  });
  assert.equal(messages.length, 2);
  assert.deepEqual(Object.keys(messages[0]), ['id', 'threadId', 'from', 'subject', 'date', 'snippet', 'unread', 'important', 'starred', 'category', 'bulk']);
});

test('sender search reuses the readonly list call with a from: query and metadata-only gets', async () => {
  const calls = [];
  const client = {
    users: {
      messages: {
        async list(options) {
          calls.push({ fn: 'list', options });
          return { data: { messages: [{ id: 'message-9' }] } };
        },
        async get(options) {
          calls.push({ fn: 'get', options });
          return { data: buildGmailMessage({ id: options.id, threadId: 'thread-9' }) };
        },
        async send() {
          throw new Error('send must never be called');
        },
      },
    },
  };
  const messages = await listReadonlyGmailMessages(
    { maxMessages: 5, senderAddress: ' Contacto@Example.com ' },
    { getGmailClient: () => client },
  );

  assert.deepEqual(calls[0], {
    fn: 'list',
    options: { userId: 'me', maxResults: 5, q: 'from:contacto@example.com' },
  });
  assert.deepEqual(calls[1].options, {
    userId: 'me',
    id: 'message-9',
    format: 'metadata',
    metadataHeaders: ['From', 'Subject', 'Date', 'List-Unsubscribe'],
  });
  assert.equal(messages.length, 1);
});

test('sender search rejects anything that is not a plain address before calling Gmail', async () => {
  for (const senderAddress of ['contacto@example.com OR from:x', 'in:sent', '"a"@example.com', '']) {
    await assert.rejects(
      listReadonlyGmailMessages({ senderAddress }, {
        getGmailClient() { throw new Error('Gmail must not be reached'); },
      }).catch((error) => {
        if (error.message === 'Gmail must not be reached') throw new Error('reached Gmail');
        throw error;
      }),
      (error) => error.code === 'invalid_sender_address',
    );
  }
});

test('private context passes the sender address to the reader only when given', async () => {
  const seen = [];
  const reader = async (options) => { seen.push(options); return []; };
  const identity = {
    clientId: 'client-alpha',
    userId: 'user-alpha',
    expectedClientId: 'client-alpha',
    authorization: { status: 'granted', provider: 'google-oauth' },
  };
  await buildGmailPrivateContext({ ...identity, maxMessages: 5 }, { listReadonlyGmailMessages: reader });
  await buildGmailPrivateContext(
    { ...identity, maxMessages: 5, senderAddress: 'contacto@example.com' },
    { listReadonlyGmailMessages: reader },
  );
  assert.deepEqual(seen, [
    { maxMessages: 5, labelIds: undefined },
    { maxMessages: 5, labelIds: undefined, senderAddress: 'contacto@example.com' },
  ]);
});

test('reads the text of one selected message with the readonly client (plain part preferred, html fallback)', async () => {
  const encode = (text) => Buffer.from(text, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
  const calls = [];
  const clientFor = (payload) => ({
    users: {
      messages: {
        async get(options) { calls.push(options); return { data: { payload } }; },
        async send() { throw new Error('send must never be called'); },
      },
    },
  });
  const plain = await readReadonlyGmailMessageText({ messageId: 'msg_1-A' }, {
    getGmailClient: () => clientFor({
      mimeType: 'multipart/alternative',
      parts: [
        { mimeType: 'text/plain', body: { data: encode('Hola José,\r\n\r\n\r\nTu plan vence.') } },
        { mimeType: 'text/html', body: { data: encode('<p>ignored</p>') } },
      ],
    }),
  });
  assert.equal(plain, 'Hola José,\n\nTu plan vence.');
  assert.deepEqual(calls[0], { userId: 'me', id: 'msg_1-A', format: 'full' });

  const html = await readReadonlyGmailMessageText({ messageId: 'msg2', maxChars: 12 }, {
    getGmailClient: () => clientFor({ mimeType: 'text/html', body: { data: encode('<div>Ticket &amp; plan</div><script>x()</script>') } }),
  });
  assert.equal(html, 'Ticket & pla');
});

test('message text reader rejects anything that is not a Gmail message id before calling Gmail', async () => {
  for (const messageId of ['', '../x', 'a b', undefined]) {
    await assert.rejects(
      readReadonlyGmailMessageText({ messageId }, { getGmailClient() { throw new Error('reached Gmail'); } }),
      (error) => error.code === 'invalid_message_id',
    );
  }
});

'use strict';

const {
  assertGoogleOAuthConfigured,
  getGmailClient,
} = require('../../integrations/googleOAuth');

const MAX_MESSAGES = 10;
const DEFAULT_MESSAGES = 5;

function buildProviderError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isValidText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasGrantedGoogleOAuthAuthorization(authorization) {
  return Boolean(
    authorization
      && typeof authorization === 'object'
      && authorization.status === 'granted'
      && authorization.provider === 'google-oauth',
  );
}

function assertGmailPrivateIdentity(input = {}) {
  if (
    !isValidText(input.clientId)
    || !isValidText(input.userId)
    || !isValidText(input.expectedClientId)
    || !hasGrantedGoogleOAuthAuthorization(input.authorization)
  ) {
    throw buildProviderError(
      'gmail_private_identity_required',
      'gmail_private_identity_required',
    );
  }
}

function clampMaxMessages(value) {
  if (typeof value === 'undefined' || value === null) {
    return DEFAULT_MESSAGES;
  }

  if (!Number.isInteger(value) || value < 1) {
    throw buildProviderError('invalid_max_messages', 'maxMessages must be a positive integer.');
  }

  return Math.min(value, MAX_MESSAGES);
}

function getHeader(headers, name) {
  if (!Array.isArray(headers)) {
    return '';
  }

  const found = headers.find((header) => (
    header
      && typeof header.name === 'string'
      && header.name.toLowerCase() === name.toLowerCase()
  ));

  return found && typeof found.value === 'string' ? found.value : '';
}

function normalizeGmailMessage(message = {}) {
  const payload = message.payload && typeof message.payload === 'object'
    ? message.payload
    : {};
  const headers = Array.isArray(payload.headers) ? payload.headers : [];
  const labelIds = Array.isArray(message.labelIds) ? message.labelIds : [];

  return {
    id: isValidText(message.id) ? message.id.trim() : null,
    threadId: isValidText(message.threadId) ? message.threadId.trim() : null,
    from: isValidText(message.from) ? message.from.trim() : getHeader(headers, 'From'),
    subject: isValidText(message.subject) ? message.subject.trim() : getHeader(headers, 'Subject'),
    date: isValidText(message.date) ? message.date.trim() : getHeader(headers, 'Date'),
    snippet: isValidText(message.snippet) ? message.snippet.trim() : '',
    unread: labelIds.includes('UNREAD'),
    important: labelIds.includes('IMPORTANT'),
  };
}

async function listReadonlyGmailMessages(options = {}, dependencies = {}) {
  const gmailClientFactory = dependencies.getGmailClient || getGmailClient;
  const gmail = gmailClientFactory();
  const maxMessages = clampMaxMessages(options.maxMessages);
  const listResponse = await gmail.users.messages.list({
    userId: 'me',
    maxResults: maxMessages,
    labelIds: Array.isArray(options.labelIds) ? options.labelIds : ['INBOX'],
  });
  const messages = listResponse && listResponse.data && Array.isArray(listResponse.data.messages)
    ? listResponse.data.messages
    : [];
  const details = [];

  for (const message of messages.slice(0, maxMessages)) {
    const detail = await gmail.users.messages.get({
      userId: 'me',
      id: message.id,
      format: 'metadata',
      metadataHeaders: ['From', 'Subject', 'Date'],
    });

    details.push(detail.data || {});
  }

  return details.map(normalizeGmailMessage);
}

async function buildGmailPrivateContext(input = {}, dependencies = {}) {
  const gmailReader = dependencies.listReadonlyGmailMessages || listReadonlyGmailMessages;
  const oauthGuard = dependencies.assertGoogleOAuthConfigured || assertGoogleOAuthConfigured;
  assertGmailPrivateIdentity(input);
  const maxMessages = clampMaxMessages(input.maxMessages);

  if (!dependencies.listReadonlyGmailMessages) {
    oauthGuard();
  }

  const messages = await gmailReader({
    maxMessages,
    labelIds: input.labelIds,
  });
  const normalizedMessages = Array.isArray(messages)
    ? messages.slice(0, maxMessages).map(normalizeGmailMessage)
    : [];

  return {
    privateContextMetadata: {
      clientId: input.clientId.trim(),
      userId: input.userId.trim(),
      scope: 'private:user',
      sensitivity: input.sensitivity || 'confidential',
      sourceType: 'gmail',
      sourceId: input.sourceId || 'gmail-primary',
      authorization: input.authorization,
      purpose: 'executive-briefing',
      retentionPolicy: 'CLIENT_CONTROLLED',
      promotionPolicy: 'NEVER_PROMOTE',
    },
    expectedClientId: input.expectedClientId.trim(),
    privatePayload: {
      source: 'gmail',
      messages: normalizedMessages,
      maxMessages,
    },
  };
}

module.exports = {
  DEFAULT_MESSAGES,
  MAX_MESSAGES,
  assertGmailPrivateIdentity,
  buildGmailPrivateContext,
  listReadonlyGmailMessages,
  normalizeGmailMessage,
};

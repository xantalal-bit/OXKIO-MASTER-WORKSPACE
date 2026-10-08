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

// Gmail's own inbox tabs, read from the labels the metadata call already
// returns (V3 local analysis, 06/10/2026). No new scope or request.
const GMAIL_CATEGORIES = Object.freeze({
  CATEGORY_PERSONAL: 'primary',
  CATEGORY_SOCIAL: 'social',
  CATEGORY_PROMOTIONS: 'promotions',
  CATEGORY_UPDATES: 'updates',
  CATEGORY_FORUMS: 'forums',
});

function categoryOf(labelIds) {
  const found = labelIds.find((label) => Object.hasOwn(GMAIL_CATEGORIES, label));
  return found ? GMAIL_CATEGORIES[found] : null;
}

function normalizeGmailMessage(message = {}) {
  const payload = message.payload && typeof message.payload === 'object'
    ? message.payload
    : {};
  const headers = Array.isArray(payload.headers) ? payload.headers : [];
  // Idempotent (06/10/2026): buildGmailPrivateContext normalizes the reader's
  // already-normalized messages again; without labels, the flags they carry
  // are kept instead of being recomputed as false.
  const hasLabels = Array.isArray(message.labelIds);
  const labelIds = hasLabels ? message.labelIds : [];
  const flag = (label, field) => (hasLabels ? labelIds.includes(label) : message[field] === true);

  return {
    id: isValidText(message.id) ? message.id.trim() : null,
    threadId: isValidText(message.threadId) ? message.threadId.trim() : null,
    from: isValidText(message.from) ? message.from.trim() : getHeader(headers, 'From'),
    subject: isValidText(message.subject) ? message.subject.trim() : getHeader(headers, 'Subject'),
    date: isValidText(message.date) ? message.date.trim() : getHeader(headers, 'Date'),
    snippet: isValidText(message.snippet) ? message.snippet.trim() : '',
    unread: flag('UNREAD', 'unread'),
    important: flag('IMPORTANT', 'important'),
    starred: flag('STARRED', 'starred'),
    category: hasLabels
      ? categoryOf(labelIds)
      : (Object.values(GMAIL_CATEGORIES).includes(message.category) ? message.category : null),
  };
}

// Strict address shape: the value is interpolated into a Gmail search
// operator, so anything beyond a plain address (spaces, quotes, operators)
// is rejected instead of escaped.
const SENDER_ADDRESS_PATTERN = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

function normalizeSenderAddress(value) {
  if (typeof value === 'undefined' || value === null) return null;
  const address = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!SENDER_ADDRESS_PATTERN.test(address) || address.length > 254) {
    throw buildProviderError('invalid_sender_address', 'senderAddress must be a plain email address.');
  }
  return address;
}

// Same readonly messages.list call (gmail.readonly already allows `q`). With
// a sender it searches that sender across the mailbox (spam/trash excluded
// by Gmail's default) instead of only the latest INBOX messages.
async function listReadonlyGmailMessages(options = {}, dependencies = {}) {
  const maxMessages = clampMaxMessages(options.maxMessages);
  const senderAddress = normalizeSenderAddress(options.senderAddress);
  const gmailClientFactory = dependencies.getGmailClient || getGmailClient;
  const gmail = await gmailClientFactory();
  const listResponse = await gmail.users.messages.list(senderAddress
    ? { userId: 'me', maxResults: maxMessages, q: `from:${senderAddress}` }
    : {
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

const MESSAGE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const DEFAULT_MESSAGE_TEXT_CHARS = 6000;

function decodeBase64Url(data) {
  if (typeof data !== 'string' || !data) return '';
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function collectParts(part, found) {
  if (!part || typeof part !== 'object') return found;
  const mimeType = typeof part.mimeType === 'string' ? part.mimeType.toLowerCase() : '';
  if (mimeType === 'text/plain' && part.body) found.plain.push(decodeBase64Url(part.body.data));
  if (mimeType === 'text/html' && part.body) found.html.push(decodeBase64Url(part.body.data));
  if (Array.isArray(part.parts)) part.parts.forEach((child) => collectParts(child, found));
  return found;
}

function htmlToText(html) {
  return String(html)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/p>|<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// Supervisor V1 (27/09/2026): text of ONE message already selected by the
// user, for the reasoning mission only. Same readonly client and scope
// (gmail.readonly); the text is returned to the caller, never logged or
// stored here, and capped to maxChars.
async function readReadonlyGmailMessageText(options = {}, dependencies = {}) {
  const messageId = typeof options.messageId === 'string' ? options.messageId.trim() : '';
  if (!MESSAGE_ID_PATTERN.test(messageId)) {
    throw buildProviderError('invalid_message_id', 'messageId must be a Gmail message id.');
  }
  const maxChars = Number.isInteger(options.maxChars) && options.maxChars > 0
    ? options.maxChars
    : DEFAULT_MESSAGE_TEXT_CHARS;
  const gmailClientFactory = dependencies.getGmailClient || getGmailClient;
  const gmail = await gmailClientFactory();
  const response = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });
  const found = collectParts(response && response.data && response.data.payload, { plain: [], html: [] });
  const raw = found.plain.join('\n').trim() || htmlToText(found.html.join('\n'));
  return raw.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, maxChars);
}

async function buildGmailPrivateContext(input = {}, dependencies = {}) {
  const gmailReader = dependencies.listReadonlyGmailMessages || listReadonlyGmailMessages;
  const oauthGuard = dependencies.assertGoogleOAuthConfigured || assertGoogleOAuthConfigured;
  assertGmailPrivateIdentity(input);
  const maxMessages = clampMaxMessages(input.maxMessages);
  const senderAddress = normalizeSenderAddress(input.senderAddress);

  if (!dependencies.listReadonlyGmailMessages) {
    oauthGuard();
  }

  const messages = await gmailReader({
    maxMessages,
    labelIds: input.labelIds,
    ...(senderAddress ? { senderAddress } : {}),
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
  readReadonlyGmailMessageText,
};

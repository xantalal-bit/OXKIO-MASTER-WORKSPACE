'use strict';

const LIMITS = Object.freeze({
  to: 320,
  subject: 998,
  body: 100000,
  id: 512,
});

const EMAIL_PATTERN = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i;

function buildFailure(code, retryable, message) {
  return {
    success: false,
    provider: 'gmail',
    mode: 'SAFE_DRAFT_ONLY',
    externalId: null,
    secondaryExternalId: null,
    metadata: { actionType: 'propose_email' },
    code,
    retryable,
    message,
  };
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validateHeaderString(value, field, limit) {
  if (typeof value !== 'string' || !value.trim()) return `${field}_required`;
  if (value.length > limit) return `${field}_too_long`;
  if (/\r|\n/.test(value)) return `${field}_invalid`;
  return null;
}

function validateOptionalId(value, field) {
  if (value === null) return null;
  if (typeof value !== 'string' || !value.trim()) return `${field}_invalid`;
  if (value.length > LIMITS.id || /\r|\n/.test(value)) return `${field}_invalid`;
  return null;
}

function validateExecutionInput(input) {
  if (!isPlainObject(input) || input.actionType !== 'propose_email') {
    return 'invalid_execution_contract';
  }

  for (const field of ['approvalId', 'interactionId', 'executionId']) {
    if (typeof input[field] !== 'string' || !input[field].trim()) {
      return 'invalid_execution_contract';
    }
  }

  const payload = input.executionPayload;
  if (!isPlainObject(payload)) return 'invalid_execution_payload';

  const toError = validateHeaderString(payload.to, 'to', LIMITS.to);
  if (toError) return toError;
  if (!EMAIL_PATTERN.test(payload.to)) return 'to_invalid';

  const subjectError = validateHeaderString(payload.subject, 'subject', LIMITS.subject);
  if (subjectError) return subjectError;

  if (typeof payload.body !== 'string' || !payload.body.trim()) return 'body_required';
  if (payload.body.length > LIMITS.body) return 'body_too_long';

  return validateOptionalId(payload.replyMessageId, 'reply_message_id')
    || validateOptionalId(payload.threadId, 'thread_id');
}

function buildMimeMessage(payload) {
  const headers = [
    `To: ${payload.to}`,
    `Subject: ${payload.subject}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
  ];

  if (payload.replyMessageId) {
    headers.push(`In-Reply-To: ${payload.replyMessageId}`);
    headers.push(`References: ${payload.replyMessageId}`);
  }

  return [...headers, '', payload.body].join('\r\n');
}

function encodeBase64Url(value) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function classifyProviderError(error) {
  const status = Number(error && (error.status || error.response && error.response.status));
  const code = error && error.code;
  const requestUrl = String(
    error && (
      error.config && error.config.url
      || error.response && error.response.config && error.response.config.url
      || error.message
    ) || ''
  );

  if (code === 'google_oauth_not_configured' || code === 'oauth_unavailable') {
    return buildFailure('oauth_unavailable', false, 'Gmail authorization is not available.');
  }
  if (/oauth2\.googleapis\.com\/token/i.test(requestUrl)) {
    return buildFailure('oauth_unavailable', true, 'Gmail authorization could not be refreshed.');
  }
  if (status === 401 || status === 403) {
    return buildFailure('gmail_unauthorized', false, 'Gmail authorization was rejected.');
  }
  if (status === 429) {
    return buildFailure('gmail_rate_limited', true, 'Gmail is temporarily rate limited.');
  }
  if (status >= 500 && status <= 599) {
    return buildFailure('gmail_unavailable', true, 'Gmail is temporarily unavailable.');
  }

  return buildFailure('gmail_draft_failed', false, 'Gmail draft creation failed.');
}

class GmailDraftProvider {
  constructor({ gmail, mode, allowRealSend } = {}) {
    this.gmail = gmail;
    this.mode = mode;
    this.allowRealSend = allowRealSend;
  }

  async execute(input) {
    if (this.mode !== 'SAFE_DRAFT_ONLY' || this.allowRealSend !== false) {
      return buildFailure('unsafe_gmail_mode', false, 'Gmail draft mode is not safe.');
    }

    const validationCode = validateExecutionInput(input);
    if (validationCode) {
      return buildFailure(validationCode, false, 'Invalid Gmail draft execution payload.');
    }

    const createDraft = this.gmail
      && this.gmail.users
      && this.gmail.users.drafts
      && this.gmail.users.drafts.create;
    if (typeof createDraft !== 'function') {
      return buildFailure('gmail_capability_unavailable', false, 'Gmail draft capability is unavailable.');
    }

    const payload = input.executionPayload;
    const message = {
      raw: encodeBase64Url(buildMimeMessage(payload)),
    };
    if (payload.threadId) message.threadId = payload.threadId;

    try {
      const response = await this.gmail.users.drafts.create({
        userId: 'me',
        requestBody: { message },
      });
      const draftId = response && response.data && response.data.id;
      const messageId = response && response.data && response.data.message && response.data.message.id;

      if (typeof draftId !== 'string' || typeof messageId !== 'string') {
        return buildFailure('gmail_invalid_response', true, 'Gmail returned an invalid draft response.');
      }

      return {
        success: true,
        provider: 'gmail',
        mode: 'SAFE_DRAFT_ONLY',
        externalId: draftId,
        secondaryExternalId: messageId,
        metadata: { actionType: 'propose_email' },
      };
    } catch (error) {
      return classifyProviderError(error);
    }
  }
}

module.exports = {
  GmailDraftProvider,
  LIMITS,
  buildMimeMessage,
  encodeBase64Url,
  validateExecutionInput,
};

'use strict';

const { GmailDraftProvider } = require('./providers/gmail-draft-provider');

function createAuthorizedGmailDraftProvider({
  executionEnabled,
  oauthReadiness,
  getGmailClient,
} = {}) {
  if (executionEnabled !== true) {
    return {
      ok: true,
      connected: false,
      code: 'execution_disabled',
      provider: null,
    };
  }

  if (!oauthReadiness || oauthReadiness.readyForDraftCreate !== true) {
    return {
      ok: false,
      connected: false,
      code: oauthReadiness && typeof oauthReadiness.code === 'string'
        ? oauthReadiness.code
        : 'oauth_not_ready',
      provider: null,
    };
  }

  if (typeof getGmailClient !== 'function') {
    return {
      ok: false,
      connected: false,
      code: 'oauth_not_ready',
      provider: null,
    };
  }

  try {
    const gmail = getGmailClient();
    if (!gmail || typeof gmail !== 'object') {
      return {
        ok: false,
        connected: false,
        code: 'oauth_not_ready',
        provider: null,
      };
    }

    return {
      ok: true,
      connected: true,
      code: null,
      provider: new GmailDraftProvider({
        gmail,
        mode: 'SAFE_DRAFT_ONLY',
        allowRealSend: false,
      }),
    };
  } catch (error) {
    return {
      ok: false,
      connected: false,
      code: error && typeof error.code === 'string' ? error.code : 'oauth_not_ready',
      provider: null,
    };
  }
}

module.exports = { createAuthorizedGmailDraftProvider };

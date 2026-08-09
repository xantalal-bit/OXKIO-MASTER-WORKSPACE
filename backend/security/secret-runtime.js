'use strict';

const { ENVIRONMENT_VARIABLES } = require('../config/environment-contract');

const REDACTED = '[REDACTED]';
const SECRET_KIND = 'secret';
const PUBLIC_DIAGNOSTIC_CODES = new Set([
  'operation_failed',
  'secret_unknown',
  'secret_not_allowed',
  'secret_missing',
  'google_oauth_not_configured',
  'oauth_not_ready',
  'oauth_not_configured',
  'oauth_token_missing',
  'oauth_token_invalid',
  'oauth_access_unavailable',
  'oauth_refresh_unavailable',
  'gmail_compose_scope_missing',
  'oauth_config_failed',
  'oauth_callback_failed',
  'gmail_inbox_failed',
  'gmail_analysis_failed',
  'simulator_unavailable',
  'api_execute_failed',
]);
const INLINE_CREDENTIAL = /\b(token|password|secret|authorization|private[_-]?key|connection[_-]?string)\s*[:=]\s*([^\s,;]+)/gi;
const AUTHORIZATION_VALUE = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const CREDENTIAL_URL = /\b([a-z][a-z0-9+.-]*):\/\/([^\s/@:]+):([^\s/@]+)@/gi;
const PRIVATE_KEY = /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi;

class SecretRuntimeError extends Error {
  constructor(code, id) {
    super(`Secret contract failed for ${id}.`);
    this.name = 'SecretRuntimeError';
    this.code = code;
    this.secretId = id;
  }
}

function isRegisteredSecret(id) {
  const definition = ENVIRONMENT_VARIABLES[id];
  return Boolean(definition && definition.kind === SECRET_KIND);
}

function assertRegisteredSecret(id) {
  if (!Object.prototype.hasOwnProperty.call(ENVIRONMENT_VARIABLES, id)) {
    throw new SecretRuntimeError('secret_unknown', String(id || 'unknown'));
  }
  if (!isRegisteredSecret(id)) {
    throw new SecretRuntimeError('secret_not_allowed', id);
  }
}

function createEnvironmentSecretProvider({ env = process.env } = {}) {
  return Object.freeze({
    get(id) {
      return env[id];
    },
  });
}

function createSyntheticSecretProvider(values = {}) {
  const synthetic = { ...values };
  return Object.freeze({
    get(id) {
      return synthetic[id];
    },
  });
}

function normalizeSecret(value, id) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new SecretRuntimeError('secret_missing', id);
  }
  return value;
}

function replaceKnownSecrets(text, knownSecrets) {
  let safe = String(text);
  for (const secret of knownSecrets) {
    if (secret && safe.includes(secret)) safe = safe.split(secret).join(REDACTED);
  }
  return safe
    .replace(PRIVATE_KEY, REDACTED)
    .replace(AUTHORIZATION_VALUE, `${REDACTED}`)
    .replace(CREDENTIAL_URL, `$1://${REDACTED}@`)
    .replace(INLINE_CREDENTIAL, '$1=' + REDACTED);
}

function isSensitiveKey(key) {
  const normalized = String(key).replace(/[^a-z0-9]/gi, '').toLowerCase();
  return /(?:token|password|secret|authorization|privatekey|connectionstring)$/.test(normalized);
}

function redactValue(value, knownSecrets, seen) {
  if (typeof value === 'string') return replaceKnownSecrets(value, knownSecrets);
  if (value === null || value === undefined || typeof value !== 'object') return value;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (value instanceof Error) {
    const safeError = {
      name: replaceKnownSecrets(value.name || 'Error', knownSecrets),
      message: replaceKnownSecrets(value.message || 'Operation failed.', knownSecrets),
    };
    if (typeof value.code === 'string') {
      safeError.code = replaceKnownSecrets(value.code, knownSecrets);
    }
    return safeError;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, knownSecrets, seen));
  }

  const output = {};
  for (const [key, item] of Object.entries(value)) {
    output[key] = isSensitiveKey(key)
      ? REDACTED
      : redactValue(item, knownSecrets, seen);
  }
  return output;
}

function createSecretRuntime({ provider = createEnvironmentSecretProvider() } = {}) {
  if (!provider || typeof provider.get !== 'function') {
    throw new TypeError('Secret provider must implement get(id).');
  }

  function getSecret(id) {
    assertRegisteredSecret(id);
    return normalizeSecret(provider.get(id), id);
  }

  function knownSecretValues() {
    return Object.keys(ENVIRONMENT_VARIABLES)
      .filter(isRegisteredSecret)
      .flatMap((id) => {
        try {
          return [getSecret(id)];
        } catch (error) {
          return [];
        }
      })
      .sort((left, right) => right.length - left.length);
  }

  function redact(value) {
    return redactValue(value, knownSecretValues(), new WeakSet());
  }

  function safeDiagnostic(error, fallbackCode = 'operation_failed') {
    const candidate = error && typeof error.code === 'string' ? error.code : fallbackCode;
    const safeFallback = PUBLIC_DIAGNOSTIC_CODES.has(fallbackCode)
      ? fallbackCode
      : 'operation_failed';
    const code = PUBLIC_DIAGNOSTIC_CODES.has(candidate) ? candidate : safeFallback;
    return Object.freeze({ code, message: 'Operation failed.' });
  }

  return Object.freeze({ getSecret, redact, safeDiagnostic });
}

const defaultRuntime = createSecretRuntime();

module.exports = {
  REDACTED,
  SecretRuntimeError,
  createEnvironmentSecretProvider,
  createSecretRuntime,
  createSyntheticSecretProvider,
  getSecret: defaultRuntime.getSecret,
  redact: defaultRuntime.redact,
  safeDiagnostic: defaultRuntime.safeDiagnostic,
};

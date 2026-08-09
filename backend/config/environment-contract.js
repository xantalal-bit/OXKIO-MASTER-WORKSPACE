'use strict';

const ENVIRONMENT_KINDS = Object.freeze([
  'secret',
  'sensitive_config',
  'config',
  'governance',
]);

const ENVIRONMENT_VARIABLES = Object.freeze({
  PORT: Object.freeze({ kind: 'config', classifications: ['optional'], scope: 'runtime' }),
  NODE_ENV: Object.freeze({ kind: 'config', classifications: ['optional'], scope: 'runtime' }),
  OXKIO_FILESYSTEM_MODE: Object.freeze({ kind: 'governance', classifications: ['invariant'], scope: 'runtime' }),
  XANTALAL_ROOT: Object.freeze({ kind: 'sensitive_config', classifications: ['optional', 'local_only'], scope: 'local_connectors' }),
  KNOWLEDGE_DISCOVERY_ROOT: Object.freeze({ kind: 'sensitive_config', classifications: ['optional', 'local_only'], scope: 'local_connectors' }),
  GOOGLE_CLIENT_ID: Object.freeze({ kind: 'sensitive_config', classifications: ['required'], scope: 'google_oauth' }),
  GOOGLE_CLIENT_SECRET: Object.freeze({ kind: 'secret', classifications: ['required', 'secret'], scope: 'google_oauth' }),
  GOOGLE_REDIRECT_URI: Object.freeze({ kind: 'sensitive_config', classifications: ['required'], scope: 'google_oauth' }),
  FIREBASE_PROJECT_ID: Object.freeze({ kind: 'sensitive_config', classifications: ['required'], scope: 'firebase' }),
  FIREBASE_CLIENT_EMAIL: Object.freeze({ kind: 'sensitive_config', classifications: ['optional'], scope: 'firebase' }),
  FIREBASE_PRIVATE_KEY: Object.freeze({ kind: 'secret', classifications: ['optional', 'secret'], scope: 'firebase' }),
  GOOGLE_APPLICATION_CREDENTIALS: Object.freeze({
    kind: 'sensitive_config',
    classifications: ['optional', 'local_only'],
    scope: 'firebase',
  }),
  GOOGLE_CLOUD_PROJECT: Object.freeze({ kind: 'sensitive_config', classifications: ['optional'], scope: 'firebase' }),
  OXKIO_ADMIN_FIREBASE_UIDS: Object.freeze({ kind: 'sensitive_config', classifications: ['required'], scope: 'authorization' }),
  OXKIO_ADMIN_FIREBASE_EMAILS: Object.freeze({ kind: 'sensitive_config', classifications: ['optional'], scope: 'authorization' }),
  OPENAI_API_KEY: Object.freeze({ kind: 'secret', classifications: ['optional', 'local_only', 'secret'], scope: 'simulator' }),
  OXKIO_MISSION_PG_RUNTIME_URL: Object.freeze({ kind: 'secret', classifications: ['optional', 'secret'], scope: 'postgres' }),
  OXKIO_MISSION_PG_ADMIN_URL: Object.freeze({ kind: 'secret', classifications: ['optional', 'secret'], scope: 'postgres' }),
});

function isPresent(env, name) {
  return typeof env[name] === 'string' && env[name].trim().length > 0;
}

function validateEnvironment(env = process.env, { requiredScopes = [] } = {}) {
  const missing = [];
  for (const [name, definition] of Object.entries(ENVIRONMENT_VARIABLES)) {
    if (
      definition.classifications.includes('required')
      && requiredScopes.includes(definition.scope)
      && !isPresent(env, name)
    ) {
      missing.push(name);
    }
  }

  const invalid = [];
  if (isPresent(env, 'NODE_ENV') && !['development', 'test', 'production'].includes(env.NODE_ENV)) {
    invalid.push('NODE_ENV');
  }
  if (isPresent(env, 'OXKIO_FILESYSTEM_MODE') && env.OXKIO_FILESYSTEM_MODE !== 'ephemeral') {
    invalid.push('OXKIO_FILESYSTEM_MODE');
  }

  return Object.freeze({
    ok: missing.length === 0 && invalid.length === 0,
    missing: Object.freeze(missing),
    invalid: Object.freeze(invalid),
  });
}

function assertEnvironment(env = process.env, options = {}) {
  const result = validateEnvironment(env, options);
  if (!result.ok) {
    const names = [...result.missing, ...result.invalid].join(', ');
    throw new Error(`Environment contract is not satisfied: ${names}.`);
  }
  return result;
}

module.exports = {
  ENVIRONMENT_KINDS,
  ENVIRONMENT_VARIABLES,
  assertEnvironment,
  validateEnvironment,
};

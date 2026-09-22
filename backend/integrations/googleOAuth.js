const { google } = require("googleapis");
const path = require("path");
const {
  createEnvironmentSecretProvider,
  createSecretRuntime,
} = require("../security/secret-runtime");
const { createGoogleOAuthTokenStore } = require("./google-oauth-token-store");

const TOKENS_PATH = path.join(__dirname, "../auth/googleTokens.json");
const GMAIL_COMPOSE_SCOPE = "https://www.googleapis.com/auth/gmail.compose";
const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const GOOGLE_OAUTH_SCOPES = Object.freeze([
  "https://www.googleapis.com/auth/gmail.readonly",
  GMAIL_COMPOSE_SCOPE,
  "https://www.googleapis.com/auth/calendar.readonly"
]);

function runtimeForEnvironment(env) {
  return createSecretRuntime({ provider: createEnvironmentSecretProvider({ env }) });
}

function buildGoogleOAuthConfigError() {
  const error = new Error("Google OAuth is not configured.");
  error.code = "google_oauth_not_configured";
  return error;
}

function buildSafeOAuthError(code) {
  const error = new Error("Google OAuth is not ready.");
  error.code = code || "oauth_not_ready";
  return error;
}

// Readiness states (fail-closed, never exposes token values):
//   A. OAuth client config absent       -> google_oauth_not_configured
//   B. configured, but store has no
//      usable tokens yet                -> google_oauth_tokens_missing
//   C. tokens available and usable      -> "ready"
//   D. the configured token store itself
//      could not be reached/read        -> google_oauth_token_store_unavailable
// Finer-grained states below C (expired without a refresh token, excess
// scope, missing compose scope) keep their existing specific codes — they
// only apply once a token was actually found.
async function inspectGoogleOAuthReadiness({
  env = process.env,
  secretRuntime = runtimeForEnvironment(env),
  now = Date.now(),
  ...storeOptions
} = {}) {
  const configured = getMissingGoogleOAuthConfig({ env, secretRuntime }).length === 0;

  let tokens = null;
  let storeUnavailable = false;
  if (configured) {
    try {
      tokens = await resolveTokenStore({ env, ...storeOptions }).load();
    } catch (error) {
      storeUnavailable = true;
    }
  }

  const tokenPresent = Boolean(tokens);
  const accessTokenPresent = Boolean(tokens && typeof tokens.access_token === "string" && tokens.access_token.trim());
  const refreshTokenPresent = Boolean(tokens && typeof tokens.refresh_token === "string" && tokens.refresh_token.trim());
  const expiryDate = Number(tokens && tokens.expiry_date);
  const expired = Number.isFinite(expiryDate) && expiryDate <= now;
  const scopes = tokens && typeof tokens.scope === "string"
    ? tokens.scope.split(/\s+/).filter(Boolean)
    : [];
  const requiredScopesPresent = scopes.includes(GMAIL_COMPOSE_SCOPE);
  const excessiveScopesPresent = scopes.includes(GMAIL_SEND_SCOPE);

  // Note: a plausible token object (per the store's own contract) always
  // has at least one of access_token/refresh_token as a non-empty string —
  // the same test the store uses to decide something is even worth
  // returning from load(). So once tokenPresent is true, "neither token is
  // present" cannot occur; there is deliberately no such branch here.
  let code = "ready";
  if (!configured) code = "google_oauth_not_configured";
  else if (storeUnavailable) code = "google_oauth_token_store_unavailable";
  else if (!tokenPresent) code = "google_oauth_tokens_missing";
  else if (expired && !refreshTokenPresent) code = "oauth_refresh_unavailable";
  else if (!requiredScopesPresent) code = "gmail_compose_scope_missing";

  return {
    configured,
    tokenPresent,
    accessTokenPresent,
    refreshTokenPresent,
    expired,
    requiredScopesPresent,
    excessiveScopesPresent,
    readyForDraftCreate: code === "ready",
    code,
  };
}

function getMissingGoogleOAuthConfig({
  env = process.env,
  secretRuntime = runtimeForEnvironment(env),
} = {}) {
  const missing = ["GOOGLE_CLIENT_ID", "GOOGLE_REDIRECT_URI"]
    .filter((key) => !env[key] || !String(env[key]).trim());
  try {
    secretRuntime.getSecret("GOOGLE_CLIENT_SECRET");
  } catch (error) {
    missing.push("GOOGLE_CLIENT_SECRET");
  }
  return missing;
}

function assertGoogleOAuthConfigured(options = {}) {
  if (getMissingGoogleOAuthConfig(options).length > 0) {
    throw buildGoogleOAuthConfigError();
  }

  return true;
}

function createGoogleOAuthClient({
  env = process.env,
  secretRuntime = runtimeForEnvironment(env),
  googleApi = google,
} = {}) {
  assertGoogleOAuthConfigured({ env, secretRuntime });
  return new googleApi.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    secretRuntime.getSecret("GOOGLE_CLIENT_SECRET"),
    env.GOOGLE_REDIRECT_URI
  );
}

// tokenStore selection is explicit-only (OXKIO_GOOGLE_OAUTH_TOKEN_STORE),
// per backend/integrations/google-oauth-token-store.js: absent/unset keeps
// today's file-based local behavior unchanged.
function resolveTokenStore({ env = process.env, tokenStore, tokensPath = TOKENS_PATH, fsModule, secretManagerClient } = {}) {
  return tokenStore || createGoogleOAuthTokenStore({ env, tokensPath, fsModule, secretManagerClient });
}

async function saveTokens(tokens, options = {}) {
  const store = resolveTokenStore(options);
  return store.save(tokens);
}

async function loadTokens({ oauthClient = createGoogleOAuthClient(), ...options } = {}) {
  const store = resolveTokenStore(options);
  const tokens = await store.load();
  if (!tokens) return null;

  oauthClient.setCredentials(tokens);
  return tokens;
}

function getAuthUrl({ state, ...options } = {}) {
  const oauthClient = createGoogleOAuthClient(options);

  return oauthClient.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GOOGLE_OAUTH_SCOPES,
    ...(typeof state === "string" && state ? { state } : {})
  });
}

async function getTokens(code, options = {}) {
  const oauthClient = createGoogleOAuthClient(options);

  const { tokens } = await oauthClient.getToken(code);
  oauthClient.setCredentials(tokens);
  await saveTokens(tokens, options);
  return tokens;
}

async function setCredentials(tokens, options = {}) {
  const oauthClient = createGoogleOAuthClient(options);
  oauthClient.setCredentials(tokens);
  await saveTokens(tokens, options);
}

// google-auth-library's OAuth2Client refreshes an expired access_token
// transparently (whenever a request needs one and a refresh_token is on
// file) and emits "tokens" with whatever Google returned — which may omit
// refresh_token entirely (Google only re-issues one when it decides to
// rotate it). Without persisting that event, every future getGmailClient/
// getCalendarClient call keeps loading the stale, already-expired
// access_token from the store and silently re-refreshing it in memory on
// every call, never converging. Reusing saveTokens() here both persists
// the refresh AND preserves the existing refresh_token when Google's
// response omits one (see withRefreshTokenPreservation).
function attachTokenPersistence(oauthClient, options) {
  if (!oauthClient || typeof oauthClient.on !== "function") return;
  oauthClient.on("tokens", (refreshedTokens) => {
    saveTokens(refreshedTokens, options).catch(() => {
      // Best-effort: the in-memory client still works for the current
      // request either way. A failed persistence here is not fatal — it
      // just means the next getGmailClient/getCalendarClient call may
      // have to refresh again from the still-stale stored token.
    });
  });
}

async function getGmailClient({
  env = process.env,
  now = Date.now(),
  secretRuntime = runtimeForEnvironment(env),
  oauthClient,
  googleApi = google,
  ...storeOptions
} = {}) {
  const readiness = await inspectGoogleOAuthReadiness({ env, secretRuntime, now, ...storeOptions });
  if (!readiness.readyForDraftCreate) throw buildSafeOAuthError(readiness.code);

  const client = oauthClient || createGoogleOAuthClient({ env, secretRuntime, googleApi });
  await loadTokens({ oauthClient: client, env, ...storeOptions });
  attachTokenPersistence(client, { env, ...storeOptions });

  return googleApi.gmail({
    version: "v1",
    auth: client
  });
}

async function getCalendarClient(options = {}) {
  const { googleApi = google, ...rest } = options;
  const oauthClient = createGoogleOAuthClient({ ...rest, googleApi });
  await loadTokens({ oauthClient, ...rest });
  attachTokenPersistence(oauthClient, rest);

  return googleApi.calendar({
    version: "v3",
    auth: oauthClient
  });
}

module.exports = {
  getAuthUrl,
  getTokens,
  setCredentials,
  getGmailClient,
  getCalendarClient,
  saveTokens,
  loadTokens,
  getMissingGoogleOAuthConfig,
  assertGoogleOAuthConfigured,
  createGoogleOAuthClient,
  inspectGoogleOAuthReadiness,
  buildSafeOAuthError,
  GOOGLE_OAUTH_SCOPES
};

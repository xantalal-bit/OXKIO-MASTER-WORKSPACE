const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");
const {
  createEnvironmentSecretProvider,
  createSecretRuntime,
} = require("../security/secret-runtime");

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

function readTokenFile({ tokensPath = TOKENS_PATH, fsModule = fs } = {}) {
  if (!fsModule.existsSync(tokensPath)) {
    return { present: false, parseable: false, tokens: null };
  }

  try {
    const raw = fsModule.readFileSync(tokensPath, "utf8");
    if (!raw || !raw.trim()) return { present: true, parseable: false, tokens: null };
    const tokens = JSON.parse(raw);
    if (!tokens || typeof tokens !== "object" || Array.isArray(tokens)) {
      return { present: true, parseable: false, tokens: null };
    }
    return { present: true, parseable: true, tokens };
  } catch (error) {
    return { present: true, parseable: false, tokens: null };
  }
}

function inspectGoogleOAuthReadiness({
  env = process.env,
  secretRuntime = runtimeForEnvironment(env),
  tokensPath = TOKENS_PATH,
  fsModule = fs,
  now = Date.now(),
} = {}) {
  const configured = getMissingGoogleOAuthConfig({ env, secretRuntime }).length === 0;
  const tokenFile = readTokenFile({ tokensPath, fsModule });
  const tokens = tokenFile.tokens || {};
  const accessTokenPresent = typeof tokens.access_token === "string" && Boolean(tokens.access_token.trim());
  const refreshTokenPresent = typeof tokens.refresh_token === "string" && Boolean(tokens.refresh_token.trim());
  const expiryDate = Number(tokens.expiry_date);
  const expired = Number.isFinite(expiryDate) && expiryDate <= now;
  const scopes = typeof tokens.scope === "string"
    ? tokens.scope.split(/\s+/).filter(Boolean)
    : [];
  const requiredScopesPresent = scopes.includes(GMAIL_COMPOSE_SCOPE);
  const excessiveScopesPresent = scopes.includes(GMAIL_SEND_SCOPE);

  let code = null;
  if (!configured) code = "oauth_not_configured";
  else if (!tokenFile.present) code = "oauth_token_missing";
  else if (!tokenFile.parseable) code = "oauth_token_invalid";
  else if (!accessTokenPresent && !refreshTokenPresent) code = "oauth_access_unavailable";
  else if (expired && !refreshTokenPresent) code = "oauth_refresh_unavailable";
  else if (!requiredScopesPresent) code = "gmail_compose_scope_missing";

  return {
    configured,
    tokenPresent: tokenFile.present,
    tokenParseable: tokenFile.parseable,
    accessTokenPresent,
    refreshTokenPresent,
    expired,
    requiredScopesPresent,
    excessiveScopesPresent,
    readyForDraftCreate: code === null,
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

function saveTokens(tokens) {
  fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2));
}

function loadTokens({ oauthClient = createGoogleOAuthClient() } = {}) {
  if (!fs.existsSync(TOKENS_PATH)) return null;

  const raw = fs.readFileSync(TOKENS_PATH, "utf8");
  if (!raw || raw.trim() === "") return null;

  const tokens = JSON.parse(raw);
  if (!tokens || Object.keys(tokens).length === 0) return null;

  oauthClient.setCredentials(tokens);
  return tokens;
}

function getAuthUrl(options = {}) {
  const oauthClient = createGoogleOAuthClient(options);

  return oauthClient.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GOOGLE_OAUTH_SCOPES
  });
}

async function getTokens(code, options = {}) {
  const oauthClient = createGoogleOAuthClient(options);

  const { tokens } = await oauthClient.getToken(code);
  oauthClient.setCredentials(tokens);
  saveTokens(tokens);
  return tokens;
}

function setCredentials(tokens, options = {}) {
  const oauthClient = createGoogleOAuthClient(options);
  oauthClient.setCredentials(tokens);
  saveTokens(tokens);
}

function getGmailClient({
  env = process.env,
  tokensPath = TOKENS_PATH,
  fsModule = fs,
  now = Date.now(),
  secretRuntime = runtimeForEnvironment(env),
  oauthClient,
  googleApi = google,
} = {}) {
  const readiness = inspectGoogleOAuthReadiness({ env, secretRuntime, tokensPath, fsModule, now });
  if (!readiness.readyForDraftCreate) throw buildSafeOAuthError(readiness.code);

  const tokenFile = readTokenFile({ tokensPath, fsModule });
  const client = oauthClient || createGoogleOAuthClient({ env, secretRuntime, googleApi });
  client.setCredentials(tokenFile.tokens);

  return googleApi.gmail({
    version: "v1",
    auth: client
  });
}

function getCalendarClient() {
  const oauthClient = createGoogleOAuthClient();
  loadTokens({ oauthClient });

  return google.calendar({
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

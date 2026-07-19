const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const TOKENS_PATH = path.join(__dirname, "../auth/googleTokens.json");
const GMAIL_COMPOSE_SCOPE = "https://www.googleapis.com/auth/gmail.compose";
const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const GOOGLE_OAUTH_SCOPES = Object.freeze([
  "https://www.googleapis.com/auth/gmail.readonly",
  GMAIL_COMPOSE_SCOPE,
  "https://www.googleapis.com/auth/calendar.readonly"
]);

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

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
  tokensPath = TOKENS_PATH,
  fsModule = fs,
  now = Date.now(),
} = {}) {
  const configured = [
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_REDIRECT_URI"
  ].every((key) => typeof env[key] === "string" && env[key].trim());
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

function getMissingGoogleOAuthConfig() {
  return [
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "GOOGLE_REDIRECT_URI"
  ].filter((key) => !process.env[key] || !String(process.env[key]).trim());
}

function assertGoogleOAuthConfigured() {
  if (getMissingGoogleOAuthConfig().length > 0) {
    throw buildGoogleOAuthConfigError();
  }

  return true;
}

function saveTokens(tokens) {
  fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2));
}

function loadTokens() {
  if (!fs.existsSync(TOKENS_PATH)) return null;

  const raw = fs.readFileSync(TOKENS_PATH, "utf8");
  if (!raw || raw.trim() === "") return null;

  const tokens = JSON.parse(raw);
  if (!tokens || Object.keys(tokens).length === 0) return null;

  oauth2Client.setCredentials(tokens);
  return tokens;
}

function getAuthUrl() {
  assertGoogleOAuthConfigured();

  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GOOGLE_OAUTH_SCOPES
  });
}

async function getTokens(code) {
  assertGoogleOAuthConfigured();

  const { tokens } = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);
  saveTokens(tokens);
  return tokens;
}

function setCredentials(tokens) {
  oauth2Client.setCredentials(tokens);
  saveTokens(tokens);
}

function getGmailClient({
  env = process.env,
  tokensPath = TOKENS_PATH,
  fsModule = fs,
  now = Date.now(),
  oauthClient = oauth2Client,
  googleApi = google,
} = {}) {
  const readiness = inspectGoogleOAuthReadiness({ env, tokensPath, fsModule, now });
  if (!readiness.readyForDraftCreate) throw buildSafeOAuthError(readiness.code);

  const tokenFile = readTokenFile({ tokensPath, fsModule });
  oauthClient.setCredentials(tokenFile.tokens);

  return googleApi.gmail({
    version: "v1",
    auth: oauthClient
  });
}

function getCalendarClient() {
  assertGoogleOAuthConfigured();
  loadTokens();

  return google.calendar({
    version: "v3",
    auth: oauth2Client
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
  inspectGoogleOAuthReadiness,
  buildSafeOAuthError,
  GOOGLE_OAUTH_SCOPES
};

const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const TOKENS_PATH = path.join(__dirname, "../auth/googleTokens.json");

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
    scope: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.compose",
      "https://www.googleapis.com/auth/calendar.readonly"
    ]
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

function getGmailClient() {
  assertGoogleOAuthConfigured();
  loadTokens();

  return google.gmail({
    version: "v1",
    auth: oauth2Client
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
  assertGoogleOAuthConfigured
};

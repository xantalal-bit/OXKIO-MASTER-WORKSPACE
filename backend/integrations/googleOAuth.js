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
  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.compose"
    ]
  });
}

async function getTokens(code) {
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
  loadTokens();

  return google.gmail({
    version: "v1",
    auth: oauth2Client
  });
}

module.exports = {
  getAuthUrl,
  getTokens,
  setCredentials,
  getGmailClient,
  saveTokens,
  loadTokens
};
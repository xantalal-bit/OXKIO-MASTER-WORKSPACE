'use strict';
// GitHub Actions entry point for the V3 PostgreSQL phase. It reuses the
// existing scripts unchanged (preflight-v3-pg-node.js, provision-v3-pg-secret.js)
// and adds only what an unattended, PUBLIC-log runner needs:
// - the Neon admin URL is read from Secret Manager inside this process and is
//   handed to the child process environment only: never argv, never a shell
//   variable, never $GITHUB_ENV, never printed (logs of a public repository are
//   public; masking is not relied upon);
// - child output is re-emitted only when it matches the expected sanitized
//   shape; anything else (stderr included) is replaced by a fixed message;
// - provision-resume runs only after a read-only preflight PASS in the same
//   job, and only with the typed confirmation phrase.
const { spawn } = require('node:child_process');
const path = require('node:path');
const { verifiedAdminConnectionString } = require('./provision-v3-pg-secret');

const PROJECT = 'oxkio-runtime-prod';
const ADMIN_URL_SECRET = `projects/${PROJECT}/secrets/OXKIO_V3_PG_ADMIN_URL/versions/latest`;
const CONFIRM_PROVISION = 'ACTIVAR-LOGIN-oxkio_v3_runtime';
const PREFLIGHT = path.join(__dirname, 'preflight-v3-pg-node.js');
const PROVISION = path.join(__dirname, 'provision-v3-pg-secret.js');
// Only what the children need: no GITHUB_TOKEN, no ACTIONS_* runtime tokens.
const INHERITED_ENV = ['PATH', 'HOME', 'SystemRoot', 'TEMP', 'TMP', 'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_CLOUD_PROJECT', 'CLOUDSDK_CORE_PROJECT', 'NODE_EXTRA_CA_CERTS'];
const PREFLIGHT_KEYS = ['status', 'role', 'tls', 'serverReportedTls', 'sessionLoggingGate', 'loggingBlockers',
  'secretManagerVerified', 'provisioningExecuted', 'next'];
const LOGGING_BLOCKER = /^(session|log_[a-z_]+|pg_stat_statements\.track)$/;

function childEnv(adminUrl, extra = {}, source = process.env) {
  const env = {};
  for (const key of INHERITED_ENV) if (source[key] !== undefined) env[key] = source[key];
  return { ...env, ...extra, OXKIO_V3_PG_ADMIN_URL: adminUrl };
}

// Keeps only known keys with values of the expected type; never echoes free text.
function sanitizePreflight(stdout) {
  let parsed;
  try { parsed = JSON.parse(String(stdout).trim().split('\n').pop()); } catch { return null; }
  if (!parsed || typeof parsed !== 'object') return null;
  const out = {};
  for (const key of PREFLIGHT_KEYS) {
    const value = parsed[key];
    if (key === 'loggingBlockers') {
      if (!Array.isArray(value) || !value.every((v) => typeof v === 'string' && LOGGING_BLOCKER.test(v))) return null;
      out[key] = value;
    } else if (typeof value === 'boolean' || (typeof value === 'string' && /^[A-Z_]{2,64}$/.test(value))) {
      out[key] = value;
    } else {
      return null;
    }
  }
  return out;
}

function runChild(script, args, env, { spawnImpl = spawn, timeoutMs = 120000 } = {}) {
  return new Promise((resolve) => {
    const child = spawnImpl(process.execPath, [script, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    child.stdout.on('data', (d) => { if (stdout.length < 65536) stdout += d; });
    child.stderr.on('data', () => {}); // provider errors can carry URLs: never forwarded
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout }); });
    child.on('error', () => { clearTimeout(timer); resolve({ code: -1, stdout: '' }); });
  });
}

async function readAdminUrl(secrets) {
  const [version] = await secrets.accessSecretVersion({ name: ADMIN_URL_SECRET });
  const raw = version?.payload?.data ? Buffer.from(version.payload.data).toString('utf8').trim() : '';
  verifiedAdminConnectionString(raw); // fail closed on unsafe TLS modes or extra parameters
  return raw;
}

async function runOperation({ operation, confirm = '', secrets, spawnImpl, source = process.env }) {
  if (!['preflight', 'provision-resume'].includes(operation)) return { ok: false, report: { status: 'BLOCKED', reason: 'unknown_operation' } };
  if (operation === 'provision-resume' && confirm !== CONFIRM_PROVISION) {
    return { ok: false, report: { status: 'BLOCKED', reason: 'confirmation_phrase_required' } };
  }
  let adminUrl;
  try { adminUrl = await readAdminUrl(secrets); } catch {
    return { ok: false, report: { status: 'BLOCKED', reason: 'admin_url_unavailable_or_unsafe' } };
  }
  try {
    const pre = await runChild(PREFLIGHT, ['--read-only'], childEnv(adminUrl, {}, source), { spawnImpl });
    const preflight = sanitizePreflight(pre.stdout);
    if (!preflight) return { ok: false, report: { status: 'BLOCKED', reason: 'preflight_failed_closed' } };
    if (preflight.status !== 'DB_PREFLIGHT_PASS_ONLY' || operation === 'preflight') {
      return { ok: preflight.status === 'DB_PREFLIGHT_PASS_ONLY', report: { operation, preflight } };
    }
    const run = await runChild(PROVISION, ['--execute', '--resume', '--plaintext-tls'],
      childEnv(adminUrl, { OXKIO_V3_SECRET_PROVISION_APPROVED: 'YES' }, source), { spawnImpl, timeoutMs: 300000 });
    const verified = run.code === 0 &&
      /^Verified dedicated role and secret: projects\/oxkio-runtime-prod\/secrets\/OXKIO_V3_PG_PASSWORD$/m.test(run.stdout);
    return { ok: verified, report: { operation, preflight,
      provisioning: verified ? 'LOGIN_ENABLED_AND_RUNTIME_LOGIN_VERIFIED' : 'FAILED_RUNTIME_LEFT_NOLOGIN_BY_SCRIPT' } };
  } finally {
    adminUrl = null;
  }
}

async function main() {
  const [operation] = process.argv.slice(2);
  const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
  const result = await runOperation({ operation, confirm: process.env.OXKIO_V3_CONFIRM || '', secrets: new SecretManagerServiceClient() });
  const line = JSON.stringify(result.report);
  process.stdout.write(line + '\n');
  if (process.env.GITHUB_STEP_SUMMARY) {
    require('node:fs').appendFileSync(process.env.GITHUB_STEP_SUMMARY, '```json\n' + line + '\n```\n');
  }
  if (!result.ok) process.exitCode = 2;
}

if (require.main === module) {
  main().catch(() => {
    process.stderr.write('OXKIO V3 DB operation BLOCKED; no details are printed on public runners.\n');
    process.exitCode = 1;
  });
}

module.exports = { runOperation, sanitizePreflight, childEnv, CONFIRM_PROVISION, ADMIN_URL_SECRET };

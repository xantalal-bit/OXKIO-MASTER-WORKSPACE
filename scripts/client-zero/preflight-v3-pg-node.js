'use strict';
// Read-only Node preflight for OXKIO V3. No Secret Manager access, no password
// retrieval, no role mutation, no --resume. A PASS is NOT permission to execute.
const ROLE = 'oxkio_v3_runtime';

async function preflight(db, guards, { expectedHost } = {}) {
  await db.query('BEGIN READ ONLY');
  try {
    const role = (await db.query(guards.ROLE_STATE_SQL, [ROLE])).rows?.[0];
    const session = (await db.query(guards.PLAINTEXT_SAFETY_SQL)).rows?.[0];
    let leastPrivilegeNoLogin = false;
    let clientTls = false;
    try { guards.checkRole(role); leastPrivilegeNoLogin = true; } catch {}
    // TLS is judged on this client's socket; pg_stat_ssl is false behind a TLS-terminating proxy.
    try { guards.verifyClientTls(db, expectedHost); clientTls = true; } catch {}
    const loggingBlockers = guards.loggingBlockers(session);
    await db.query('COMMIT');
    return {
      status: leastPrivilegeNoLogin && clientTls && loggingBlockers.length === 0 ? 'DB_PREFLIGHT_PASS_ONLY' : 'BLOCKED',
      role: leastPrivilegeNoLogin ? 'NOLOGIN_LEAST_PRIVILEGE' : 'BLOCKED',
      tls: clientTls ? 'PASS' : 'BLOCKED',
      serverReportedTls: session?.server_tls === true,
      sessionLoggingGate: loggingBlockers.length === 0 ? 'PASS' : 'BLOCKED',
      loggingBlockers,
      secretManagerVerified: false,
      provisioningExecuted: false,
      // The actual provisioner must recheck TLS and logging on its own session.
      next: 'AUTHORIZED_SAME_SESSION_RECHECK_REQUIRED'
    };
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function main() {
  if (process.argv.length !== 3 || process.argv[2] !== '--read-only' ||
      !process.env.OXKIO_V3_PG_ADMIN_URL) {
    throw new Error('Read-only preflight requires --read-only and a trusted admin URL environment');
  }
  // Load dependencies only in the trusted Node execution environment.
  const { Client } = require('pg');
  const guards = require('./provision-v3-pg-secret');
  const adminUrl = guards.verifiedAdminConnectionString(process.env.OXKIO_V3_PG_ADMIN_URL);
  const db = new Client({
    connectionString: adminUrl,
    ssl: { rejectUnauthorized: true },
    application_name: 'oxkio_v3_preflight_read_only'
  });
  await db.connect();
  try {
    const result = await preflight(db, guards, { expectedHost: new URL(adminUrl).hostname });
    process.stdout.write(JSON.stringify(result) + '\n');
    if (result.status !== 'DB_PREFLIGHT_PASS_ONLY') process.exitCode = 2;
  } finally {
    await db.end();
  }
}

if (require.main === module) {
  main().catch(() => {
    // No connection strings, provider error messages, parameter values or secrets.
    process.stderr.write('OXKIO V3 read-only Node preflight BLOCKED; inspect trusted environment privately.\n');
    process.exitCode = 1;
  });
}

module.exports = { preflight };

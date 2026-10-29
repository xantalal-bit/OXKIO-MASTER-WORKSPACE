'use strict';
// Read-only Node preflight for OXKIO V3. No Secret Manager access, no password
// retrieval, no role mutation, no --resume. A PASS is NOT permission to execute.
const ROLE = 'oxkio_v3_runtime';

async function preflight(db, guards) {
  await db.query('BEGIN READ ONLY');
  try {
    const role = (await db.query(guards.ROLE_STATE_SQL, [ROLE])).rows?.[0];
    const session = (await db.query(guards.PLAINTEXT_SAFETY_SQL)).rows?.[0];
    let leastPrivilegeNoLogin = false;
    let safeSession = false;
    try { guards.checkRole(role); leastPrivilegeNoLogin = true; } catch {}
    try { guards.checkPlaintextSafety(session); safeSession = true; } catch {}
    await db.query('COMMIT');
    return {
      status: leastPrivilegeNoLogin && safeSession ? 'DB_PREFLIGHT_PASS_ONLY' : 'BLOCKED',
      role: leastPrivilegeNoLogin ? 'NOLOGIN_LEAST_PRIVILEGE' : 'BLOCKED',
      tls: session?.tls === true ? 'PASS' : 'BLOCKED',
      sessionLoggingGate: safeSession ? 'PASS' : 'BLOCKED',
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
  const db = new Client({
    connectionString: guards.verifiedAdminConnectionString(process.env.OXKIO_V3_PG_ADMIN_URL),
    ssl: { rejectUnauthorized: true },
    application_name: 'oxkio_v3_preflight_read_only'
  });
  await db.connect();
  try {
    const result = await preflight(db, guards);
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

'use strict';
// One-shot, human-gated provisioning. Run ONLY in an authenticated, trusted
// execution environment with Google ADC and a dedicated Neon admin URL.
// No credential is printed, persisted locally, or passed in CLI arguments.
const { randomBytes } = require('node:crypto');
const { Client } = require('pg');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');

const PROJECT = 'oxkio-runtime-prod';
const SECRET = 'OXKIO_V3_PG_PASSWORD';
const ROLE = 'oxkio_v3_runtime';
const NAME = `projects/${PROJECT}/secrets/${SECRET}`;

function checkRole(row) {
  if (!row || row.rolname !== ROLE || row.rolcanlogin ||
      row.rolsuper || row.rolbypassrls || row.rolcreaterole ||
      row.rolcreatedb || row.password_set ||
      !row.can_read || !row.can_write || row.can_delete || row.can_schema_create) {
    throw new Error('V3 runtime role does not match safe provisioning preconditions');
  }
}

async function provision({ db, secrets, makePassword = () => randomBytes(48).toString('base64url') }) {
  const state = await db.query(`SELECT rolname,rolcanlogin,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb,
    rolpassword IS NOT NULL AS password_set,
    has_table_privilege(rolname,'oxkio_v3.memory_snapshots','SELECT') AS can_read,
    has_table_privilege(rolname,'oxkio_v3.memory_snapshots','INSERT') AS can_write,
    has_table_privilege(rolname,'oxkio_v3.memory_snapshots','DELETE') AS can_delete,
    has_schema_privilege(rolname,'oxkio_v3','CREATE') AS can_schema_create
    FROM pg_authid WHERE rolname=$1`, [ROLE]);
  checkRole(state.rows[0]);
  // Fail closed if the secret is already present: never overwrite or rotate.
  try {
    await secrets.getSecret({ name: NAME });
    throw new Error('Secret already exists; refusing overwrite');
  } catch (e) {
    if (e.code !== 5 && e.code !== 'NOT_FOUND') throw e;
  }
  const password = makePassword();
  if (!/^[A-Za-z0-9_-]{64}$/.test(password)) throw new Error('Password generator failed');
  // Secret payload travels directly through authenticated API requests,
  // never console/logs/files/command arguments.
  await secrets.createSecret({
    parent: `projects/${PROJECT}`, secretId: SECRET,
    secret: { replication: { automatic: {} } }
  });
  await secrets.addSecretVersion({
    parent: NAME,
    payload: { data: Buffer.from(password, 'utf8') }
  });
  // Verify custody before allowing PostgreSQL LOGIN.
  const [v] = await secrets.accessSecretVersion({ name: `${NAME}/versions/1` });
  const stored = v?.payload?.data;
  if (!stored || !Buffer.from(stored).equals(Buffer.from(password))) {
    throw new Error('Secret custody verification failed; role remains NOLOGIN');
  }
  // Password is from fixed, strictly validated URL-safe alphabet. Role literal fixed.
  // No real password is returned or logged.
  try {
    await db.query(`ALTER ROLE ${ROLE} PASSWORD '${password}' LOGIN`);
    const check = await db.query(`SELECT rolcanlogin,rolbypassrls,
      rolpassword IS NOT NULL AS password_set FROM pg_authid WHERE rolname=$1`, [ROLE]);
    if (!check.rows[0]?.rolcanlogin || check.rows[0]?.rolbypassrls ||
        !check.rows[0]?.password_set) throw new Error('PostgreSQL role verification failed');
  } catch (e) {
    // A failure after password assignment must leave runtime non-login.
    await db.query(`ALTER ROLE ${ROLE} NOLOGIN`).catch(() => {});
    throw new Error('Database provisioning failed; verify that runtime is NOLOGIN');
  }
  return { role: ROLE, secretName: NAME, verified: true };
}

async function main() {
  if (process.argv.length !== 3 || process.argv[2] !== '--execute' ||
      process.env.OXKIO_V3_SECRET_PROVISION_APPROVED !== 'YES' ||
      !process.env.OXKIO_V3_PG_ADMIN_URL) {
    throw new Error('Explicit --execute, approval flag and admin connection required');
  }
  const db = new Client({ connectionString: process.env.OXKIO_V3_PG_ADMIN_URL,
    ssl: { rejectUnauthorized: true } });
  await db.connect();
  try {
    const result = await provision({ db, secrets: new SecretManagerServiceClient() });
    process.stdout.write(`Verified dedicated role and secret: ${result.secretName}\n`);
  } finally {
    await db.end();
  }
}

if (require.main === module) {
  main().catch(() => {
    // Intentionally suppress provider errors: they can include sensitive URLs.
    process.stderr.write('V3 provisioning failed; inspect role and secret metadata securely.\n');
    process.exitCode = 1;
  });
}

module.exports = { checkRole, provision };

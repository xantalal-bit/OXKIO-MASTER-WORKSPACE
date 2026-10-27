'use strict';
// One-shot, human-gated provisioning. Run ONLY in an authenticated, trusted
// execution environment with Google ADC and a dedicated Neon admin URL.
// No credential is printed, persisted locally, or passed in CLI arguments.
const { randomBytes, pbkdf2Sync, createHmac, createHash } = require('node:crypto');
const { Client } = require('pg');

const PROJECT = 'oxkio-runtime-prod';
const SECRET = 'OXKIO_V3_PG_PASSWORD';
const ROLE = 'oxkio_v3_runtime';
const NAME = `projects/${PROJECT}/secrets/${SECRET}`;
const SCRAM_ITERATIONS = 4096;

// pg_roles, not pg_authid: on Neon the admin role is not superuser and
// pg_authid is unreadable. pg_roles masks rolpassword, so an existing password
// cannot be detected here; NOLOGIN plus the overwrite below make that harmless.
const ROLE_STATE_SQL = `SELECT rolname,rolcanlogin,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb,
    has_schema_privilege(rolname,'oxkio_v3','USAGE') AS schema_usage,
    has_schema_privilege(rolname,'oxkio_v3','CREATE') AS can_schema_create,
    has_table_privilege(rolname,'oxkio_v3.memory_snapshots','SELECT') AS can_read,
    has_table_privilege(rolname,'oxkio_v3.memory_snapshots','INSERT') AS can_write,
    has_table_privilege(rolname,'oxkio_v3.memory_snapshots','UPDATE') AS can_update,
    has_table_privilege(rolname,'oxkio_v3.memory_snapshots','DELETE') AS can_delete,
    has_table_privilege(rolname,'oxkio_v3.memory_snapshots','TRUNCATE') AS can_truncate
    FROM pg_roles WHERE rolname=$1`;

function checkRole(row, { login = false } = {}) {
  if (!row || row.rolname !== ROLE || row.rolcanlogin !== login ||
      row.rolsuper || row.rolbypassrls || row.rolcreaterole || row.rolcreatedb ||
      !row.schema_usage || !row.can_read || !row.can_write || !row.can_update ||
      row.can_delete || row.can_truncate || row.can_schema_create) {
    throw new Error('V3 runtime role does not match safe provisioning preconditions');
  }
}

// RFC 7677 / PostgreSQL SCRAM-SHA-256 verifier. Sending the verifier instead
// of the plaintext keeps the password out of server statement logs and
// pg_stat_statements; PostgreSQL stores a pre-hashed value unchanged.
function scramVerifier(password, salt = randomBytes(16), iterations = SCRAM_ITERATIONS) {
  const salted = pbkdf2Sync(Buffer.from(password, 'utf8'), salt, iterations, 32, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest('base64');
  const serverKey = createHmac('sha256', salted).update('Server Key').digest('base64');
  return `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}$${storedKey}:${serverKey}`;
}

// Neon rejects pre-hashed passwords ("Passwords must be supplied in plain text
// but are encrypted when stored. Hashed passwords are not supported." -
// neon.com/docs/manage/roles). 'plaintext-tls' sends the password itself, so
// this read-only gate runs first and refuses unless the session is TLS and no
// setting would record the statement text of a successful ALTER ROLE.
const PLAINTEXT_SAFETY_SQL = `SELECT
    (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS tls,
    current_setting('log_statement') AS log_statement,
    current_setting('log_min_duration_statement') AS log_min_duration_statement,
    EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements') AS pgss,
    current_setting('pg_stat_statements.track_utility', true) AS pgss_track_utility`;

function checkPlaintextSafety(row) {
  if (!row || row.tls !== true || row.log_statement !== 'none' || row.log_min_duration_statement !== '-1' ||
      (row.pgss && row.pgss_track_utility !== 'off')) {
    throw new Error('Plaintext password transport is not safe on this session; role remains NOLOGIN');
  }
}

async function provision({ db, secrets, connectAsRuntime, resume = false,
  passwordTransport = 'scram-verifier',
  makePassword = () => randomBytes(48).toString('base64url') }) {
  if (typeof connectAsRuntime !== 'function') throw new Error('Runtime login verifier required');
  if (!['scram-verifier', 'plaintext-tls'].includes(passwordTransport)) throw new Error('Unknown password transport');
  checkRole((await db.query(ROLE_STATE_SQL, [ROLE])).rows[0]);
  // Fail closed if the secret is already present: never overwrite or rotate.
  // --resume only completes an interrupted run: the role is still NOLOGIN
  // (checked above) and version 1 already holds the custodied password.
  let exists = true;
  try {
    await secrets.getSecret({ name: NAME });
  } catch (e) {
    if (e.code !== 5 && e.code !== 'NOT_FOUND') throw e;
    exists = false;
  }
  if (exists && !resume) throw new Error('Secret already exists; refusing overwrite');
  if (!exists && resume) throw new Error('Nothing to resume: secret does not exist');
  let password;
  if (resume) {
    const [v] = await secrets.accessSecretVersion({ name: `${NAME}/versions/1` });
    password = v?.payload?.data ? Buffer.from(v.payload.data).toString('utf8') : '';
    if (!/^[A-Za-z0-9_-]{64}$/.test(password)) throw new Error('Custodied password is not a provisioned value; refusing resume');
  } else {
    password = makePassword();
    if (!/^[A-Za-z0-9_-]{64}$/.test(password)) throw new Error('Password generator failed');
  }
  const verifier = scramVerifier(password);
  if (!/^SCRAM-SHA-256\$4096:[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/.test(verifier)) {
    throw new Error('Password verifier failed');
  }
  if (!resume) {
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
  }
  // Before any ALTER ROLE: a failed gate leaves the role exactly as it was (NOLOGIN).
  if (passwordTransport === 'plaintext-tls') checkPlaintextSafety((await db.query(PLAINTEXT_SAFETY_SQL)).rows[0]);
  // Both literals come from strictly validated alphabets (base64url password,
  // SCRAM verifier) without quotes, and the role literal is fixed.
  const literal = passwordTransport === 'plaintext-tls' ? password : verifier;
  try {
    await db.query(`ALTER ROLE ${ROLE} PASSWORD '${literal}' LOGIN`);
    checkRole((await db.query(ROLE_STATE_SQL, [ROLE])).rows[0], { login: true });
    // Prove the custodied password actually authenticates as the runtime role.
    const runtime = await connectAsRuntime(password);
    try {
      const { rows: [who] } = await runtime.query('SELECT current_user AS name');
      if (who?.name !== ROLE) throw new Error('Runtime login verification failed');
    } finally {
      await runtime.end();
    }
  } catch (e) {
    // A failure after password assignment must leave runtime non-login.
    await db.query(`ALTER ROLE ${ROLE} NOLOGIN`).catch(() => {});
    throw new Error('Database provisioning failed; verify that runtime is NOLOGIN');
  }
  return { role: ROLE, secretName: NAME, verified: true };
}

function runtimeConnector(adminUrl) {
  const url = new URL(adminUrl);
  return async (password) => {
    const client = new Client({ host: url.hostname, port: Number(url.port || 5432),
      database: decodeURIComponent(url.pathname.slice(1)), user: ROLE, password,
      ssl: { rejectUnauthorized: true } });
    await client.connect();
    return client;
  };
}

async function main() {
  const args = process.argv.slice(2);
  const flags = new Set(args.slice(1));
  const resume = flags.has('--resume');
  const plaintextTls = flags.has('--plaintext-tls'); // Neon: hashed passwords are not supported
  if (args[0] !== '--execute' || flags.size !== args.length - 1 ||
      [...flags].some((f) => !['--resume', '--plaintext-tls'].includes(f)) ||
      process.env.OXKIO_V3_SECRET_PROVISION_APPROVED !== 'YES' ||
      !process.env.OXKIO_V3_PG_ADMIN_URL) {
    throw new Error('Explicit --execute [--resume] [--plaintext-tls], approval flag and admin connection required');
  }
  const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
  const db = new Client({ connectionString: process.env.OXKIO_V3_PG_ADMIN_URL,
    ssl: { rejectUnauthorized: true } });
  await db.connect();
  try {
    const result = await provision({ db, secrets: new SecretManagerServiceClient(), resume,
      passwordTransport: plaintextTls ? 'plaintext-tls' : 'scram-verifier',
      connectAsRuntime: runtimeConnector(process.env.OXKIO_V3_PG_ADMIN_URL) });
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

module.exports = { checkRole, checkPlaintextSafety, provision, scramVerifier, ROLE_STATE_SQL, PLAINTEXT_SAFETY_SQL };

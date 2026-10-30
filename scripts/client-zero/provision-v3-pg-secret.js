'use strict';
// One-shot, human-gated provisioning. Run ONLY in an authenticated, trusted
// execution environment with Google ADC and a dedicated Neon admin URL.
// No credential is printed, persisted locally, or passed in CLI arguments.
const { randomBytes, pbkdf2Sync, createHmac, createHash } = require('node:crypto');
const tls = require('node:tls');
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
// neon.com/docs/manage/roles). 'plaintext-tls' must send the password itself,
// but never inside the text of any statement: statement text can be recorded
// by log_statement, log_min_error_statement (on failure), error CONTEXT lines
// and pg_stat_statements (track_utility cannot be disabled by Neon's owner).
// The password travels only as a bind parameter into a transaction-local
// setting; a DO block builds the ALTER ROLE and re-raises any failure with a
// fixed message and the SQLSTATE only.
const PASSWORD_GUC = 'oxkio.v3_runtime_password';
// Return only a boolean: SELECT set_config(...) alone echoes the secret in query results.
const SET_PASSWORD_GUC_SQL = 'SELECT set_config($1, $2, true) IS NOT NULL AS applied';
const ALTER_FROM_GUC_SQL = `DO $oxkio$
BEGIN
  EXECUTE format('ALTER ROLE ${ROLE} PASSWORD %L LOGIN', current_setting('${PASSWORD_GUC}'));
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'oxkio_v3_runtime password change failed' USING ERRCODE = SQLSTATE;
END
$oxkio$`;

// Read-only gate, before any write. What could still record the password:
// bind parameters (statement/duration/transaction sampling, or error logging)
// and nested statements (pg_stat_statements.track=all). server_tls is only
// informational: behind Neon's proxy, which terminates TLS before the compute,
// pg_stat_ssl reports false for every client. TLS is verified on the client
// socket instead (verifyClientTls).
const PLAINTEXT_SAFETY_SQL = `SELECT
    (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS server_tls,
    current_setting('log_statement') AS log_statement,
    current_setting('log_min_duration_statement') AS log_min_duration_statement,
    current_setting('log_min_duration_sample') AS log_min_duration_sample,
    current_setting('log_transaction_sample_rate') AS log_transaction_sample_rate,
    current_setting('log_parameter_max_length_on_error') AS log_parameter_max_length_on_error,
    EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements') AS pgss,
    current_setting('pg_stat_statements.track', true) AS pgss_track`;

// Names (never values) of the settings that block plaintext transport.
function loggingBlockers(row) {
  if (!row) return ['session'];
  const blockers = [];
  if (row.log_statement !== 'none') blockers.push('log_statement');
  if (row.log_min_duration_statement !== '-1') blockers.push('log_min_duration_statement');
  if (row.log_min_duration_sample !== '-1') blockers.push('log_min_duration_sample');
  if (row.log_transaction_sample_rate == null || Number(row.log_transaction_sample_rate) !== 0) blockers.push('log_transaction_sample_rate');
  if (row.log_parameter_max_length_on_error !== '0') blockers.push('log_parameter_max_length_on_error');
  if (row.pgss && row.pgss_track === 'all') blockers.push('pg_stat_statements.track');
  return blockers;
}

function checkPlaintextSafety(row) {
  if (loggingBlockers(row).length) {
    throw new Error('Plaintext password transport is not safe on this session; role remains NOLOGIN');
  }
}

// TLS of node-postgres' own socket, independent of what the server reports:
// encrypted, certificate chain verified (authorized), TLS 1.2+, and a peer
// certificate valid for the host this client was told to reach.
const CLIENT_TLS_PROTOCOLS = new Set(['TLSv1.2', 'TLSv1.3']);

function verifyClientTls(db, expectedHost) {
  const socket = db?.connection?.stream;
  if (!(socket instanceof tls.TLSSocket) || socket.encrypted !== true || socket.authorized !== true ||
      !CLIENT_TLS_PROTOCOLS.has(socket.getProtocol())) {
    throw new Error('Client TLS is not verified; role remains NOLOGIN');
  }
  const cert = socket.getPeerCertificate();
  if (typeof expectedHost !== 'string' || !expectedHost || !cert || !cert.raw ||
      tls.checkServerIdentity(expectedHost, cert) !== undefined) {
    throw new Error('Client TLS is not verified; role remains NOLOGIN');
  }
}

async function provision({ db, secrets, connectAsRuntime, resume = false,
  passwordTransport = 'scram-verifier', expectedHost,
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
  if (passwordTransport === 'plaintext-tls') {
    verifyClientTls(db, expectedHost);
    checkPlaintextSafety((await db.query(PLAINTEXT_SAFETY_SQL)).rows[0]);
  }
  try {
    if (passwordTransport === 'plaintext-tls') {
      // The password is only a bind parameter; it never appears in statement text.
      await db.query('BEGIN');
      try {
        await db.query(SET_PASSWORD_GUC_SQL, [PASSWORD_GUC, password]);
        await db.query(ALTER_FROM_GUC_SQL);
        await db.query('COMMIT');
      } catch (e) {
        await db.query('ROLLBACK').catch(() => {});
        throw e;
      }
    } else {
      // The verifier alphabet is strictly validated above and the role literal is fixed.
      await db.query(`ALTER ROLE ${ROLE} PASSWORD '${verifier}' LOGIN`);
    }
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

// node-postgres copies every URL query parameter over the explicit config, so
// besides sslmode/sslcert/sslkey/sslrootcert a URL could also redirect host,
// port, user, sslnegotiation or uselibpqcompat. Accept only an allowlist and
// remove the verified TLS mode so rejectUnauthorized:true cannot be overridden.
const ALLOWED_ADMIN_URL_PARAMS = new Set(['sslmode', 'channel_binding', 'application_name']);

function verifiedAdminConnectionString(raw) {
  const url = new URL(raw);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Invalid admin database URL');
  if (!url.hostname || url.hash) throw new Error('Invalid admin database URL');
  for (const key of url.searchParams.keys()) {
    if (!ALLOWED_ADMIN_URL_PARAMS.has(key)) throw new Error('Unsupported admin connection option');
  }
  const modes = url.searchParams.getAll('sslmode');
  if (modes.length > 1 || (modes.length === 1 && !['require', 'verify-full'].includes(modes[0]))) {
    throw new Error('Unsafe admin TLS mode');
  }
  url.searchParams.delete('sslmode');
  return url.toString();
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
  const adminUrl = verifiedAdminConnectionString(process.env.OXKIO_V3_PG_ADMIN_URL);
  const db = new Client({ connectionString: adminUrl, ssl: { rejectUnauthorized: true } });
  await db.connect();
  try {
    const result = await provision({ db, secrets: new SecretManagerServiceClient(), resume,
      passwordTransport: plaintextTls ? 'plaintext-tls' : 'scram-verifier', expectedHost: new URL(adminUrl).hostname,
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

module.exports = { checkRole, checkPlaintextSafety, loggingBlockers, verifyClientTls, verifiedAdminConnectionString, provision, scramVerifier, ROLE_STATE_SQL, PLAINTEXT_SAFETY_SQL, ALTER_FROM_GUC_SQL };

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { checkRole, provision, scramVerifier, ROLE_STATE_SQL } = require('./provision-v3-pg-secret');

const safeRole = (login = false) => ({
  rolname:'oxkio_v3_runtime', rolcanlogin:login, rolsuper:false,
  rolbypassrls:false, rolcreaterole:false, rolcreatedb:false,
  schema_usage:true, can_schema_create:false, can_read:true, can_write:true,
  can_update:true, can_delete:false, can_truncate:false
});
const goodPassword = 'A'.repeat(64);
const missing = async () => { const e = new Error('not found'); e.code = 5; throw e; };
const runtimeLogin = (calls = [], name = 'oxkio_v3_runtime') => async (password) => {
  calls.push('LOGIN:' + (password === goodPassword));
  return { query: async () => ({ rows:[{ name }] }), end: async () => { calls.push('LOGOUT'); } };
};
// Fake DB whose role state follows the issued ALTER ROLE statements.
const fakeDb = (calls, { failOn } = {}) => {
  let login = false;
  return { query: async (sql) => {
    calls.push(sql);
    if (failOn && failOn(sql)) throw new Error('synthetic DB failure');
    if (sql.startsWith('ALTER ROLE')) { login = / LOGIN$/.test(sql); return { rows:[] }; }
    return { rows:[safeRole(login)] };
  } };
};
const goodSecrets = (calls = []) => ({
  getSecret: missing,
  createSecret: async () => { calls.push('CREATE_SECRET'); },
  addSecretVersion: async () => { calls.push('ADD_VERSION'); },
  accessSecretVersion: async () => { calls.push('READ_VERSION'); return [{ payload:{ data:Buffer.from(goodPassword) } }]; }
});

test('rejects elevated privileges, missing least privileges and unexpected login', () => {
  for (const field of ['rolcanlogin','rolsuper','rolbypassrls','rolcreaterole',
    'rolcreatedb','can_delete','can_truncate','can_schema_create']) {
    assert.throws(() => checkRole({ ...safeRole(), [field]: true }));
  }
  for (const field of ['schema_usage','can_read','can_write','can_update']) {
    assert.throws(() => checkRole({ ...safeRole(), [field]: false }));
  }
  assert.throws(() => checkRole(null));
  assert.throws(() => checkRole(safeRole(false), { login: true }));
  checkRole(safeRole(true), { login: true });
});

test('role inspection never depends on superuser-only pg_authid', () => {
  assert.match(ROLE_STATE_SQL, /FROM pg_roles /);
  assert.doesNotMatch(ROLE_STATE_SQL, /pg_authid|rolpassword/);
});

test('SCRAM verifier reproduces the RFC 7677 server signature and never embeds the password', () => {
  const verifier = scramVerifier('pencil', Buffer.from('W22ZaJ0SNY7soEsUEjb6gQ==', 'base64'));
  const match = /^SCRAM-SHA-256\$4096:W22ZaJ0SNY7soEsUEjb6gQ==\$([^:]+):(.+)$/.exec(verifier);
  assert.ok(match, verifier);
  const nonce = 'rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0';
  const authMessage = `n=user,r=rOprNGfwEbeRWgbNEkqO,r=${nonce},s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096,c=biws,r=${nonce}`;
  const signature = createHmac('sha256', Buffer.from(match[2], 'base64')).update(authMessage).digest('base64');
  assert.equal(signature, '6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=');
  assert.equal(scramVerifier(goodPassword).includes(goodPassword), false);
});

test('fails closed before secret creation when preconditions are unsafe', async () => {
  let creates = 0;
  const db = { query: async () => ({ rows:[{ ...safeRole(), rolbypassrls:true }] }) };
  const secrets = { createSecret: async () => { creates++; } };
  await assert.rejects(provision({ db, secrets, connectAsRuntime: runtimeLogin(), makePassword: () => goodPassword }));
  assert.equal(creates, 0);
});

test('requires a runtime login verifier before touching anything', async () => {
  const calls = [];
  await assert.rejects(provision({ db: fakeDb(calls), secrets: goodSecrets(calls) }), /login verifier required/);
  assert.deepEqual(calls, []);
});

test('does not overwrite existing Google secret', async () => {
  let creates = 0;
  const secrets = { getSecret: async () => ({}), createSecret: async () => { creates++; } };
  await assert.rejects(provision({ db: fakeDb([]), secrets, connectAsRuntime: runtimeLogin(), makePassword: () => goodPassword }), /already exists/);
  assert.equal(creates, 0);
});

test('custody first, then hashed password, then real runtime login; never returns or sends the password', async () => {
  const calls = [];
  const result = await provision({ db: fakeDb(calls), secrets: goodSecrets(calls),
    connectAsRuntime: runtimeLogin(calls), makePassword: () => goodPassword });
  assert.equal(result.verified, true);
  assert.equal(JSON.stringify(result).includes(goodPassword), false);
  assert.deepEqual(calls.slice(1, 4), ['CREATE_SECRET', 'ADD_VERSION', 'READ_VERSION']);
  assert.match(calls[4], /^ALTER ROLE oxkio_v3_runtime PASSWORD 'SCRAM-SHA-256\$4096:[^']+' LOGIN$/);
  assert.equal(calls.some(x => x.includes(goodPassword)), false);
  assert.deepEqual(calls.slice(-2), ['LOGIN:true', 'LOGOUT']);
});

test('does not enable login if Secret Manager returns unexpected payload', async () => {
  const calls = [];
  const secrets = { ...goodSecrets(), accessSecretVersion: async () => [{ payload:{ data:Buffer.from('different') } }] };
  await assert.rejects(provision({ db: fakeDb(calls), secrets, connectAsRuntime: runtimeLogin(), makePassword: () => goodPassword }), /custody verification/);
  assert.equal(calls.some(x => x.startsWith('ALTER ROLE')), false);
});

test('database failure after secret custody requests NOLOGIN rollback', async () => {
  const calls = [];
  await assert.rejects(provision({ db: fakeDb(calls, { failOn: sql => sql.includes(' PASSWORD ') }),
    secrets: goodSecrets(), connectAsRuntime: runtimeLogin(), makePassword: () => goodPassword }), /Database provisioning failed/);
  assert.equal(calls.at(-1), 'ALTER ROLE oxkio_v3_runtime NOLOGIN');
});

test('failed or mismatched runtime login rolls back to NOLOGIN', async () => {
  for (const connectAsRuntime of [async () => { throw new Error('password authentication failed'); },
    runtimeLogin([], 'someone_else')]) {
    const calls = [];
    await assert.rejects(provision({ db: fakeDb(calls), secrets: goodSecrets(), connectAsRuntime,
      makePassword: () => goodPassword }), /Database provisioning failed/);
    assert.equal(calls.at(-1), 'ALTER ROLE oxkio_v3_runtime NOLOGIN');
  }
});

// Real PostgreSQL proof: only with an isolated runner owning a throwaway
// cluster (same convention as postgres-memory-store.pg.test.js).
const port = Number(process.env.OXKIO_V3_TEST_PORT);
const ready = Number.isInteger(port) && port >= 1024 && port <= 65535;
test('real PostgreSQL: non-superuser admin provisions a hashed, login-verified runtime role', { skip: ready ? false : 'isolated local runner required' }, async (t) => {
  const { Client } = require('pg');
  const fs = require('node:fs');
  const path = require('node:path');
  const base = { host:'127.0.0.1', port, database:'oxkio_v3_it' };
  const su = new Client({ ...base, user:'oxkio_v3_test' });
  await su.connect();
  t.after(() => su.end());
  // Neon-like topology: the provisioning admin is CREATEROLE but not superuser.
  await su.query('DROP SCHEMA IF EXISTS oxkio_v3 CASCADE');
  await su.query('DROP ROLE IF EXISTS oxkio_v3_runtime');
  // Idempotent on a reused cluster: a previous run leaves a database grant behind.
  await su.query("DO $$BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='oxkio_neon_like_owner') THEN EXECUTE 'DROP OWNED BY oxkio_neon_like_owner'; END IF; END$$");
  await su.query('DROP ROLE IF EXISTS oxkio_neon_like_owner');
  await su.query('CREATE ROLE oxkio_neon_like_owner LOGIN CREATEROLE');
  await su.query('GRANT CREATE ON DATABASE oxkio_v3_it TO oxkio_neon_like_owner');
  const owner = new Client({ ...base, user:'oxkio_neon_like_owner' });
  await owner.connect();
  t.after(() => owner.end());
  await owner.query('CREATE ROLE oxkio_v3_runtime NOLOGIN');
  await owner.query(fs.readFileSync(path.join(__dirname, '../../backend/repositories/postgres/migrations/006_v3_memory_snapshots.sql'), 'utf8'));
  await owner.query('GRANT USAGE ON SCHEMA oxkio_v3 TO oxkio_v3_runtime');
  await owner.query('GRANT SELECT,INSERT,UPDATE ON oxkio_v3.memory_snapshots TO oxkio_v3_runtime');
  await assert.rejects(owner.query('SELECT 1 FROM pg_authid'), { code:'42501' });
  let custody;
  const secrets = { getSecret: missing, createSecret: async () => {},
    addSecretVersion: async ({ payload }) => { custody = Buffer.from(payload.data); },
    accessSecretVersion: async () => [{ payload:{ data:custody } }] };
  const connectAsRuntime = async (password) => { const c = new Client({ ...base, user:'oxkio_v3_runtime', password }); await c.connect(); return c; };
  const result = await provision({ db: owner, secrets, connectAsRuntime });
  assert.equal(result.verified, true);
  const password = custody.toString('utf8');
  const { rows:[stored] } = await su.query("SELECT rolcanlogin, rolpassword FROM pg_authid WHERE rolname='oxkio_v3_runtime'");
  assert.equal(stored.rolcanlogin, true);
  assert.match(stored.rolpassword, /^SCRAM-SHA-256\$4096:/);
  assert.equal(stored.rolpassword.includes(password), false);
  await assert.rejects(connectAsRuntime('wrong-' + password));
  const runtime = await connectAsRuntime(password);
  try { await assert.rejects(runtime.query('DELETE FROM oxkio_v3.memory_snapshots'), { code:'42501' }); } finally { await runtime.end(); }
  // Interrupted run: custody done, ALTER/login fails -> NOLOGIN; plain rerun refuses; --resume completes it.
  await su.query('ALTER ROLE oxkio_v3_runtime NOLOGIN');
  let held; const store = { getSecret: missing, createSecret: async () => {}, addSecretVersion: async ({ payload }) => { held = Buffer.from(payload.data); store.getSecret = async () => ({}); },
    accessSecretVersion: async () => [{ payload:{ data:held } }] };
  await assert.rejects(provision({ db: owner, secrets: store, connectAsRuntime: async () => { throw new Error('network'); } }), /Database provisioning failed/);
  assert.equal((await su.query("SELECT rolcanlogin FROM pg_roles WHERE rolname='oxkio_v3_runtime'")).rows[0].rolcanlogin, false);
  await assert.rejects(provision({ db: owner, secrets: store, connectAsRuntime }), /already exists/);
  assert.equal((await provision({ db: owner, secrets: store, connectAsRuntime, resume: true })).verified, true);
  const resumed = await connectAsRuntime(held.toString('utf8')); await resumed.end();
  // A second run on a provisioned role refuses: role already LOGIN.
  await assert.rejects(provision({ db: owner, secrets, connectAsRuntime }), /preconditions/);
});

test('resume completes an interrupted run with the custodied password, never creating or adding', async () => {
  const calls = [];
  const secrets = { getSecret: async () => ({}), createSecret: async () => { calls.push('CREATE_SECRET'); },
    addSecretVersion: async () => { calls.push('ADD_VERSION'); },
    accessSecretVersion: async () => [{ payload:{ data:Buffer.from(goodPassword) } }] };
  const result = await provision({ db: fakeDb(calls), secrets, resume: true, connectAsRuntime: runtimeLogin(calls),
    makePassword: () => { throw new Error('must not generate'); } });
  assert.equal(result.verified, true);
  assert.equal(calls.includes('CREATE_SECRET') || calls.includes('ADD_VERSION'), false);
  assert.deepEqual(calls.slice(-2), ['LOGIN:true', 'LOGOUT']);
});

test('resume refuses a missing secret, a non-provisioned payload or a role already LOGIN', async () => {
  await assert.rejects(provision({ db: fakeDb([]), secrets: goodSecrets(), resume: true, connectAsRuntime: runtimeLogin() }), /Nothing to resume/);
  const odd = { getSecret: async () => ({}), accessSecretVersion: async () => [{ payload:{ data:Buffer.from('short') } }] };
  await assert.rejects(provision({ db: fakeDb([]), secrets: odd, resume: true, connectAsRuntime: runtimeLogin() }), /refusing resume/);
  const loginDb = { query: async () => ({ rows:[safeRole(true)] }) };
  await assert.rejects(provision({ db: loginDb, secrets: { getSecret: async () => ({}) }, resume: true, connectAsRuntime: runtimeLogin() }), /preconditions/);
});

// Neon: "Hashed passwords are not supported" -> plaintext over TLS behind a read-only gate.
const { checkPlaintextSafety, ALTER_FROM_GUC_SQL } = require('./provision-v3-pg-secret');
const safeSession = { tls: true, log_statement: 'none', log_min_duration_statement: '-1', log_parameter_max_length_on_error: '0', pgss: false, pgss_track: null };
// Fake that records statement TEXT and bind PARAMETERS separately; the DO block flips LOGIN.
const plaintextDb = (calls, session = safeSession, params = [], { failAlter = false } = {}) => {
  let login = false;
  return { query: async (sql, p) => {
    calls.push(sql); if (p) params.push(...p);
    if (/pg_stat_ssl/.test(sql)) { calls.push('SAFETY_GATE'); return { rows: [session] }; }
    if (sql === ALTER_FROM_GUC_SQL) { if (failAlter) { const e = new Error('oxkio_v3_runtime password change failed'); e.code = '42501'; throw e; } login = true; return { rows: [] }; }
    if (/^ALTER ROLE \S+ NOLOGIN$/.test(sql)) { login = false; return { rows: [] }; }
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql) || sql.startsWith('SELECT set_config')) return { rows: [] };
    return { rows: [safeRole(login)] };
  } };
};

test('plaintext-tls: gate first; the password is only a bind parameter, never statement text', async () => {
  const calls = []; const params = [];
  const result = await provision({ db: plaintextDb(calls, safeSession, params), secrets: goodSecrets(calls), passwordTransport: 'plaintext-tls',
    connectAsRuntime: runtimeLogin(calls), makePassword: () => goodPassword });
  assert.equal(result.verified, true);
  assert.equal(calls.some((x) => x.includes(goodPassword)), false, 'password in statement text');
  assert.ok(params.includes(goodPassword), 'password must travel as a parameter');
  const gate = calls.indexOf('SAFETY_GATE'); const begin = calls.indexOf('BEGIN'); const alter = calls.indexOf(ALTER_FROM_GUC_SQL);
  assert.ok(calls.indexOf('READ_VERSION') < gate && gate < begin && begin < alter && alter < calls.indexOf('COMMIT'), calls.join(' > '));
  assert.match(calls[begin + 1], /^SELECT set_config\(\$1, \$2, true\) IS NOT NULL AS applied$/); // do not echo password in result rows
  assert.deepEqual(calls.slice(-2), ['LOGIN:true', 'LOGOUT']);
});

test('plaintext-tls: the ALTER ROLE is built inside DO and failures are re-raised without the inner SQL', () => {
  assert.match(ALTER_FROM_GUC_SQL, /EXECUTE format\('ALTER ROLE oxkio_v3_runtime PASSWORD %L LOGIN', current_setting\('oxkio\.v3_runtime_password'\)\)/);
  assert.match(ALTER_FROM_GUC_SQL, /EXCEPTION WHEN OTHERS THEN\s+RAISE EXCEPTION 'oxkio_v3_runtime password change failed' USING ERRCODE = SQLSTATE;/);
  assert.doesNotMatch(ALTER_FROM_GUC_SQL, /SQLERRM|\$1/);
});

test('plaintext-tls: a failed ALTER rolls back the transaction, then NOLOGIN, without the password in any statement', async () => {
  const calls = []; const params = [];
  await assert.rejects(provision({ db: plaintextDb(calls, safeSession, params, { failAlter: true }), secrets: goodSecrets(), passwordTransport: 'plaintext-tls',
    connectAsRuntime: runtimeLogin(), makePassword: () => goodPassword }), /Database provisioning failed/);
  assert.equal(calls.some((x) => x.includes(goodPassword)), false);
  assert.deepEqual(calls.slice(-2), ['ROLLBACK', 'ALTER ROLE oxkio_v3_runtime NOLOGIN']);
  assert.equal(calls.includes('COMMIT'), false);
});

test('plaintext-tls: any setting that could record parameters or nested statements aborts before writing', async () => {
  for (const unsafe of [{ tls: false }, { tls: null }, { log_statement: 'ddl' }, { log_statement: 'mod' }, { log_statement: 'all' },
    { log_min_duration_statement: '0' }, { log_parameter_max_length_on_error: '-1' }, { log_parameter_max_length_on_error: '64' },
    { pgss: true, pgss_track: 'all' }]) {
    const calls = [];
    await assert.rejects(provision({ db: plaintextDb(calls, { ...safeSession, ...unsafe }), secrets: goodSecrets(), passwordTransport: 'plaintext-tls',
      connectAsRuntime: runtimeLogin(), makePassword: () => goodPassword }), /not safe on this session/, JSON.stringify(unsafe));
    assert.equal(calls.some((x) => x === 'BEGIN' || x.startsWith('ALTER ROLE') || x === ALTER_FROM_GUC_SQL), false, JSON.stringify(unsafe));
  }
  // Top-level tracking cannot see the nested ALTER; the DO text holds no password.
  for (const track of ['top', 'none']) checkPlaintextSafety({ ...safeSession, pgss: true, pgss_track: track });
});

test('plaintext-tls resume reuses version 1 and default transport stays the SCRAM verifier', async () => {
  const calls = []; const params = [];
  const secrets = { getSecret: async () => ({}), accessSecretVersion: async () => [{ payload:{ data:Buffer.from(goodPassword) } }],
    createSecret: async () => { calls.push('CREATE_SECRET'); }, addSecretVersion: async () => { calls.push('ADD_VERSION'); } };
  await provision({ db: plaintextDb(calls, safeSession, params), secrets, resume: true, passwordTransport: 'plaintext-tls', connectAsRuntime: runtimeLogin(calls) });
  assert.equal(calls.includes('CREATE_SECRET') || calls.includes('ADD_VERSION'), false);
  assert.ok(params.includes(goodPassword) && calls.includes(ALTER_FROM_GUC_SQL));
  await assert.rejects(provision({ db: fakeDb([]), secrets: goodSecrets(), passwordTransport: 'md5', connectAsRuntime: runtimeLogin() }), /Unknown password transport/);
});

const tlsPort = Number(process.env.OXKIO_V3_TEST_TLS_PORT);
test('real PostgreSQL over TLS: gate blocks statement logging, plaintext ALTER then logs in without leaking the password', { skip: Number.isInteger(tlsPort) ? false : 'isolated TLS runner required' }, async (t) => {
  const { Client } = require('pg');
  const fs = require('node:fs');
  const path = require('node:path');
  const base = { host:'127.0.0.1', port: tlsPort, database:'oxkio_v3_it', ssl: { rejectUnauthorized: false } };
  const su = new Client({ ...base, user:'oxkio_v3_test' }); await su.connect();
  // Every session is closed even when an assertion fails (an open client keeps the runner alive).
  const resetDb = () => su.query('ALTER DATABASE oxkio_v3_it RESET ALL');
  const sessions = []; t.after(async () => { await Promise.allSettled(sessions.map((c) => c.end())); await resetDb().catch(() => {}); await su.end(); });
  // A previous interrupted run may have left database-level overrides behind.
  await resetDb();
  await su.query('DROP SCHEMA IF EXISTS oxkio_v3 CASCADE');
  await su.query('DROP ROLE IF EXISTS oxkio_v3_runtime');
  await su.query("DO $$BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='oxkio_neon_like_owner') THEN EXECUTE 'DROP OWNED BY oxkio_neon_like_owner'; END IF; END$$");
  await su.query('DROP ROLE IF EXISTS oxkio_neon_like_owner');
  await su.query('CREATE ROLE oxkio_neon_like_owner LOGIN CREATEROLE');
  await su.query('GRANT CREATE ON DATABASE oxkio_v3_it TO oxkio_neon_like_owner');
  const ownerSession = async () => { const c = new Client({ ...base, user:'oxkio_neon_like_owner' }); sessions.push(c); await c.connect(); return c; };
  let owner = await ownerSession();
  await owner.query('CREATE ROLE oxkio_v3_runtime NOLOGIN');
  await owner.query(fs.readFileSync(path.join(__dirname, '../../backend/repositories/postgres/migrations/006_v3_memory_snapshots.sql'), 'utf8'));
  await owner.query('GRANT USAGE ON SCHEMA oxkio_v3 TO oxkio_v3_runtime');
  await owner.query('GRANT SELECT,INSERT,UPDATE ON oxkio_v3.memory_snapshots TO oxkio_v3_runtime');
  let held; const store = { getSecret: missing, createSecret: async () => {}, accessSecretVersion: async () => [{ payload:{ data:held } }],
    addSecretVersion: async ({ payload }) => { held = Buffer.from(payload.data); store.getSecret = async () => ({}); } };
  const connectAsRuntime = async (password) => { const c = new Client({ ...base, user:'oxkio_v3_runtime', password }); await c.connect(); return c; };
  // The cluster logs every statement: the gate must refuse after custody and before any ALTER.
  await assert.rejects(provision({ db: owner, secrets: store, connectAsRuntime, passwordTransport: 'plaintext-tls' }), /not safe on this session/);
  assert.equal((await su.query("SELECT rolcanlogin FROM pg_roles WHERE rolname='oxkio_v3_runtime'")).rows[0].rolcanlogin, false);
  // Statement logging off (like Neon's default) but error logging at its most verbose:
  // a failing ALTER (owner without ADMIN OPTION) must not leak the password anywhere.
  await su.query("ALTER DATABASE oxkio_v3_it SET log_statement = 'none'");
  await su.query("ALTER DATABASE oxkio_v3_it SET log_min_error_statement = 'debug5'");
  await su.query("ALTER DATABASE oxkio_v3_it SET log_error_verbosity = 'verbose'");
  await su.query('REVOKE ADMIN OPTION FOR oxkio_v3_runtime FROM oxkio_neon_like_owner GRANTED BY oxkio_v3_test');
  owner = await ownerSession();
  await assert.rejects(provision({ db: owner, secrets: store, connectAsRuntime, resume: true, passwordTransport: 'plaintext-tls' }), /Database provisioning failed/);
  assert.equal((await su.query("SELECT rolcanlogin FROM pg_roles WHERE rolname='oxkio_v3_runtime'")).rows[0].rolcanlogin, false);
  await su.query('GRANT oxkio_v3_runtime TO oxkio_neon_like_owner WITH ADMIN OPTION GRANTED BY oxkio_v3_test');
  owner = await ownerSession();
  const result = await provision({ db: owner, secrets: store, connectAsRuntime, resume: true, passwordTransport: 'plaintext-tls' });
  assert.equal(result.verified, true);
  const password = held.toString('utf8');
  const { rows:[stored] } = await su.query("SELECT rolcanlogin, rolpassword FROM pg_authid WHERE rolname='oxkio_v3_runtime'");
  assert.equal(stored.rolcanlogin, true);
  assert.match(stored.rolpassword, /^SCRAM-SHA-256\$/); // the server hashed the plaintext itself
  const runtime = await connectAsRuntime(password); await runtime.end();
  const logDir = process.env.OXKIO_V3_TEST_PG_LOG;
  if (logDir) assert.equal(fs.readFileSync(logDir, 'utf8').includes(password), false, 'password reached the server log');
});

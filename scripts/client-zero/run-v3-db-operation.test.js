'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { runOperation, sanitizePreflight, childEnv, CONFIRM_PROVISION, ADMIN_URL_SECRET } = require('./run-v3-db-operation');

const ADMIN_URL = 'postgresql://neondb_owner:fake-admin-password@ep-fake-123.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';
const PASS = { status: 'DB_PREFLIGHT_PASS_ONLY', role: 'NOLOGIN_LEAST_PRIVILEGE', tls: 'PASS', serverReportedTls: false,
  sessionLoggingGate: 'PASS', loggingBlockers: [], secretManagerVerified: false, provisioningExecuted: false,
  next: 'AUTHORIZED_SAME_SESSION_RECHECK_REQUIRED' };

const secretsWith = (url, calls = []) => ({ accessSecretVersion: async (req) => { calls.push(req.name); return [{ payload: { data: Buffer.from(url) } }]; } });

// Fake child process: records argv and env, answers with scripted stdout/stderr.
function fakeSpawn(script) {
  const calls = [];
  const spawnImpl = (cmd, args, opts) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => {};
    const isProvision = args[0].endsWith('provision-v3-pg-secret.js');
    calls.push({ script: isProvision ? 'provision' : 'preflight', args: args.slice(1), env: opts.env, stdio: opts.stdio });
    const reply = script[isProvision ? 'provision' : 'preflight'];
    setImmediate(() => {
      child.stdout.end(reply.stdout ?? ''); child.stderr.end(reply.stderr ?? '');
      setImmediate(() => child.emit('close', reply.code ?? 0));
    });
    return child;
  };
  return { calls, spawnImpl };
}

test('preflight: the admin URL reaches only the child environment and is never printed', async () => {
  const secretCalls = [];
  const fake = fakeSpawn({ preflight: { stdout: JSON.stringify(PASS) + '\n', stderr: 'error at ' + ADMIN_URL } });
  const source = { PATH: '/usr/bin', GITHUB_TOKEN: 'ghs_fake', ACTIONS_RUNTIME_TOKEN: 'fake', GOOGLE_APPLICATION_CREDENTIALS: '/tmp/creds.json' };
  const result = await runOperation({ operation: 'preflight', secrets: secretsWith(ADMIN_URL, secretCalls), spawnImpl: fake.spawnImpl, source });
  assert.deepEqual(secretCalls, [ADMIN_URL_SECRET]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.report, { operation: 'preflight', preflight: PASS });
  assert.equal(fake.calls.length, 1);
  assert.deepEqual(fake.calls[0].args, ['--read-only']);
  assert.equal(fake.calls[0].env.OXKIO_V3_PG_ADMIN_URL, ADMIN_URL);
  assert.equal(fake.calls[0].env.GITHUB_TOKEN, undefined, 'runner tokens must not reach the child');
  assert.equal(fake.calls[0].env.ACTIONS_RUNTIME_TOKEN, undefined);
  assert.equal(fake.calls[0].env.OXKIO_V3_SECRET_PROVISION_APPROVED, undefined);
  assert.deepEqual(fake.calls[0].stdio, ['ignore', 'pipe', 'pipe']);
  assert.equal(JSON.stringify(result).includes('fake-admin-password'), false);
  assert.equal(JSON.stringify(result).includes('neon.tech'), false);
});

test('provision-resume requires the typed confirmation and a preflight PASS in the same job', async () => {
  for (const confirm of ['', 'yes', CONFIRM_PROVISION.toLowerCase()]) {
    const fake = fakeSpawn({ preflight: { stdout: JSON.stringify(PASS) } });
    const result = await runOperation({ operation: 'provision-resume', confirm, secrets: secretsWith(ADMIN_URL), spawnImpl: fake.spawnImpl });
    assert.equal(result.ok, false);
    assert.equal(result.report.reason, 'confirmation_phrase_required');
    assert.equal(fake.calls.length, 0, 'nothing runs without the phrase');
  }
  const blocked = { ...PASS, status: 'BLOCKED', tls: 'BLOCKED' };
  const fake = fakeSpawn({ preflight: { stdout: JSON.stringify(blocked) } });
  const result = await runOperation({ operation: 'provision-resume', confirm: CONFIRM_PROVISION, secrets: secretsWith(ADMIN_URL), spawnImpl: fake.spawnImpl });
  assert.equal(result.ok, false);
  assert.deepEqual(fake.calls.map((c) => c.script), ['preflight'], 'a BLOCKED preflight never reaches the provisioner');
});

test('provision-resume reuses the existing script with --resume --plaintext-tls and reports only fixed states', async () => {
  const fake = fakeSpawn({ preflight: { stdout: JSON.stringify(PASS) },
    provision: { stdout: 'Verified dedicated role and secret: projects/oxkio-runtime-prod/secrets/OXKIO_V3_PG_PASSWORD\n' } });
  const result = await runOperation({ operation: 'provision-resume', confirm: CONFIRM_PROVISION, secrets: secretsWith(ADMIN_URL), spawnImpl: fake.spawnImpl });
  assert.equal(result.ok, true);
  assert.deepEqual(fake.calls.map((c) => c.script), ['preflight', 'provision']);
  assert.deepEqual(fake.calls[1].args, ['--execute', '--resume', '--plaintext-tls']);
  assert.equal(fake.calls[1].env.OXKIO_V3_SECRET_PROVISION_APPROVED, 'YES');
  assert.equal(result.report.provisioning, 'LOGIN_ENABLED_AND_RUNTIME_LOGIN_VERIFIED');

  const failed = fakeSpawn({ preflight: { stdout: JSON.stringify(PASS) }, provision: { code: 1, stdout: 'leak ' + ADMIN_URL } });
  const bad = await runOperation({ operation: 'provision-resume', confirm: CONFIRM_PROVISION, secrets: secretsWith(ADMIN_URL), spawnImpl: failed.spawnImpl });
  assert.equal(bad.ok, false);
  assert.equal(bad.report.provisioning, 'FAILED_RUNTIME_LEFT_NOLOGIN_BY_SCRIPT');
  assert.equal(JSON.stringify(bad).includes('fake-admin-password'), false);
});

test('unsafe or missing admin URLs fail closed before any child process runs', async () => {
  for (const url of ['', 'postgresql://a:b@ep-x.neon.tech/neondb?sslmode=disable', 'postgresql://a:b@ep-x.neon.tech/neondb?host=evil.example', 'http://x']) {
    const fake = fakeSpawn({ preflight: { stdout: JSON.stringify(PASS) } });
    const result = await runOperation({ operation: 'preflight', secrets: secretsWith(url), spawnImpl: fake.spawnImpl });
    assert.deepEqual(result.report, { status: 'BLOCKED', reason: 'admin_url_unavailable_or_unsafe' });
    assert.equal(fake.calls.length, 0);
  }
  const denied = { accessSecretVersion: async () => { throw new Error('PERMISSION_DENIED on ' + ADMIN_URL_SECRET); } };
  const result = await runOperation({ operation: 'preflight', secrets: denied, spawnImpl: fakeSpawn({}).spawnImpl });
  assert.deepEqual(result.report, { status: 'BLOCKED', reason: 'admin_url_unavailable_or_unsafe' });
  assert.deepEqual((await runOperation({ operation: 'drop', secrets: secretsWith(ADMIN_URL) })).report, { status: 'BLOCKED', reason: 'unknown_operation' });
});

test('preflight output is re-emitted only in its sanitized shape', () => {
  assert.deepEqual(sanitizePreflight(JSON.stringify(PASS)), PASS);
  assert.deepEqual(sanitizePreflight(JSON.stringify({ ...PASS, loggingBlockers: ['log_statement', 'pg_stat_statements.track'] })).loggingBlockers,
    ['log_statement', 'pg_stat_statements.track']);
  for (const tampered of [{ ...PASS, status: ADMIN_URL }, { ...PASS, next: 'see postgresql://x' }, { ...PASS, loggingBlockers: ['all statements'] },
    { ...PASS, tls: undefined }, 'not json', '']) {
    assert.equal(sanitizePreflight(typeof tampered === 'string' ? tampered : JSON.stringify(tampered)), null);
  }
  const env = childEnv(ADMIN_URL, {}, { PATH: 'p', GITHUB_TOKEN: 't', OXKIO_V3_PG_ADMIN_URL: 'stale' });
  assert.deepEqual(Object.keys(env).sort(), ['OXKIO_V3_PG_ADMIN_URL', 'PATH']);
});

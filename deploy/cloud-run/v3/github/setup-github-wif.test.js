'use strict';
// Runs setup-github-wif.sh against a fake gcloud that records every call, so
// the one-time Cloud Shell operation is checked without touching Google Cloud.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, 'setup-github-wif.sh');
const bash = spawnSync('bash', ['--version']).status === 0;
const skip = bash && process.platform !== 'win32' ? false : 'bash with GNU date required';
const ADMIN_URL = 'postgresql://neondb_owner:fake-admin-pw-123@ep-fake-123.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

const FAKE_GCLOUD = `#!/usr/bin/env bash
printf '%s\\x1f' "$@" >> "$FAKE_LOG"; printf '\\n' >> "$FAKE_LOG"
case "$*" in
  *"projects describe"*) echo 123456789012 ;;
  *"secrets versions add"*) cat > "$FAKE_STDIN" ;;
  *"versions list"*) [[ -n "$FAKE_HAS_VERSION" ]] && echo 1 ;;
  *" describe "*|*"describe "*) [[ -n "$FAKE_EXISTS" ]] || exit 1 ;;
esac
exit 0
`;

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxkio-wif-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'gcloud'), FAKE_GCLOUD, { mode: 0o755 });
  return dir;
}

function run(dir, args, { input = '', env = {} } = {}) {
  const log = path.join(dir, 'calls.log'); const stdinFile = path.join(dir, 'stdin.txt');
  fs.writeFileSync(log, '');
  const r = spawnSync('bash', [SCRIPT, ...args], { input, encoding: 'utf8',
    env: { PATH: `${dir}:${process.env.PATH}`, HOME: dir, FAKE_LOG: log, FAKE_STDIN: stdinFile, ...env } });
  const calls = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => l.split('\x1f').filter((x) => x !== ''));
  return { ...r, calls, stdin: fs.existsSync(stdinFile) ? fs.readFileSync(stdinFile, 'utf8') : null };
}

const MUTATING = /^(create|create-oidc|update-oidc|add-iam-policy-binding|remove-iam-policy-binding|delete|enable|disable|add|set-iam-policy)$/;
const mutations = (calls) => calls.filter((c) => c.some((a) => MUTATING.test(a)) && !(c[0] === 'config'));

test('the script parses and rejects unknown modes and windows over 24 h', { skip }, (t) => {
  assert.equal(spawnSync('bash', ['-n', SCRIPT]).status, 0);
  const dir = setup(t);
  assert.equal(run(dir, ['destroy']).status, 64);
  assert.equal(run(dir, ['apply', '--hours', '25']).status, 64);
  assert.equal(run(dir, ['apply', '--hours', '0']).status, 64);
});

test('plan changes nothing and shows the restricted federation', { skip }, (t) => {
  const dir = setup(t);
  const r = run(dir, ['plan']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(mutations(r.calls), [], 'plan executes only reads');
  const out = r.stdout;
  assert.match(out, /MODO PLAN/);
  for (const piece of ["assertion.repository_id == '1239701981'", "assertion.repository_owner_id == '273384467'",
    "assertion.ref == 'refs/heads/main'", "assertion.event_name == 'workflow_dispatch'",
    "assertion.environment == 'oxkio-v3-db' && assertion.workflow_ref == 'xantalal-bit/OXKIO-MASTER-WORKSPACE/.github/workflows/oxkio-v3-db.yml@refs/heads/main'",
    "assertion.environment == 'oxkio-v3-deploy' && assertion.workflow_ref == 'xantalal-bit/OXKIO-MASTER-WORKSPACE/.github/workflows/oxkio-v3-deploy.yml@refs/heads/main'"]) {
    assert.ok(out.includes(piece), piece);
  }
  assert.match(out, /workloadIdentityUser --member=principalSet:\/\/iam\.googleapis\.com\/projects\/123456789012\/locations\/global\/workloadIdentityPools\/oxkio-github\/attribute\.environment\/oxkio-v3-db/);
  assert.match(out, /attribute\.environment\/oxkio-v3-deploy/);
  assert.doesNotMatch(out, /keys create|allUsers|allAuthenticatedUsers|setIamPolicy|roles\/owner|roles\/editor|roles\/run\.admin|secretmanager\.admin/);
  // The Neon admin secret is never granted to the deploy identity, and DB grants always expire.
  for (const line of out.split('\n').filter((l) => l.includes('OXKIO_V3_PG_ADMIN_URL') && l.includes('add-iam-policy-binding'))) {
    assert.match(line, /serviceAccount:oxkio-gha-db@/);
    assert.match(line, /--condition=expression=request\.time < timestamp\("\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ"\)/);
  }
  assert.doesNotMatch(out, /OXKIO_V3_PG_ADMIN_URL[^\n]*oxkio-gha-deploy/);
});

test('apply streams the admin URL over stdin only, with an expiring DB window', { skip }, (t) => {
  const dir = setup(t);
  const before = Date.now();
  const r = run(dir, ['apply', '--hours', '2'], { input: ADMIN_URL + '\n' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdin, ADMIN_URL, 'value delivered to gcloud through stdin');
  const everything = r.stdout + r.stderr + r.calls.flat().join(' ');
  assert.equal(everything.includes('fake-admin-pw-123'), false, 'secret never in argv or output');
  const add = r.calls.find((c) => c.includes('versions') && c.includes('add'));
  assert.ok(add.includes('--data-file=-'));
  const windows = r.calls.filter((c) => c.includes('add-iam-policy-binding') && c.some((a) => a.includes('oxkio-gha-db@')) && c[0] === 'secrets');
  assert.equal(windows.length, 3);
  for (const c of windows) {
    const cond = c.find((a) => a.startsWith('--condition='));
    const until = Date.parse(/timestamp\("([^"]+)"\)/.exec(cond)[1]);
    assert.ok(until > before + 1.9 * 3600e3 && until < before + 2.1 * 3600e3, cond);
  }
  // Window reopening first removes any earlier grant (no accumulation).
  const firstRemove = r.calls.findIndex((c) => c.includes('remove-iam-policy-binding'));
  const firstGrant = r.calls.findIndex((c) => c === windows[0]);
  assert.ok(firstRemove >= 0 && firstRemove < firstGrant);
  assert.equal(r.calls.some((c) => c.includes('keys') && c.includes('create')), false);
});

test('an unsafe admin URL is refused without echo; an existing version is never overwritten', { skip }, (t) => {
  const dir = setup(t);
  for (const bad of ['postgresql://u:fake-admin-pw-123@ep-x.neon.tech/neondb?sslmode=disable', 'postgresql://u:fake-admin-pw-123@evil.example/neondb', 'not a url']) {
    const r = run(dir, ['apply'], { input: bad + '\n' });
    assert.equal(r.status, 66);
    assert.equal(r.stdin, null, 'nothing stored');
    assert.equal((r.stdout + r.stderr).includes('fake-admin-pw-123'), false);
  }
  const r = run(dir, ['apply'], { input: '', env: { FAKE_HAS_VERSION: '1', FAKE_EXISTS: '1' } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdin, null);
  assert.match(r.stdout, /ya tiene una versión habilitada/);
  assert.equal(r.calls.some((c) => c.includes('create') && c.includes('workload-identity-pools') && !c.includes('providers')), false, 'existing pool reused');
  assert.ok(r.calls.some((c) => c.includes('update-oidc')), 'existing provider updated to the exact condition');
});

test('rollback requires the typed confirmation and only disables secret versions', { skip }, (t) => {
  const dir = setup(t);
  const cancelled = run(dir, ['rollback'], { input: 'si\n' });
  assert.equal(cancelled.status, 67);
  assert.deepEqual(mutations(cancelled.calls), []);
  const r = run(dir, ['rollback'], { input: 'REVERTIR\n', env: { FAKE_HAS_VERSION: '1' } });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.calls.some((c) => c.includes('workload-identity-pools') && c.includes('delete')));
  assert.ok(r.calls.some((c) => c.includes('versions') && c.includes('disable')));
  assert.equal(r.calls.some((c) => c.includes('destroy')), false, 'secret versions are never destroyed');
  assert.equal(r.calls.some((c) => c[0] === 'secrets' && c[1] === 'delete'), false);
});

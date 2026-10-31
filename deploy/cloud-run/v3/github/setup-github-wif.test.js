'use strict';
// Runs setup-github-wif.sh against fake gcloud/gh binaries driven by rules, so
// the one-time Cloud Shell operation is checked without touching Google Cloud
// or GitHub: ownership, read-only modes, strict verify and own-only rollback.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, 'setup-github-wif.sh');
const hasTools = process.platform !== 'win32' && spawnSync('bash', ['--version']).status === 0 && spawnSync('python3', ['--version']).status === 0;
const skip = hasTools ? false : 'bash, GNU date and python3 required';
const ADMIN_URL = 'postgresql://neondb_owner:fake-admin-pw-123@ep-fake-123.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';
const NUM = '123456789012';
const P = 'oxkio-runtime-prod';
const DB = `oxkio-gha-db@${P}.iam.gserviceaccount.com`;
const DEPLOY = `oxkio-gha-deploy@${P}.iam.gserviceaccount.com`;
const MARK = 'oxkio-setup-github-wif';
const principal = (env) => `principalSet://iam.googleapis.com/projects/${NUM}/locations/global/workloadIdentityPools/oxkio-github/attribute.environment/${env}`;
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const windowBinding = (role, member, until) => ({ role, members: [member], condition: { title: 'w', expression: `request.time < timestamp("${until}")` } });
const policy = (...bindings) => JSON.stringify({ bindings });

// One fake for both tools: logs every call and answers from FAKE_RULES (first match wins).
const FAKE = `#!/usr/bin/env node
const fs = require('fs'); const path = require('path');
const tool = path.basename(process.argv[1]); const args = process.argv.slice(2); const line = args.join(' ');
const condFile = args.find((a) => a.startsWith('--condition-from-file='));
const cond = condFile ? JSON.parse(fs.readFileSync(condFile.slice('--condition-from-file='.length), 'utf8')) : undefined;
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ tool, args, cond }) + '\\n');
const rules = JSON.parse(fs.readFileSync(process.env.FAKE_RULES, 'utf8'));
let rule = rules.find((r) => (r.tool || 'gcloud') === tool && r.all.every((s) => line.includes(s)));
// stdouts: successive answers of the same rule (e.g. a policy before and after a removal).
if (rule && rule.stdouts) {
  const counter = process.env.FAKE_RULES + '.' + rules.indexOf(rule);
  const n = fs.existsSync(counter) ? Number(fs.readFileSync(counter, 'utf8')) : 0;
  fs.writeFileSync(counter, String(n + 1));
  rule = { ...rule, stdout: rule.stdouts[Math.min(n, rule.stdouts.length - 1)] };
}
if (tool === 'gcloud' && line.includes('versions add')) fs.writeFileSync(process.env.FAKE_STDIN, fs.readFileSync(0, 'utf8'));
if (rule) { if (rule.stdout) process.stdout.write(rule.stdout + '\\n'); process.exit(rule.code || 0); }
if (tool === 'gh') process.exit(1);
process.exit(args.includes('describe') ? 1 : 0);
`;

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oxkio-wif-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const tool of ['gcloud', 'gh']) fs.writeFileSync(path.join(dir, tool), FAKE, { mode: 0o755 });
  return dir;
}

function run(dir, args, { input = '', rules = [] } = {}) {
  const log = path.join(dir, 'calls.log'); const stdinFile = path.join(dir, 'stdin.txt'); const rulesFile = path.join(dir, 'rules.json');
  fs.writeFileSync(log, ''); fs.rmSync(stdinFile, { force: true });
  for (const f of fs.readdirSync(dir).filter((n) => n.startsWith('rules.json.'))) fs.rmSync(path.join(dir, f));
  fs.writeFileSync(rulesFile, JSON.stringify([{ all: ['projects describe'], stdout: NUM }, ...rules]));
  const r = spawnSync('bash', [SCRIPT, ...args], { input, encoding: 'utf8',
    env: { PATH: `${dir}:${process.env.PATH}`, HOME: dir, FAKE_LOG: log, FAKE_STDIN: stdinFile, FAKE_RULES: rulesFile } });
  const calls = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return { ...r, calls, removals: calls.filter((c) => c.tool === 'gcloud' && c.args.includes('remove-iam-policy-binding')),
    gcloud: calls.filter((c) => c.tool === 'gcloud').map((c) => c.args), stdin: fs.existsSync(stdinFile) ? fs.readFileSync(stdinFile, 'utf8') : null };
}

const MUTATING = /^(create|create-oidc|update-oidc|update|add-iam-policy-binding|remove-iam-policy-binding|delete|enable|disable|add|set-iam-policy|set|destroy)$/;
const mutations = (r) => r.gcloud.filter((a) => a.some((x) => MUTATING.test(x)));
const owned = [
  { all: ['service-accounts describe', DB, 'description'], stdout: `${MARK}` },
  { all: ['service-accounts describe', DEPLOY, 'description'], stdout: `${MARK}` },
  { all: ['service-accounts describe'], code: 0 },
  { all: ['providers describe', 'description'], stdout: MARK },
  { all: ['workload-identity-pools describe', 'description'], stdout: MARK },
  { all: ['workload-identity-pools'], code: 0, stdout: '' }
];

function goodState({ dbBindings, deployOnAdmin = false, ghAuthed = true, reviewers = ['xantalal-bit'] } = {}) {
  const until = iso(Date.now() + 3 * 3600e3);
  const plan = run.lastPlanCondition;
  const db = dbBindings ?? {
    OXKIO_V3_PG_ADMIN_URL: [windowBinding('roles/secretmanager.secretAccessor', `serviceAccount:${DB}`, until)],
    OXKIO_V3_PG_PASSWORD: [windowBinding('roles/secretmanager.secretAccessor', `serviceAccount:${DB}`, until),
      windowBinding('roles/secretmanager.viewer', `serviceAccount:${DB}`, until)]
  };
  const metadata = ['OXKIO_APPROVAL_PG_RUNTIME_URL', 'OXKIO_MISSION_PG_RUNTIME_URL', 'OXKIO_REASONING_API_KEY', 'OXKIO_V3_INTEGRITY_KEY',
    'oxkio-google-client-secret', 'oxkio-google-oauth-tokens', 'OXKIO_V3_PG_PASSWORD'];
  const secrets = [...new Set([...metadata, 'OXKIO_V3_PG_ADMIN_URL', 'UNRELATED_SECRET'])];
  const rules = [
    ...owned.slice(0, 3),
    { all: ['providers describe', 'attributeCondition'], stdout: plan },
    ...owned.slice(3),
    { all: ['keys list'], stdout: '' },
    { all: ['service-accounts get-iam-policy', DB], stdout: policy({ role: 'roles/iam.workloadIdentityUser', members: [principal('oxkio-v3-db')] }) },
    { all: ['service-accounts get-iam-policy', DEPLOY], stdout: policy({ role: 'roles/iam.workloadIdentityUser', members: [principal('oxkio-v3-deploy')] }) },
    { all: ['service-accounts get-iam-policy', `oxkio-runtime-prod@${P}`], stdout: policy({ role: 'roles/iam.serviceAccountUser', members: [`serviceAccount:${DEPLOY}`, 'user:jose@example.com'] }) },
    { all: ['projects get-iam-policy'], stdout: policy(...['roles/cloudbuild.builds.editor', 'roles/serviceusage.serviceUsageConsumer', 'roles/logging.viewer', 'roles/iam.securityReviewer', 'roles/run.viewer']
      .map((role) => ({ role, members: [`serviceAccount:${DEPLOY}`] })), { role: 'roles/owner', members: ['user:jose@example.com'] }) },
    { all: ['run services get-iam-policy'], stdout: policy({ role: 'roles/run.developer', members: [`serviceAccount:${DEPLOY}`] }, { role: 'roles/run.invoker', members: [`serviceAccount:${DEPLOY}`] }) },
    { all: ['artifacts repositories get-iam-policy'], stdout: policy({ role: 'roles/artifactregistry.reader', members: [`serviceAccount:${DEPLOY}`] }) },
    { all: ['secrets list'], stdout: secrets.map((s) => `projects/${NUM}/secrets/${s}`).join('\n') },
    ...secrets.map((s) => ({ all: ['secrets get-iam-policy', ` ${s} `], stdout: policy(...(db[s] || []),
      ...(metadata.includes(s) ? [{ role: 'roles/secretmanager.viewer', members: [`serviceAccount:${DEPLOY}`] }] : []),
      ...(deployOnAdmin && s === 'OXKIO_V3_PG_ADMIN_URL' ? [{ role: 'roles/secretmanager.secretAccessor', members: [`serviceAccount:${DEPLOY}`] }] : [])) })),
    { all: ['versions list', 'OXKIO_V3_PG_ADMIN_URL'], stdout: `projects/${NUM}/secrets/OXKIO_V3_PG_ADMIN_URL/versions/1` }
  ];
  if (ghAuthed) {
    const env = { protection_rules: [{ type: 'required_reviewers', reviewers: reviewers.map((login) => ({ reviewer: { login } })) }],
      deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } };
    rules.push({ tool: 'gh', all: ['auth status'] },
      { tool: 'gh', all: ['deployment-branch-policies'], stdout: JSON.stringify({ branch_policies: [{ name: 'main', type: 'branch' }] }) },
      { tool: 'gh', all: ['environments/oxkio-v3-deploy/variables/OXKIO_V3_PG_HOST'], stdout: 'ep-fake-123.eu-central-1.aws.neon.tech' },
      { tool: 'gh', all: ['environments/oxkio-v3-deploy/secrets/OXKIO_V3_OWNER_UID'], stdout: 'OXKIO_V3_OWNER_UID' },
      { tool: 'gh', all: ['environments/'], stdout: JSON.stringify(env) },
      { tool: 'gh', all: ['variables/OXKIO_GCP_WIF_PROVIDER'], stdout: `projects/${NUM}/locations/global/workloadIdentityPools/oxkio-github/providers/oxkio-main` },
      { tool: 'gh', all: ['variables/OXKIO_GCP_DB_SA'], stdout: DB },
      { tool: 'gh', all: ['variables/OXKIO_GCP_DEPLOY_SA'], stdout: DEPLOY });
  }
  return rules;
}

test('the script parses and rejects unknown modes and windows over 24 h', { skip }, (t) => {
  assert.equal(spawnSync('bash', ['-n', SCRIPT]).status, 0);
  const dir = setup(t);
  assert.equal(run(dir, ['destroy']).status, 64);
  assert.equal(run(dir, ['apply', '--hours', '25']).status, 64);
  assert.equal(run(dir, ['apply', '--hours', '0']).status, 64);
});

test('plan only reads (no gcloud config change) and shows the restricted federation', { skip }, (t) => {
  const dir = setup(t);
  const r = run(dir, ['plan']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(mutations(r), [], 'plan executes only reads');
  assert.equal(r.gcloud.some((a) => a[0] === 'config'), false, 'no gcloud config set project');
  const out = r.stdout;
  for (const piece of ["assertion.repository_id == '1239701981'", "assertion.repository_owner_id == '273384467'",
    "assertion.ref == 'refs/heads/main'", "assertion.event_name == 'workflow_dispatch'",
    "assertion.environment == 'oxkio-v3-db' && assertion.workflow_ref == 'xantalal-bit/OXKIO-MASTER-WORKSPACE/.github/workflows/oxkio-v3-db.yml@refs/heads/main'",
    "assertion.environment == 'oxkio-v3-deploy' && assertion.workflow_ref == 'xantalal-bit/OXKIO-MASTER-WORKSPACE/.github/workflows/oxkio-v3-deploy.yml@refs/heads/main'"]) {
    assert.ok(out.includes(piece), piece);
  }
  assert.ok(out.includes(`--member=${principal('oxkio-v3-db')}`) && out.includes(`--member=${principal('oxkio-v3-deploy')}`));
  assert.match(out, new RegExp(`--description=${MARK}`), 'created resources carry the ownership marker');
  assert.match(out, /--labels=oxkio-managed-by=oxkio-setup-github-wif/);
  assert.doesNotMatch(out, /keys create|allUsers|allAuthenticatedUsers|set-iam-policy|roles\/owner|roles\/editor|roles\/run\.admin|secretmanager\.admin/);
  for (const line of out.split('\n').filter((l) => l.includes('OXKIO_V3_PG_ADMIN_URL') && l.includes('add-iam-policy-binding'))) {
    assert.match(line, /serviceAccount:oxkio-gha-db@/);
    assert.match(line, /--condition=expression=request\.time < timestamp\("\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ"\)/);
  }
  run.lastPlanCondition = /--attribute-condition=(.*?) --description=/.exec(out)[1];
});

test('apply refuses pre-existing resources it does not own, before changing anything', { skip }, (t) => {
  const dir = setup(t);
  for (const foreign of [
    [{ all: ['workload-identity-pools describe', 'description'], stdout: 'someone else' }, { all: ['workload-identity-pools describe'] }],
    [{ all: ['providers describe', 'description'], stdout: '' }, { all: ['providers describe'] }, ...owned.slice(3)],
    [{ all: ['service-accounts describe', DEPLOY, 'description'], stdout: 'legacy' }, { all: ['service-accounts describe', DEPLOY] }, ...owned.slice(0, 1), ...owned.slice(3)],
    [{ all: ['service-accounts describe', DB, 'description'], stdout: 'legacy account' }, { all: ['service-accounts describe', DB] }]
  ]) {
    const r = run(dir, ['apply'], { input: ADMIN_URL + '\n', rules: foreign });
    assert.equal(r.status, 68, JSON.stringify(foreign));
    assert.match(r.stderr, /no lo creó este script/);
    assert.deepEqual(mutations(r), [], 'nothing changed, not even an API');
    assert.equal(r.stdin, null);
  }
});

test('apply streams the admin URL over stdin only, records the version it created and opens an expiring window', { skip }, (t) => {
  const dir = setup(t);
  const before = Date.now();
  const r = run(dir, ['apply', '--hours', '2'], { input: ADMIN_URL + '\n', rules: [
    { all: ['secrets describe', 'annotations.oxkio-setup-versions'], stdout: '1' },
    { all: ['versions add'], stdout: `projects/${NUM}/secrets/OXKIO_V3_PG_ADMIN_URL/versions/3` },
    { all: ['secrets describe'], code: 0 }, ...owned] });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdin, ADMIN_URL, 'value delivered to gcloud through stdin');
  assert.equal((r.stdout + r.stderr + JSON.stringify(r.calls)).includes('fake-admin-pw-123'), false, 'secret never in argv or output');
  assert.ok(r.gcloud.some((a) => a.includes('update') && a.includes('--update-annotations=oxkio-setup-versions=1,3')), 'own version recorded');
  const windows = r.gcloud.filter((a) => a[0] === 'secrets' && a.includes('add-iam-policy-binding') && a.some((x) => x.includes('oxkio-gha-db@')));
  assert.equal(windows.length, 3);
  for (const a of windows) {
    const until = Date.parse(/timestamp\("([^"]+)"\)/.exec(a.find((x) => x.startsWith('--condition=')))[1]);
    assert.ok(until > before + 1.9 * 3600e3 && until < before + 2.1 * 3600e3);
  }
  assert.ok(r.gcloud.findIndex((a) => a.includes('remove-iam-policy-binding')) < r.gcloud.findIndex((a) => a === windows[0]), 'old windows removed first');
  assert.equal(r.gcloud.some((a) => a[0] === 'config' || (a.includes('keys') && a.includes('create'))), false);
});

test('an unsafe admin URL is refused without echo; an existing version is never overwritten nor adopted', { skip }, (t) => {
  const dir = setup(t);
  for (const bad of ['postgresql://u:fake-admin-pw-123@ep-x.neon.tech/neondb?sslmode=disable', 'postgresql://u:fake-admin-pw-123@evil.example/neondb', 'not a url']) {
    const r = run(dir, ['apply'], { input: bad + '\n' });
    assert.equal(r.status, 66);
    assert.equal(r.stdin, null);
    assert.equal((r.stdout + r.stderr).includes('fake-admin-pw-123'), false);
  }
  const r = run(dir, ['apply'], { rules: [{ all: ['versions list'], stdout: '1' }, { all: ['secrets describe'], code: 0 }, ...owned] });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdin, null);
  assert.equal(r.gcloud.some((a) => a.some((x) => x.startsWith('--update-annotations'))), false, 'a pre-existing version is not recorded as own');
  assert.ok(r.gcloud.some((a) => a.includes('update-oidc')), 'own provider updated to the exact condition');
});

test('verify only reads and passes on the complete, correct state', { skip }, (t) => {
  const dir = setup(t);
  const r = run(dir, ['verify'], { rules: goodState() });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /VERIFY: PASS/);
  assert.doesNotMatch(r.stdout, /^FAIL/m);
  assert.deepEqual(mutations(r), []);
  assert.equal(r.gcloud.some((a) => a[0] === 'config'), false);
  assert.equal(r.calls.filter((c) => c.tool === 'gh').some((c) => c.args.some((a) => /^-X$|--method|PUT|POST|DELETE|PATCH/.test(a))), false, 'gh only reads');
  assert.match(r.stdout, /Pendiente fuera de verify/);
});

test('verify fails without an active window, with expired or unconditional grants and with alternative permissions', { skip }, (t) => {
  const dir = setup(t);
  const past = iso(Date.now() - 60e3); const far = iso(Date.now() + 48 * 3600e3); const soon = iso(Date.now() + 3600e3);
  const cases = [
    ['no grants at all (window closed)', goodState({ dbBindings: {} }), /FAIL  ventana DB no vigente/],
    ['expired window', goodState({ dbBindings: { OXKIO_V3_PG_ADMIN_URL: [windowBinding('roles/secretmanager.secretAccessor', `serviceAccount:${DB}`, past)],
      OXKIO_V3_PG_PASSWORD: [windowBinding('roles/secretmanager.secretAccessor', `serviceAccount:${DB}`, past), windowBinding('roles/secretmanager.viewer', `serviceAccount:${DB}`, past)] } }), /FAIL  ventana DB no vigente/],
    ['window longer than 24 h', goodState({ dbBindings: { OXKIO_V3_PG_ADMIN_URL: [windowBinding('roles/secretmanager.secretAccessor', `serviceAccount:${DB}`, far)],
      OXKIO_V3_PG_PASSWORD: [windowBinding('roles/secretmanager.secretAccessor', `serviceAccount:${DB}`, soon), windowBinding('roles/secretmanager.viewer', `serviceAccount:${DB}`, soon)] } }), /FAIL  ventana DB no vigente/],
    ['unconditional grant', goodState({ dbBindings: { OXKIO_V3_PG_ADMIN_URL: [{ role: 'roles/secretmanager.secretAccessor', members: [`serviceAccount:${DB}`] }],
      OXKIO_V3_PG_PASSWORD: [windowBinding('roles/secretmanager.secretAccessor', `serviceAccount:${DB}`, soon), windowBinding('roles/secretmanager.viewer', `serviceAccount:${DB}`, soon)] } }), /FAIL  ventana DB no vigente/],
    ['DB identity on another secret', goodState({ dbBindings: { OXKIO_V3_PG_ADMIN_URL: [windowBinding('roles/secretmanager.secretAccessor', `serviceAccount:${DB}`, soon)],
      OXKIO_V3_PG_PASSWORD: [windowBinding('roles/secretmanager.secretAccessor', `serviceAccount:${DB}`, soon), windowBinding('roles/secretmanager.viewer', `serviceAccount:${DB}`, soon)],
      UNRELATED_SECRET: [windowBinding('roles/secretmanager.secretAccessor', `serviceAccount:${DB}`, soon)] } }), /FAIL  oxkio-gha-db@[^\n]*exactamente los 3 permisos/],
    ['deploy identity can read the Neon admin URL', goodState({ deployOnAdmin: true }), /FAIL  oxkio-gha-deploy@[^\n]*solo metadatos/],
    ['GitHub not verifiable', goodState({ ghAuthed: false }), /FAIL  GitHub no verificable/],
    ['environment without the required reviewer', goodState({ reviewers: [] }), /FAIL  entorno oxkio-v3-db: revisor obligatorio/]
  ];
  for (const [label, rules, expected] of cases) {
    const r = run(dir, ['verify'], { rules });
    assert.equal(r.status, 1, label);
    assert.match(r.stdout, expected, label);
    assert.match(r.stdout, /VERIFY: FAIL/, label);
    assert.deepEqual(mutations(r), [], label);
  }
});

test('rollback reverts only own resources and only the secret versions this script added', { skip }, (t) => {
  const dir = setup(t);
  const cancelled = run(dir, ['rollback'], { input: 'si\n', rules: owned });
  assert.equal(cancelled.status, 67);
  assert.deepEqual(mutations(cancelled), []);

  // Own accounts and provider; a pre-existing pool without the marker; version 1 pre-existing, 3 own.
  const r = run(dir, ['rollback'], { input: 'REVERTIR\n', rules: [
    { all: ['workload-identity-pools describe', 'description'], stdout: 'created by someone else' },
    { all: ['secrets describe', 'annotations.oxkio-setup-versions'], stdout: '3' },
    { all: ['versions list'], stdout: '1\n3' }, ...owned] });
  assert.equal(r.status, 0, r.stderr);
  const disabled = r.gcloud.filter((a) => a.includes('versions') && a.includes('disable')).map((a) => a[a.indexOf('disable') + 1]);
  assert.deepEqual(disabled, ['3'], 'only the version this script added');
  assert.equal(r.gcloud.some((a) => a.includes('destroy') || (a[0] === 'secrets' && a[1] === 'delete')), false);
  assert.ok(r.gcloud.some((a) => a.includes('service-accounts') && a.includes('delete') && a.includes(DB)));
  assert.ok(r.gcloud.some((a) => a.includes('providers') && a.includes('delete')));
  assert.equal(r.gcloud.some((a) => a[1] === 'workload-identity-pools' && a[2] === 'delete'), false, 'foreign pool untouched');
  assert.match(r.stdout, /pool oxkio-github no es propio/);

  // Nothing owned at all: no change of any kind.
  const none = run(dir, ['rollback'], { input: 'REVERTIR\n', rules: [{ all: ['describe', 'description'], stdout: 'legacy' }, { all: ['describe'] }] });
  assert.equal(none.status, 0, none.stderr);
  assert.deepEqual(mutations(none), []);
});

// ---------------------------------------------------------------- DB window closing (regression)
// gcloud refuses `remove-iam-policy-binding --all` on conditional policies in non-interactive
// mode; the old close hid that error and reported the window as closed while it stayed open.
const ACC = 'roles/secretmanager.secretAccessor';
const VIEW = 'roles/secretmanager.viewer';
const TITLE = 'oxkio-db-window-20261031T091954Z';
const win = (role, title = TITLE) => ({ role, members: [`serviceAccount:${DB}`],
  condition: { expression: `request.time < timestamp("${iso(Date.now() + 3600e3)}")`, title, description: 'Temporary GitHub DB window' } });
const RUNTIME_MEMBER = `serviceAccount:oxkio-runtime-prod@${P}.iam.gserviceaccount.com`;
const FOREIGN_PG = [{ role: ACC, members: [RUNTIME_MEMBER] }, { role: VIEW, members: [`serviceAccount:${DEPLOY}`] }];
const OPEN_ADMIN = policy(win(ACC));
const OPEN_PG = policy(win(ACC), win(VIEW), ...FOREIGN_PG);
const CLOSED_ADMIN = JSON.stringify({ etag: 'ACAB' });
const CLOSED_PG = policy(...FOREIGN_PG);
const secretPolicies = (admin, pg) => [
  { all: ['secrets get-iam-policy', ' OXKIO_V3_PG_ADMIN_URL '], stdouts: admin },
  { all: ['secrets get-iam-policy', ' OXKIO_V3_PG_PASSWORD '], stdouts: pg }];
const removalOf = (c) => ({ secret: c.args[2], role: c.args.find((a) => a.startsWith('--role=')).slice(7),
  member: c.args.find((a) => a.startsWith('--member=')).slice(9), cond: c.cond });

test('close-db-window removes each window grant by its exact condition and verifies nothing remains', { skip }, (t) => {
  const dir = setup(t);
  const r = run(dir, ['close-db-window'], { rules: [...secretPolicies([OPEN_ADMIN, CLOSED_ADMIN], [OPEN_PG, CLOSED_PG]), ...owned] });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Ventana DB cerrada \(verificado/);
  const removed = r.removals.map(removalOf);
  assert.deepEqual(removed.map((x) => `${x.secret} ${x.role}`).sort(),
    [`OXKIO_V3_PG_ADMIN_URL ${ACC}`, `OXKIO_V3_PG_PASSWORD ${ACC}`, `OXKIO_V3_PG_PASSWORD ${VIEW}`]);
  for (const x of removed) {
    assert.equal(x.member, `serviceAccount:${DB}`, 'only the DB identity is touched');
    assert.equal(x.cond.title, TITLE);
    assert.match(x.cond.expression, /^request\.time < timestamp\("[^"]+"\)$/, 'exact condition, quotes intact');
  }
  assert.equal(r.gcloud.some((a) => a.includes('--all')), false, 'no --all');
});

test('close-db-window is idempotent: an already closed window changes nothing and passes', { skip }, (t) => {
  const dir = setup(t);
  for (let i = 0; i < 2; i += 1) {
    const r = run(dir, ['close-db-window'], { rules: [...secretPolicies([CLOSED_ADMIN], [CLOSED_PG]), ...owned] });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.removals, []);
    assert.match(r.stdout, /Ventana DB cerrada/);
  }
});

test('close-db-window preserves grants it did not create and then fails instead of reporting closed', { skip }, (t) => {
  const dir = setup(t);
  const manual = { role: ACC, members: [`serviceAccount:${DB}`] };
  const otherCondition = win(VIEW, 'manual-grant');
  const before = policy(win(ACC), manual, otherCondition, { role: ACC, members: [RUNTIME_MEMBER] });
  const after = policy(manual, otherCondition, { role: ACC, members: [RUNTIME_MEMBER] });
  const r = run(dir, ['close-db-window'], { rules: [...secretPolicies([before, after], [CLOSED_PG]), ...owned] });
  assert.equal(r.status, 70);
  assert.deepEqual(r.removals.map(removalOf).map((x) => [x.secret, x.role, x.cond.title]), [['OXKIO_V3_PG_ADMIN_URL', ACC, TITLE]],
    'only the window grant is removed; unconditional, foreign-condition and other principals untouched');
  assert.match(r.stderr, /conserva roles\/secretmanager\.secretAccessor, concesión no creada por open-db-window/);
  assert.match(r.stderr, /conserva roles\/secretmanager\.viewer, concesión no creada por open-db-window/);
  assert.doesNotMatch(r.stdout, /Ventana DB cerrada/);
});

test('close-db-window fails on removal errors, unreadable policies and grants that survive a removal', { skip }, (t) => {
  const dir = setup(t);
  const cases = [
    ['removal refused', [{ all: ['remove-iam-policy-binding'], code: 1 }, ...secretPolicies([OPEN_ADMIN], [OPEN_PG])], /no se pudo retirar la concesión de ventana/],
    ['policy unreadable', [{ all: ['secrets get-iam-policy'], code: 1 }], /no se pudo leer la política IAM/],
    ['grant still present after a reported success', secretPolicies([OPEN_ADMIN], [OPEN_PG]), /conserva roles\/secretmanager\.secretAccessor \(ventana\)/]
  ];
  for (const [label, rules, expected] of cases) {
    const r = run(dir, ['close-db-window'], { rules: [...rules, ...owned] });
    assert.equal(r.status, 70, label);
    assert.match(r.stderr, expected, label);
    assert.match(r.stderr, /CIERRE: FAIL/, label);
    assert.doesNotMatch(r.stdout, /Ventana DB cerrada/, label);
  }
});

test('open-db-window reopens without accumulation and never opens over a window it cannot close', { skip }, (t) => {
  const dir = setup(t);
  const r = run(dir, ['open-db-window', '--hours', '4'], { rules: [...secretPolicies([OPEN_ADMIN, CLOSED_ADMIN], [OPEN_PG, CLOSED_PG]), ...owned] });
  assert.equal(r.status, 0, r.stderr);
  const idx = (pred) => r.calls.map((c, i) => (pred(c) ? i : -1)).filter((i) => i >= 0);
  const removals = idx((c) => c.args.includes('remove-iam-policy-binding'));
  const adds = idx((c) => c.args.includes('add-iam-policy-binding'));
  assert.equal(removals.length, 3, 'previous window removed by exact condition');
  assert.equal(adds.length, 3, 'exactly the three new grants');
  assert.ok(Math.max(...removals) < Math.min(...adds), 'old window gone before the new one is added');

  const blocked = run(dir, ['open-db-window', '--hours', '4'], { rules: [{ all: ['remove-iam-policy-binding'], code: 1 },
    ...secretPolicies([OPEN_ADMIN], [OPEN_PG]), ...owned] });
  assert.equal(blocked.status, 70);
  assert.match(blocked.stderr, /no se abre otra/);
  assert.equal(blocked.gcloud.some((a) => a.includes('add-iam-policy-binding')), false, 'no new grant on top of an open window');
});

test('rollback does not delete the DB identity while its window cannot be closed', { skip }, (t) => {
  const dir = setup(t);
  const r = run(dir, ['rollback'], { input: 'REVERTIR\n', rules: [{ all: ['remove-iam-policy-binding'], code: 1 },
    ...secretPolicies([OPEN_ADMIN], [OPEN_PG]), ...owned] });
  assert.equal(r.status, 70);
  assert.match(r.stderr, /no se elimina/);
  assert.equal(r.gcloud.some((a) => a.includes('service-accounts') && a.includes('delete')), false);
});

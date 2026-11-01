'use strict';
// Static guarantees of the GitHub Actions path (the repository and its logs are
// public) plus the Windows self-test of the CI wrapper that reuses the existing
// Cloud Run PowerShell procedure.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const YAML = require('yaml');

const root = path.join(__dirname, '..', '..', '..', '..');
const WORKFLOWS = {
  'oxkio-v3-db.yml': { environment: 'oxkio-v3-db', sa: 'OXKIO_GCP_DB_SA', phrases: ['ACTIVAR-LOGIN-oxkio_v3_runtime'] },
  'oxkio-v3-deploy.yml': { environment: 'oxkio-v3-deploy', sa: 'OXKIO_GCP_DEPLOY_SA', phrases: ['CREAR-REVISION-PRIVADA', 'QUITAR-ETIQUETA', 'CREAR-REVISION-PRIVADA-CON-RAZONAMIENTO'] }
};
const read = (file) => fs.readFileSync(path.join(root, '.github/workflows', file), 'utf8');

for (const [file, spec] of Object.entries(WORKFLOWS)) {
  test(`${file}: manual only, least privilege, protected environment, no secret exposure`, () => {
    const text = read(file);
    const wf = YAML.parse(text);
    assert.deepEqual(Object.keys(wf.on), ['workflow_dispatch'], 'manual trigger only');
    assert.deepEqual(wf.permissions, {}, 'no default token permissions');
    assert.equal(wf.concurrency['cancel-in-progress'], false);

    const jobs = Object.entries(wf.jobs);
    const guarded = jobs.filter(([, job]) => job.environment);
    assert.equal(guarded.length, 1);
    const [, main] = guarded[0];
    assert.equal(main.environment, spec.environment);
    assert.equal(main.needs, 'guard');
    assert.deepEqual(main.permissions, { contents: 'read', 'id-token': 'write' });
    for (const [name, job] of jobs) {
      assert.ok(job.permissions, `${name} declares its permissions`);
      if (!job.environment) assert.equal(job.permissions['id-token'], undefined, `${name} cannot mint OIDC tokens`);
    }

    const guardRun = wf.jobs.guard.steps.map((s) => s.run || '').join('\n');
    assert.match(guardRun, /refs\/heads\/main/);
    assert.match(guardRun, new RegExp(`environments/${spec.environment}`));
    assert.match(guardRun, /required_reviewers/);
    assert.match(guardRun, /custom_branch_policies == true/);
    for (const phrase of spec.phrases) assert.ok(guardRun.includes(phrase), phrase);

    const steps = jobs.flatMap(([, job]) => job.steps);
    for (const step of steps) {
      // Inputs and secrets reach scripts only through env, never interpolated into code.
      if (step.run) assert.doesNotMatch(step.run, /\$\{\{/, `script injection risk in: ${step.name}`);
      if (step.uses) assert.match(step.uses, /^(actions\/(checkout|setup-node)@v4|google-github-actions\/(auth|setup-gcloud)@v2)$/, step.uses);
      if (step.uses?.startsWith('actions/checkout')) assert.equal(step.with['persist-credentials'], false);
    }
    const auth = steps.find((s) => s.uses?.startsWith('google-github-actions/auth'));
    assert.equal(auth.with.workload_identity_provider, '${{ vars.OXKIO_GCP_WIF_PROVIDER }}');
    assert.equal(auth.with.service_account, `\${{ vars.${spec.sa} }}`);
    assert.equal(auth.with.credentials_json, undefined, 'no service account keys');

    assert.doesNotMatch(text, /upload-artifact|set -x|ACTIONS_STEP_DEBUG|ACTIONS_RUNNER_DEBUG|pull_request|add-mask|GITHUB_ENV|GITHUB_OUTPUT/);
    const secretRefs = [...text.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1]);
    assert.deepEqual(secretRefs, file === 'oxkio-v3-deploy.yml' ? ['OXKIO_V3_OWNER_UID'] : []);
  });
}

test('the federation condition in the Cloud Shell setup matches these workflow files and environments', () => {
  const setup = fs.readFileSync(path.join(__dirname, 'setup-github-wif.sh'), 'utf8');
  for (const [file, spec] of Object.entries(WORKFLOWS)) {
    assert.ok(fs.existsSync(path.join(root, '.github/workflows', file)));
    assert.ok(setup.includes(`.github/workflows/${file}`), file);
    assert.ok(setup.includes(`"${spec.environment}"`), spec.environment);
  }
  assert.match(setup, /REPO_ID="1239701981"/);
  assert.match(setup, /REPO_OWNER_ID="273384467"/);
});

test('the DB workflow reuses the existing scripts and the deploy workflow the existing Cloud Run procedure', () => {
  assert.match(read('oxkio-v3-db.yml'), /node scripts\/client-zero\/run-v3-db-operation\.js "\$OPERATION"/);
  const wrapper = fs.readFileSync(path.join(root, 'deploy/cloud-run/v3/ci/Invoke-OxkioV3CloudCi.ps1'), 'utf8');
  assert.match(wrapper, /\. \(Join-Path \$PSScriptRoot '\.\.\\Invoke-OxkioV3CloudRevision\.ps1'\) -Mode Validate -Variant Real/);
  assert.match(read('oxkio-v3-deploy.yml'), /Invoke-OxkioV3CloudCi\.ps1 -Operation/);
  assert.doesNotMatch(wrapper, /add-iam-policy-binding|set-iam-policy|allUsers/, 'the deploy path never changes exposure');
  // Run 41219259414: with WIF, gcloud cannot mint audience ID tokens; the wrapper does STS + generateIdToken
  // for the deploy account the workflow names, and no code line calls print-identity-token.
  const deployStep = YAML.parse(read('oxkio-v3-deploy.yml')).jobs.deploy.steps.find((s) => s.shell === 'pwsh');
  assert.equal(deployStep.env.OXKIO_GCP_DEPLOY_SA, '${{ vars.OXKIO_GCP_DEPLOY_SA }}');
  const code = wrapper.split(/\r?\n/).filter((l) => !/^\s*#/.test(l)).join('\n');
  assert.doesNotMatch(code, /print-identity-token/);
  assert.match(code, /:generateIdToken"/);
  assert.match(code, /https:\/\/sts\.googleapis\.com\/v1\/token/);
});

// Issue #85: V3 reasoning is an explicit, separately confirmed choice; off by default.
test('the deploy workflow keeps V3 reasoning off unless chosen with its own confirmation phrase', () => {
  const wf = YAML.parse(read('oxkio-v3-deploy.yml'));
  const input = wf.on.workflow_dispatch.inputs.reasoning;
  assert.equal(input.type, 'choice');
  assert.deepEqual(input.options, ['off', 'internal-egress']);
  assert.equal(input.default, 'off');
  const guard = wf.jobs.guard.steps.map((s) => s.run || '').join('\n');
  assert.equal(wf.jobs.guard.steps.find((s) => s.run).env.REASONING, '${{ inputs.reasoning }}');
  assert.match(guard, /if \[ "\$REASONING" = "internal-egress" \]; then\s+test "\$CONFIRM" = "CREAR-REVISION-PRIVADA-CON-RAZONAMIENTO"/);
  assert.match(guard, /off\|internal-egress\) ;;\s+\*\) echo "Modo de razonamiento no admitido"; exit 1 ;;/);
  assert.match(guard, /remove-tag\)\s+test "\$REASONING" = "off"/);
  const deployStep = wf.jobs.deploy.steps.find((s) => s.shell === 'pwsh');
  assert.equal(deployStep.env.OXKIO_V3_REASONING_MODE, '${{ inputs.reasoning }}');
  // Issue #86: the serving revision is a repository variable, changed only after an authorized promotion.
  assert.equal(deployStep.env.OXKIO_V3_SERVING_REVISION, '${{ vars.OXKIO_V3_SERVING_REVISION }}');
  const wrapper = fs.readFileSync(path.join(root, 'deploy/cloud-run/v3/ci/Invoke-OxkioV3CloudCi.ps1'), 'utf8');
  assert.match(wrapper, /if\(\[string\]\$env:OXKIO_V3_SERVING_REVISION\)\{ \$ciServing\.ServingRevision=/);
  assert.match(wrapper, /'internal-egress' \{'InternalEgress'\} default \{ throw 'OXKIO_V3_REASONING_MODE invalido' \}/);
  assert.match(wrapper, /-V3Reasoning \$ciReasoning/);
  const script = fs.readFileSync(path.join(root, 'deploy/cloud-run/v3/Invoke-OxkioV3CloudRevision.ps1'), 'utf8');
  assert.match(script, /\[ValidateSet\('Off','InternalEgress'\)\]\[string\]\$V3Reasoning='Off'/);
  assert.match(script, /OXKIO_V3_REASONING_BASE_URL='https:\/\/eu\.api\.openai\.com\/v1'/);
  assert.doesNotMatch(script, /OXKIO_V3_REASONING_CONFIDENTIAL|OXKIO_V3_REASONING_API_KEY=/);
});

const shell = ['pwsh', 'powershell'].find((s) => spawnSync(s, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major']).status === 0);
test('CI wrapper self-test: reused functions load and the public summary drops identities', { skip: shell ? false : 'PowerShell not available' }, () => {
  const r = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-File', path.join(root, 'deploy/cloud-run/v3/ci/Invoke-OxkioV3CloudCi.ps1'), '-Operation', 'SelfTest'],
    { encoding: 'utf8', env: { ...process.env, OXKIO_V3_OWNER_UID: '', GITHUB_STEP_SUMMARY: '' } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /SELFTEST OK/);
});

'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repositoryRoot = path.resolve(__dirname, '..', '..');
const scriptPath = path.join(repositoryRoot, 'scripts', 'Start-Oxkio.ps1');
const batPath = path.join(repositoryRoot, 'scripts', 'INICIAR_OXKIO.bat');
const packagePath = path.join(repositoryRoot, 'package.json');
const gitignorePath = path.join(repositoryRoot, '.gitignore');
const serverPath = path.join(repositoryRoot, 'backend', 'api', 'server.js');
const runtimeFiles = [
  path.join(repositoryRoot, 'backend', 'auth', 'googleTokens.json'),
  path.join(repositoryRoot, 'backend', 'core', 'approvalQueue.json'),
  path.join(repositoryRoot, 'backend', 'memory', 'memory.json'),
];
const initialRuntimeHashes = new Map(runtimeFiles.map((file) => [file, hashFile(file)]));
const powershellProbe = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-Command', 'exit 0']);
const powershellSpawnBlocked = powershellProbe.error && powershellProbe.error.code === 'EPERM';

function hashFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function setEnvironmentValue(environment, name, value) {
  Object.keys(environment)
    .filter((key) => key.toLowerCase() === name.toLowerCase())
    .forEach((key) => delete environment[key]);
  if (value !== undefined) environment[name] = value;
}

function runValidation({ credential = {}, environment = {}, missingCredential = false } = {}) {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'oxkio-firebase-startup-'));
  const marker = crypto.randomUUID();
  const values = {
    projectId: `project-${marker}`,
    uid: `uid-${marker}`,
    clientEmail: `client-${marker}@example.test`,
    privateKey: `private-key-${marker}`,
  };
  const credentialPath = path.join(temporaryDirectory, `credential-${marker}.json`);
  const baseCredential = {
    type: 'service_account',
    project_id: values.projectId,
    client_email: values.clientEmail,
    private_key: values.privateKey,
  };
  if (!missingCredential) {
    const body = Object.hasOwn(credential, 'raw')
      ? credential.raw
      : JSON.stringify({ ...baseCredential, ...credential });
    fs.writeFileSync(credentialPath, body, 'utf8');
  }

  const childEnvironment = { ...process.env };
  setEnvironmentValue(childEnvironment, 'GOOGLE_APPLICATION_CREDENTIALS', credentialPath);
  setEnvironmentValue(childEnvironment, 'FIREBASE_PROJECT_ID', values.projectId);
  setEnvironmentValue(childEnvironment, 'OXKIO_ADMIN_FIREBASE_UIDS', values.uid);
  Object.entries(environment).forEach(([name, value]) => {
    setEnvironmentValue(childEnvironment, name, value);
  });

  const result = spawnSync('powershell.exe', [
    '-NoLogo',
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    scriptPath,
    '-ValidateOnly',
  ], {
    cwd: os.tmpdir(),
    env: childEnvironment,
    encoding: 'utf8',
  });

  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  return {
    ...result,
    output: `${result.stdout || ''}${result.stderr || ''}`,
    values: { ...values, credentialPath },
  };
}

function assertSensitiveValuesHidden(result) {
  Object.values(result.values).forEach((value) => {
    assert.equal(result.output.includes(value), false);
  });
}

test('standard Node start remains portable while Windows validation stays available', () => {
  assert.equal(fs.existsSync(scriptPath), true);
  const script = fs.readFileSync(scriptPath, 'utf8');
  const bat = fs.readFileSync(batPath, 'utf8');
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

  assert.match(script, /param\([\s\S]*\[switch\]\$ValidateOnly/);
  assert.match(script, /\$PSScriptRoot/);
  assert.doesNotMatch(script, /[A-Z]:\\Users\\/i);
  assert.match(script, /GOOGLE_APPLICATION_CREDENTIALS/);
  assert.match(script, /FIREBASE_PROJECT_ID/);
  assert.match(script, /OXKIO_ADMIN_FIREBASE_UIDS/);
  assert.match(script, /function Resolve-OxkioEnvironmentVariable/);
  assert.match(script, /GetEnvironmentVariable\(\$Name, 'Process'\)/);
  assert.match(script, /GetEnvironmentVariable\(\$Name, 'User'\)/);
  assert.match(script, /SetEnvironmentVariable\(\$Name, \$userValue, 'Process'\)/);
  assert.doesNotMatch(script, /SetEnvironmentVariable\([^\r\n]+,\s*'(?:User|Machine)'\s*\)/);
  assert.doesNotMatch(script, /dotenv|\.env/i);
  assert.ok(
    script.indexOf("GetEnvironmentVariable($Name, 'Process')")
      < script.indexOf("GetEnvironmentVariable($Name, 'User')")
  );
  assert.match(script, /if \(-not \[string\]::IsNullOrWhiteSpace\(\$processValue\)\) \{\s*return \$processValue/);
  assert.match(script, /Variable \$Name ausente en proceso y usuario/);
  assert.match(script, /foreach \(\$variableName in \$requiredVariables\) \{\s*\$variableValue = Resolve-OxkioEnvironmentVariable -Name \$variableName/);
  assert.doesNotMatch(script, /FIREBASE_PRIVATE_KEY|FIREBASE_CLIENT_EMAIL/);
  assert.match(script, /Test-Path -LiteralPath \$credentialPath -PathType Leaf/);
  assert.match(script, /ConvertFrom-Json/);
  assert.match(script, /\$credential\.type -ne 'service_account'/);
  assert.match(script, /@\('project_id', 'client_email', 'private_key'\)/);
  assert.match(script, /\[string\]\$credential\.project_id -cne \$configuredProject/);
  assert.match(script, /\$adminUids\.Split\(','\)/);
  assert.ok(script.indexOf('if ($ValidateOnly)') < script.indexOf('& $nodeCommand.Source $serverPath'));
  assert.ok(
    script.indexOf("SetEnvironmentVariable($Name, $userValue, 'Process')")
      < script.indexOf('& $nodeCommand.Source $serverPath')
  );
  assert.match(bat, /"%~dp0Start-Oxkio\.ps1" %\*/);
  assert.doesNotMatch(bat, /[A-Z]:\\Users\\/i);
  assert.equal(packageJson.scripts.start, 'node backend/api/server.js');
  assert.equal(
    packageJson.scripts['start:windows'],
    'powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File ./scripts/Start-Oxkio.ps1',
  );
});

test('gitignore contains only the agreed Firebase startup additions', () => {
  const lines = fs.readFileSync(gitignorePath, 'utf8').split(/\r?\n/);
  for (const pattern of [
    '.env.local',
    '.env.*.local',
    '**/*firebase-adminsdk*.json',
    '**/firebase-admin-service-account*.json',
  ]) {
    assert.equal(lines.filter((line) => line === pattern).length, 1);
  }
});

test('ValidateOnly accepts a complete simulated configuration from an unrelated CWD', (t) => {
  if (powershellSpawnBlocked) {
    t.skip('El sandbox no permite spawnSync de powershell.exe.');
    return;
  }
  const result = runValidation();
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /Configuracion Firebase Admin validada/);
  assert.doesNotMatch(result.output, /recuperada desde la configuracion de usuario/);
  assert.doesNotMatch(result.output, /Oxkio System V2 iniciado|Servidor OXKIO iniciado/i);
  assertSensitiveValuesHidden(result);
});

test('approved variables share Process-first, User-fallback, fail-closed resolution', () => {
  const script = fs.readFileSync(scriptPath, 'utf8');
  const requiredVariables = script.match(/\$requiredVariables = @\(([\s\S]*?)\)/)[1];
  for (const name of [
    'GOOGLE_APPLICATION_CREDENTIALS',
    'FIREBASE_PROJECT_ID',
    'OXKIO_ADMIN_FIREBASE_UIDS',
  ]) {
    assert.match(requiredVariables, new RegExp(`'${name}'`));
  }
  assert.match(script, /\$Name -notin \$allowedNames/);
  assert.match(script, /\$userValue = \[Environment\]::GetEnvironmentVariable\(\$Name, 'User'\)/);
  assert.match(script, /if \(\[string\]::IsNullOrWhiteSpace\(\$userValue\)\) \{\s*Stop-Validation "Variable \$Name ausente en proceso y usuario\." \$null/);
});

test('ValidateOnly rejects missing, unreadable-format, and invalid credential contracts', async (t) => {
  if (powershellSpawnBlocked) {
    t.skip('El sandbox no permite spawnSync de powershell.exe.');
    return;
  }
  const cases = [
    ['missing file', { missingCredential: true }],
    ['invalid JSON', { credential: { raw: '{invalid' } }],
    ['wrong type', { credential: { type: 'authorized_user' } }],
    ['missing project_id', { credential: { project_id: '' } }],
    ['missing client_email', { credential: { client_email: '' } }],
    ['missing private_key', { credential: { private_key: '' } }],
    ['project mismatch', { credential: { project_id: 'different-project' } }],
  ];
  for (const [name, options] of cases) {
    await t.test(name, () => {
      const result = runValidation(options);
      assert.notEqual(result.status, 0);
      assertSensitiveValuesHidden(result);
    });
  }
});

test('production execution remains disabled', () => {
  const server = fs.readFileSync(serverPath, 'utf8');
  assert.match(server, /executionEnabled:\s*false/);
  assert.match(server, /draftExecutionEnabled:\s*true/);
  assert.doesNotMatch(server, /executionEnabled:\s*true/);
});

test.after(() => {
  runtimeFiles.forEach((file) => {
    assert.equal(hashFile(file), initialRuntimeHashes.get(file));
  });
});

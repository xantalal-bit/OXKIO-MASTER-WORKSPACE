'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');
const test = require('node:test');

const repositoryRoot = path.resolve(__dirname, '..', '..');
const scriptPath = path.join(repositoryRoot, 'scripts', 'Start-Oxkio.ps1');
const batPath = path.join(repositoryRoot, 'scripts', 'INICIAR_OXKIO.bat');
const packagePath = path.join(repositoryRoot, 'package.json');
const gitignorePath = path.join(repositoryRoot, '.gitignore');
const serverPath = path.join(repositoryRoot, 'backend', 'api', 'server.js');

function createMinimalChildEnvironment() {
  const environment = {};
  for (const expectedName of [
    'PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP',
  ]) {
    const actualName = Object.keys(process.env)
      .find((name) => name.toLowerCase() === expectedName.toLowerCase());
    if (actualName) environment[actualName] = process.env[actualName];
  }
  return environment;
}

function snapshotSyntheticFile(file) {
  const stat = fs.statSync(file);
  return {
    hash: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
    size: stat.size,
    mtimeMs: stat.mtimeMs,
  };
}

function createSyntheticRepository(temporaryDirectory, marker, { serverScript } = {}) {
  const syntheticRoot = path.join(temporaryDirectory, 'synthetic-repository');
  const syntheticScript = path.join(syntheticRoot, 'scripts', 'Start-Oxkio.ps1');
  const protectedStores = [
    ['backend/auth/googleTokens.json', `synthetic-token-store-${marker}`],
    ['backend/core/approvalQueue.json', `synthetic-approval-store-${marker}`],
    ['backend/memory/memory.json', `synthetic-memory-store-${marker}`],
  ];

  fs.mkdirSync(path.dirname(syntheticScript), { recursive: true });
  fs.copyFileSync(scriptPath, syntheticScript);
  fs.mkdirSync(path.join(syntheticRoot, 'backend', 'api'), { recursive: true });
  fs.writeFileSync(
    path.join(syntheticRoot, 'backend', 'api', 'server.js'),
    serverScript || '// synthetic server sentinel\n',
  );
  fs.mkdirSync(path.join(syntheticRoot, 'node_modules', 'firebase-admin'), { recursive: true });
  fs.writeFileSync(
    path.join(syntheticRoot, 'node_modules', 'firebase-admin', 'package.json'),
    JSON.stringify({ name: 'firebase-admin' }),
  );

  const storeFiles = protectedStores.map(([relativePath, contents]) => {
    const file = path.join(syntheticRoot, ...relativePath.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents, 'utf8');
    return { file, contents };
  });

  return { syntheticScript, storeFiles };
}

function runAclCommand(args) {
  const result = spawnSync('icacls.exe', args, {
    env: createMinimalChildEnvironment(),
    encoding: 'utf8',
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Synthetic ACL operation failed: ${result.error && result.error.code || result.status}.`);
  }
}

function currentUserSid() {
  const result = spawnSync('powershell.exe', [
    '-NoLogo',
    '-NoProfile',
    '-Command',
    '[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value',
  ], {
    env: createMinimalChildEnvironment(),
    encoding: 'utf8',
  });
  const sid = String(result.stdout || '').trim();
  if (result.error || result.status !== 0 || !/^S-\d(?:-\d+)+$/.test(sid)) {
    throw new Error('Current Windows SID is unavailable for the synthetic ACL test.');
  }
  return sid;
}

function denySyntheticStoreReads(storeFiles) {
  const sid = currentUserSid();
  const denied = [];

  function restore() {
    const failures = [];
    for (const { file } of denied.reverse()) {
      try {
        runAclCommand([file, '/remove:d', `*${sid}`]);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) throw failures[0];
  }

  try {
    for (const store of storeFiles) {
      runAclCommand([store.file, '/deny', `*${sid}:(R)`]);
      denied.push(store);
    }
    for (const { file } of storeFiles) {
      assert.throws(
        () => fs.readFileSync(file),
        (error) => error && ['EACCES', 'EPERM'].includes(error.code),
      );
    }
  } catch (error) {
    restore();
    throw error;
  }

  return restore;
}

function createSyntheticGcloud(temporaryDirectory) {
  const directory = path.join(temporaryDirectory, 'synthetic-gcloud');
  fs.mkdirSync(directory, { recursive: true });
  const gcloudScript = path.join(directory, 'gcloud.cmd');
  fs.writeFileSync(gcloudScript, [
    '@echo off',
    'if not "%OXKIO_TEST_GCLOUD_LOG%"=="" echo %* >> "%OXKIO_TEST_GCLOUD_LOG%"',
    '<nul set /p "=%OXKIO_TEST_GCLOUD_SECRET_VALUE%"',
    'echo.',
    'exit /b %OXKIO_TEST_GCLOUD_EXIT_CODE%',
    '',
  ].join('\r\n'), 'utf8');
  return directory;
}

function findEnvironmentValue(environment, name) {
  const key = Object.keys(environment).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key ? environment[key] : undefined;
}

function buildGcloudControlledEnvironment(gcloudDirectory) {
  const environment = createMinimalChildEnvironment();
  const windowsRoot = findEnvironmentValue(environment, 'SystemRoot')
    || findEnvironmentValue(environment, 'windir')
    || path.join(`C:${path.sep}`, 'Windows');
  const curatedEntries = [
    path.dirname(process.execPath),
    path.join(windowsRoot, 'System32'),
    path.join(windowsRoot, 'System32', 'WindowsPowerShell', 'v1.0'),
  ];
  if (gcloudDirectory) curatedEntries.unshift(gcloudDirectory);
  setEnvironmentValue(environment, 'PATH', curatedEntries.join(';'));
  return environment;
}

const powershellProbe = spawnSync(
  'powershell.exe',
  ['-NoLogo', '-NoProfile', '-Command', 'exit 0'],
  { env: createMinimalChildEnvironment() },
);
const powershellSpawnBlocked = powershellProbe.error && powershellProbe.error.code === 'EPERM';

function setEnvironmentValue(environment, name, value) {
  Object.keys(environment)
    .filter((key) => key.toLowerCase() === name.toLowerCase())
    .forEach((key) => delete environment[key]);
  if (value !== undefined) environment[name] = value;
}

function prepareSyntheticLaunch({
  credential = {}, environment = {}, missingCredential = false, gcloud = {}, serverScript,
} = {}) {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'oxkio-firebase-startup-'));
  const marker = crypto.randomUUID();
  const syntheticRepository = createSyntheticRepository(temporaryDirectory, marker, { serverScript });
  const protectedBefore = syntheticRepository.storeFiles.map(({ file }) => snapshotSyntheticFile(file));
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

  const gcloudOptions = {
    present: true,
    exitCode: 0,
    secretValue: `postgresql://synthetic:synthetic@example.invalid/neondb-${marker}`,
    ...gcloud,
  };
  const gcloudDirectory = gcloudOptions.present ? createSyntheticGcloud(temporaryDirectory) : null;
  const gcloudLogPath = path.join(temporaryDirectory, 'gcloud-invocations.log');

  const childEnvironment = buildGcloudControlledEnvironment(gcloudDirectory);
  setEnvironmentValue(childEnvironment, 'GOOGLE_APPLICATION_CREDENTIALS', credentialPath);
  setEnvironmentValue(childEnvironment, 'FIREBASE_PROJECT_ID', values.projectId);
  setEnvironmentValue(childEnvironment, 'OXKIO_ADMIN_FIREBASE_UIDS', values.uid);
  setEnvironmentValue(childEnvironment, 'OXKIO_TEST_GCLOUD_LOG', gcloudLogPath);
  setEnvironmentValue(childEnvironment, 'OXKIO_TEST_GCLOUD_EXIT_CODE', String(gcloudOptions.exitCode));
  setEnvironmentValue(childEnvironment, 'OXKIO_TEST_GCLOUD_SECRET_VALUE', gcloudOptions.secretValue || '');
  Object.entries(environment).forEach(([name, value]) => {
    setEnvironmentValue(childEnvironment, name, value);
  });

  return {
    temporaryDirectory,
    syntheticRepository,
    protectedBefore,
    values,
    credentialPath,
    gcloudOptions,
    gcloudLogPath,
    childEnvironment,
  };
}

function runValidation({
  credential = {}, environment = {}, missingCredential = false, gcloud = {},
  validateOnly = true, serverScript,
} = {}) {
  const prepared = prepareSyntheticLaunch({
    credential, environment, missingCredential, gcloud, serverScript,
  });
  const {
    temporaryDirectory, syntheticRepository, protectedBefore, values, credentialPath,
    gcloudOptions, gcloudLogPath, childEnvironment,
  } = prepared;
  try {
    const powershellArguments = [
      '-NoLogo',
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      syntheticRepository.syntheticScript,
    ];
    if (validateOnly) powershellArguments.push('-ValidateOnly');

    const restoreReads = denySyntheticStoreReads(syntheticRepository.storeFiles);
    let result;
    try {
      result = spawnSync('powershell.exe', powershellArguments, {
        cwd: os.tmpdir(),
        env: childEnvironment,
        encoding: 'utf8',
      });
    } finally {
      restoreReads();
    }

    const protectedAfter = syntheticRepository.storeFiles.map(({ file }) => snapshotSyntheticFile(file));
    const secretValueIsMeaningful = Boolean(gcloudOptions.secretValue && gcloudOptions.secretValue.trim());
    return {
      ...result,
      output: `${result.stdout || ''}${result.stderr || ''}`,
      gcloudInvocations: fs.existsSync(gcloudLogPath) ? fs.readFileSync(gcloudLogPath, 'utf8') : '',
      values: {
        ...values,
        credentialPath,
        ...(secretValueIsMeaningful ? { approvalPgRuntimeUrl: gcloudOptions.secretValue } : {}),
        ...Object.fromEntries(
          syntheticRepository.storeFiles.map(({ contents }, index) => [`storeMarker${index}`, contents]),
        ),
      },
      protectedStoresUntouched: JSON.stringify(protectedBefore) === JSON.stringify(protectedAfter),
    };
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

async function waitUntil(conditionFn, { timeoutMs = 15000, intervalMs = 200 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (conditionFn()) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => { setTimeout(resolve, intervalMs); });
  }
}

function isProcessAlive(pid) {
  const check = spawnSync('powershell.exe', [
    '-NoLogo',
    '-NoProfile',
    '-Command',
    `[bool](Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}" -ErrorAction SilentlyContinue)`,
  ], { env: createMinimalChildEnvironment(), encoding: 'utf8' });
  return String(check.stdout || '').trim() === 'True';
}

function assertSensitiveValuesHidden(result) {
  assert.equal(result.protectedStoresUntouched, true);
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
  for (const protectedStore of ['googleTokens.json', 'approvalQueue.json', 'memory.json']) {
    assert.doesNotMatch(script, new RegExp(protectedStore.replace('.', '\\.')));
  }
  assert.ok(
    script.indexOf("SetEnvironmentVariable($Name, $userValue, 'Process')")
      < script.indexOf('Start-Process -FilePath $nodeCommand.Source')
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
  assert.match(result.output, /Configuracion Firebase Admin y selector Approval PostgreSQL validados/);
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

test('Approval selector fija postgres exclusivamente en Process, sin persistir PG-APR en el resolver', () => {
  const script = fs.readFileSync(scriptPath, 'utf8');

  assert.match(script, /SetEnvironmentVariable\('OXKIO_APPROVAL_REPOSITORY_BACKEND',\s*'postgres',\s*'Process'\)/);

  const allowedNames = script.match(/\$allowedNames = @\(([\s\S]*?)\)/)[1];
  assert.doesNotMatch(allowedNames, /OXKIO_APPROVAL_PG_RUNTIME_URL/);
  assert.doesNotMatch(allowedNames, /OXKIO_APPROVAL_REPOSITORY_BACKEND/);

  const requiredVariables = script.match(/\$requiredVariables = @\(([\s\S]*?)\)/)[1];
  assert.doesNotMatch(requiredVariables, /OXKIO_APPROVAL_PG_RUNTIME_URL/);
  assert.doesNotMatch(requiredVariables, /OXKIO_APPROVAL_REPOSITORY_BACKEND/);

  assert.match(script, /function Resolve-OxkioGcloudCommand/);
  assert.match(script, /Get-Command -Name 'gcloud\.cmd' -CommandType Application/);
  assert.match(script, /function Get-OxkioApprovalPostgresRuntimeUrl/);
  assert.match(script, /--secret=OXKIO_APPROVAL_PG_RUNTIME_URL/);
  assert.match(script, /--project=oxkio-runtime-prod/);
  assert.match(script, /SetEnvironmentVariable\('OXKIO_APPROVAL_PG_RUNTIME_URL',\s*\$approvalPgRuntimeUrl,\s*'Process'\)/);
  assert.ok(
    script.indexOf("SetEnvironmentVariable('OXKIO_APPROVAL_PG_RUNTIME_URL'")
      < script.indexOf('if ($ValidateOnly)')
  );
});

test('Node lifecycle controls only its own child process, not a generic node.exe kill', () => {
  const script = fs.readFileSync(scriptPath, 'utf8');

  assert.match(script, /Start-Process -FilePath \$nodeCommand\.Source -ArgumentList @\(\$serverPath\) -NoNewWindow -PassThru/);
  assert.match(script, /\$null = \$nodeProcess\.Handle/);
  assert.ok(
    script.indexOf('Start-Process -FilePath $nodeCommand.Source') < script.indexOf('$null = $nodeProcess.Handle'),
  );
  assert.match(script, /\$nodeProcess\.WaitForExit\(\)/);
  assert.match(script, /\$nodeExitCode = \$nodeProcess\.ExitCode/);
  assert.match(script, /if \(\$nodeProcess -and -not \$nodeProcess\.HasExited\)/);
  assert.match(script, /Stop-Process -Id \$nodeProcess\.Id -Force/);
  assert.doesNotMatch(script, /Stop-Process[^\r\n]*-Name/i);
  assert.doesNotMatch(script, /taskkill/i);
  assert.doesNotMatch(script, /Get-Process\s+node/i);
  assert.ok(script.indexOf('if ($ValidateOnly)') < script.indexOf('Start-Process -FilePath $nodeCommand.Source'));
});

test('Windows Job Object (kill-on-close) protege al proceso Node ante terminacion externa del launcher', () => {
  const script = fs.readFileSync(scriptPath, 'utf8');

  assert.match(script, /CreateJobObject/);
  assert.match(script, /SetInformationJobObject/);
  assert.match(script, /AssignProcessToJobObject/);
  assert.match(script, /CloseHandle/);
  assert.match(script, /\$JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000/);
  assert.match(script, /JOBOBJECT_EXTENDED_LIMIT_INFORMATION/);
  assert.match(script, /JOBOBJECT_BASIC_LIMIT_INFORMATION/);

  assert.doesNotMatch(script, /\$extendedLimitInformation\.BasicLimitInformation\.LimitFlags\s*=/);
  assert.match(script, /\$basicLimitInformation = New-Object OxkioNodeJobObjectNative\+JOBOBJECT_BASIC_LIMIT_INFORMATION/);
  assert.match(script, /\$basicLimitInformation\.LimitFlags = \$JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE/);
  assert.match(script, /\$extendedLimitInformation\.BasicLimitInformation = \$basicLimitInformation/);

  assert.ok(
    script.indexOf('New-OxkioNodeContainmentJob') < script.indexOf('Start-Process -FilePath $nodeCommand.Source'),
    'el Job Object debe crearse antes de lanzar el proceso Node',
  );
  assert.ok(
    script.indexOf('$null = $nodeProcess.Handle') < script.indexOf('AssignProcessToJobObject($nodeJobHandle'),
    'la asignacion al Job Object debe ocurrir inmediatamente tras obtener el Handle',
  );
  assert.ok(
    script.indexOf('AssignProcessToJobObject($nodeJobHandle') < script.indexOf('$nodeProcess.WaitForExit()'),
    'el proceso debe quedar contenido en el Job Object antes de esperar su finalizacion',
  );

  assert.match(script, /if \(-not \$assigned\) \{/);
  assert.ok(
    script.indexOf('if (-not $assigned)') < script.indexOf("Stop-Validation 'No se pudo asignar el proceso Node al Job Object"),
    'un fallo de asignacion debe limpiar el proceso Node antes de abortar',
  );
  assert.ok(
    script.indexOf('if (-not $nodeProcess.HasExited)') < script.indexOf("Stop-Validation 'No se pudo asignar el proceso Node al Job Object")
      && script.indexOf('Stop-Process -Id $nodeProcess.Id -Force -ErrorAction SilentlyContinue')
        < script.indexOf("Stop-Validation 'No se pudo asignar el proceso Node al Job Object"),
    'el cleanup del PID hijo debe ocurrir antes de abortar por fallo de asignacion',
  );

  assert.match(script, /if \(\$jobHandle -eq \[IntPtr\]::Zero\) \{\s*Stop-Validation 'No se pudo crear el Job Object de contencion del proceso Node\.' \$null/);
  assert.match(script, /if \(-not \$configured\) \{\s*\[OxkioNodeJobObjectNative\]::CloseHandle\(\$jobHandle\) \| Out-Null\s*Stop-Validation 'No se pudo configurar JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE en el Job Object\.' \$null/);
  assert.ok(
    script.indexOf('return $jobHandle') < script.indexOf('$nodeProcess = Start-Process -FilePath $nodeCommand.Source'),
    'Node nunca debe arrancar antes de que el Job Object este creado y configurado con exito',
  );

  assert.match(script, /if \(\$nodeJobHandle -ne \[IntPtr\]::Zero\) \{\s*\[OxkioNodeJobObjectNative\]::CloseHandle\(\$nodeJobHandle\) \| Out-Null/);

  assert.doesNotMatch(script, /Stop-Process[^\r\n]*-Name/i);
  assert.doesNotMatch(script, /taskkill/i);
  assert.doesNotMatch(script, /Get-Process\s+node/i);
});

test('Node lifecycle (dinamico, finalizacion normal): el launcher crea exactamente un hijo Node sintetico, lo espera, propaga su exit code y el PID deja de existir', (t) => {
  if (powershellSpawnBlocked) {
    t.skip('El sandbox no permite spawnSync de powershell.exe.');
    return;
  }

  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'oxkio-lifecycle-normal-'));
  try {
    const pidMarkerPath = path.join(temporaryDirectory, 'child-pid.txt');
    const expectedExitCode = 42;
    const serverScript = [
      "'use strict';",
      "const fs = require('fs');",
      "fs.writeFileSync(process.env.OXKIO_TEST_CHILD_PID_MARKER, String(process.pid), 'utf8');",
      'process.exit(Number(process.env.OXKIO_TEST_CHILD_EXIT_CODE));',
      '',
    ].join('\n');

    const result = runValidation({
      validateOnly: false,
      serverScript,
      environment: {
        OXKIO_TEST_CHILD_PID_MARKER: pidMarkerPath,
        OXKIO_TEST_CHILD_EXIT_CODE: String(expectedExitCode),
      },
    });

    assert.equal(result.error, undefined);
    assert.equal(result.status, expectedExitCode, result.output);

    const pidAnnouncement = result.output.match(/Proceso Node iniciado \(PID (\d+)\)/);
    assert.ok(pidAnnouncement, result.output);
    assert.equal(fs.existsSync(pidMarkerPath), true);
    const childPidFromMarker = Number(fs.readFileSync(pidMarkerPath, 'utf8').trim());
    assert.ok(Number.isInteger(childPidFromMarker) && childPidFromMarker > 0);
    assert.equal(Number(pidAnnouncement[1]), childPidFromMarker);

    const aliveCheck = spawnSync('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-Command',
      `[bool](Get-Process -Id ${childPidFromMarker} -ErrorAction SilentlyContinue)`,
    ], { env: createMinimalChildEnvironment(), encoding: 'utf8' });
    assert.equal(String(aliveCheck.stdout || '').trim(), 'False');

    assertSensitiveValuesHidden(result);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test('Job Object (dinamico, terminacion forzada): el hijo Node muere automaticamente cuando el launcher desaparece, sin kill explicito del hijo', async (t) => {
  if (powershellSpawnBlocked) {
    t.skip('El sandbox no permite spawnSync de powershell.exe.');
    return;
  }

  const markerDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'oxkio-lifecycle-forced-'));
  const pidMarkerPath = path.join(markerDirectory, 'child-pid.txt');
  const longRunningServerScript = [
    "'use strict';",
    "const fs = require('fs');",
    "fs.writeFileSync(process.env.OXKIO_TEST_CHILD_PID_MARKER, String(process.pid), 'utf8');",
    'setInterval(() => {}, 60 * 60 * 1000);',
    '',
  ].join('\n');

  const prepared = prepareSyntheticLaunch({
    serverScript: longRunningServerScript,
    environment: { OXKIO_TEST_CHILD_PID_MARKER: pidMarkerPath },
  });

  let launcherChild = null;
  let launcherPid = null;
  let childPid = null;
  try {
    const powershellArguments = [
      '-NoLogo',
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      prepared.syntheticRepository.syntheticScript,
    ];

    launcherChild = spawn('powershell.exe', powershellArguments, {
      cwd: os.tmpdir(),
      env: prepared.childEnvironment,
    });
    launcherPid = launcherChild.pid;
    assert.ok(Number.isInteger(launcherPid) && launcherPid > 0);

    const childAppeared = await waitUntil(() => fs.existsSync(pidMarkerPath), { timeoutMs: 20000, intervalMs: 200 });
    assert.equal(childAppeared, true, 'el hijo Node sintetico nunca escribio su PID marcador a tiempo');

    childPid = Number(fs.readFileSync(pidMarkerPath, 'utf8').trim());
    assert.ok(Number.isInteger(childPid) && childPid > 0);
    assert.notEqual(childPid, launcherPid, 'el PID del hijo Node debe ser distinto del PID del launcher');

    const childAliveBefore = await waitUntil(() => isProcessAlive(childPid), { timeoutMs: 5000, intervalMs: 200 });
    assert.equal(childAliveBefore, true, 'el hijo Node sintetico deberia seguir vivo antes de terminar el launcher');

    const killResult = spawnSync('powershell.exe', [
      '-NoLogo', '-NoProfile', '-Command', `Stop-Process -Id ${launcherPid} -Force`,
    ], { env: createMinimalChildEnvironment(), encoding: 'utf8' });
    assert.equal(killResult.status, 0, killResult.stderr || killResult.stdout);

    const childGone = await waitUntil(() => !isProcessAlive(childPid), { timeoutMs: 10000, intervalMs: 250 });
    assert.equal(
      childGone,
      true,
      `el proceso hijo Node (PID ${childPid}) seguia vivo tras terminar el launcher (PID ${launcherPid}) por Stop-Process -Force; `
        + 'el Job Object no lo contuvo como se esperaba.',
    );
  } finally {
    if (childPid && isProcessAlive(childPid)) {
      spawnSync('powershell.exe', [
        '-NoLogo', '-NoProfile', '-Command', `Stop-Process -Id ${childPid} -Force -ErrorAction SilentlyContinue`,
      ], { env: createMinimalChildEnvironment(), encoding: 'utf8' });
    }
    if (launcherPid && isProcessAlive(launcherPid)) {
      spawnSync('powershell.exe', [
        '-NoLogo', '-NoProfile', '-Command', `Stop-Process -Id ${launcherPid} -Force -ErrorAction SilentlyContinue`,
      ], { env: createMinimalChildEnvironment(), encoding: 'utf8' });
    }
    if (launcherChild && launcherChild.exitCode === null && !launcherChild.killed) {
      try { launcherChild.kill(); } catch { /* already gone */ }
    }
    fs.rmSync(markerDirectory, { recursive: true, force: true });
    fs.rmSync(prepared.temporaryDirectory, { recursive: true, force: true });
  }
});

test('ValidateOnly resuelve el selector Approval postgres con Secret Manager sintetico y oculta el secreto', (t) => {
  if (powershellSpawnBlocked) {
    t.skip('El sandbox no permite spawnSync de powershell.exe.');
    return;
  }
  const result = runValidation();
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /selector Approval PostgreSQL validados/);
  assert.match(result.gcloudInvocations, /--secret=OXKIO_APPROVAL_PG_RUNTIME_URL/);
  assert.match(result.gcloudInvocations, /--project=oxkio-runtime-prod/);
  assertSensitiveValuesHidden(result);
});

test('ValidateOnly falla cerrado si gcloud.cmd no esta disponible', (t) => {
  if (powershellSpawnBlocked) {
    t.skip('El sandbox no permite spawnSync de powershell.exe.');
    return;
  }
  const result = runValidation({ gcloud: { present: false } });
  assert.notEqual(result.status, 0);
  assert.match(result.output, /gcloud\.cmd no disponible/);
  assertSensitiveValuesHidden(result);
});

test('ValidateOnly falla cerrado si gcloud.cmd devuelve un codigo de salida distinto de cero', (t) => {
  if (powershellSpawnBlocked) {
    t.skip('El sandbox no permite spawnSync de powershell.exe.');
    return;
  }
  const result = runValidation({ gcloud: { exitCode: 1, secretValue: '' } });
  assert.notEqual(result.status, 0);
  assert.match(result.output, /No se pudo obtener OXKIO_APPROVAL_PG_RUNTIME_URL/);
  assertSensitiveValuesHidden(result);
});

test('ValidateOnly falla cerrado si el secreto de Secret Manager esta vacio o en blanco', async (t) => {
  if (powershellSpawnBlocked) {
    t.skip('El sandbox no permite spawnSync de powershell.exe.');
    return;
  }
  const cases = [
    ['cadena vacia', ''],
    ['solo espacios en blanco', '   '],
  ];
  for (const [name, secretValue] of cases) {
    await t.test(name, () => {
      const result = runValidation({ gcloud: { exitCode: 0, secretValue } });
      assert.notEqual(result.status, 0);
      assert.match(result.output, /vacio en Secret Manager/);
      assertSensitiveValuesHidden(result);
    });
  }
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

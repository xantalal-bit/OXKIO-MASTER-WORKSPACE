'use strict';

// 5C.7B.6B.3E — Tests focales OFFLINE del runner de backup.
//
// Ninguna prueba de este archivo conecta con Neon, ejecuta `pg_dump`
// real ni crea ningun secreto. El unico "secreto" que existe es una
// credencial sintetica sobre el TLD reservado `.invalid`, generada
// localmente para los tests. `resolveApprovalCatalog` es siempre un
// doble en memoria: ninguna consulta a un catalogo real ocurre aqui.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  MODE_EXECUTE,
  MODE_VALIDATE_ONLY,
  composeBackupRequest,
  defaultScope,
  main,
  parseArgs,
  runExecute,
  runValidateOnly,
  toSafeRunnerFailure,
} = require('./backup-runner');
const { SCOPE_MODE_OWNER_RESOLVED } = require('./pg-dump-wrapper');
const { EXPECTED_APPROVAL_TABLES } = require('./approval-domain-manifest');

const SYNTHETIC_PASSWORD = 'synthetic-runner-pw-0000';

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'oxkio-6b3e-'));
const fakePgDumpPath = path.join(workspace, 'fake-pg_dump.exe');
fs.writeFileSync(fakePgDumpPath, 'not a real binary');

test.after(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

const observedOutputs = [];
function observe(value) {
  observedOutputs.push(typeof value === 'string' ? value : JSON.stringify(value));
  return value;
}

const probe18 = () => 'pg_dump (PostgreSQL) 18.6\n';

function neverRun() {
  return async () => {
    throw new Error('runProcess must not be invoked from validate-only.');
  };
}

function createFakeRunner(behaviour) {
  const calls = [];
  return {
    calls,
    async run(invocation) {
      calls.push(invocation);
      return behaviour ? behaviour(invocation) : { exitCode: 0, signal: null, stdout: '', stderr: '' };
    },
  };
}

function fakeSecretProvider(overrides = {}) {
  return {
    async getBackupCredential() {
      return {
        host: 'ep-runner-synthetic.db.example.invalid',
        port: 5432,
        database: 'oxkio',
        user: 'pg-bkp-login-synthetic',
        password: SYNTHETIC_PASSWORD,
        ...overrides,
      };
    },
  };
}

function matchingCatalogResolver() {
  return async ({ owner }) => EXPECTED_APPROVAL_TABLES.map((table) => ({ table, owner }));
}

function baseOptions(overrides = {}) {
  return {
    executionId: 'exec-6b3e-offline',
    asset: 'oxkio-approval',
    outputDirectory: workspace,
    pgDumpPath: fakePgDumpPath,
    secretProvider: fakeSecretProvider(),
    resolveApprovalCatalog: matchingCatalogResolver(),
    wrapperDependencies: { probeVersion: probe18, runProcess: neverRun() },
    ...overrides,
  };
}

async function codeOf(promiseFactory) {
  try {
    await promiseFactory();
  } catch (error) {
    return error.code;
  }
  return null;
}

// ==========================================================================
// PASS
// ==========================================================================

test('PASS: validate-only completo con providers fake', async () => {
  const result = observe(await runValidateOnly(baseOptions()));
  assert.equal(result.ok, true);
  assert.equal(result.runnerMode, MODE_VALIDATE_ONLY);
  assert.equal(result.processLaunched, false);
});

test('PASS: no se llama runProcess durante validate-only', async () => {
  const runner = createFakeRunner();
  const result = observe(await runValidateOnly(baseOptions({
    wrapperDependencies: { probeVersion: probe18, runProcess: runner.run },
  })));
  assert.equal(result.ok, true);
  assert.equal(runner.calls.length, 0);
});

test('PASS: el manifiesto se consume tal cual (approval_items, sin duplicar la lista)', async () => {
  const scope = defaultScope();
  assert.equal(scope.mode, SCOPE_MODE_OWNER_RESOLVED);
  assert.deepEqual([...scope.expected], [...EXPECTED_APPROVAL_TABLES]);

  const result = observe(await runValidateOnly(baseOptions()));
  assert.equal(result.ok, true);
  assert.deepEqual([...result.scope.tables], [...EXPECTED_APPROVAL_TABLES]);
});

test('PASS: igualdad de catalogo exacta activa catalogVerified', async () => {
  const result = observe(await runValidateOnly(baseOptions()));
  assert.equal(result.ok, true);
  assert.equal(result.scope.catalogVerified, true);
});

test('PASS: TLS exacto (verify-full + channel binding require + sslrootcert=system)', async () => {
  const result = observe(await runValidateOnly(baseOptions()));
  assert.equal(result.ok, true);
  assert.equal(result.tls.sslMode, 'verify-full');
  assert.equal(result.tls.channelBinding, 'require');
  assert.equal(result.tls.sslRootCert, 'system');
});

test('PASS: la password nunca es visible y el host queda redactado', async () => {
  const result = observe(await runValidateOnly(baseOptions()));
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes(SYNTHETIC_PASSWORD));
  assert.equal(result.endpoint.host, '[REDACTED]');
});

test('PASS: se puede imponer un sslRootCert explicito (override de la politica por defecto)', async () => {
  const rootCertPath = path.join(workspace, 'fake-root.crt');
  fs.writeFileSync(rootCertPath, '-----BEGIN CERTIFICATE-----\nsynthetic\n-----END CERTIFICATE-----\n');
  const result = observe(await runValidateOnly(baseOptions({
    sslRootCert: rootCertPath,
    executionId: 'exec-6b3e-rootcert',
  })));
  assert.equal(result.ok, true);
  assert.equal(result.tls.sslRootCert, 'explicit-file');
});

test('PASS: parseArgs interpreta las flags del CLI sin ejecutar nada', () => {
  const flags = observe(parseArgs([
    '--execute',
    '--allow-execute',
    '--execution-id=exec-cli',
    '--asset=oxkio-approval',
    '--output-dir=/tmp/oxkio-backup',
    '--pg-dump-path=/usr/bin/pg_dump',
  ]));
  assert.equal(flags.mode, MODE_EXECUTE);
  assert.equal(flags.allowExecute, true);
  assert.equal(flags.executionId, 'exec-cli');
  assert.equal(flags.outputDirectory, '/tmp/oxkio-backup');
});

test('PASS: parseArgs por defecto es validate-only sin allowExecute', () => {
  const flags = observe(parseArgs([]));
  assert.equal(flags.mode, MODE_VALIDATE_ONLY);
  assert.equal(flags.allowExecute, false);
});

// ==========================================================================
// FAIL-CLOSED
// ==========================================================================

test('FAIL: secret provider ausente', async () => {
  assert.equal(
    await codeOf(() => composeBackupRequest(baseOptions({ secretProvider: undefined }))),
    'runner_secret_provider_missing',
  );
  const result = observe(await runValidateOnly(baseOptions({ secretProvider: undefined })));
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'runner_secret_provider_missing');
});

test('FAIL: catalog provider ausente con alcance owner_resolved', async () => {
  const result = observe(await runValidateOnly(baseOptions({ resolveApprovalCatalog: undefined })));
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'runner_catalog_provider_missing');
});

test('FAIL: mismatch de catalogo (el resolver devuelve algo distinto del manifiesto)', async () => {
  const result = observe(await runValidateOnly(baseOptions({
    resolveApprovalCatalog: async ({ owner }) => [{ table: 'oxkio.approval_events', owner }],
  })));
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'backup_scope_catalog_mismatch');
});

test('FAIL: Mission Queue en el catalogo resuelto nunca se acepta', async () => {
  const result = observe(await runValidateOnly(baseOptions({
    resolveApprovalCatalog: async ({ owner }) => [
      { table: 'oxkio.approval_items', owner },
      { table: 'oxkio.missions', owner },
    ],
  })));
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'backup_scope_out_of_domain');
});

test('FAIL: owner distinto en un objeto del catalogo resuelto', async () => {
  const result = observe(await runValidateOnly(baseOptions({
    resolveApprovalCatalog: async () => [{ table: 'oxkio.approval_items', owner: 'unexpected_owner' }],
  })));
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'backup_scope_catalog_unexpected_owner');
});

test('FAIL: endpoint pooled', async () => {
  const result = observe(await runValidateOnly(baseOptions({
    secretProvider: fakeSecretProvider({ host: 'ep-runner-synthetic-pooler.db.example.invalid' }),
  })));
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'backup_host_pooled_forbidden');
});

test('FAIL: downgrade de TLS via credencial (el runner no permite override mas debil que el fijado)', async () => {
  // El runner no expone sslMode/channelBinding como parametros: siempre
  // usa REQUIRED_SSL_MODE/REQUIRED_CHANNEL_BINDING. Esta prueba confirma
  // que no hay ruta para inyectar un valor mas debil desde las options.
  const result = observe(await runValidateOnly({
    ...baseOptions(),
    sslMode: 'require',
    channelBinding: 'prefer',
  }));
  assert.equal(result.ok, true);
  assert.equal(result.tls.sslMode, 'verify-full');
  assert.equal(result.tls.channelBinding, 'require');
});

test('FAIL: connectionString/URI detectada a traves de la credencial', async () => {
  const result = observe(await runValidateOnly(baseOptions({
    secretProvider: fakeSecretProvider({ host: 'postgresql://u:p@h.example.invalid/db' }),
  })));
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'backup_connection_string_forbidden');
});

test('FAIL: EXECUTE no autorizado sin allowExecute', async () => {
  const result = observe(await runExecute(baseOptions({ allowExecute: false })));
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'runner_execute_not_authorized');
});

test('FAIL: EXECUTE no autorizado con mode correcto pero allowExecute ausente por completo', async () => {
  assert.equal(
    await codeOf(() => composeBackupRequest({ ...baseOptions(), mode: MODE_EXECUTE })),
    'runner_execute_not_authorized',
  );
});

test('FAIL: la password no aparece en ninguna salida, incluso en fallos', async () => {
  const result = observe(await runValidateOnly(baseOptions({
    secretProvider: fakeSecretProvider({ password: '' }),
  })));
  assert.equal(result.ok, false);
  assert.ok(!JSON.stringify(result).includes(SYNTHETIC_PASSWORD));
});

test('FAIL: executionId ausente', async () => {
  const result = observe(await runValidateOnly(baseOptions({ executionId: undefined })));
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'runner_execution_id_missing');
});

test('FAIL: outputDirectory relativo o ausente', async () => {
  const result = observe(await runValidateOnly(baseOptions({ outputDirectory: 'relative/dir' })));
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'runner_output_directory_invalid');
});

test('FAIL: credencial con forma invalida (falta un campo)', async () => {
  const result = observe(await runValidateOnly(baseOptions({
    secretProvider: { async getBackupCredential() { return { host: 'x.example.invalid', port: 5432 }; } },
  })));
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'runner_credential_invalid');
});

test('FAIL: modo desconocido', async () => {
  assert.equal(
    await codeOf(() => composeBackupRequest(baseOptions({ mode: 'delete-everything' }))),
    'runner_mode_unknown',
  );
});

test('FAIL: el reporte de error usa lista blanca de campos', () => {
  const error = new Error('leak');
  error.code = 'runner_credential_invalid';
  error.stack = `contains ${SYNTHETIC_PASSWORD}`;
  const failure = observe(toSafeRunnerFailure(error));
  assert.deepEqual(Object.keys(failure), ['code', 'message']);
  assert.ok(!JSON.stringify(failure).includes(SYNTHETIC_PASSWORD));
});

// ==========================================================================
// EXECUTE (contrato interno, siempre con runner de proceso falso)
// ==========================================================================

test('PASS: EXECUTE autorizado con runner falso produce evidencia sin secretos', async () => {
  const runner = createFakeRunner((invocation) => {
    const fileArg = invocation.args.find((arg) => arg.startsWith('--file='));
    fs.writeFileSync(fileArg.slice('--file='.length), 'PGDMP-synthetic-offline-fixture');
    return { exitCode: 0, signal: null, stdout: '', stderr: '' };
  });

  const result = observe(await runExecute(baseOptions({
    allowExecute: true,
    executionId: 'exec-6b3e-execute',
    wrapperDependencies: { probeVersion: probe18, runProcess: runner.run },
  })));

  assert.equal(result.ok, true);
  assert.equal(result.runnerMode, MODE_EXECUTE);
  assert.ok(result.evidence.sizeBytes > 0);
  assert.match(result.evidence.sha256, /^[0-9a-f]{64}$/);
  assert.ok(!runner.calls[0].args.join(' ').includes(SYNTHETIC_PASSWORD));
});

// ==========================================================================
// CLI (main)
// ==========================================================================

test('FAIL (CLI): sin createProviders inyectado, main() falla cerrado (sin provider real todavia)', async () => {
  let exitOutput = '';
  const originalExitCode = process.exitCode;
  process.exitCode = undefined;
  await main({
    argv: [`--execution-id=exec-cli-noprovider`, `--output-dir=${workspace}`, `--pg-dump-path=${fakePgDumpPath}`],
    write: (text) => { exitOutput = text; },
    writeError: () => {},
  });
  observe(exitOutput);
  assert.equal(process.exitCode, 1);
  const parsed = JSON.parse(exitOutput);
  assert.equal(parsed.ok, false);
  assert.equal(parsed.failure.code, 'runner_secret_provider_missing');
  process.exitCode = originalExitCode;
});

test('PASS (CLI): main() con createProviders de test completa validate-only offline', async () => {
  let exitOutput = '';
  const originalExitCode = process.exitCode;
  process.exitCode = undefined;
  await main({
    argv: [
      '--validate-only',
      '--execution-id=exec-cli-ok',
      `--output-dir=${workspace}`,
      `--pg-dump-path=${fakePgDumpPath}`,
    ],
    createProviders: () => ({
      secretProvider: fakeSecretProvider(),
      resolveApprovalCatalog: matchingCatalogResolver(),
      wrapperDependencies: { probeVersion: probe18, runProcess: neverRun() },
    }),
    write: (text) => { exitOutput = text; },
    writeError: () => {},
  });
  observe(exitOutput);
  assert.equal(process.exitCode, 0);
  const parsed = JSON.parse(exitOutput);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.processLaunched, false);
  process.exitCode = originalExitCode;
});

test('FAIL (CLI): --execute sin --allow-execute falla cerrado incluso con providers validos', async () => {
  let exitOutput = '';
  const originalExitCode = process.exitCode;
  process.exitCode = undefined;
  await main({
    argv: ['--execute', '--execution-id=exec-cli-execute-blocked', `--output-dir=${workspace}`, `--pg-dump-path=${fakePgDumpPath}`],
    createProviders: () => ({
      secretProvider: fakeSecretProvider(),
      resolveApprovalCatalog: matchingCatalogResolver(),
      wrapperDependencies: { probeVersion: probe18, runProcess: neverRun() },
    }),
    write: (text) => { exitOutput = text; },
    writeError: () => {},
  });
  observe(exitOutput);
  assert.equal(process.exitCode, 1);
  const parsed = JSON.parse(exitOutput);
  assert.equal(parsed.failure.code, 'runner_execute_not_authorized');
  process.exitCode = originalExitCode;
});

// ==========================================================================
// Auditoria final de secretos
// ==========================================================================

test('AUDIT: ninguna salida observada contiene la credencial sintetica', () => {
  assert.ok(observedOutputs.length > 0);
  for (const entry of observedOutputs) {
    assert.ok(!entry.includes(SYNTHETIC_PASSWORD), 'una salida del runner contenia la credencial sintetica');
  }
});

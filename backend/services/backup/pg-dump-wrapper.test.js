'use strict';

// 5C.7B.6B.2 — Tests focales OFFLINE del wrapper seguro de pg_dump.
//
// Ninguna prueba de este archivo conecta con Neon, ejecuta un backup real,
// crea roles/secretos ni produce un artefacto persistente fuera del
// directorio temporal del sistema operativo. El unico proceso que puede
// llegar a lanzarse es `pg_dump --version` local, sin red ni credenciales,
// y solo en la prueba explicita de toolchain (que se omite si el binario
// no esta instalado en esta maquina).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  APPROVAL_BACKUP_SCOPE,
  OWNERSHIP_FLAGS_DECISION,
  REQUIRED_CHANNEL_BINDING,
  REQUIRED_SSL_MODE,
  SCOPE_MODE_OWNER_RESOLVED,
  buildBackupArtifactName,
  buildChildEnvironment,
  createPgDumpWrapper,
  parsePostgresVersion,
  sanitizeProcessOutput,
  toSafeFailure,
} = require('./pg-dump-wrapper');

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..', '..');
const LOCAL_PG_BIN = path.join('C:', path.sep, 'Program Files', 'PostgreSQL', '18', 'bin');

// Credencial sintetica exclusiva de tests. No corresponde a ninguna
// identidad real y nunca debe aparecer en ninguna salida del wrapper.
const SYNTHETIC_PASSWORD = 'synthetic-approval-pw-0000';
const ARGV_PROBE_PASSWORD = 'argv-leak-probe-1111';

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'oxkio-6b2-'));
const fakePgDumpPath = path.join(workspace, 'fake-pg_dump.exe');
const fakePgRestorePath = path.join(workspace, 'fake-pg_restore.exe');
fs.writeFileSync(fakePgDumpPath, 'not a real binary');
fs.writeFileSync(fakePgRestorePath, 'not a real binary');

// Toda salida observada se acumula aqui para la auditoria final de secretos.
const observedOutputs = [];
function observe(value) {
  observedOutputs.push(typeof value === 'string' ? value : JSON.stringify(value));
  return value;
}

test.after(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

const probe18 = () => 'pg_dump (PostgreSQL) 18.6\n';
const probe17 = () => 'pg_dump (PostgreSQL) 17.4\n';

function neverRun() {
  return async () => {
    throw new Error('runProcess must not be invoked.');
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

function outputPathFor(name) {
  return path.join(workspace, `${name}.dump`);
}

function baseConfig(overrides = {}) {
  return {
    host: 'ep-synthetic-000000.db.example.invalid',
    port: 5432,
    database: 'oxkio',
    user: 'pg-bkp-login-synthetic',
    password: SYNTHETIC_PASSWORD,
    pgDumpPath: fakePgDumpPath,
    outputPath: outputPathFor('base'),
    executionId: 'exec-6b2-offline',
    ...overrides,
  };
}

function wrapper(dependencies = {}) {
  return createPgDumpWrapper({
    probeVersion: probe18,
    runProcess: neverRun(),
    parentEnv: {
      SystemRoot: 'C:\\Windows',
      PATH: 'C:\\Windows\\System32',
      TEMP: workspace,
      APPDATA: 'C:\\Users\\synthetic\\AppData\\Roaming',
      PGPASSWORD: 'inherited-must-not-survive',
      PGSSLMODE: 'disable',
      OXKIO_APPROVAL_PG_RUNTIME_URL: 'postgresql://inherited:leak@example.invalid/db',
    },
    platform: 'win32',
    ...dependencies,
  });
}

function codeOf(fn) {
  try {
    fn();
  } catch (error) {
    return error.code;
  }
  return null;
}

// ==========================================================================
// PASS
// ==========================================================================

test('PASS: pg_dump 18.x es reconocido y expuesto como version no secreta', () => {
  const result = observe(wrapper().validateOnly(baseConfig({ outputPath: outputPathFor('p1') })));
  assert.equal(result.ok, true);
  assert.match(result.pgDump.version, /^pg_dump \(PostgreSQL\) 18\./);
});

test('PASS: endpoint sin -pooler se acepta y se declara directo', () => {
  const result = observe(wrapper().validateOnly(baseConfig({ outputPath: outputPathFor('p2') })));
  assert.equal(result.endpoint.kind, 'direct');
  assert.equal(result.endpoint.pooled, false);
});

test('PASS: el entorno del hijo fija verify-full y channel binding require', () => {
  const childEnv = buildChildEnvironment({
    connection: {
      host: 'ep-synthetic.example.invalid',
      port: 5432,
      database: 'oxkio',
      user: 'pg-bkp-login-synthetic',
      password: SYNTHETIC_PASSWORD,
    },
    tls: { sslMode: REQUIRED_SSL_MODE, channelBinding: REQUIRED_CHANNEL_BINDING },
    parentEnv: {
      SystemRoot: 'C:\\Windows',
      PATH: 'C:\\Windows\\System32',
      PGSSLMODE: 'disable',
      PGPASSWORD: 'inherited-must-not-survive',
      SECRET_UNRELATED: 'must-not-be-copied',
    },
    platform: 'win32',
  });

  assert.equal(childEnv.PGSSLMODE, 'verify-full');
  assert.equal(childEnv.PGCHANNELBINDING, 'require');
  assert.equal(childEnv.PGPASSWORD, SYNTHETIC_PASSWORD);
  // El entorno del padre no se hereda completo y ninguna PG* previa sobrevive.
  assert.equal(childEnv.SECRET_UNRELATED, undefined);
  assert.equal(childEnv.PGSSLROOTCERT, undefined);
  assert.equal(childEnv.PGHOST, 'ep-synthetic.example.invalid');
  observe(Object.keys(childEnv).sort().join(','));
});

test('PASS: los argumentos no contienen la credencial ni ninguna URI', () => {
  const result = observe(wrapper().validateOnly(baseConfig({ outputPath: outputPathFor('p4') })));
  const joined = result.args.join(' ');
  assert.ok(!joined.includes(SYNTHETIC_PASSWORD));
  assert.doesNotMatch(joined, /postgres(ql)?:\/\//i);
  assert.doesNotMatch(joined, /PGPASSWORD/i);
  assert.ok(result.args.includes('--format=custom'));
  assert.ok(result.args.includes('--no-password'));
  assert.ok(result.args.includes('--table=oxkio.approval_items'));
  assert.ok(result.args.some((arg) => arg.startsWith('--file=')));
  // Decision --no-owner / --no-privileges PENDIENTE hasta 6C: no se emiten.
  assert.ok(!result.args.includes('--no-owner'));
  assert.ok(!result.args.includes('--no-privileges'));
  assert.equal(result.ownershipFlags, OWNERSHIP_FLAGS_DECISION);
});

test('PASS: ValidateOnly no lanza ningun proceso', () => {
  const runner = createFakeRunner();
  const result = observe(
    wrapper({ runProcess: runner.run }).validateOnly(baseConfig({ outputPath: outputPathFor('p5') })),
  );
  assert.equal(runner.calls.length, 0);
  assert.equal(result.processLaunched, false);
});

test('PASS: la salida de ValidateOnly es no secreta (sin password, host redactado)', () => {
  const result = observe(wrapper().validateOnly(baseConfig({ outputPath: outputPathFor('p6') })));
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes(SYNTHETIC_PASSWORD));
  assert.equal(result.endpoint.host, '[REDACTED]');
  // Solo se publican NOMBRES de variables, nunca valores.
  assert.ok(result.environmentKeys.includes('PGPASSWORD'));
  assert.ok(!serialized.includes('inherited-must-not-survive'));
  assert.equal(result.tls.sslRootCert, 'unset');
});

test('PASS: el output vive fuera del repositorio y fuera de OneDrive', () => {
  const result = observe(wrapper().validateOnly(baseConfig({ outputPath: outputPathFor('p7') })));
  assert.equal(result.output.insideRepository, false);
  assert.equal(result.output.basename, 'p7.dump');
  assert.ok(!path.resolve(workspace).startsWith(REPOSITORY_ROOT));
});

test('PASS: el nombre del artefacto es determinista (asset + UTC + executionId)', () => {
  const name = buildBackupArtifactName({
    asset: 'oxkio-approval',
    createdAt: new Date('2026-09-09T10:15:00.000Z'),
    executionId: 'exec-6b2-offline',
  });
  assert.equal(name, 'oxkio-approval-20260909T101500Z-exec-6b2-offline.dump');

  const resolved = wrapper().resolveArtifactPath({
    directory: workspace,
    executionId: 'exec-6b2-offline',
    createdAt: new Date('2026-09-09T10:15:00.000Z'),
  });
  assert.equal(path.basename(resolved), name);
  observe(name);
});

test('PASS: el alcance por defecto es Approval unicamente', () => {
  assert.deepEqual([...APPROVAL_BACKUP_SCOPE.tables], ['oxkio.approval_items']);
  const result = observe(wrapper().validateOnly(baseConfig({ outputPath: outputPathFor('p9') })));
  assert.deepEqual([...result.scope.tables], ['oxkio.approval_items']);
  assert.equal(result.scope.owner, 'oxkio_approval_owner');
});

test('PASS: runExport con runner falso produce tamano y sha256', async () => {
  const outputPath = outputPathFor('p10');
  const runner = createFakeRunner((invocation) => {
    const fileArg = invocation.args.find((arg) => arg.startsWith('--file='));
    fs.writeFileSync(fileArg.slice('--file='.length), 'PGDMP-synthetic-offline-fixture');
    return { exitCode: 0, signal: null, stdout: '', stderr: '' };
  });

  const result = await wrapper({ runProcess: runner.run }).runExport(baseConfig({ outputPath }));
  observe(result);

  assert.equal(result.ok, true);
  assert.equal(result.evidence.exitCode, 0);
  assert.ok(result.evidence.sizeBytes > 0);
  assert.match(result.evidence.sha256, /^[0-9a-f]{64}$/);
  assert.equal(result.evidence.outputBasename, 'p10.dump');
  // La credencial nunca viaja en argv; solo en el entorno del hijo.
  assert.ok(!runner.calls[0].args.join(' ').includes(SYNTHETIC_PASSWORD));
  assert.equal(runner.calls[0].env.PGSSLMODE, 'verify-full');
  assert.equal(runner.calls[0].env.PGCHANNELBINDING, 'require');
});

test('PASS: pg_restore --list se parsea offline con runner falso', async () => {
  const artifactPath = outputPathFor('p11');
  fs.writeFileSync(artifactPath, 'PGDMP-synthetic-offline-fixture');
  const runner = createFakeRunner(() => ({
    exitCode: 0,
    signal: null,
    stdout: [
      '; Archive created at 2026-09-09 10:15:00 UTC',
      '215; 1259 16385 TABLE oxkio approval_items synthetic_owner',
      '',
    ].join('\n'),
    stderr: '',
  }));

  const result = await wrapper({ runProcess: runner.run }).listArtifact({
    pgRestorePath: fakePgRestorePath,
    artifactPath,
  });
  observe(result);

  assert.equal(result.ok, true);
  assert.equal(result.entryCount, 1);
  assert.match(result.entries[0], /approval_items/);
  assert.deepEqual(runner.calls[0].args, ['--list', artifactPath]);
  // El listado no recibe credencial alguna.
  assert.equal(runner.calls[0].env.PGPASSWORD, undefined);
});

test('PASS: toolchain local pg_dump 18.x (se omite si no esta instalado)', (t) => {
  const realPgDump = path.join(LOCAL_PG_BIN, 'pg_dump.exe');
  if (process.platform !== 'win32' || !fs.existsSync(realPgDump)) {
    t.skip('PostgreSQL 18 client tools no instalados en esta maquina.');
    return;
  }
  const result = observe(
    createPgDumpWrapper({ runProcess: neverRun(), platform: 'win32' }).validateOnly(
      baseConfig({ pgDumpPath: realPgDump, outputPath: outputPathFor('p12') }),
    ),
  );
  assert.match(result.pgDump.version, /^pg_dump \(PostgreSQL\) 18\./);
});

// ==========================================================================
// FAIL-CLOSED
// ==========================================================================

test('FAIL: password vacio', () => {
  assert.equal(
    codeOf(() => wrapper().validateOnly(baseConfig({ password: '', outputPath: outputPathFor('f1') }))),
    'backup_password_missing',
  );
});

test('FAIL: endpoint pooled se rechaza y no se corrige automaticamente', () => {
  assert.equal(
    codeOf(() => wrapper().validateOnly(baseConfig({
      host: 'ep-synthetic-000000-pooler.db.example.invalid',
      outputPath: outputPathFor('f2'),
    }))),
    'backup_host_pooled_forbidden',
  );
});

test('FAIL: connectionString como clave de configuracion', () => {
  assert.equal(
    codeOf(() => wrapper().validateOnly(baseConfig({
      connectionString: 'postgresql://u:p@h.example.invalid/db',
      outputPath: outputPathFor('f3'),
    }))),
    'backup_connection_string_forbidden',
  );
});

test('FAIL: URI PostgreSQL cruda en cualquier campo', () => {
  assert.equal(
    codeOf(() => wrapper().validateOnly(baseConfig({
      host: 'postgresql://u:p@h.example.invalid/db',
      outputPath: outputPathFor('f4'),
    }))),
    'backup_connection_string_forbidden',
  );
});

test('FAIL: pg_dump inexistente', () => {
  assert.equal(
    codeOf(() => wrapper().validateOnly(baseConfig({
      pgDumpPath: path.join(workspace, 'no-such-binary.exe'),
      outputPath: outputPathFor('f5'),
    }))),
    'backup_pg_dump_missing',
  );
});

test('FAIL: version 17.x simulada', () => {
  assert.equal(
    codeOf(() => wrapper({ probeVersion: probe17 }).validateOnly(
      baseConfig({ outputPath: outputPathFor('f6') }),
    )),
    'backup_pg_dump_version_unsupported',
  );
});

test('FAIL: el artefacto de salida ya existe (no overwrite)', () => {
  const outputPath = outputPathFor('f7');
  fs.writeFileSync(outputPath, 'pre-existing');
  assert.equal(
    codeOf(() => wrapper().validateOnly(baseConfig({ outputPath }))),
    'backup_output_already_exists',
  );
});

test('FAIL: output dentro del repositorio', () => {
  assert.equal(
    codeOf(() => wrapper().validateOnly(baseConfig({
      outputPath: path.join(REPOSITORY_ROOT, 'backend', 'services', 'backup', 'forbidden.dump'),
    }))),
    'backup_output_path_forbidden',
  );
});

test('FAIL: la credencial no puede colarse en argv a traves del outputPath', () => {
  assert.equal(
    codeOf(() => wrapper().validateOnly(baseConfig({
      password: ARGV_PROBE_PASSWORD,
      outputPath: outputPathFor(ARGV_PROBE_PASSWORD),
    }))),
    'backup_secret_in_arguments',
  );
});

test('FAIL: sslmode inseguro', () => {
  assert.equal(
    codeOf(() => wrapper().validateOnly(baseConfig({ sslMode: 'require', outputPath: outputPathFor('f10') }))),
    'backup_ssl_mode_invalid',
  );
});

test('FAIL: channel binding distinto de require', () => {
  assert.equal(
    codeOf(() => wrapper().validateOnly(baseConfig({
      channelBinding: 'prefer',
      outputPath: outputPathFor('f11'),
    }))),
    'backup_channel_binding_invalid',
  );
});

test('FAIL: host vacio, port invalido, database vacia y user vacio', () => {
  assert.equal(
    codeOf(() => wrapper().validateOnly(baseConfig({ host: '', outputPath: outputPathFor('f12a') }))),
    'backup_host_missing',
  );
  assert.equal(
    codeOf(() => wrapper().validateOnly(baseConfig({ port: 0, outputPath: outputPathFor('f12b') }))),
    'backup_port_invalid',
  );
  assert.equal(
    codeOf(() => wrapper().validateOnly(baseConfig({ database: '', outputPath: outputPathFor('f12c') }))),
    'backup_database_invalid',
  );
  assert.equal(
    codeOf(() => wrapper().validateOnly(baseConfig({ user: '  ', outputPath: outputPathFor('f12d') }))),
    'backup_user_invalid',
  );
});

test('FAIL: alcance owner_resolved queda PENDIENTE, no se inventa', () => {
  assert.equal(
    codeOf(() => wrapper().validateOnly(baseConfig({
      scope: { mode: SCOPE_MODE_OWNER_RESOLVED, schema: 'oxkio', owner: 'oxkio_approval_owner' },
      outputPath: outputPathFor('f13'),
    }))),
    'backup_scope_resolution_pending',
  );
});

test('FAIL: Mission Queue queda fuera del dominio Approval', () => {
  assert.equal(
    codeOf(() => wrapper().validateOnly(baseConfig({
      scope: {
        mode: 'explicit_tables',
        schema: 'oxkio',
        tables: ['oxkio.approval_items', 'oxkio.missions'],
      },
      outputPath: outputPathFor('f14'),
    }))),
    'backup_scope_out_of_domain',
  );
});

test('FAIL POST: exit code distinto de 0', async () => {
  const runner = createFakeRunner(() => ({ exitCode: 1, signal: null, stdout: '', stderr: 'boom' }));
  const result = await wrapper({ runProcess: runner.run }).runExport(
    baseConfig({ outputPath: outputPathFor('f15') }),
  );
  observe(result);
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'backup_process_failed');
});

test('FAIL POST: senal o timeout', async () => {
  const runner = createFakeRunner(() => ({ exitCode: null, signal: 'SIGTERM', stdout: '', stderr: '' }));
  const result = await wrapper({ runProcess: runner.run }).runExport(
    baseConfig({ outputPath: outputPathFor('f16') }),
  );
  observe(result);
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'backup_process_signaled');
});

test('FAIL POST: artefacto ausente pese a exit code 0', async () => {
  const runner = createFakeRunner(() => ({ exitCode: 0, signal: null, stdout: '', stderr: '' }));
  const result = await wrapper({ runProcess: runner.run }).runExport(
    baseConfig({ outputPath: outputPathFor('f17') }),
  );
  observe(result);
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'backup_artifact_missing');
});

test('FAIL POST: artefacto de tamano 0', async () => {
  const outputPath = outputPathFor('f18');
  const runner = createFakeRunner(() => {
    fs.writeFileSync(outputPath, '');
    return { exitCode: 0, signal: null, stdout: '', stderr: '' };
  });
  const result = await wrapper({ runProcess: runner.run }).runExport(baseConfig({ outputPath }));
  observe(result);
  assert.equal(result.ok, false);
  assert.equal(result.failure.code, 'backup_artifact_empty');
  assert.equal(result.evidence.sizeBytes, 0);
});

test('FAIL POST: stderr con la credencial se sanea antes de la evidencia', async () => {
  const runner = createFakeRunner(() => ({
    exitCode: 1,
    signal: null,
    stdout: '',
    stderr: `connection failed: password=${SYNTHETIC_PASSWORD} for postgresql://u:${SYNTHETIC_PASSWORD}@h.example.invalid/db`,
  }));
  const result = await wrapper({ runProcess: runner.run }).runExport(
    baseConfig({ outputPath: outputPathFor('f19') }),
  );
  observe(result);
  assert.equal(result.ok, false);
  assert.ok(!result.evidence.stderr.includes(SYNTHETIC_PASSWORD));
  assert.match(result.evidence.stderr, /\[REDACTED\]/);
});

test('FAIL: el reporte de error usa lista blanca de campos, nunca el Error completo', () => {
  const error = new Error('leak');
  error.code = 'backup_process_failed';
  error.stack = `contains ${SYNTHETIC_PASSWORD}`;
  error.password = SYNTHETIC_PASSWORD;
  const failure = observe(toSafeFailure(error));
  assert.deepEqual(Object.keys(failure), ['code', 'message']);
  assert.ok(!JSON.stringify(failure).includes(SYNTHETIC_PASSWORD));
});

// ==========================================================================
// Utilidades
// ==========================================================================

test('parsePostgresVersion extrae major/minor y sanitizeProcessOutput redacta', () => {
  assert.equal(parsePostgresVersion('pg_dump (PostgreSQL) 18.6').major, 18);
  assert.equal(parsePostgresVersion('sin version'), null);
  const safe = observe(sanitizeProcessOutput(`x ${SYNTHETIC_PASSWORD} y`, [SYNTHETIC_PASSWORD]));
  assert.ok(!safe.includes(SYNTHETIC_PASSWORD));
});

// ==========================================================================
// Auditoria final de secretos sobre TODA la salida observada
// ==========================================================================

test('AUDIT: ninguna salida observada contiene la credencial sintetica', () => {
  assert.ok(observedOutputs.length > 0);
  for (const entry of observedOutputs) {
    assert.ok(
      !entry.includes(SYNTHETIC_PASSWORD),
      'una salida del wrapper contenia la credencial sintetica',
    );
    assert.ok(!entry.includes('inherited-must-not-survive'));
  }
});

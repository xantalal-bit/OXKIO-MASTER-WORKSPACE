'use strict';

// 5C.7B.6B.2/6B.3A — Tests focales OFFLINE del wrapper seguro de pg_dump.
//
// Ninguna prueba de este archivo conecta con Neon, ejecuta un backup real,
// crea roles/secretos ni produce un artefacto persistente fuera del
// directorio temporal del sistema operativo. El unico proceso que puede
// llegar a lanzarse es `pg_dump --version` local, sin red ni credenciales,
// y solo en la prueba explicita de toolchain (que se omite si el binario
// no esta instalado en esta maquina). La resolucion de catalogo Approval
// (6B.3A) se prueba exclusivamente con un `resolveApprovalCatalog` falso
// inyectado: ningun test consulta pg_catalog real.

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
  SSL_ROOT_CERT_SYSTEM,
  buildBackupArtifactName,
  buildChildEnvironment,
  createPgDumpWrapper,
  parsePostgresVersion,
  sanitizeProcessOutput,
  toSafeFailure,
} = require('./pg-dump-wrapper');

const { EXPECTED_APPROVAL_TABLES } = require('./approval-domain-manifest');

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..', '..');
const LOCAL_PG_BIN = path.join('C:', path.sep, 'Program Files', 'PostgreSQL', '18', 'bin');

// Credencial sintetica exclusiva de tests. No corresponde a ninguna
// identidad real y nunca debe aparecer en ninguna salida del wrapper.
const SYNTHETIC_PASSWORD = 'synthetic-approval-pw-0000';
const ARGV_PROBE_PASSWORD = 'argv-leak-probe-1111';

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'oxkio-6b2-'));
const fakePgDumpPath = path.join(workspace, 'fake-pg_dump.exe');
const fakePgRestorePath = path.join(workspace, 'fake-pg_restore.exe');
const fakeRootCertPath = path.join(workspace, 'fake-root.crt');
fs.writeFileSync(fakePgDumpPath, 'not a real binary');
fs.writeFileSync(fakePgRestorePath, 'not a real binary');
fs.writeFileSync(fakeRootCertPath, '-----BEGIN CERTIFICATE-----\nsynthetic-fixture-only\n-----END CERTIFICATE-----\n');

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

// codeOf funciona tanto con funciones sincronas como con promesas: captura
// el `.code` del PgDumpWrapperError en cualquiera de los dos casos.
async function codeOf(fn) {
  try {
    await fn();
  } catch (error) {
    return error.code;
  }
  return null;
}

// ==========================================================================
// PASS
// ==========================================================================

test('PASS: pg_dump 18.x es reconocido y expuesto como version no secreta', async () => {
  const result = observe(await wrapper().validateOnly(baseConfig({ outputPath: outputPathFor('p1') })));
  assert.equal(result.ok, true);
  assert.match(result.pgDump.version, /^pg_dump \(PostgreSQL\) 18\./);
});

test('PASS: endpoint sin -pooler se acepta y se declara directo', async () => {
  const result = observe(await wrapper().validateOnly(baseConfig({ outputPath: outputPathFor('p2') })));
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

test('PASS: los argumentos no contienen la credencial ni ninguna URI', async () => {
  const result = observe(await wrapper().validateOnly(baseConfig({ outputPath: outputPathFor('p4') })));
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

test('PASS: ValidateOnly no lanza ningun proceso', async () => {
  const runner = createFakeRunner();
  const result = observe(
    await wrapper({ runProcess: runner.run }).validateOnly(baseConfig({ outputPath: outputPathFor('p5') })),
  );
  assert.equal(runner.calls.length, 0);
  assert.equal(result.processLaunched, false);
});

test('PASS: la salida de ValidateOnly es no secreta (sin password, host redactado)', async () => {
  const result = observe(await wrapper().validateOnly(baseConfig({ outputPath: outputPathFor('p6') })));
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes(SYNTHETIC_PASSWORD));
  assert.equal(result.endpoint.host, '[REDACTED]');
  // Solo se publican NOMBRES de variables, nunca valores.
  assert.ok(result.environmentKeys.includes('PGPASSWORD'));
  assert.ok(!serialized.includes('inherited-must-not-survive'));
  assert.equal(result.tls.sslRootCert, 'unset');
});

test('PASS: el output vive fuera del repositorio y fuera de OneDrive', async () => {
  const result = observe(await wrapper().validateOnly(baseConfig({ outputPath: outputPathFor('p7') })));
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

test('PASS: el alcance por defecto es Approval unicamente', async () => {
  assert.deepEqual([...APPROVAL_BACKUP_SCOPE.tables], ['oxkio.approval_items']);
  const result = observe(await wrapper().validateOnly(baseConfig({ outputPath: outputPathFor('p9') })));
  assert.deepEqual([...result.scope.tables], ['oxkio.approval_items']);
  assert.equal(result.scope.owner, 'oxkio_approval_owner');
  assert.equal(result.scope.catalogVerified, false);
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

test('PASS: toolchain local pg_dump 18.x (se omite si no esta instalado)', async (t) => {
  const realPgDump = path.join(LOCAL_PG_BIN, 'pg_dump.exe');
  if (process.platform !== 'win32' || !fs.existsSync(realPgDump)) {
    t.skip('PostgreSQL 18 client tools no instalados en esta maquina.');
    return;
  }
  const result = observe(
    await createPgDumpWrapper({ runProcess: neverRun(), platform: 'win32' }).validateOnly(
      baseConfig({ pgDumpPath: realPgDump, outputPath: outputPathFor('p12') }),
    ),
  );
  assert.match(result.pgDump.version, /^pg_dump \(PostgreSQL\) 18\./);
});

// ==========================================================================
// FAIL-CLOSED
// ==========================================================================

test('FAIL: password vacio', async () => {
  assert.equal(
    await codeOf(() => wrapper().validateOnly(baseConfig({ password: '', outputPath: outputPathFor('f1') }))),
    'backup_password_missing',
  );
});

test('FAIL: endpoint pooled se rechaza y no se corrige automaticamente', async () => {
  assert.equal(
    await codeOf(() => wrapper().validateOnly(baseConfig({
      host: 'ep-synthetic-000000-pooler.db.example.invalid',
      outputPath: outputPathFor('f2'),
    }))),
    'backup_host_pooled_forbidden',
  );
});

test('FAIL: connectionString como clave de configuracion', async () => {
  assert.equal(
    await codeOf(() => wrapper().validateOnly(baseConfig({
      connectionString: 'postgresql://u:p@h.example.invalid/db',
      outputPath: outputPathFor('f3'),
    }))),
    'backup_connection_string_forbidden',
  );
});

test('FAIL: URI PostgreSQL cruda en cualquier campo', async () => {
  assert.equal(
    await codeOf(() => wrapper().validateOnly(baseConfig({
      host: 'postgresql://u:p@h.example.invalid/db',
      outputPath: outputPathFor('f4'),
    }))),
    'backup_connection_string_forbidden',
  );
});

test('FAIL: pg_dump inexistente', async () => {
  assert.equal(
    await codeOf(() => wrapper().validateOnly(baseConfig({
      pgDumpPath: path.join(workspace, 'no-such-binary.exe'),
      outputPath: outputPathFor('f5'),
    }))),
    'backup_pg_dump_missing',
  );
});

test('FAIL: version 17.x simulada', async () => {
  assert.equal(
    await codeOf(() => wrapper({ probeVersion: probe17 }).validateOnly(
      baseConfig({ outputPath: outputPathFor('f6') }),
    )),
    'backup_pg_dump_version_unsupported',
  );
});

test('FAIL: el artefacto de salida ya existe (no overwrite)', async () => {
  const outputPath = outputPathFor('f7');
  fs.writeFileSync(outputPath, 'pre-existing');
  assert.equal(
    await codeOf(() => wrapper().validateOnly(baseConfig({ outputPath }))),
    'backup_output_already_exists',
  );
});

test('FAIL: output dentro del repositorio', async () => {
  assert.equal(
    await codeOf(() => wrapper().validateOnly(baseConfig({
      outputPath: path.join(REPOSITORY_ROOT, 'backend', 'services', 'backup', 'forbidden.dump'),
    }))),
    'backup_output_path_forbidden',
  );
});

test('FAIL: la credencial no puede colarse en argv a traves del outputPath', async () => {
  assert.equal(
    await codeOf(() => wrapper().validateOnly(baseConfig({
      password: ARGV_PROBE_PASSWORD,
      outputPath: outputPathFor(ARGV_PROBE_PASSWORD),
    }))),
    'backup_secret_in_arguments',
  );
});

test('FAIL: sslmode inseguro', async () => {
  assert.equal(
    await codeOf(() => wrapper().validateOnly(baseConfig({ sslMode: 'require', outputPath: outputPathFor('f10') }))),
    'backup_ssl_mode_invalid',
  );
});

test('FAIL: channel binding distinto de require', async () => {
  assert.equal(
    await codeOf(() => wrapper().validateOnly(baseConfig({
      channelBinding: 'prefer',
      outputPath: outputPathFor('f11'),
    }))),
    'backup_channel_binding_invalid',
  );
});

test('FAIL: host vacio, port invalido, database vacia y user vacio', async () => {
  assert.equal(
    await codeOf(() => wrapper().validateOnly(baseConfig({ host: '', outputPath: outputPathFor('f12a') }))),
    'backup_host_missing',
  );
  assert.equal(
    await codeOf(() => wrapper().validateOnly(baseConfig({ port: 0, outputPath: outputPathFor('f12b') }))),
    'backup_port_invalid',
  );
  assert.equal(
    await codeOf(() => wrapper().validateOnly(baseConfig({ database: '', outputPath: outputPathFor('f12c') }))),
    'backup_database_invalid',
  );
  assert.equal(
    await codeOf(() => wrapper().validateOnly(baseConfig({ user: '  ', outputPath: outputPathFor('f12d') }))),
    'backup_user_invalid',
  );
});

test('FAIL: alcance owner_resolved queda PENDIENTE sin manifiesto/resolver explicitos', async () => {
  assert.equal(
    await codeOf(() => wrapper().validateOnly(baseConfig({
      scope: { mode: SCOPE_MODE_OWNER_RESOLVED, schema: 'oxkio', owner: 'oxkio_approval_owner' },
      outputPath: outputPathFor('f13'),
    }))),
    'backup_scope_resolution_pending',
  );
});

test('FAIL: Mission Queue queda fuera del dominio Approval', async () => {
  assert.equal(
    await codeOf(() => wrapper().validateOnly(baseConfig({
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
// 6B.3A — CA raiz (PGSSLROOTCERT / sslrootcert=system)
// ==========================================================================

test('PASS: sslRootCert=system se acepta y se declara sin exponer detalle de archivo', async () => {
  const result = observe(await wrapper().validateOnly(baseConfig({
    sslRootCert: SSL_ROOT_CERT_SYSTEM,
    outputPath: outputPathFor('ca1'),
  })));
  assert.equal(result.tls.sslRootCert, 'system');
  assert.equal(result.tls.sslMode, 'verify-full');
});

test('PASS: sslRootCert con ruta absoluta existente se acepta como archivo explicito', async () => {
  const result = observe(await wrapper().validateOnly(baseConfig({
    sslRootCert: fakeRootCertPath,
    outputPath: outputPathFor('ca2'),
  })));
  assert.equal(result.tls.sslRootCert, 'explicit-file');
  // La ruta real del certificado nunca se publica, solo su categoria.
  assert.ok(!JSON.stringify(result).includes(fakeRootCertPath));
  assert.ok(!JSON.stringify(result).includes(path.basename(fakeRootCertPath)));
});

test('FAIL: sslRootCert con ruta relativa se rechaza (nunca se adivina la CWD)', async () => {
  assert.equal(
    await codeOf(() => wrapper().validateOnly(baseConfig({
      sslRootCert: 'relative\\root.crt',
      outputPath: outputPathFor('ca3'),
    }))),
    'backup_ssl_root_cert_invalid',
  );
});

test('FAIL: sslRootCert con ruta absoluta inexistente falla cerrado', async () => {
  assert.equal(
    await codeOf(() => wrapper().validateOnly(baseConfig({
      sslRootCert: path.join(workspace, 'no-such-root.crt'),
      outputPath: outputPathFor('ca4'),
    }))),
    'backup_ssl_root_cert_missing',
  );
});

test('PASS: sslRootCert vacio o ausente equivale a no fijar PGSSLROOTCERT (default de libpq)', async () => {
  const result = observe(await wrapper().validateOnly(baseConfig({
    sslRootCert: '',
    outputPath: outputPathFor('ca5'),
  })));
  assert.equal(result.tls.sslRootCert, 'unset');
});

// ==========================================================================
// 6B.3A — Alcance dinamico Approval (manifiesto vs. catalogo resuelto)
// ==========================================================================

function ownerScopeConfig(overrides = {}) {
  return {
    mode: SCOPE_MODE_OWNER_RESOLVED,
    schema: 'oxkio',
    owner: 'oxkio_approval_owner',
    expected: [...EXPECTED_APPROVAL_TABLES],
    ...overrides,
  };
}

test('PASS: manifiesto y catalogo resuelto coinciden exactamente (approval_items incluido, orden deterministico)', async () => {
  const resolveApprovalCatalog = async ({ owner }) => [
    { table: 'oxkio.approval_items', owner },
  ];
  const result = observe(
    await wrapper({ resolveApprovalCatalog }).validateOnly(baseConfig({
      scope: ownerScopeConfig(),
      outputPath: outputPathFor('sc1'),
    })),
  );
  assert.equal(result.scope.catalogVerified, true);
  assert.deepEqual([...result.scope.tables], ['oxkio.approval_items']);
  // Determinismo: la lista viaja siempre ordenada, no en el orden del resolver.
  assert.deepEqual([...result.scope.tables], [...result.scope.tables].sort());
});

test('FAIL: el catalogo resuelto incluye Mission Queue (nunca se acepta aunque venga del catalogo)', async () => {
  const resolveApprovalCatalog = async ({ owner }) => [
    { table: 'oxkio.approval_items', owner },
    { table: 'oxkio.missions', owner },
  ];
  assert.equal(
    await codeOf(() => wrapper({ resolveApprovalCatalog }).validateOnly(baseConfig({
      scope: ownerScopeConfig(),
      outputPath: outputPathFor('sc2'),
    }))),
    'backup_scope_out_of_domain',
  );
});

test('FAIL: falta un objeto esperado en el catalogo resuelto (resolucion parcial)', async () => {
  const resolveApprovalCatalog = async ({ owner }) => [
    { table: 'oxkio.approval_events', owner },
  ];
  assert.equal(
    await codeOf(() => wrapper({ resolveApprovalCatalog }).validateOnly(baseConfig({
      scope: ownerScopeConfig(),
      outputPath: outputPathFor('sc3'),
    }))),
    'backup_scope_catalog_mismatch',
  );
});

test('FAIL: aparece un objeto Approval no esperado en el manifiesto (STOP, no se adopta por inercia)', async () => {
  const resolveApprovalCatalog = async ({ owner }) => [
    { table: 'oxkio.approval_items', owner },
    { table: 'oxkio.approval_events', owner },
  ];
  assert.equal(
    await codeOf(() => wrapper({ resolveApprovalCatalog }).validateOnly(baseConfig({
      scope: ownerScopeConfig(),
      outputPath: outputPathFor('sc4'),
    }))),
    'backup_scope_catalog_mismatch',
  );
});

test('FAIL: owner inesperado en un objeto resuelto', async () => {
  const resolveApprovalCatalog = async () => [
    { table: 'oxkio.approval_items', owner: 'unexpected_owner' },
  ];
  assert.equal(
    await codeOf(() => wrapper({ resolveApprovalCatalog }).validateOnly(baseConfig({
      scope: ownerScopeConfig(),
      outputPath: outputPathFor('sc5'),
    }))),
    'backup_scope_catalog_unexpected_owner',
  );
});

test('FAIL: el resolver de catalogo falla (no se degrada a lista parcial)', async () => {
  const resolveApprovalCatalog = async () => {
    throw new Error('catalog unreachable');
  };
  assert.equal(
    await codeOf(() => wrapper({ resolveApprovalCatalog }).validateOnly(baseConfig({
      scope: ownerScopeConfig(),
      outputPath: outputPathFor('sc6'),
    }))),
    'backup_scope_catalog_unavailable',
  );
});

test('FAIL: el resolver de catalogo devuelve un conjunto vacio', async () => {
  const resolveApprovalCatalog = async () => [];
  assert.equal(
    await codeOf(() => wrapper({ resolveApprovalCatalog }).validateOnly(baseConfig({
      scope: ownerScopeConfig(),
      outputPath: outputPathFor('sc7'),
    }))),
    'backup_scope_catalog_unavailable',
  );
});

test('FAIL: owner_resolved con manifiesto pero sin resolver inyectado sigue PENDIENTE', async () => {
  assert.equal(
    await codeOf(() => wrapper().validateOnly(baseConfig({
      scope: ownerScopeConfig(),
      outputPath: outputPathFor('sc8'),
    }))),
    'backup_scope_resolution_pending',
  );
});

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

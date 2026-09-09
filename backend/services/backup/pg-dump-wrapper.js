'use strict';

// 5C.7B.6B.2/6B.3A — Wrapper seguro para pg_dump (implementacion OFFLINE).
//
// Este modulo NO conecta con Neon, NO ejecuta un backup real y NO crea
// ninguna identidad ni secreto. Implementa el contrato de invocacion
// segura de `pg_dump` ratificado en el canon 5C.7B.6 / 6B / PRE-6B.3:
//
//   - credencial efimera inyectada por el llamador, nunca leida de
//     process.env, nunca escrita en .env/User/Machine/Git/argv/logs;
//   - endpoint DIRECTO (unpooled) obligatorio;
//   - TLS `verify-full` y channel binding `require` impuestos por codigo,
//     no configurables a un valor mas debil;
//   - prohibicion absoluta de connectionString / URI PostgreSQL cruda,
//     coherente con `postgres-approval-factory.js`;
//   - alcance dominio Approval unicamente (`oxkio.approval_items` y
//     futuros objetos del owner `oxkio_approval_owner`), con comparacion
//     exacta manifiesto-vs-catalogo cuando se resuelve dinamicamente
//     (6B.3A) — nunca por inferencia de nombre ni degradacion parcial;
//   - CA raiz para `verify-full`: `sslrootcert=system` (libpq >= 16,
//     confirmado en `pg_dump --version` = 18.6 local) o una ruta de
//     archivo explicita; nunca se descarga ni empaqueta un certificado
//     en este modulo (6B.3A);
//   - fail-closed antes y despues del proceso hijo.
//
// La ejecucion real contra Neon pertenece a una puerta humana posterior.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { REDACTED, redact } = require('../../security/secret-runtime');

// --------------------------------------------------------------------------
// Constantes de contrato
// --------------------------------------------------------------------------

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..', '..');

const REQUIRED_SSL_MODE = 'verify-full';
const REQUIRED_CHANNEL_BINDING = 'require';
const REQUIRED_PG_MAJOR_VERSION = 18;
const DUMP_FORMAT = 'custom';
const DUMP_EXTENSION = '.dump';
const DEFAULT_ASSET = 'oxkio-approval';

// Dominio Approval ratificado (PRE-6B.3, seccion 5). Mission Queue queda
// explicitamente fuera del alcance inicial del backup independiente.
const APPROVAL_SCHEMA = 'oxkio';
const APPROVAL_OWNER = 'oxkio_approval_owner';
const APPROVAL_TABLES = Object.freeze(['oxkio.approval_items']);
const OUT_OF_DOMAIN_TABLES = Object.freeze([
  'oxkio.missions',
  'oxkio.mission_confirmations',
]);

const SCOPE_MODE_EXPLICIT_TABLES = 'explicit_tables';
const SCOPE_MODE_OWNER_RESOLVED = 'owner_resolved';

const APPROVAL_BACKUP_SCOPE = Object.freeze({
  mode: SCOPE_MODE_EXPLICIT_TABLES,
  schema: APPROVAL_SCHEMA,
  owner: APPROVAL_OWNER,
  tables: APPROVAL_TABLES,
});

// Decision PENDIENTE, no se introducen flags por comodidad: si el restore
// aislado de 6C necesita `--no-owner` / `--no-privileges` se decidira alli
// con evidencia, no aqui. El wrapper NO los emite.
const OWNERSHIP_FLAGS_DECISION = 'PENDING_6C';

// Claves que, si aparecen en la configuracion, indican un intento de pasar
// una connection string / URI en lugar de campos discretos.
const FORBIDDEN_CONFIG_KEYS = Object.freeze([
  'connectionstring',
  'connectionurl',
  'runtimeurl',
  'dsn',
  'uri',
  'url',
  'pgurl',
  'databaseurl',
]);

const POSTGRES_URI = /\bpostgres(?:ql)?:\/\//i;

// Variables minimas del entorno padre necesarias para que un proceso nativo
// arranque. Se copian por nombre; nunca se hereda el entorno completo.
const WINDOWS_ENVIRONMENT_ALLOWLIST = Object.freeze([
  'SystemRoot',
  'windir',
  'SystemDrive',
  'COMSPEC',
  'PATH',
  'PATHEXT',
  'TEMP',
  'TMP',
  'NUMBER_OF_PROCESSORS',
  'PROCESSOR_ARCHITECTURE',
  // libpq busca el certificado raiz por defecto en %APPDATA%\postgresql\root.crt
  // cuando no se fija PGSSLROOTCERT; sin APPDATA, `verify-full` no puede
  // resolver la CA y el proceso fallaria por una causa enganosa.
  'APPDATA',
]);

const POSIX_ENVIRONMENT_ALLOWLIST = Object.freeze([
  'PATH',
  'HOME',
  'LANG',
  'LC_ALL',
  'TZ',
  'TMPDIR',
]);

const MAX_CAPTURED_OUTPUT = 8000;

// Valor magico documentado en PostgreSQL 18 (libpq-connect.html, seccion
// sslrootcert, disponible desde libpq 16): carga las raices de confianza
// del sistema operativo/implementacion SSL en lugar de un archivo propio.
// Conocido no-funcional en Windows para usuarios sin almacen OpenSSL propio
// (hilo oficial pgsql-hackers, abril 2025) — ver seccion B del informe
// 6B.3A. Se usa por su nombre exacto, sin traducir ni reinterpretar.
const SSL_ROOT_CERT_SYSTEM = 'system';

// --------------------------------------------------------------------------
// Errores fail-closed
// --------------------------------------------------------------------------

class PgDumpWrapperError extends Error {
  constructor(code, detail) {
    super('pg_dump wrapper contract failed.');
    this.name = 'PgDumpWrapperError';
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

function fail(code, detail) {
  throw new PgDumpWrapperError(code, detail);
}

// Reporte de errores por lista blanca de campos: nunca se propaga el objeto
// Error completo de una fase que ha manipulado credenciales reales.
function toSafeFailure(error, fallbackCode = 'backup_operation_failed') {
  const code = error && typeof error.code === 'string' && /^backup_/.test(error.code)
    ? error.code
    : fallbackCode;
  const failure = { code, message: 'Backup operation failed.' };
  if (error && typeof error.detail === 'string') {
    failure.detail = error.detail;
  }
  return Object.freeze(failure);
}

// --------------------------------------------------------------------------
// Saneado de texto
// --------------------------------------------------------------------------

function sanitizeProcessOutput(value, ephemeralSecrets = []) {
  let safe = String(value === undefined || value === null ? '' : value);
  for (const secret of ephemeralSecrets) {
    if (typeof secret === 'string' && secret.length > 0 && safe.includes(secret)) {
      safe = safe.split(secret).join(REDACTED);
    }
  }
  safe = redact(safe);
  return safe
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .slice(0, MAX_CAPTURED_OUTPUT);
}

// --------------------------------------------------------------------------
// Nombre determinista del artefacto
// --------------------------------------------------------------------------

function formatUtcStamp(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    fail('backup_timestamp_invalid');
  }
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function assertSlug(value, code) {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/i.test(value)) {
    fail(code);
  }
  return value;
}

function buildBackupArtifactName({ asset = DEFAULT_ASSET, createdAt, executionId } = {}) {
  assertSlug(asset, 'backup_asset_invalid');
  assertSlug(executionId, 'backup_execution_id_invalid');
  return `${asset}-${formatUtcStamp(createdAt)}-${executionId}${DUMP_EXTENSION}`;
}

// --------------------------------------------------------------------------
// Validacion de conexion (anti-connectionString)
// --------------------------------------------------------------------------

function assertNoConnectionString(config) {
  for (const key of Object.keys(config || {})) {
    if (FORBIDDEN_CONFIG_KEYS.includes(key.replace(/[^a-z0-9]/gi, '').toLowerCase())) {
      fail('backup_connection_string_forbidden', key);
    }
  }
  for (const [key, value] of Object.entries(config || {})) {
    if (typeof value === 'string' && POSTGRES_URI.test(value)) {
      fail('backup_connection_string_forbidden', key);
    }
  }
}

function validateHost(host) {
  if (typeof host !== 'string' || host.trim().length === 0) {
    fail('backup_host_missing');
  }
  const normalized = host.trim();
  // Endpoint pooled => STOP. No se "arregla" automaticamente.
  if (/-pooler/i.test(normalized) || /(^|\.)pooler\./i.test(normalized)) {
    fail('backup_host_pooled_forbidden');
  }
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i.test(normalized)) {
    fail('backup_host_invalid');
  }
  return normalized;
}

function validatePort(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    fail('backup_port_invalid');
  }
  return port;
}

function validateIdentifier(value, code) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    fail(code);
  }
  const normalized = value.trim();
  if (/[\s/@:]/.test(normalized)) {
    fail(code);
  }
  return normalized;
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length === 0) {
    fail('backup_password_missing');
  }
  return password;
}

function validateTlsPolicy({ sslMode, channelBinding }) {
  if (sslMode !== REQUIRED_SSL_MODE) {
    fail('backup_ssl_mode_invalid');
  }
  if (channelBinding !== REQUIRED_CHANNEL_BINDING) {
    fail('backup_channel_binding_invalid');
  }
  return { sslMode, channelBinding };
}

// CA raiz para `verify-full`. Solo dos formas validas: el valor magico
// `system` (documentado desde libpq 16; ver cabecera del modulo sobre su
// limitacion conocida en Windows) o una ruta ABSOLUTA a un archivo que
// exista localmente. Nunca una ruta relativa, nunca vacia-pero-presente,
// nunca un valor que el wrapper no pueda verificar por si mismo.
function validateSslRootCert(rawValue, { fileSystem }) {
  if (rawValue === undefined || rawValue === null) {
    return null;
  }
  if (typeof rawValue !== 'string') {
    fail('backup_ssl_root_cert_invalid');
  }
  const value = rawValue.trim();
  if (value.length === 0) {
    return null;
  }
  if (value === SSL_ROOT_CERT_SYSTEM) {
    return SSL_ROOT_CERT_SYSTEM;
  }
  if (!path.isAbsolute(value)) {
    fail('backup_ssl_root_cert_invalid');
  }
  let stats;
  try {
    stats = fileSystem.statSync(value);
  } catch {
    fail('backup_ssl_root_cert_missing');
  }
  if (!stats.isFile()) {
    fail('backup_ssl_root_cert_missing');
  }
  return value;
}

// --------------------------------------------------------------------------
// Alcance Approval
// --------------------------------------------------------------------------

function validateQualifiedTable(table, schema, code) {
  if (typeof table !== 'string' || !/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/i.test(table)) {
    fail(code, 'table');
  }
  if (!table.toLowerCase().startsWith(`${schema.toLowerCase()}.`)) {
    fail(code, 'schema');
  }
  if (OUT_OF_DOMAIN_TABLES.includes(table.toLowerCase())) {
    fail('backup_scope_out_of_domain', table);
  }
  return table;
}

function validateExplicitScope(scope) {
  const schema = validateIdentifier(scope.schema, 'backup_scope_invalid');
  const tables = Array.isArray(scope.tables) ? scope.tables : null;
  if (!tables || tables.length === 0) {
    fail('backup_scope_invalid');
  }
  for (const table of tables) {
    validateQualifiedTable(table, schema, 'backup_scope_invalid');
  }
  return Object.freeze({
    mode: SCOPE_MODE_EXPLICIT_TABLES,
    schema,
    owner: typeof scope.owner === 'string' ? scope.owner : APPROVAL_OWNER,
    tables: Object.freeze([...tables]),
    catalogVerified: false,
  });
}

// Alcance dinamico "futuros objetos del owner oxkio_approval_owner"
// (6B.3A). No se consulta ningun catalogo real aqui: se compara, por
// IGUALDAD EXACTA DE CONJUNTOS, un manifiesto versionado (`scope.expected`,
// revisado en PR cada vez que se crea un objeto Approval) contra lo que
// devuelva un `resolveApprovalCatalog` inyectado. Sin ambos ingredientes
// explicitos, el modo sigue fallando cerrado como PENDIENTE — nunca se
// activa por inercia ni se completa con un valor por defecto implicito.
// Cualquier discrepancia en cualquier direccion (falta un objeto, sobra
// un objeto, aparece un owner distinto, el resolver falla o devuelve un
// resultado parcial/vacio) es fail-closed: STOP, nunca degradacion parcial.
async function resolveOwnerScope(scope, { resolveApprovalCatalog }) {
  const schema = validateIdentifier(scope.schema, 'backup_scope_invalid');
  const owner = validateIdentifier(
    typeof scope.owner === 'string' ? scope.owner : APPROVAL_OWNER,
    'backup_scope_invalid',
  );

  const expected = Array.isArray(scope.expected) ? scope.expected : null;
  if (!expected || expected.length === 0 || typeof resolveApprovalCatalog !== 'function') {
    // Resolverlo exige el catalogo real de Neon y un manifiesto explicito;
    // ninguno de los dos se asume por defecto.
    fail('backup_scope_resolution_pending');
  }

  const expectedSet = new Set();
  for (const table of expected) {
    validateQualifiedTable(table, schema, 'backup_scope_invalid');
    expectedSet.add(table.toLowerCase());
  }

  let resolved;
  try {
    resolved = await resolveApprovalCatalog({ schema, owner });
  } catch {
    fail('backup_scope_catalog_unavailable');
  }

  if (!Array.isArray(resolved) || resolved.length === 0) {
    fail('backup_scope_catalog_unavailable');
  }

  const resolvedSet = new Set();
  for (const record of resolved) {
    if (
      !record
      || typeof record !== 'object'
      || typeof record.table !== 'string'
      || typeof record.owner !== 'string'
    ) {
      fail('backup_scope_catalog_invalid_record');
    }
    validateQualifiedTable(record.table, schema, 'backup_scope_catalog_invalid_record');
    if (record.owner !== owner) {
      fail('backup_scope_catalog_unexpected_owner', record.table);
    }
    resolvedSet.add(record.table.toLowerCase());
  }

  if (resolvedSet.size !== expectedSet.size) {
    fail('backup_scope_catalog_mismatch');
  }
  for (const table of expectedSet) {
    if (!resolvedSet.has(table)) {
      fail('backup_scope_catalog_mismatch');
    }
  }

  return Object.freeze({
    mode: SCOPE_MODE_OWNER_RESOLVED,
    schema,
    owner,
    tables: Object.freeze([...expectedSet].sort()),
    catalogVerified: true,
  });
}

async function resolveScope(scope, dependencies) {
  if (!scope || typeof scope !== 'object') {
    fail('backup_scope_invalid');
  }
  if (scope.mode === SCOPE_MODE_OWNER_RESOLVED) {
    return resolveOwnerScope(scope, dependencies);
  }
  if (scope.mode !== SCOPE_MODE_EXPLICIT_TABLES) {
    fail('backup_scope_invalid');
  }
  return validateExplicitScope(scope);
}

// --------------------------------------------------------------------------
// Binario pg_dump / pg_restore
// --------------------------------------------------------------------------

function parsePostgresVersion(raw) {
  const match = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(raw || ''));
  if (!match) return null;
  return {
    raw: String(raw).trim(),
    major: Number(match[1]),
    minor: Number(match[2]),
  };
}

function defaultVersionProbe(binaryPath) {
  const { execFileSync } = require('node:child_process');
  // Sonda local sin red, sin credenciales y sin conexion: solo `--version`.
  return execFileSync(binaryPath, ['--version'], {
    encoding: 'utf8',
    timeout: 15000,
    windowsHide: true,
  });
}

function resolveBinary({ binaryPath, missingCode, versionCode, probeVersion }) {
  if (typeof binaryPath !== 'string' || binaryPath.trim().length === 0 || !path.isAbsolute(binaryPath)) {
    fail(missingCode);
  }
  let stats;
  try {
    stats = fs.statSync(binaryPath);
  } catch {
    fail(missingCode);
  }
  if (!stats.isFile()) {
    fail(missingCode);
  }

  let output;
  try {
    output = probeVersion(binaryPath);
  } catch {
    fail(versionCode);
  }

  const version = parsePostgresVersion(output);
  if (!version || version.major !== REQUIRED_PG_MAJOR_VERSION) {
    fail(versionCode);
  }

  return Object.freeze({ path: binaryPath, version: version.raw, major: version.major });
}

// --------------------------------------------------------------------------
// Ubicacion temporal gobernada del artefacto
// --------------------------------------------------------------------------

function containsSegment(target, segment) {
  return target
    .split(/[\\/]+/)
    .some((part) => part.toLowerCase() === segment.toLowerCase());
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function validateOutputPath(outputPath, { fileSystem }) {
  if (typeof outputPath !== 'string' || outputPath.trim().length === 0) {
    fail('backup_output_path_invalid');
  }
  if (!path.isAbsolute(outputPath)) {
    fail('backup_output_path_invalid');
  }
  const resolved = path.resolve(outputPath);
  if (path.extname(resolved).toLowerCase() !== DUMP_EXTENSION) {
    fail('backup_output_path_invalid', 'extension');
  }
  // Nunca dentro del repositorio, ni de OneDrive, ni de un arbol Git.
  if (resolved === REPOSITORY_ROOT || isInside(REPOSITORY_ROOT, resolved)) {
    fail('backup_output_path_forbidden', 'repository');
  }
  if (containsSegment(resolved, 'OneDrive')) {
    fail('backup_output_path_forbidden', 'onedrive');
  }
  if (containsSegment(resolved, '.git')) {
    fail('backup_output_path_forbidden', 'git');
  }

  const directory = path.dirname(resolved);
  let directoryStats;
  try {
    directoryStats = fileSystem.statSync(directory);
  } catch {
    fail('backup_output_directory_missing');
  }
  if (!directoryStats.isDirectory()) {
    fail('backup_output_directory_missing');
  }

  // No overwrite: si el artefacto ya existe, se aborta.
  if (fileSystem.existsSync(resolved)) {
    fail('backup_output_already_exists');
  }

  return resolved;
}

// --------------------------------------------------------------------------
// Entorno del proceso hijo (PGPASSWORD solo aqui)
// --------------------------------------------------------------------------

function copyAllowlisted(parentEnv, allowlist) {
  const copied = {};
  const index = new Map(
    Object.keys(parentEnv).map((key) => [key.toLowerCase(), key]),
  );
  for (const name of allowlist) {
    const actual = index.get(name.toLowerCase());
    if (actual && typeof parentEnv[actual] === 'string') {
      copied[name] = parentEnv[actual];
    }
  }
  return copied;
}

function buildChildEnvironment({
  connection,
  tls,
  sslRootCert,
  parentEnv = process.env,
  platform = process.platform,
} = {}) {
  const allowlist = platform === 'win32'
    ? WINDOWS_ENVIRONMENT_ALLOWLIST
    : POSIX_ENVIRONMENT_ALLOWLIST;

  const childEnv = copyAllowlisted(parentEnv, allowlist);

  // Ninguna PG* heredada del padre puede sobrevivir a esta construccion.
  for (const key of Object.keys(childEnv)) {
    if (/^PG/i.test(key)) delete childEnv[key];
  }

  childEnv.PGHOST = connection.host;
  childEnv.PGPORT = String(connection.port);
  childEnv.PGDATABASE = connection.database;
  childEnv.PGUSER = connection.user;
  childEnv.PGPASSWORD = connection.password;
  childEnv.PGSSLMODE = tls.sslMode;
  childEnv.PGCHANNELBINDING = tls.channelBinding;
  if (typeof sslRootCert === 'string' && sslRootCert.trim().length > 0) {
    childEnv.PGSSLROOTCERT = sslRootCert.trim();
  }

  return childEnv;
}

// --------------------------------------------------------------------------
// Argumentos de pg_dump (nunca secretos)
// --------------------------------------------------------------------------

function buildPgDumpArguments({ outputPath, scope }) {
  const args = [
    `--format=${DUMP_FORMAT}`,
    `--file=${outputPath}`,
    // Sin prompt interactivo: si falta la credencial, se falla cerrado en
    // lugar de bloquear el proceso esperando entrada por consola.
    '--no-password',
  ];
  for (const table of scope.tables) {
    args.push(`--table=${table}`);
  }
  // OWNERSHIP_FLAGS_DECISION = PENDING_6C: no se anaden --no-owner ni
  // --no-privileges sin la evidencia del restore aislado de 6C.
  return args;
}

function assertArgumentsFreeOfSecrets(args, ephemeralSecrets = []) {
  for (const arg of args) {
    const value = String(arg);
    if (POSTGRES_URI.test(value)) {
      fail('backup_secret_in_arguments', 'uri');
    }
    if (/^-{1,2}(W|password)$/i.test(value) || /^--dbname=/i.test(value)) {
      fail('backup_secret_in_arguments', 'flag');
    }
    if (/PGPASSWORD/i.test(value)) {
      fail('backup_secret_in_arguments', 'pgpassword');
    }
    for (const secret of ephemeralSecrets) {
      if (typeof secret === 'string' && secret.length > 0 && value.includes(secret)) {
        fail('backup_secret_in_arguments', 'credential');
      }
    }
  }
  return args;
}

// --------------------------------------------------------------------------
// Runner de proceso (inyectable)
// --------------------------------------------------------------------------

function defaultProcessRunner({ command, args, env, cwd, timeoutMs }) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, {
        env,
        cwd,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        ...(Number.isInteger(timeoutMs) && timeoutMs > 0 ? { timeout: timeoutMs } : {}),
      });
    } catch {
      reject(new PgDumpWrapperError('backup_process_spawn_failed'));
      return;
    }

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      if (stdout.length < MAX_CAPTURED_OUTPUT) stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      if (stderr.length < MAX_CAPTURED_OUTPUT) stderr += chunk.toString('utf8');
    });
    child.on('error', () => {
      reject(new PgDumpWrapperError('backup_process_spawn_failed'));
    });
    child.on('close', (exitCode, signal) => {
      resolve({ exitCode, signal, stdout, stderr });
    });
  });
}

// --------------------------------------------------------------------------
// Integridad del artefacto
// --------------------------------------------------------------------------

function hashArtifact(artifactPath, { fileSystem }) {
  const hash = crypto.createHash('sha256');
  hash.update(fileSystem.readFileSync(artifactPath));
  return hash.digest('hex');
}

// --------------------------------------------------------------------------
// Plan validado (nucleo compartido por validateOnly y runExport)
// --------------------------------------------------------------------------

async function buildValidatedPlan(config, dependencies) {
  const { fileSystem, probeVersion, parentEnv, platform, resolveApprovalCatalog } = dependencies;

  assertNoConnectionString(config);

  const executionId = assertSlug(config.executionId, 'backup_execution_id_invalid');
  const asset = assertSlug(
    config.asset === undefined ? DEFAULT_ASSET : config.asset,
    'backup_asset_invalid',
  );

  const connection = {
    host: validateHost(config.host),
    port: validatePort(config.port),
    database: validateIdentifier(config.database, 'backup_database_invalid'),
    user: validateIdentifier(config.user, 'backup_user_invalid'),
    password: validatePassword(config.password),
  };

  const tls = validateTlsPolicy({
    sslMode: config.sslMode === undefined ? REQUIRED_SSL_MODE : config.sslMode,
    channelBinding:
      config.channelBinding === undefined ? REQUIRED_CHANNEL_BINDING : config.channelBinding,
  });

  const sslRootCert = validateSslRootCert(config.sslRootCert, { fileSystem });

  const scope = await resolveScope(
    config.scope === undefined ? APPROVAL_BACKUP_SCOPE : config.scope,
    { resolveApprovalCatalog },
  );

  const pgDump = resolveBinary({
    binaryPath: config.pgDumpPath,
    missingCode: 'backup_pg_dump_missing',
    versionCode: 'backup_pg_dump_version_unsupported',
    probeVersion,
  });

  const outputPath = validateOutputPath(config.outputPath, { fileSystem });

  const args = assertArgumentsFreeOfSecrets(
    buildPgDumpArguments({ outputPath, scope }),
    [connection.password],
  );

  const childEnv = buildChildEnvironment({
    connection,
    tls,
    sslRootCert,
    parentEnv,
    platform,
  });

  return {
    asset,
    executionId,
    connection,
    tls,
    scope,
    pgDump,
    outputPath,
    args,
    childEnv,
    sslRootCert,
    timeoutMs: Number.isInteger(config.timeoutMs) && config.timeoutMs > 0 ? config.timeoutMs : null,
  };
}

// Proyeccion publica: exclusivamente datos NO SECRETOS. Nunca PGPASSWORD,
// nunca el host completo, nunca valores de entorno.
function describePlan(plan) {
  return Object.freeze({
    ok: true,
    asset: plan.asset,
    executionId: plan.executionId,
    pgDump: Object.freeze({ path: plan.pgDump.path, version: plan.pgDump.version }),
    endpoint: Object.freeze({
      kind: 'direct',
      pooled: false,
      port: plan.connection.port,
      database: plan.connection.database,
      user: plan.connection.user,
      host: REDACTED,
    }),
    tls: Object.freeze({
      sslMode: plan.tls.sslMode,
      channelBinding: plan.tls.channelBinding,
      sslRootCert:
        plan.sslRootCert === null
          ? 'unset'
          : plan.sslRootCert === SSL_ROOT_CERT_SYSTEM
            ? 'system'
            : 'explicit-file',
    }),
    scope: Object.freeze({
      mode: plan.scope.mode,
      schema: plan.scope.schema,
      owner: plan.scope.owner,
      tables: Object.freeze([...plan.scope.tables]),
      catalogVerified: plan.scope.catalogVerified,
    }),
    format: DUMP_FORMAT,
    ownershipFlags: OWNERSHIP_FLAGS_DECISION,
    args: Object.freeze([...plan.args]),
    environmentKeys: Object.freeze(Object.keys(plan.childEnv).sort()),
    output: Object.freeze({
      basename: path.basename(plan.outputPath),
      insideRepository: false,
    }),
    timeoutMs: plan.timeoutMs,
    processLaunched: false,
  });
}

// Limpieza logica de referencias a la credencial efimera. No se afirma
// borrado seguro de RAM: solo se deja de referenciar el valor.
function releaseCredential(plan) {
  plan.childEnv.PGPASSWORD = '';
  delete plan.childEnv.PGPASSWORD;
  plan.connection.password = '';
}

// --------------------------------------------------------------------------
// API publica
// --------------------------------------------------------------------------

function createPgDumpWrapper(dependencies = {}) {
  const {
    fileSystem = fs,
    probeVersion = defaultVersionProbe,
    runProcess = defaultProcessRunner,
    parentEnv = process.env,
    platform = process.platform,
    now = () => new Date(),
    // Sin resolver inyectado, el modo owner_resolved sigue fallando cerrado
    // como PENDIENTE (backup_scope_resolution_pending): no hay resolucion
    // real de catalogo en 6B.3A, solo el contrato para probarla offline.
    resolveApprovalCatalog,
  } = dependencies;

  const shared = { fileSystem, probeVersion, parentEnv, platform, resolveApprovalCatalog };

  // ValidateOnly: valida la configuracion (incluida, si se pide, la
  // comparacion exacta manifiesto-vs-catalogo mediante el resolver
  // inyectado), resuelve el binario, construye args y entorno saneados y
  // NO lanza pg_dump ni abre ninguna conexion.
  // (La resolucion del binario incluye una sonda local `--version`, sin red
  //  y sin credenciales; sin ella la puerta de version no seria exigible.)
  async function validateOnly(config = {}) {
    const plan = await buildValidatedPlan(config, shared);
    const description = describePlan(plan);
    releaseCredential(plan);
    return description;
  }

  function resolveArtifactPath({ directory, asset = DEFAULT_ASSET, executionId, createdAt } = {}) {
    if (typeof directory !== 'string' || !path.isAbsolute(directory)) {
      fail('backup_output_path_invalid', 'directory');
    }
    return path.join(
      directory,
      buildBackupArtifactName({
        asset,
        createdAt: createdAt === undefined ? now() : createdAt,
        executionId,
      }),
    );
  }

  // Ejecucion real. NO se invoca contra Neon en 5C.7B.6B.2: exige una
  // puerta humana separada. Se implementa aqui el comportamiento
  // fail-closed POST para que la ejecucion real de 6B no improvise.
  async function runExport(config = {}) {
    const plan = await buildValidatedPlan(config, shared);
    const startedAt = Date.now();
    const ephemeralSecrets = [plan.connection.password];

    let result;
    try {
      result = await runProcess({
        command: plan.pgDump.path,
        args: plan.args,
        env: plan.childEnv,
        cwd: path.dirname(plan.outputPath),
        timeoutMs: plan.timeoutMs,
      });
    } finally {
      releaseCredential(plan);
    }

    const evidence = {
      asset: plan.asset,
      executionId: plan.executionId,
      pgDumpVersion: plan.pgDump.version,
      format: DUMP_FORMAT,
      scope: Object.freeze([...plan.scope.tables]),
      outputBasename: path.basename(plan.outputPath),
      exitCode: result ? result.exitCode : null,
      signal: result && result.signal ? result.signal : null,
      elapsedMs: Date.now() - startedAt,
      stdout: sanitizeProcessOutput(result && result.stdout, ephemeralSecrets),
      stderr: sanitizeProcessOutput(result && result.stderr, ephemeralSecrets),
    };

    function failed(code, extra = {}) {
      return Object.freeze({
        ok: false,
        failure: toSafeFailure(new PgDumpWrapperError(code)),
        evidence: Object.freeze({ ...evidence, ...extra }),
      });
    }

    if (!result || result.signal) return failed('backup_process_signaled');
    if (result.exitCode !== 0) return failed('backup_process_failed');
    if (!fileSystem.existsSync(plan.outputPath)) return failed('backup_artifact_missing');

    const sizeBytes = fileSystem.statSync(plan.outputPath).size;
    if (!(sizeBytes > 0)) return failed('backup_artifact_empty', { sizeBytes });

    evidence.sizeBytes = sizeBytes;
    evidence.sha256 = hashArtifact(plan.outputPath, { fileSystem });

    return Object.freeze({ ok: true, evidence: Object.freeze(evidence) });
  }

  // Verificacion futura del custom dump sin restaurarlo (6B, seccion F).
  async function listArtifact({ pgRestorePath, artifactPath, timeoutMs } = {}) {
    const pgRestore = resolveBinary({
      binaryPath: pgRestorePath,
      missingCode: 'backup_pg_restore_missing',
      versionCode: 'backup_pg_restore_version_unsupported',
      probeVersion,
    });

    if (
      typeof artifactPath !== 'string'
      || !path.isAbsolute(artifactPath)
      || !fileSystem.existsSync(artifactPath)
    ) {
      fail('backup_artifact_missing');
    }

    const result = await runProcess({
      command: pgRestore.path,
      args: ['--list', artifactPath],
      env: copyAllowlisted(
        parentEnv,
        platform === 'win32' ? WINDOWS_ENVIRONMENT_ALLOWLIST : POSIX_ENVIRONMENT_ALLOWLIST,
      ),
      cwd: path.dirname(artifactPath),
      timeoutMs: Number.isInteger(timeoutMs) && timeoutMs > 0 ? timeoutMs : null,
    });

    const stdout = sanitizeProcessOutput(result && result.stdout);
    const stderr = sanitizeProcessOutput(result && result.stderr);

    if (!result || result.signal || result.exitCode !== 0) {
      return Object.freeze({
        ok: false,
        failure: toSafeFailure(new PgDumpWrapperError('backup_artifact_not_listable')),
        pgRestoreVersion: pgRestore.version,
        stderr,
      });
    }

    const entries = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith(';'));

    return Object.freeze({
      ok: true,
      pgRestoreVersion: pgRestore.version,
      entryCount: entries.length,
      entries: Object.freeze(entries),
    });
  }

  return Object.freeze({
    validateOnly,
    resolveArtifactPath,
    runExport,
    listArtifact,
  });
}

module.exports = {
  APPROVAL_BACKUP_SCOPE,
  APPROVAL_OWNER,
  APPROVAL_SCHEMA,
  DEFAULT_ASSET,
  DUMP_EXTENSION,
  DUMP_FORMAT,
  OUT_OF_DOMAIN_TABLES,
  OWNERSHIP_FLAGS_DECISION,
  POSIX_ENVIRONMENT_ALLOWLIST,
  PgDumpWrapperError,
  REQUIRED_CHANNEL_BINDING,
  REQUIRED_PG_MAJOR_VERSION,
  REQUIRED_SSL_MODE,
  SCOPE_MODE_EXPLICIT_TABLES,
  SCOPE_MODE_OWNER_RESOLVED,
  SSL_ROOT_CERT_SYSTEM,
  WINDOWS_ENVIRONMENT_ALLOWLIST,
  buildBackupArtifactName,
  buildChildEnvironment,
  createPgDumpWrapper,
  parsePostgresVersion,
  sanitizeProcessOutput,
  toSafeFailure,
};

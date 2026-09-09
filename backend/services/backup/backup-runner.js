'use strict';

// 5C.7B.6B.3E — Runner/entrypoint OFFLINE del backup de Approval.
//
// Este modulo NO conecta con Neon, NO ejecuta `pg_dump` contra datos
// reales y NO crea ningun secreto. Compone el flujo:
//
//   preflight -> catalogo Approval -> validate -> pg_dump -> verify
//
// reutilizando integramente `pg-dump-wrapper.js` (nunca reimplementa la
// invocacion de `pg_dump`) y `approval-domain-manifest.js` (nunca
// duplica la lista de tablas del dominio Approval). Su unico valor
// anadido es la COMPOSICION: recibe la credencial y el catalogo real a
// traves de dos interfaces inyectables (`secretProvider`,
// `resolveApprovalCatalog`) que en este cambio NUNCA tienen una
// implementacion real de Neon ni de Secret Manager — solo el contrato,
// probado con fixtures/mocks sinteticos. Sin ambas interfaces
// inyectadas, el runner falla cerrado antes de tocar nada.

const path = require('node:path');

const {
  APPROVAL_OWNER,
  APPROVAL_SCHEMA,
  REQUIRED_CHANNEL_BINDING,
  REQUIRED_SSL_MODE,
  SCOPE_MODE_OWNER_RESOLVED,
  SSL_ROOT_CERT_SYSTEM,
  createPgDumpWrapper,
} = require('./pg-dump-wrapper');
const { EXPECTED_APPROVAL_TABLES } = require('./approval-domain-manifest');

const MODE_VALIDATE_ONLY = 'validate-only';
const MODE_EXECUTE = 'execute';
const SUPPORTED_MODES = Object.freeze([MODE_VALIDATE_ONLY, MODE_EXECUTE]);

// Alcance por defecto del runner: el manifiesto versionado (6B.3A) con
// verificacion de catalogo activada. El runner NUNCA declara su propia
// lista de tablas — la consume tal cual del manifiesto.
function defaultScope() {
  return Object.freeze({
    mode: SCOPE_MODE_OWNER_RESOLVED,
    schema: APPROVAL_SCHEMA,
    owner: APPROVAL_OWNER,
    expected: EXPECTED_APPROVAL_TABLES,
  });
}

class BackupRunnerError extends Error {
  constructor(code, detail) {
    super('Backup runner contract failed.');
    this.name = 'BackupRunnerError';
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

function fail(code, detail) {
  throw new BackupRunnerError(code, detail);
}

// Reporte de errores por lista blanca de campos, igual que
// `toSafeFailure` de `pg-dump-wrapper.js`: nunca se propaga el objeto
// Error completo de una fase que ha manipulado una credencial real.
function toSafeRunnerFailure(error, fallbackCode = 'runner_operation_failed') {
  const code = error && typeof error.code === 'string'
    ? error.code
    : fallbackCode;
  const failure = { code, message: 'Backup runner operation failed.' };
  if (error && typeof error.detail === 'string') {
    failure.detail = error.detail;
  }
  return Object.freeze(failure);
}

function assertMode(mode) {
  if (!SUPPORTED_MODES.includes(mode)) {
    fail('runner_mode_unknown', String(mode));
  }
  return mode;
}

function assertSecretProvider(secretProvider) {
  if (!secretProvider || typeof secretProvider.getBackupCredential !== 'function') {
    fail('runner_secret_provider_missing');
  }
  return secretProvider;
}

// Verificacion temprana y especifica del runner: el propio
// `pg-dump-wrapper.js` ya falla cerrado con `backup_scope_resolution_pending`
// si falta el resolver, pero aqui se anticipa con un codigo mas legible
// para quien opera el runner, sin sustituir esa garantia (defensa en
// profundidad, no unica linea de defensa).
function assertCatalogProviderIfNeeded(scope, resolveApprovalCatalog) {
  if (scope && scope.mode === SCOPE_MODE_OWNER_RESOLVED && typeof resolveApprovalCatalog !== 'function') {
    fail('runner_catalog_provider_missing');
  }
}

function assertExecuteAuthorized(mode, allowExecute) {
  if (mode === MODE_EXECUTE && allowExecute !== true) {
    // Contrato interno: EXECUTE existe pero nunca es invocable por
    // accidente. Se requieren DOS senales explicitas y separadas
    // (mode === 'execute' Y allowExecute === true), nunca una sola.
    fail('runner_execute_not_authorized');
  }
}

function assertCredentialShape(credential) {
  if (
    !credential
    || typeof credential !== 'object'
    || typeof credential.host !== 'string'
    || !Number.isInteger(credential.port)
    || typeof credential.database !== 'string'
    || typeof credential.user !== 'string'
    || typeof credential.password !== 'string'
  ) {
    fail('runner_credential_invalid');
  }
  return credential;
}

// Limpieza logica de la copia de la credencial que sostiene el runner
// (distinta de la copia interna del wrapper, que ya se libera sola). No
// se afirma borrado seguro de RAM: solo se deja de referenciar el valor.
function releaseLocalCredential(credential) {
  if (credential && typeof credential === 'object') {
    credential.password = '';
    delete credential.password;
  }
}

// --------------------------------------------------------------------------
// Composicion (nucleo, sin efectos de red/proceso salvo lo que el propio
// wrapper decida — y el wrapper nunca decide nada sin ValidateOnly/EXECUTE
// explicitos)
// --------------------------------------------------------------------------

async function composeBackupRequest({
  mode = MODE_VALIDATE_ONLY,
  allowExecute = false,
  executionId,
  asset,
  outputDirectory,
  pgDumpPath,
  secretProvider,
  resolveApprovalCatalog,
  scope,
  sslRootCert,
  timeoutMs,
  createWrapper = createPgDumpWrapper,
  wrapperDependencies = {},
  now = () => new Date(),
} = {}) {
  assertMode(mode);
  assertExecuteAuthorized(mode, allowExecute);
  assertSecretProvider(secretProvider);

  const effectiveScope = scope === undefined ? defaultScope() : scope;
  assertCatalogProviderIfNeeded(effectiveScope, resolveApprovalCatalog);

  const wrapper = createWrapper({ resolveApprovalCatalog, now, ...wrapperDependencies });

  if (typeof executionId !== 'string' || executionId.trim().length === 0) {
    fail('runner_execution_id_missing');
  }
  if (typeof outputDirectory !== 'string' || !path.isAbsolute(outputDirectory)) {
    fail('runner_output_directory_invalid');
  }

  const outputPath = wrapper.resolveArtifactPath({
    directory: outputDirectory,
    asset,
    executionId,
    createdAt: now(),
  });

  const credential = assertCredentialShape(await secretProvider.getBackupCredential());

  let pgDumpConfig;
  try {
    pgDumpConfig = {
      host: credential.host,
      port: credential.port,
      database: credential.database,
      user: credential.user,
      password: credential.password,
      sslMode: REQUIRED_SSL_MODE,
      channelBinding: REQUIRED_CHANNEL_BINDING,
      // Politica Linux ratificada en 6B.3D: system trust store por
      // defecto, sin root.crt propio, salvo que el llamador imponga
      // explicitamente otra ruta (p. ej. pruebas locales en Windows).
      sslRootCert: sslRootCert === undefined ? SSL_ROOT_CERT_SYSTEM : sslRootCert,
      scope: effectiveScope,
      pgDumpPath,
      outputPath,
      executionId,
      asset,
      timeoutMs,
    };
  } finally {
    releaseLocalCredential(credential);
  }

  return Object.freeze({ wrapper, pgDumpConfig });
}

// --------------------------------------------------------------------------
// API publica
// --------------------------------------------------------------------------

// ValidateOnly: nunca abre red, nunca ejecuta `pg_dump`. Compone la
// configuracion a traves de los providers inyectados y delega en
// `wrapper.validateOnly`, que ya es fail-closed por si mismo.
async function runValidateOnly(options = {}) {
  if (options.mode !== undefined && options.mode !== MODE_VALIDATE_ONLY) {
    fail('runner_mode_unknown', String(options.mode));
  }
  try {
    const { wrapper, pgDumpConfig } = await composeBackupRequest({
      ...options,
      mode: MODE_VALIDATE_ONLY,
      allowExecute: false,
    });
    const description = await wrapper.validateOnly(pgDumpConfig);
    return Object.freeze({ ok: true, runnerMode: MODE_VALIDATE_ONLY, ...description });
  } catch (error) {
    return Object.freeze({
      ok: false,
      runnerMode: MODE_VALIDATE_ONLY,
      failure: toSafeRunnerFailure(error),
    });
  }
}

// EXECUTE: contrato interno para una futura puerta humana. Requiere
// `allowExecute: true` explicito ademas de `mode: 'execute'`; sin ambas
// senales, o sin cualquiera de las dependencias reales
// (pgDumpPath/secretProvider/resolveApprovalCatalog cuando aplica),
// falla cerrado ANTES de intentar nada. En 5C.7B.6B.3E nunca se invoca
// con un `runProcess` real: los tests siempre inyectan un doble.
async function runExecute(options = {}) {
  if (options.mode !== undefined && options.mode !== MODE_EXECUTE) {
    fail('runner_mode_unknown', String(options.mode));
  }
  try {
    const { wrapper, pgDumpConfig } = await composeBackupRequest({
      ...options,
      mode: MODE_EXECUTE,
      allowExecute: options.allowExecute === true,
    });
    const result = await wrapper.runExport(pgDumpConfig);
    return Object.freeze({ runnerMode: MODE_EXECUTE, ...result });
  } catch (error) {
    return Object.freeze({
      ok: false,
      runnerMode: MODE_EXECUTE,
      failure: toSafeRunnerFailure(error),
    });
  }
}

// --------------------------------------------------------------------------
// CLI (entrypoint del target Docker `backup`, invocacion explicita)
// --------------------------------------------------------------------------

function parseArgs(argv) {
  const flags = { mode: MODE_VALIDATE_ONLY, allowExecute: false };
  for (const arg of argv) {
    if (arg === '--validate-only') flags.mode = MODE_VALIDATE_ONLY;
    else if (arg === '--execute') flags.mode = MODE_EXECUTE;
    else if (arg === '--allow-execute') flags.allowExecute = true;
    else if (arg.startsWith('--execution-id=')) flags.executionId = arg.slice('--execution-id='.length);
    else if (arg.startsWith('--asset=')) flags.asset = arg.slice('--asset='.length);
    else if (arg.startsWith('--output-dir=')) flags.outputDirectory = arg.slice('--output-dir='.length);
    else if (arg.startsWith('--pg-dump-path=')) flags.pgDumpPath = arg.slice('--pg-dump-path='.length);
  }
  return flags;
}

// En 5C.7B.6B.3E no existe ningun proveedor real de secretos ni de
// catalogo: ejecutar este CLI tal cual, sin inyectar `createProviders`
// de test, falla cerrado con `runner_secret_provider_missing`. Es
// intencional — esta fase entrega el contrato del runner, no una
// integracion con Neon/Secret Manager.
function defaultCreateProviders() {
  return { secretProvider: undefined, resolveApprovalCatalog: undefined };
}

async function main({
  argv = process.argv.slice(2),
  createProviders = defaultCreateProviders,
  write = (text) => process.stdout.write(text),
  writeError = (text) => process.stderr.write(text),
} = {}) {
  const flags = parseArgs(argv);
  // `wrapperDependencies` solo existe para que los tests del propio CLI
  // puedan inyectar un `probeVersion`/`runProcess` falsos sin tocar un
  // binario real; `defaultCreateProviders` nunca lo devuelve.
  const { secretProvider, resolveApprovalCatalog, wrapperDependencies } = createProviders();

  const runner = flags.mode === MODE_EXECUTE ? runExecute : runValidateOnly;
  const result = await runner({
    mode: flags.mode,
    allowExecute: flags.allowExecute,
    executionId: flags.executionId,
    asset: flags.asset,
    outputDirectory: flags.outputDirectory,
    pgDumpPath: flags.pgDumpPath,
    secretProvider,
    resolveApprovalCatalog,
    ...(wrapperDependencies ? { wrapperDependencies } : {}),
  });

  write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) {
    process.exitCode = 1;
    return;
  }
  process.exitCode = 0;
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`Backup runner failed: ${error && error.message ? error.message : 'unknown error'}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  BackupRunnerError,
  MODE_EXECUTE,
  MODE_VALIDATE_ONLY,
  SUPPORTED_MODES,
  composeBackupRequest,
  defaultScope,
  main,
  parseArgs,
  runExecute,
  runValidateOnly,
  toSafeRunnerFailure,
};

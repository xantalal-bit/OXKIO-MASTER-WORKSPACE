'use strict';

// Tests OFFLINE/estaticos de 004_approval_items_client_id_guard.sql
// (5C.7B.3F / B4.D.1 -> regularizacion 21/08/2026). Ninguno de estos tests
// importa `pg`, crea un Pool o abre una conexion. Solo leen el texto de la
// migracion (y, para el guardarrail de no-regresion, el de 003) y comprueban
// propiedades textuales/estructurales. No modifican ni reejecutan 003.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MIGRATION_PATH = path.join(__dirname, '004_approval_items_client_id_guard.sql');
const MIGRATION_003_PATH = path.join(__dirname, '003_approval_items.sql');

const migrationSql = fs.readFileSync(MIGRATION_PATH, 'utf8');
const migration003Sql = fs.readFileSync(MIGRATION_003_PATH, 'utf8');

// Congelado el 17/08/2026 al cerrar B3/B3.1 y reverificado en cada auditoria
// PRE-B4.D/B4.D.1 posterior. 004 NUNCA debe modificar 003; este test lo
// comprueba de forma independiente del resto de la suite de 003.
const EXPECTED_003_SHA256 = '45e1b076947fdf9bea2bd8e54d959b105fdf1b24bfb7487a9cd9cb16678b32c2';

function stripSqlComments(sql) {
  return sql.replace(/--[^\n]*/g, '');
}

test('003_approval_items.sql permanece exactamente intacto (hash congelado)', () => {
  const sha256 = crypto.createHash('sha256').update(migration003Sql, 'utf8').digest('hex');
  assert.equal(sha256, EXPECTED_003_SHA256, '004 no debe modificar ni reescribir 003');
});

test('004 es una unica transaccion explicita con ON_ERROR_STOP', () => {
  assert.match(migrationSql, /^\\set ON_ERROR_STOP on/);
  assert.match(migrationSql, /^BEGIN;/m);
  assert.match(migrationSql, /^COMMIT;/m);
});

test('004 se ejecuta bajo SET LOCAL ROLE oxkio_approval_owner, nunca oxkio_mission_owner', () => {
  const executable = stripSqlComments(migrationSql);
  const roleMatches = executable.match(/SET\s+LOCAL\s+ROLE\s+([a-z_][a-z0-9_]*)/gi) || [];
  assert.equal(roleMatches.length, 1, 'se esperaba exactamente un SET LOCAL ROLE');
  assert.match(roleMatches[0], /oxkio_approval_owner/i);
  assert.doesNotMatch(executable, /SET\s+LOCAL\s+ROLE\s+oxkio_mission_owner/i);
  assert.doesNotMatch(executable, /\boxkio_mission_owner\b/);
  assert.doesNotMatch(executable, /\boxkio_mission_runtime\b/);
});

test('ALTER POLICY exacta sobre approval_items_scope_isolation, no DROP/CREATE POLICY', () => {
  const executable = stripSqlComments(migrationSql);
  assert.match(executable, /ALTER POLICY approval_items_scope_isolation ON oxkio\.approval_items/);
  assert.doesNotMatch(executable, /DROP POLICY/i);
  assert.doesNotMatch(executable, /CREATE POLICY/i);
});

test('USING contiene NULLIF(current_setting(...), \'\') exactamente, sin OR ni fallback', () => {
  const match = migrationSql.match(
    /ALTER POLICY approval_items_scope_isolation ON oxkio\.approval_items\s*\n\s*USING \(([\s\S]*?)\)\s*\n\s*WITH CHECK \(([\s\S]*?)\);/,
  );
  assert.ok(match, 'ALTER POLICY ... USING (...) WITH CHECK (...) no encontrado');
  const using = match[1].trim();
  const withCheck = match[2].trim();
  const expected = "client_id = NULLIF(current_setting('app.client_id', true), '')";
  assert.equal(using, expected);
  assert.equal(withCheck, expected, 'WITH CHECK debe ser identico a USING');
});

test('la expresion de la policy no introduce OR, tautologias ni valores centinela', () => {
  const match = migrationSql.match(/ALTER POLICY[\s\S]*?WITH CHECK \(([\s\S]*?)\);/);
  assert.ok(match);
  const withCheck = match[1];
  // El literal "true" es LEGITIMO aqui: es el segundo argumento (missing_ok)
  // de current_setting(...), no un booleano suelto ni una disyuncion. Lo que
  // se prohibe es "OR", una tautologia como WITH CHECK (true) a secas, o un
  // valor centinela en vez del scope real.
  assert.doesNotMatch(withCheck, /\bOR\b/i);
  assert.doesNotMatch(withCheck, /1\s*=\s*1/);
  assert.doesNotMatch(withCheck, /'anonymous'|'default'|'system'|'__/i);
  assert.doesNotMatch(withCheck, /current_setting\([^)]*\)\s*,\s*(false)\s*\)/i,
    'missing_ok debe seguir siendo true, no false (eso convertiria la ausencia de scope en un error, no en NULL)');
});

test('el constraint de no-vacio usa btrim(client_id) <> \'\' con el nombre esperado', () => {
  const executable = stripSqlComments(migrationSql);
  assert.match(
    executable,
    /ALTER TABLE oxkio\.approval_items\s*\n\s*ADD CONSTRAINT approval_items_client_id_nonempty_ck CHECK \(btrim\(client_id\) <> ''\);/,
  );
});

test('el constraint usa btrim, no una comparacion literal contra \'\' unicamente', () => {
  // Bloquea especificamente que una futura edicion relaje el guard a
  // CHECK (client_id <> '') sin btrim, que dejaria pasar ' ' o '   '. La
  // expresion tiene parentesis anidados (btrim(client_id)), asi que se
  // valida contra el texto completo de la sentencia, no con un grupo
  // "hasta el primer paréntesis de cierre".
  assert.match(
    stripSqlComments(migrationSql),
    /ADD CONSTRAINT approval_items_client_id_nonempty_ck CHECK \(btrim\(client_id\) <> ''\)/,
  );
});

test('004 no toca Mission Queue', () => {
  const executable = stripSqlComments(migrationSql);
  assert.doesNotMatch(executable, /\bmissions\b/i);
  assert.doesNotMatch(executable, /\bmission_confirmations\b/i);
  assert.doesNotMatch(executable, /\boxkio_mission_owner\b/);
  assert.doesNotMatch(executable, /\boxkio_mission_runtime\b/);
});

test('004 no cambia la propiedad del esquema oxkio ni crea/altera esquemas', () => {
  const executable = stripSqlComments(migrationSql);
  assert.doesNotMatch(executable, /CREATE SCHEMA/i);
  assert.doesNotMatch(executable, /ALTER SCHEMA/i);
  assert.doesNotMatch(executable, /AUTHORIZATION/i);
});

test('004 no concede ni revoca privilegios', () => {
  const executable = stripSqlComments(migrationSql);
  assert.doesNotMatch(executable, /\bGRANT\b/i);
  assert.doesNotMatch(executable, /\bREVOKE\b/i);
});

test('004 nunca borra ni trunca datos ni elimina la tabla', () => {
  const executable = stripSqlComments(migrationSql);
  assert.doesNotMatch(executable, /\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(executable, /\bTRUNCATE\b/i);
  assert.doesNotMatch(executable, /\bDROP\s+TABLE\b/i);
  assert.doesNotMatch(executable, /\bDROP\s+SCHEMA\b/i);
});

test('004 no crea, altera ni elimina roles, ni toca IAM/Secret Manager/gcloud', () => {
  const executable = stripSqlComments(migrationSql);
  assert.doesNotMatch(executable, /CREATE ROLE/i);
  assert.doesNotMatch(executable, /CREATE USER/i);
  assert.doesNotMatch(executable, /ALTER ROLE/i);
  assert.doesNotMatch(executable, /PASSWORD/i);
  assert.doesNotMatch(migrationSql, /gcloud|secretmanager|SecretManagerServiceClient/i);
});

test('004 no modifica columnas existentes ni anade columnas nuevas', () => {
  const executable = stripSqlComments(migrationSql);
  assert.doesNotMatch(executable, /ADD COLUMN/i);
  assert.doesNotMatch(executable, /DROP COLUMN/i);
  assert.doesNotMatch(executable, /ALTER COLUMN/i);
  assert.doesNotMatch(executable, /RENAME COLUMN/i);
});

test('004 no crea, elimina ni modifica indices', () => {
  const executable = stripSqlComments(migrationSql);
  assert.doesNotMatch(executable, /CREATE\s+(UNIQUE\s+)?INDEX/i);
  assert.doesNotMatch(executable, /DROP\s+INDEX/i);
  assert.doesNotMatch(executable, /REINDEX/i);
});

test('004 no toca version, CAS ni ningun otro constraint/columna de 003', () => {
  const executable = stripSqlComments(migrationSql);
  assert.doesNotMatch(executable, /\bversion\b/i);
  assert.doesNotMatch(executable, /approval_items_pk/);
  assert.doesNotMatch(executable, /approval_items_status_ck/);
  assert.doesNotMatch(executable, /approval_items_version_ck/);
  assert.doesNotMatch(executable, /approval_items_execution_attempt_count_ck/);
  assert.doesNotMatch(executable, /approval_items_timestamps_ck/);
  assert.doesNotMatch(executable, /approval_items_client_status_created_idx/);
  assert.doesNotMatch(executable, /approval_items_client_status_lease_idx/);
});

test('004 no toca los grants de oxkio_approval_runtime (SELECT/INSERT/UPDATE ya concedidos en 003)', () => {
  const executable = stripSqlComments(migrationSql);
  assert.doesNotMatch(executable, /\boxkio_approval_runtime\b/);
});

test('004 no usa CONCURRENTLY ni ninguna construccion incompatible con una transaccion', () => {
  for (const forbidden of [/\bCONCURRENTLY\b/i, /\bVACUUM\b/i, /\bCREATE\s+DATABASE\b/i,
                           /\bCREATE\s+TABLESPACE\b/i]) {
    assert.doesNotMatch(migrationSql, forbidden);
  }
});

test('004 no usa NOT VALID / VALIDATE CONSTRAINT (tabla vacia: validacion inmediata es suficiente)', () => {
  // Los comentarios explican deliberadamente POR QUE no se usa NOT VALID
  // (usando esas mismas palabras); solo el SQL EJECUTABLE debe carecer de
  // esa construccion. Mismo criterio que el resto de comprobaciones sobre
  // texto ejecutable en esta suite y en la de 003.
  const executable = stripSqlComments(migrationSql);
  assert.doesNotMatch(executable, /NOT VALID/i);
  assert.doesNotMatch(executable, /VALIDATE CONSTRAINT/i);
});

test('no aparece ninguna conexion, secreto o cliente pg en la migracion', () => {
  assert.doesNotMatch(migrationSql, /connectionString/i);
  assert.doesNotMatch(migrationSql, /sslmode/i);
  assert.doesNotMatch(migrationSql, /neon\.tech/i);
  assert.doesNotMatch(migrationSql, /OXKIO_APPROVAL_PG_RUNTIME_URL/);
  assert.doesNotMatch(migrationSql, /require\(['"]pg['"]\)/);
});

test('este fichero de test nunca importa pg ni abre una conexion', () => {
  const selfSource = fs.readFileSync(__filename, 'utf8');
  assert.doesNotMatch(selfSource, /require\(['"]pg['"]\)/);
  assert.doesNotMatch(selfSource, /new Pool\(/);
});

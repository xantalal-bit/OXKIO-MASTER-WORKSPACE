'use strict';

// 5C.7B.6B.3A — Manifiesto versionado del dominio Approval.
//
// Enumera, de forma explicita y auditable en Git, los objetos que el
// backup independiente (`pg_dump`) debe encontrar bajo el owner
// `oxkio_approval_owner`. Este archivo es el "conjunto esperado" del
// contrato de alcance dinamico del wrapper (`SCOPE_MODE_OWNER_RESOLVED`
// en `pg-dump-wrapper.js`): antes de cada backup real, el wrapper
// compara este manifiesto contra el catalogo real de PostgreSQL, por
// IGUALDAD EXACTA DE CONJUNTOS, y aborta si no coinciden.
//
// Cualquier objeto nuevo creado bajo `oxkio_approval_owner` debe
// anadirse aqui en la MISMA pull request que lo crea. Omitirlo no amplia
// el alcance del backup por accidente: el wrapper fallara cerrado
// (`backup_scope_catalog_mismatch`) en cuanto el catalogo real y este
// manifiesto dejen de coincidir, en cualquier direccion.
//
// Este archivo NO ejecuta ninguna consulta. Es datos, no codigo con
// efectos: se importa, se lee, se compara.

const EXPECTED_APPROVAL_OBJECTS = Object.freeze([
  Object.freeze({
    schema: 'oxkio',
    table: 'oxkio.approval_items',
    owner: 'oxkio_approval_owner',
  }),
]);

const EXPECTED_APPROVAL_TABLES = Object.freeze(
  EXPECTED_APPROVAL_OBJECTS.map((entry) => entry.table),
);

module.exports = {
  EXPECTED_APPROVAL_OBJECTS,
  EXPECTED_APPROVAL_TABLES,
};

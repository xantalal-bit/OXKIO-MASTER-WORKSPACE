# OXKIO MASTER SESSION

## Fecha

28/07/2026

## Bloque actual

5C.7 — Runtime Permanente e Infraestructura.

## Subfase actual

5C.7B.2 — Persistencia Definitiva.

## Estado

5C.7B.1 está cerrada y publicada en `a8619c1`. Firestore Emulator y PostgreSQL
portable superaron el mismo harness de 13 operaciones. La decisión humana ratifica
PostgreSQL gestionado como persistencia operativa principal mediante
`ADR-5C.7B.2-POSTGRESQL-PERSISTENCIA-PRINCIPAL.md`. 5C.7B.2 queda cerrada y publicada.
El proveedor y el diseño productivo siguen pendientes; 5C.7B.3 no está abierta.

## Último hito validado

5C.7B.1 — backend cloud-ready neutral publicado:

`a8619c1 feat(5C.7B.1): preparar backend cloud-ready neutral`

## Última evidencia aceptada

- Inventario de stores con ubicaciones, tamaños, lectores y escritores.
- Dataset sintético único y contrato neutral de 13 operaciones.
- Firestore Emulator: 13/13, aislamiento, idempotencia y restore; dos lock timeouts recuperados.
- PostgreSQL portable: 13/13, RLS forzada, constraints, append-only y dump/restore.
- ADR humana: PostgreSQL gestionado ratificado; proveedor no seleccionado.
- Ningún store, token, OAuth ni dato real fue modificado.

## Último piloto realizado

POC locales comparables, no representativas de cloud:

- Firestore Emulator: 8.810,790 ms de tiempo total y dos timeouts recuperados.
- PostgreSQL portable: 256,332 ms, cero bloqueos/deadlocks inesperados y restore con
  digest idéntico.

## Incidencias abiertas

- Los JSON productivos siguen siendo `local_only`.
- OAuth sigue usando un token local de un único sujeto.
- Las colecciones Firestore reales siguen sin inventario read-only.
- Aislamiento tenant aún no está integrado en el runtime.
- Proveedor, región, plan, coste, SLA, pool, HA y RPO/RTO siguen `UNKNOWN`.
- El repositorio de desarrollo continúa dentro de OneDrive.
- El laboratorio PostgreSQL portable no es productivo.

## Siguiente acción exacta

Sin abrir 5C.7B.3, fijar el sobre de carga de Cliente Cero y solicitar la misma ficha
técnica, contractual y de coste a Cloud SQL, Supabase, Neon y Render. Seleccionar
después el proveedor PostgreSQL gestionado y aprobar el diseño productivo, sin contratar
ni migrar.

## Archivos pendientes de staging

Ninguno de 5C.7B.2 tras el cierre material. El trabajo ajeno permanece sin staging.

## Exclusiones

Sin migración, datos reales, OAuth, tokens, Blaze, Firestore productivo, PostgreSQL
contratado, despliegue, staging, commit, push ni apertura de 5C.7B.3.

## Commit de cierre

`feat(5C.7B.2): ratificar PostgreSQL como persistencia principal`

## Última copia ZIP conocida

No consta ninguna copia ZIP nueva en el repositorio.

## Riesgos abiertos

La decisión de motor es definitiva para este alcance. Siguen pendientes proveedor,
región, pool, coste, SLA, HA, RPO/RTO, integración RLS en runtime, gestor de secretos,
retención y métricas cloud para 10/100/1.000 usuarios.

## Decisiones permanentes recientes

- Una fuente canónica por tipo de dato.
- `tenantId` y `userId` obligatorios en toda persistencia operativa.
- La identidad se deriva del token verificado; nunca del body.
- Approval, Operation y Audit deben migrarse como una unidad transaccional.
- OAuth y secretos vivirán en el gestor de secretos futuro, nunca en PostgreSQL.
- Google Calendar, documentos de usuario, Firebase Authentication y gobernanza
  permanecen en sus autoridades externas.
- `executionEnabled=false` y `SAFE_DRAFT_ONLY` permanecen intactos.

## Reglas nuevas incorporadas

La persistencia operativa principal exige POC comparables, aislamiento, restauración y
decisión humana mediante ADR. La selección de proveedor exige región UE, DPA, RLS,
backups, PITR, exportación, TLS, roles mínimos, pool, monitorización, SLA, escalado,
coste y portabilidad verificados o `UNKNOWN` explícito.

## Próximo objetivo estratégico

Definir el sobre de carga y seleccionar proveedor PostgreSQL gestionado en una fase
posterior todavía no abierta ni numerada. No abrir 5C.7B.3 todavía.

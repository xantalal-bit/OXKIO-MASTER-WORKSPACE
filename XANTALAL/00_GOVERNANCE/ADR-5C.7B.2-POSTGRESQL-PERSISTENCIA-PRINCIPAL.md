# ADR-5C.7B.2 — PostgreSQL como persistencia operativa principal

## Estado

- Estado de la decisión: **RATIFICADA**.
- Fecha: 28/07/2026.
- Autoridad: decisión humana expresa.
- Fase: 5C.7B.2.3 — Ratificación de persistencia y ADR.
- Base publicada: `a8619c1 feat(5C.7B.1): preparar backend cloud-ready neutral`.
- Implementación, contratación y migración: no realizadas.
- Siguiente fase: definición del sobre de carga, selección del proveedor PostgreSQL
  gestionado y diseño productivo; todavía no abierta ni numerada.
- 5C.7B.3: no abierta.

## Contexto

OXKIO conserva persistencia operativa en JSON local y necesita una fuente durable,
multiinstancia y multiusuario para aprobar, reservar y auditar efectos sin duplicados.
La elección debía preservar:

- transiciones condicionales y transacciones;
- constraints relacionales;
- idempotencia durable;
- aislamiento por `tenantId` y `userId`;
- auditoría append-only;
- consulta y exportación por tenant;
- backup y restauración verificables;
- portabilidad entre proveedores;
- una sola fuente operativa principal.

Se implementó un contrato neutral y se ejecutó el mismo dataset sintético y las mismas
13 operaciones contra Firestore Emulator y PostgreSQL 18.4 portable. Ninguna ejecución
utilizó datos reales, servicios cloud productivos ni los stores operativos de OXKIO.

## Candidatos considerados

1. Firestore como persistencia operativa principal.
2. PostgreSQL gestionado como persistencia operativa principal.
3. Firestore + PostgreSQL como arquitectura híbrida para el núcleo.

## Evidencia de los POC

| Evidencia local | Firestore Emulator | PostgreSQL portable |
|---|---:|---:|
| Operaciones completadas | 13/13 | 13/13 |
| Mismo dataset y contrato | Sí | Sí |
| Aislamiento tenant/user | Superado | Superado |
| Idempotencia y duplicado | Superado | Superado |
| Exportación y restauración | Superadas | Superadas |
| Suma de latencias | 4.106,964 ms | 114,859 ms |
| Tiempo total del harness | 8.810,790 ms | 256,332 ms |
| Reserva concurrente | 3.461,060 ms | 50,380 ms |
| Contención inesperada | 2 lock timeouts recuperados | 0 bloqueos/deadlocks |
| Garantías específicas | Transacciones documentales y paths por tenant | PK, FK, UNIQUE, CHECK, RLS forzada y auditoría append-only |
| Recuperación nativa | Export/import del emulador | `pg_dump`/`pg_restore`, digest idéntico |

Las cifras son locales y solo comparan este harness. No predicen latencia, coste,
disponibilidad ni escalado de servicios cloud.

## Decisión

**PostgreSQL gestionado queda ratificado como persistencia operativa principal de
OXKIO.**

Firestore no será la BBDD operativa principal. No se declara inutilizable: sus
colecciones existentes quedan intactas y pendientes de inventario read-only.
No se activa doble escritura.

La ratificación selecciona el motor, no el proveedor. Región, plan, dimensionamiento,
SLA, RPO/RTO, coste y runtime definitivo continúan pendientes de decisión separada.

## Responsabilidad definitiva de los datos

### PostgreSQL gestionado

PostgreSQL será la fuente canónica operativa de:

- tenants y membresías;
- perfiles operativos;
- memoria;
- tareas internas;
- aprobaciones;
- operaciones;
- reservas de idempotencia;
- auditoría append-only;
- agenda ejecutiva interna;
- Project Registry;
- Security Inventory;
- metadatos de documentos y conocimiento.

Los binarios y documentos completos no se guardarán en PostgreSQL. Los metadatos
incluirán únicamente identificadores, autoridad, tenant, checksum, versión, estado y
referencias necesarias.

### Fuentes externas

| Dominio | Fuente canónica |
|---|---|
| Identidad | Firebase Authentication |
| Calendario de usuario | Google Calendar |
| Binarios y documentos | Drive/Storage y la autoridad documental aprobada |
| Código y gobernanza | GitHub |
| Secretos, credenciales y OAuth | Gestor de secretos futuro |
| Logs técnicos de plataforma | Sistema de logging del runtime/proveedor futuro |

PostgreSQL podrá conservar referencias y metadatos no secretos, pero nunca claves,
client secrets, refresh tokens ni access tokens OAuth.

## Razones

1. Approval, Operation y Audit requieren atomicidad conjunta, relaciones y constraints.
2. `UNIQUE (tenant_id, idempotency_key)` expresa la reserva durable directamente.
3. RLS forzada proporciona una segunda barrera de aislamiento, además del backend.
4. PK, FK, UNIQUE, CHECK y NOT NULL reducen invariantes dispersas en código.
5. La auditoría append-only puede imponerse con permisos y funciones/triggers.
6. SQL cubre reporting, filtros temporales, joins y exportaciones coherentes.
7. `pg_dump`/`pg_restore` y el formato SQL reducen dependencia de proveedor.
8. El POC restauró exactamente los datos y el digest esperado.
9. Firestore fue viable, pero exigió más invariantes en paths/aplicación y mostró
   contención recuperada en la reserva concurrente.
10. Una arquitectura híbrida añadiría sincronización y recuperación doble sin una
    necesidad demostrada.

## Consecuencias

### Positivas

- una única fuente operativa;
- integridad y transacciones nativas;
- aislamiento por tenant verificable;
- backup, PITR y exportación seleccionables como requisitos del proveedor;
- modelo portable entre PostgreSQL gestionados;
- ruta futura a full-text y `pgvector`, sin hacer vector obligatorio ahora.

### Costes y obligaciones

- diseñar y versionar esquema y migraciones;
- configurar roles mínimos, RLS, pool y TLS;
- operar observabilidad, backup, restore y rotación de credenciales;
- normalizar JSON legacy antes de migrar;
- dimensionar conexiones para el runtime elegido;
- validar RPO/RTO, SLA y coste antes de contratar;
- mantener feature flags y rollback por unidad de datos.

## Firestore existente

No se realizó conexión al Firestore real, lectura de documentos ni listado cloud. El
repositorio solo prueba que el proyecto Firebase `oxkio-9af40` se usa para identidad en
el cliente. No prueba nombres, contenido, volumen ni escritores de colecciones reales.

| Alcance observable | Colecciones | Clasificación | Tratamiento |
|---|---|---|---|
| POC Firestore Emulator | `oxkioPocTenants/{tenant}` | `archive` | Evidencia sintética; no es fuente migratoria |
| Subcolecciones POC | `memberships`, `approvals`, `operations`, `memories`, `audit` | `archive` | Conservar solo como resultado reproducible del POC |
| Firestore real del proyecto Firebase | No enumeradas; existencia y contenido `UNKNOWN` | `unknown` | Inventario humano/read-only antes de cualquier clasificación adicional |

Reglas de clasificación para el futuro inventario:

- `legacy_readonly`: colección con lector legacy aún necesario y escrituras congeladas;
- `migrate_later`: datos operativos reales que deban pasar a PostgreSQL;
- `archive`: datos sin uso operativo, conservados por trazabilidad o retención;
- `specialized_candidate`: uso documental especializado demostrado que justifique
  conservar Firestore fuera del núcleo;
- `unknown`: propietario, contenido, lectores, escritores o retención no verificados.

No hay evidencia suficiente para asignar una colección real a `legacy_readonly`,
`migrate_later`, `archive` o `specialized_candidate`. Hasta el inventario, todas
permanecen `unknown`, sin borrado, escritura, doble escritura ni migración.

## Requisitos del PostgreSQL gestionado

Un proveedor solo podrá seleccionarse si demuestra:

1. región primaria dentro de la UE y ubicación de backups declarada;
2. DPA aplicable, RGPD, subprocesadores y mecanismo de transferencias;
3. PostgreSQL estándar y acceso compatible con `psql`, `pg_dump` y `pg_restore`;
4. soporte de RLS, roles propios, constraints, triggers y transacciones;
5. backups automáticos;
6. PITR con retención, RPO y procedimiento de restauración conocidos;
7. exportación lógica completa y salida sin bloqueo contractual;
8. TLS obligatorio y validación de certificado;
9. rol de aplicación mínimo sin `SUPERUSER`, `CREATEDB`, `CREATEROLE` ni `BYPASSRLS`;
10. pool compatible con el runtime y límites de conexión publicados;
11. métricas, logs, alertas y diagnóstico de consultas;
12. SLA y soporte adecuados al piloto y a producción;
13. escalado vertical y estrategia de HA/réplicas documentados;
14. coste mensual reproducible para una carga acordada, con límites y alertas;
15. portabilidad mediante SQL y dumps estándares;
16. `pgvector` disponible como opción futura, sin exigirlo en el esquema inicial.

Son además obligatorias una prueba aislada de restore, una prueba de salida a otro
PostgreSQL y la verificación de que backups y réplicas respetan la región aprobada.

## Matriz documental de proveedores

Estado documental a 28/07/2026. `UNKNOWN` significa que la fuente oficial revisada no
permite cerrar el criterio para el plan de OXKIO; no significa ausencia.

| Proveedor | UE y RGPD/DPA | PostgreSQL, RLS, TLS y roles | Backup, PITR y exportación |
|---|---|---|---|
| Cloud SQL PostgreSQL | Regiones UE, incluida Madrid; CDPA de Google | PostgreSQL gestionado; RLS/roles nativos; TLS configurable/obligatorio según política | Backups y PITR configurables; export y herramientas PostgreSQL |
| Supabase | Varias regiones UE; DPA publicado | PostgreSQL dedicado; RLS/roles; enforcement TLS configurable | Backup diario según plan; PITR como add-on; `pg_dump` por conexión directa |
| Neon | Frankfurt/Londres; GDPR y DPA publicados | PostgreSQL serverless; RLS/roles; TLS 1.2+ | Instant restore/PITR; snapshots programados sujetos a plan/estado; `pg_dump` disponible |
| Railway PostgreSQL | Región UE Ámsterdam; DPA publicado | Imagen PostgreSQL oficial con TLS; RLS/roles posibles | Plantilla declarada `unmanaged`; backup/PITR gestionados para OXKIO: `UNKNOWN`; export manual posible |
| Render PostgreSQL | Región UE Frankfurt; DPA publicado | PostgreSQL gestionado; RLS/roles/TLS; pooling documentado | PITR continuo en planes de pago; export lógico descargable |
| Proveedor ligado a otro runtime | `UNKNOWN` hasta elegir runtime | `UNKNOWN` | `UNKNOWN` |
| LucusHost | `UNKNOWN`; no hay respuesta contractual/técnica verificada | `UNKNOWN` | `UNKNOWN` |

| Proveedor | Pool, monitorización y SLA | Escalado, coste y portabilidad | `pgvector` futuro | Estado para selección |
|---|---|---|---|---|
| Cloud SQL PostgreSQL | Pool/conector según arquitectura; Cloud Monitoring/Query Insights; SLA 99,95–99,99% solo en configuraciones cubiertas | HA, réplicas y escalado; coste depende de región/edición/recursos; alta portabilidad SQL | Sí | Candidato |
| Supabase | Supavisor/PgBouncer; Reports/Metrics API; SLA de uptime solo Enterprise según matriz de planes | Compute/réplicas según plan; coste base + consumo/add-ons `UNKNOWN`; alta portabilidad | Sí | Candidato |
| Neon | PgBouncer; monitorización; SLA 99,95% limitado a Business/Scale y endpoints cubiertos | Autoscaling/read replicas; coste por uso `UNKNOWN`; alta portabilidad | Sí | Candidato |
| Railway PostgreSQL | Pool de BBDD y SLA específico: `UNKNOWN`; observabilidad de plataforma | Escalado de servicio/volumen; HA de BBDD `UNKNOWN`; coste por uso; export portable | `UNKNOWN` sin personalizar imagen | No cumple aún “gestionado” |
| Render PostgreSQL | Pooling y métricas documentados; SLA contractual exacto `UNKNOWN` | Compute/storage, HA y réplicas según plan; coste `UNKNOWN`; export portable | Sí | Candidato condicionado |
| Proveedor ligado a otro runtime | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` | Pendiente del runtime |
| LucusHost | `UNKNOWN` | `UNKNOWN` | `UNKNOWN` | No evaluable |

Fuentes oficiales revisadas:

- [Cloud SQL: regiones](https://docs.cloud.google.com/sql/docs/postgres/region-availability-overview),
  [PITR](https://docs.cloud.google.com/sql/docs/postgres/backup-recovery/configure-pitr),
  [SLA](https://cloud.google.com/sql/sla),
  [extensiones](https://docs.cloud.google.com/sql/docs/postgres/extensions) y
  [CDPA](https://cloud.google.com/terms/data-processing-addendum/).
- [Supabase: regiones](https://supabase.com/docs/guides/platform/regions),
  [backups/PITR](https://supabase.com/docs/guides/platform/backups),
  [conexiones y pool](https://supabase.com/docs/guides/database/connecting-to-postgres),
  [TLS](https://supabase.com/docs/guides/platform/ssl-enforcement),
  [extensiones](https://supabase.com/docs/guides/database/extensions) y
  [DPA](https://supabase.com/downloads/docs/Supabase%2BDPA%2B260601.pdf).
- [Neon: seguridad/RGPD](https://neon.com/security),
  [regiones y estado](https://neon.com/docs/introduction/status),
  [pool](https://neon.com/docs/connect/connection-pooling),
  [SLA](https://neon.com/sla) y
  [exportación](https://neon.com/docs/import/migrate-from-neon).
- [Railway: PostgreSQL](https://docs.railway.com/databases/postgresql),
  [regiones](https://docs.railway.com/deployments/regions) y
  [DPA](https://railway.com/legal/dpa).
- [Render: PostgreSQL](https://render.com/docs/postgresql),
  [backups/PITR](https://render.com/docs/postgresql-backups),
  [regiones](https://render.com/docs/regions) y
  [DPA](https://render.com/dpa).

No se incorporan precios numéricos porque todavía no existe una configuración de carga,
HA, retención, soporte y egress comparable. El coste permanece `UNKNOWN`.

## Plan de migración

No se implementa en esta ADR. El orden aprobado para una fase futura es:

1. definir esquema versionado y herramienta de migraciones;
2. implementar adaptador PostgreSQL productivo detrás de los contratos existentes;
3. crear referencias a secretos y OAuth en el gestor futuro, nunca en texto claro;
4. crear tenants, memberships, roles mínimos y RLS forzada;
5. exportar cada JSON real en modo read-only, con manifiesto, conteos y checksums;
6. transformar y migrar Approval, Operation, Idempotency y Audit como una unidad;
7. migrar Memory por tenant/user;
8. migrar agenda ejecutiva, Project Registry y Security Inventory;
9. migrar metadatos de documentos y conocimiento, sin mover binarios de su autoridad;
10. ejecutar lectura comparada temporal contra snapshots inmutables;
11. activar fuente por feature flag, store por store, sin doble escritura;
12. probar rollback, backup, PITR, `pg_dump` y restore aislado;
13. ejecutar piloto Cliente Cero con `executionEnabled=false` y `SAFE_DRAFT_ONLY`;
14. retirar JSON solo tras aceptación humana, retención y rollback expirado.

## Rollback

Durante la futura migración:

- mantener origen JSON/Firestore inmutable y con checksum;
- detener mutaciones antes de revertir;
- revertir el feature flag a la última fuente canónica consistente;
- tratar Approval, Operation, Idempotency y Audit como una única unidad;
- no reintentar efectos cuyo estado externo sea desconocido;
- restaurar desde dump/PITR solo en un destino aislado antes de promoción;
- conservar manifiestos y registrar toda divergencia.

Esta ADR puede revertirse antes de migrar sin tocar datos: se marca `SUPERSEDED` mediante
otra ADR humana. Después de migrar, cualquier reversión exige un plan de datos aprobado.

## Riesgos y deuda

1. OAuth continúa en filesystem local y deberá revocarse/rotarse.
2. JSON productivos continúan activos y no son multiinstancia.
3. Existen rutas legacy mezcladas con el runtime oficial.
4. Firestore real no está inventariado.
5. El aislamiento tenant aún no está integrado en el runtime.
6. Proveedor, plan, coste, HA, SLA y RPO/RTO permanecen sin decidir.
7. El repositorio de desarrollo continúa dentro de OneDrive.
8. El laboratorio PostgreSQL portable no es productivo.
9. Retención legal de memoria y auditoría está pendiente.
10. El diseño del gestor de secretos y OAuth está pendiente.
11. No existen métricas cloud ni carga validada para 10/100/1.000 usuarios.

## Alternativas descartadas

### Firestore como BBDD operativa principal

Descartada para el núcleo actual, no como tecnología general. Fue viable en el POC, pero
requiere más invariantes en paths/aplicación para relaciones, unicidad y auditoría, y
mostró dos timeouts de lock recuperados en la prueba concurrente.

### Arquitectura híbrida

Descartada para el núcleo porque introduciría dos autoridades operativas, doble
recuperación y ausencia de transacción simple entre aprobación, operación y auditoría.

### PostgreSQL autogestionado

Descartado para producción en esta fase: trasladaría parches, HA, backups, PITR y
monitorización al equipo. El laboratorio portable solo demuestra el contrato.

## Condiciones de revisión

Revisar esta ADR si:

- el proveedor seleccionado no puede cumplir región UE, DPA, RLS, PITR o exportación;
- la prueba de salida a otro PostgreSQL falla;
- la carga real invalida el modelo de conexiones o coste;
- aparece un requisito especializado que no pueda cubrir PostgreSQL razonablemente;
- cambian requisitos legales, de residencia o retención;
- un incidente demuestra que las garantías diseñadas son insuficientes.

La revisión requiere nueva evidencia y una ADR humana que reemplace esta decisión. No
autoriza borrar Firestore, migrar datos ni activar doble escritura.

## Siguiente acción exacta

Sin abrir 5C.7B.3, fijar un sobre de carga para Cliente Cero —región UE, almacenamiento,
conexiones, concurrencia, HA, RPO, RTO, retención y soporte— y solicitar con ese mismo
perfil una ficha verificable y coste total a Cloud SQL, Supabase, Neon y Render.
Railway solo podrá reincorporarse si ofrece una responsabilidad gestionada equivalente;
LucusHost solo si responde el cuestionario técnico y contractual. Después se seleccionará
proveedor y se aprobará el diseño productivo, sin contratar ni migrar todavía.

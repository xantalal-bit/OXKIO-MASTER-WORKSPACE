# OXKIO ROADMAP

## Estado operativo vigente

- Código de bloque: 5C.7
- Última microfase cerrada: G0002.5B.2F — Arquitectura productiva PostgreSQL para Cliente Cero
- Microfase abierta: 5C.7B.3 — Secret Manager, IAM, tokens cifrados y rotación
- Bloque actual: Runtime Permanente e Infraestructura
- Fases 1.1, 1.2, 1.3 y 1.4 de G0002.5B.2F: aprobadas y cerradas; 5C.7B.3 está abierta
- Selección arquitectónica: Neon Launch; contingencia: Google Cloud SQL Enterprise.
- Objetivo inmediato: 5C.7B.3D sigue abierta como contenedor con 3D.1 y 3D.2
  cerradas. 3D.2 cerró con roles creados por SQL controlado (nunca consola Neon),
  migraciones 001/002 aplicadas y `verify` final 33/33 en transacción de solo
  lectura, sin escribir ninguna fila. 3D.3 — TLS/SSL estricto — queda **cerrada**,
  con T1–T5 ejecutadas y superadas. 3D.4 — Secret Manager — queda **CERRADA**
  (15/08/2026): su puerta humana de ejecución se concedió, se usó para materializar
  PG-RUN (Puertas A y B) y quedó **consumida**. PG-RUN está materializado pero **sin
  consumidor productivo**. **3D.6 — Tier 1 (A–K) contra instancia real — queda
  CERRADA (16/08/2026)** con una única ejecución real y veredicto **PASS**; la
  segunda puerta humana fue efímera para esa ejecución y no permanece abierta;
  Tier 2/E sigue **BLOQUEADA/DEFERIDA** y restore **DIFERIDO**. 3D.5 y 5C.7B.3E
  permanecen cerradas/no abiertas. **5C.7B.3F queda DEFINIDA (16/08/2026)** —
  persistencia definitiva de ApprovalQueue/ApprovalRepository, prerrequisito de
  Runtime 24/7 y 5C.7B.7. **B1 CERRADA/PUBLICADA** (`a721285`, 16/08/2026 —
  `PostgresApprovalRepository` offline). **B2 CERRADA** (17/08/2026 —
  decisiones productivas: identidad `oxkio_approval_runtime`, secreto
  `OXKIO_APPROVAL_PG_RUNTIME_URL`, esquema conceptual, RLS, grants y política
  TLS; ninguna implementada todavía). **B3 CERRADA/PUBLICADA** (`e94e6f1`,
  17/08/2026 — migración SQL offline `003_approval_items.sql`). **B3.1
  CERRADA/PUBLICADA** (`b8117e4`, 17/08/2026 — ownership `oxkio_approval_owner`
  separado de `oxkio_mission_owner`). **B4.A CERRADA** (19/08/2026 —
  identidades PostgreSQL `oxkio_approval_owner`/`oxkio_approval_runtime`, PASS
  CON OBSERVACIONES). **B4.B CERRADA** (19/08/2026 — puente de privilegios:
  `CREATE ON SCHEMA oxkio` concedido a `oxkio_approval_owner` y fila temporal
  `set_option=true` independiente de la basal `cloud_admin`, PASS REAL).
  **B4.B.2 CERRADA (20/08/2026) — PASS REAL**: `USAGE ON SCHEMA oxkio`
  concedido a `oxkio_approval_owner` y `oxkio_approval_runtime`, resolviendo
  la observación abierta de B4.B. **B4.C CERRADA (20/08/2026) — PASS
  REAL**: Puerta A CERRADA (19/08/2026, PASS REAL — secreto
  `OXKIO_APPROVAL_PG_RUNTIME_URL` materializado en Secret Manager) y Puerta B
  CERRADA (20/08/2026, PASS REAL — IAM `roles/secretmanager.secretAccessor`
  concedido a `oxkio-runtime-prod@oxkio-runtime-prod.iam.gserviceaccount.com`
  exclusivamente sobre ese recurso). **B4.D CERRADA (21/08/2026) — PASS REAL
  ESTRUCTURAL**: `oxkio.approval_items` materializada vía
  `003_approval_items.sql` (sha256
  `45e1b076947fdf9bea2bd8e54d959b105fdf1b24bfb7487a9cd9cb16678b32c2`), verify
  catalog-only 32/32 PASS. **B4.D.1 CERRADA (21/08/2026) — PASS REAL
  FUNCIONAL**: hallazgo real del GUC `app.client_id` vacío corregido por
  `004_approval_items_client_id_guard.sql` (sha256
  `3af18fbc708569e60a7a72161366743f85ca999b78bb0429d5ab43d7805351cf`, verify
  14/14 PASS; 003 intacto); precheck real 13/13 PASS y probe funcional real
  15/15 PASS contra Neon (RLS A/B, fail-closed, CAS básico, cero residuo); no
  demuestra CAS concurrente ni wiring productivo. **B4.D.2 CERRADA
  (24/08/2026) — PASS REAL CONCURRENTE**: probe real 14/14 PASS, dos
  conexiones físicas con transacciones simultáneamente activas contra Neon,
  CAS real (`UPDATE ... WHERE version = $2`, mismo SQL productivo) con
  exactamente un ganador, estado final `version=2`, cleanup administrativo
  verificado y residuo sintético cero; sin cambios a `CAS_APPROVE_SQL`,
  003/004, RLS, roles ni permisos. **B4.E DEFINIDA (24/08/2026) — EN
  PLANIFICACIÓN DOCUMENTAL, no ejecutada, no abierta**: "Validación
  funcional real del ciclo de vida restante de Approval sobre PostgreSQL
  gestionado" — `reject`/`claimExecution`/`completeExecution`/
  `failExecution`/`expire`/`reclaimExpiredExecutions` y el conflicto
  `execution_id_mismatch`, contra Neon real vía sonda sintética, sin wiring
  productivo. B4 (contenedor)/B4.F–B6 no abiertas (ver governance doc,
  «Regularización 17/08/2026», «Regularización
  18/08/2026», «Regularización 19/08/2026», «Regularización
  20/08/2026 — B4.B.2», «Regularización 20/08/2026 — Cierre de B4.C / Puerta
  B», «Regularización 21/08/2026 — Cierre de B4.D», «Regularización
  21/08/2026 — Migración 004 y cierre de B4.D.1», «Regularización
  24/08/2026 — Cierre de B4.D.2» y «Definición documental 24/08/2026 —
  B4.E»).
- 5C.7B.3A: contrato de secretos y matriz de custodia aprobado y cerrado.
- 5C.7B.3B: runtime neutral de secretos sintéticos cerrado y publicado en `4a5076c`.
- 5C.7B.3C: cerrada; 3C.1 y 3C.2 están cerradas, sin secretos operativos ni despliegue.
- 3C.1: proyecto `oxkio-runtime-prod` creado, billing vinculado y Secret Manager API activa.
- 3C.2: tres service accounts sin claves ni roles de proyecto; canario IAM superado y eliminado,
  con cero bindings temporales, cero secretos operativos y coste atribuible USD 0.
- Aclaración: las tres service accounts de 3C.2 (runtime, migración, backup) existen y
  se reutilizarán en 3D; lo eliminado fue exclusivamente el canario sintético. Neon
  exige TLS/SSL; 3D.3 definirá y probará la verificación estricta del cliente Node.
  Se mantiene runtime pooled y administración/migración direct.
- 3D.1 cerrada: proyecto Neon Free `OXKIO` bajo organización `XANTALAL`, región
  Frankfurt, PostgreSQL 18, endpoints pooled/direct confirmados visualmente, sin
  tarjeta/gasto/plan de pago, Neon Auth desactivado. Evidencia fechada 11/08/2026,
  variable, no constante arquitectónica. `sslmode=require` observado en la cadena
  mostrada por Neon; no demostraba ni cerraba el TLS/SSL estricto de OXKIO, que
  correspondía exclusivamente a 3D.3 y quedó demostrado al cerrarse esa subfase.
  Reversibilidad del
  proyecto demostrada documentalmente (7 días de recuperación vía API/CLI, después
  permanente) según fuentes oficiales Neon, sin ejecutar borrado real; la
  organización y la cuenta quedan fuera del criterio de cierre.
- Transferencias: PostgreSQL/TLS/RLS/roles/backups a 3D; OAuth y tokens a 3E; Cloud Run,
  RPO/RTO, Owner humano e higiene de APIs automáticas a fases posteriores.
- 5C.7B.3D: abierta como contenedor; 3D.1, 3D.2, 3D.3 y **3D.4 cerradas**; la puerta
  humana de ejecución de 3D.4 se concedió y quedó consumida el 15/08/2026 para
  materializar PG-RUN; **3D.6 Tier 1 CERRADA (16/08/2026) con PASS real**, segunda
  puerta efímera consumida, Tier 2/E diferida y restore diferido; 3D.5
  cerrada/no abierta; 5C.7B.3E: cerrada/no abierta; **5C.7B.3F: DEFINIDA
  (16/08/2026)** (persistencia definitiva de ApprovalQueue/ApprovalRepository);
  **B1 CERRADA/PUBLICADA** (`a721285`) y **B2 CERRADA** (17/08/2026,
  documental); **B3 CERRADA/PUBLICADA** (`e94e6f1`) y **B3.1
  CERRADA/PUBLICADA** (`b8117e4`), ambas 17/08/2026; **B4.A CERRADA**
  (19/08/2026, identidades PostgreSQL Approval, PASS CON OBSERVACIONES) y
  **B4.B CERRADA** (19/08/2026, puente de privilegios, PASS REAL); **B4.B.2
  CERRADA** (20/08/2026, USAGE ON SCHEMA oxkio para owner+runtime Approval,
  PASS REAL); **B4.C CERRADA (20/08/2026) — PASS REAL** (Puerta A CERRADA
  19/08/2026, PASS REAL — secreto materializado; Puerta B CERRADA 20/08/2026,
  PASS REAL — IAM concedido exclusivamente sobre ese recurso); **B4.D
  CERRADA (21/08/2026) — PASS REAL ESTRUCTURAL** (`oxkio.approval_items`
  materializada, verify catalog-only 32/32 PASS); **B4.D.1 CERRADA
  (21/08/2026) — PASS REAL FUNCIONAL** (gap del GUC `app.client_id` vacío
  corregido por `004_approval_items_client_id_guard.sql`, verify 14/14 PASS,
  003 intacto; precheck real 13/13 y probe funcional real 15/15 PASS; CAS
  concurrente y wiring productivo pendientes de microfase posterior no
  abierta); **B4.D.2 CERRADA (24/08/2026) — PASS REAL CONCURRENTE** (probe
  real 14/14 PASS: dos conexiones con transacciones simultáneamente activas,
  CAS XOR con exactamente un ganador, version final=2, cleanup verificado,
  residuo cero); **B4.E DEFINIDA (24/08/2026) — EN PLANIFICACIÓN
  DOCUMENTAL**, no ejecutada, no abierta (reject/claimExecution/
  completeExecution/failExecution/expire/reclaimExpiredExecutions y
  execution_id_mismatch, contra Neon real, sin wiring productivo); B4
  (contenedor)/B4.F–B6 no abiertas.
- 3D.6 abierta en planificación (15/08/2026): documenta el contrato de las pruebas
  contra la instancia real —aislamiento RLS entre scopes sintéticos, no lectura ni
  escritura cruzadas, no escalada del rol de runtime, CAS sobre `version`, rollback,
  timeout, **reversión estructural con residuo cero**, portabilidad y validación
  integral— con datos **exclusivamente sintéticos** y sonda efímera endurecida fuera del
  repositorio. Quedan **diferidos** el **restore**, hasta que 3D.5 produzca un dump, y la
  **concurrencia (E)**, que exigiría estado COMMITeado compartido y una identidad capaz
  de revertirlo: **no se ampliarán privilegios ni se creará identidad de limpieza** para
  facilitarla. La garantía H no es limpieza ni truncado, sino no persistencia verificada.
  I/J **no repiten** el 33/33 de 3D.2: comprueban un subconjunto y lo contrastan, y toda
  contradicción es FAIL CLOSED. Los tests de integración y el POC runner, que usan
  `connectionString` sin TLS endurecido, **no pueden ejecutarse contra Neon** en 3D.6.
  **ESTADO HISTÓRICO SUPERADO tras el 16/08/2026** (ver cierre real más abajo): nada se
  había ejecutado, la apertura era documental y la ejecución exigía una segunda puerta
  humana. La sonda quedó preparada **offline** en
  `AppData\Local\OXKIO\tools\oxkio-3d6-rls-cas-probe.js` (sha256 `22ad1ff9…`, 57 802
  bytes, selftest 49/49) con `EXECUTION_AUTHORIZED = false`: `tp1` y `tp2` fallan cerrado
  antes de tocar la red y **la segunda puerta humana sigue sin conceder**. Esta versión
  sustituye a la inicial `a0637866…`, **invalidada** por la auditoría independiente: su
  conteo residual no fijaba el scope y la propia RLS habría ocultado cualquier residuo,
  produciendo un PASS falso en H. Corregido: el residuo se cuenta tras el `ROLLBACK`, en
  transacciones nuevas y con `app.*` fijado por scope, y **H solo puede ser PASS si C está
  demostrada**. G pasa a tener veredicto propio: INCONCLUSA si la sentencia lenta completa
  pese al límite. Anomalía sin resolver: solapamiento 3D.5 / 5C.7B.6. La ausencia de
  contenido canónico para 5C.7B.3F quedó **resuelta el 16/08/2026** (ver governance
  doc, "Definición formal de 5C.7B.3F").
  Preparación Tier 1 (16/08/2026): la versión `22ad1ff9…`, 57 802 bytes,
  `EXECUTION_AUTHORIZED = false`, queda **SUPERADA**. Vigente: sha256
  `3e953e9371fe7e916fdd5cb6756439a318aae2ad3aadf4a96955ffb07d40b4d8`, 59 154 bytes,
  selftest offline **PASS 49/49**, `node --check` OK. Único cambio funcional:
  `EXECUTION_AUTHORIZED = true` (primer cerrojo levantado) más la corrección de la
  aserción del selftest que presuponía ese cerrojo en `false`, sin debilitar ninguna
  comprobación. Esto **no habilita ejecución real**: la segunda puerta humana
  `OXKIO_3D6_GATE` **sigue sin conceder**, sin frase fijada. Verificado offline: `tp1`
  sin ella falla cerrado antes de tocar `pg`/DNS/red, incluso con `OXKIO_3D6_PG_URL` y
  `OXKIO_REPO_ROOT` ficticios; `tp2` sigue **BLOQUEADA/DEFERIDA** incondicionalmente.
  Cero credenciales reales, cero conexión a Neon, cero SQL ejecutado. A–K, restore
  diferido y 3D.5/3E/3F cerradas/no abiertas quedan intactos. **Todo este párrafo
  describe el ESTADO HISTÓRICO de preparación, superado por el cierre real siguiente.**
  Cierre real de Tier 1 (16/08/2026): la segunda puerta `OXKIO_3D6_GATE` fue concedida
  por José Antonio de forma efímera y exclusiva para una única ejecución (frase nunca
  solicitada, mostrada ni registrada; no permanece abierta). Con PG-RUN cargado
  localmente desde Secret Manager sin exponerlo, se ejecutó una única vez `tp1` contra
  el endpoint pooled real de Neon: `current_user` verificado `oxkio_mission_runtime`;
  RLS `enabled=true`/`forced=true` en ambas tablas; residuo tras `ROLLBACK` con
  `app.*` fijado = **0 misiones, 0 confirmaciones** en A y B; escritura cruzada,
  `row_security=off` y `SET ROLE` propietario rechazados (SQLSTATE `42501`); timeout
  activado (SQLSTATE `57014`); 0 reintentos. Veredictos: **A/B/C PASS, K PASS, D/CAS
  PASS, G/timeout PASS, F/H PASS — veredicto global PASS**. El resumen de privilegios
  observado (`INSERT, SELECT`, sin `UPDATE`) es el mismo falso negativo ya documentado
  de `information_schema.table_privileges` para roles `INHERIT FALSE` (hallazgo 3 de
  3D.2); el PASS de D/CAS confirma funcionalmente que `UPDATE` a nivel de columna
  existe y opera. Un intento previo sin `OXKIO_REPO_ROOT` falló cerrado en fase local
  antes de tocar la red y no cuenta como conexión a Neon. Tras la ejecución,
  `OXKIO_3D6_PG_URL`, `OXKIO_3D6_GATE` y `OXKIO_REPO_ROOT` se eliminaron de la sesión
  y se comprobó `False` para las tres. **Con esto, 3D.6 Tier 1 (A–K) queda CERRADA.**
  No habilita Tier 2/E (**BLOQUEADA/DEFERIDA**), restore (**DIFERIDO**) ni 3D.5/3E/3F
  (cerradas/no abiertas).
- 3D.4 abierta en planificación (13/08/2026): alcance canónico sin cambios —secretos
  PostgreSQL reales en Secret Manager, ligados a las tres service accounts de 3C.2,
  en el proyecto ya existente `oxkio-runtime-prod`—. Primera tarea **resuelta**
  (14/08/2026): inventario en **solo lectura** de esas tres identidades, ya
  registradas en la documentación canónica —runtime
  `oxkio-runtime-prod@…`, migración `oxkio-migration-prod@…` y backup
  `oxkio-backup-prod@…`, todas en `oxkio-runtime-prod.iam.gserviceaccount.com`,
  habilitadas y sin claves de usuario—. Resolverlo **no abre** la ejecución real de
  3D.4. Secreto inicial: **solo PG-RUN** (`OXKIO_MISSION_PG_RUNTIME_URL`),
  como URL **sin parámetros de consulta** y **sin `sslmode`**, prohibido pasarla a
  `pg` como `connectionString`; TLS estricto y channel binding se imponen **por
  código**. IAM previsto: `roles/secretmanager.secretAccessor` solo para la identidad
  de runtime y solo sobre ese secreto, nunca a nivel de proyecto. **PG-MIG** queda
  reservado a operaciones/migraciones controladas y **PG-BKP** pertenece a 3D.5;
  ninguno se materializa. El pendiente transversal de TLS en runtime **no se
  adjudica** a 3D.4.
- 3D.4 — evidencia empírica (15/08/2026): una única TP1 con la sonda endurecida
  `oxkio-3d4-pooler-cb-probe.js` (selftest offline 47/47) dio **PASS** contra el
  endpoint **pooled** real: `pg` 8.22.0, TLS autorizado, `rejectUnauthorized=true`,
  `enableChannelBinding=true`, mecanismo negociado **`SCRAM-SHA-256-PLUS`**, conexión
  completada y `SELECT 1` correcto, con identidad `oxkio_mission_runtime` y cero
  reintentos. **PG-RUN = POOLED queda confirmado**; no se propone DIRECT. Solo se
  mostró hostname enmascarado y las variables de credencial se retiraron del entorno.
  Confirmarlo no materializaba por sí solo PG-RUN. Lección vigente: al construir una
  URI de PostgreSQL, usuario y contraseña deben percent-encodearse antes de
  incorporarlos al userinfo.
- 3D.4 — **PG-RUN MATERIALIZADO (15/08/2026)**: bajo puerta humana concedida y ya
  **consumida**, el operador ejecutó manualmente en la consola web las Puertas A y B.
  `OXKIO_MISSION_PG_RUNTIME_URL` existe en `oxkio-runtime-prod` con **exactamente
  Version 1, habilitada** y cifrado administrado por Google; sobre el propio secreto
  figura la service account de runtime con el rol que la consola muestra como «Usuario
  con acceso a secretos de Secret Manager», sin condición IAM —
  `roles/secretmanager.secretAccessor` es su correspondencia esperada, no un ID leído
  literalmente de la pantalla—. Junto a ese binding explícito aparece el **Propietario
  heredado** del proyecto, de modo que la identidad de runtime no es el único sujeto
  capaz de leer el secreto. Migración y backup no figuran en los permisos del secreto.
  Evidencia verificada por el operador en consola; OXKIO no usó `gcloud` ni accedió al
  valor. No demuestra consumo productivo alguno.
- 3D.4 **CERRADA (15/08/2026)** tras auditoría formal: sus siete criterios quedaron
  satisfechos —inventario de service accounts, PG-RUN como único secreto inicial, PG-MIG
  y PG-BKP sin materializar, formato correcto de la URL, mínimo privilegio a nivel del
  secreto y TLS productivo fuera de alcance—. Evidencia añadida: replicación «Replicado
  automáticamente», cifrado «Administrada por Google», rotación «Sin programar»,
  vencimiento «Nunca» y los eventos `CreateSecret` → `AddSecretVersion` → `SetIamPolicy`.
  El cierre acredita **custodia y acceso, no consumo**: PG-RUN sigue **sin consumidor
  productivo**. Pendientes transferidos sin ejecutar: percent-decode al consumidor;
  `optional` y fallo cerrado al contrato/runtime; TLS y channel binding al pendiente
  transversal de composición; consumo y lectura real a runtime/Cloud Run posterior;
  conexión runtime→Neon a 3D.6/pruebas reales; despliegue y retirada del Owner humano a
  fases posteriores. No abre ninguna subfase.
- 3D.3 cerrada (13/08/2026): T1–T5 ejecutadas y **todas PASS**. TLS estricto
  demostrado —CA y hostname verificados con fallo cerrado en ambos casos
  (`ERR_TLS_CERT_ALTNAME_INVALID` y `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`), SNI
  correcto, `rejectUnauthorized=true`, certificado vigente— y **`SCRAM-SHA-256-PLUS`
  demostrado positivamente** observando el mecanismo negociado, no solo activando la
  opción. Anti-downgrade validado offline: la `connectionString` puede alterar la
  política TLS y el patrón seguro de OXKIO la preserva.
- Límite de 3D.3: todo lo anterior se demuestra **mediante sonda**. El **runtime
  productivo sigue sin política TLS cableada**; queda como **pendiente transversal de
  runtime/composición**, obligatorio antes de cualquier conexión o despliegue
  productivo, **sin asignarse todavía a ninguna subfase** y sin ampliar el alcance de
  3D.4. Constatación técnica registrada: `pg` sobrescribe `ssl.servername` con el
  host, comportamiento verificado del cliente, no vulnerabilidad.
- 3D.2 cerrada (13/08/2026): `oxkio_mission_owner` y `oxkio_mission_runtime`
  creados por SQL controlado, sin `neon_superuser`; esquema `oxkio` con
  `missions` y `mission_confirmations`; RLS `ENABLE` + `FORCE`; políticas por
  `tenant_id` + `user_id` + `client_id`; 10 índices, 22 CHECK, 56 constraints;
  privilegios mínimos verificados (`SELECT`+`INSERT`; `UPDATE` solo en 13 y 8
  columnas exactas; `DELETE`/`TRUNCATE` denegados). Demuestra RLS **configurado**,
  no aislamiento funcional entre scopes: eso pertenece a 3D.6.
- Incidencias resueltas en 3D.2: Neon no admite verificador SCRAM precomputado
  como `PASSWORD` (exige texto claro; su rechazo abortaba con `XX000` /
  `SendDeltasToControlPlane`); y el primer `verify` dio 28/31 por falsos negativos
  de `information_schema`, causados por el diseño `INHERIT FALSE`. Se corrigió solo
  el verificador, pasando a ACL directa más `has_*_privilege`; ningún permiso real
  se modificó.
- Hallazgo de seguridad (11/08/2026): los roles creados por consola/CLI/API de
  Neon reciben `neon_superuser` (CREATEDB/CREATEROLE/BYPASSRLS), incompatible
  con el mínimo privilegio exigido; `oxkio_mission_owner`/`oxkio_mission_runtime`
  se crearán solo por SQL controlado, nunca por la consola.
- Último hito publicado: 5C.7B.3B, commit `4a5076c`.
- Documento canónico del sobre de carga:
  `XANTALAL/00_GOVERNANCE/G0002.5B.2F-ARQUITECTURA-PRODUCTIVA-POSTGRESQL-CLIENTE-CERO.md`.

## Evidencia publicada G0002.5B.2E

- Implementación: completada para el commit atómico Confirmation → Mission.
- PostgreSQL Integration: 22/22 pruebas aprobadas.
- Contratos: 65/65 pruebas aprobadas.
- Servicios: 92/92 pruebas aprobadas.
- Total: 179/179 pruebas aprobadas.
- Commit y publicación: completados en `e4c79ff`.
- Continuidad: G0002.5B.2F cerrada; 5C.7B.3 abierta con 3A–B cerradas, 3C abierta
  documental/controlada y 3D–F no abiertas.

## Evidencia de cierre 5C.6D.1

- Implementación: completada
- Integración: completada
- Pruebas: completadas
- Piloto manual: completado con un borrador Gmail real y cero envíos
- Auditoría: completada; aceptación final superada
- Documentación canónica: actualizada
- Observer alineado: completado
- Validación del Supervisor: completada
- Staging selectivo preparado: completado y auditado
- Commit: completado por este cierre
- Publicación: completada por este cierre

## Evidencia publicada 5C.7B.1

Referencia publicada: 5C.7B.1.

- Implementación: completada
- Integración: completada
- Pruebas: completadas según el cierre publicado
- Piloto manual: completado en Node con puertos 3000 y 3107; Docker bloqueado por entorno
- Auditoría: completada para el alcance cloud-ready neutral
- Documentación canónica: actualizada y publicada
- Observer alineado: completado
- Validación del Supervisor: completada
- Staging selectivo preparado: completado
- Commit: completado en `a8619c1`
- Publicación: completada

## Evidencia de cierre

- Implementación: completada para inventario, contrato, harness y POC comparables.
- Integración: no iniciada; no se conectó el runtime a ningún motor.
- Pruebas: POC Firestore y PostgreSQL superadas con 13/13 operaciones.
- Piloto manual: POC local ejecutada; no representa cloud.
- Auditoría: ADR humana ratificada.
- Documentación canónica: actualizada.
- Observer alineado: completado.
- Validación del Supervisor: pendiente.
- Staging selectivo preparado: completado para 5C.7B.2.
- Commit: completado por el cierre material.
- Publicación: completada por el cierre material.

Decisión: PostgreSQL gestionado como persistencia operativa principal. Proveedor
pendiente. No se migraron datos ni se activaron servicios.

Capacidades operativas verificadas:

- Business, Knowledge, Memory, Gmail y Calendar readonly.
- OperationsCoordinator.
- Decision Engine y Operation Planner.
- Executive Fusion Engine.

## Capacidades consolidadas y publicadas

- Dashboard Intelligence.
- Executive Summary.
- Business Readonly.
- Knowledge Readonly.
- Memory Readonly.
- Gmail Readonly.
- Calendar Readonly.
- OperationsCoordinator.
- Decision Engine.
- Operation Planner.
- Executive Fusion.
- Executive Action Proposal.
- Executive Action Preparation.
- Ecosystem Observer y fusión con fuentes propietarias.
- Gmail Draft supervisado bajo SAFE_DRAFT_ONLY.

## No abrir todavía

- 5C.7B.3D.6 Tier 2/E y restore (siguen BLOQUEADA/DEFERIDA y DIFERIDO tras el cierre real de Tier 1 el 16/08/2026); 3D.5 y su rol de backup; TLS productivo cableado en el runtime; 5C.7B.3E; 5C.7B.3F desde B3 en adelante (B1 —`PostgresApprovalRepository` offline— y B2 —decisiones productivas de identidad/secreto/esquema/RLS/grants/TLS— ya CERRADAS, `a721285` y 17/08/2026 respectivamente, ambas sin SQL real, sin rol/secreto creados y sin conexión Neon; B3 —migración SQL offline— es el siguiente paso y sigue sin autorizar). (3D.4 y 3D.6 Tier 1 ya tuvieron su ejecución real autorizada y cerrada; no reabrir sin puerta humana nueva.)
- Envío de Gmail.
- Calendar Execution.
- Automatizaciones y activación de otros agentes.

## Advertencias evidenciadas

- El árbol de trabajo contiene cambios históricos y runtime ajenos a 5C.7B que deben permanecer separados.
- Los tokens OAuth reales siguen en filesystem local y deben rotarse antes de cualquier despliegue.
- Memoria, Approval Queue y logs siguen ligados a JSON local; no admiten runtime multiinstancia.
- Las colecciones Firestore reales no están inventariadas; no borrar, escribir ni activar doble escritura.
- La excepción `draftExecutionEnabled` debe permanecer cerrada a Gmail Draft y separada de `executionEnabled=false`.
- Las evidencias y auditorías ya aceptadas no se repetirán salvo invalidación objetiva del contexto.

## Decisión de arquitectura 5C.7B

- Runtime candidato pendiente de auditoría: Cloud Run + Firebase Authentication.
- Persistencia operativa principal ratificada: PostgreSQL gestionado.
- Firestore: POC superada; no será BBDD operativa principal.
- Híbrida Firestore + PostgreSQL: descartada para el núcleo.
- Primera auditoría Antigravity: recibida; veredicto APROBADA CON CORRECCIONES.
- Riesgos aceptados: JSON multiinstancia, secretos locales, filesystem efímero, idempotencia persistente y desacoplamiento de trabajos duraderos.
- Redis/BullMQ y Railway no se aceptan como decisiones obligatorias.
- Persistencia principal: ratificada mediante
  `XANTALAL/00_GOVERNANCE/ADR-5C.7B.2-POSTGRESQL-PERSISTENCIA-PRINCIPAL.md`.
- LucusHost compartido: no apto para PostgreSQL productivo con runtime externo;
  acceso remoto deshabilitado, sin PITR ni restauración PostgreSQL específica.
- Estado: 5C.7B.1 CERRADA Y PUBLICADA; 5C.7B.2 CERRADA Y PUBLICADA,
  PERSISTENCIA PRINCIPAL RATIFICADA.
- Segunda auditoría Antigravity: tras el piloto remoto y antes de probadores.
- Prohibido contratar, migrar, activar doble escritura o desplegar durante esta subfase.
- Documento canónico: `XANTALAL/00_GOVERNANCE/5C.7B-ARQUITECTURA-EJECUTABLE-RUNTIME.md`.
- Decisión detallada: `XANTALAL/00_GOVERNANCE/5C.7B.2-PERSISTENCIA-DEFINITIVA.md`.

## Elementos a reutilizar

- Completar el Ecosystem Observer existente como única proyección de conciencia situacional.
- Mantener Dashboard Intelligence como único compositor de las vistas sanitizadas.
- Reutilizar Executive Chat para el futuro comando /ecosistema solo cuando no active lecturas ajenas al Observer.

## Duplicación eliminada o evitada

- Se evitó crear otro supervisor y se amplió el Ecosystem Observer existente.
- Se conservaron SupervisorAgent y OxkioSupervisor en sus responsabilidades actuales.

## Logros de la sesión

- Se consolidó el Ecosystem Observer como Supervisor Operativo readonly.
- Se añadió una recomendación única con evidencia y autoridad humana.
- Se registraron lecciones permanentes y la preparación sanitizada del Comité de Inteligencia.
- Se completó y aceptó como evidencia canónica el piloto manual autenticado del Cliente Cero.
- Se reutilizaron Approval Queue, ExecutionService y GmailDraftProvider sin crear arquitectura paralela.
- Se separaron explícitamente aprobación humana y creación del borrador.
- Se creó exactamente un borrador Gmail real bajo SAFE_DRAFT_ONLY, sin envío ni duplicados.
- Se cerró la posible divergencia final entre ExecutionService y Approval Queue.
- Se superaron 517/517 pruebas, `node --check` y `git diff --check`.

## Historial sustituido — planificación inicial del 22/06/2026

La siguiente planificación se conserva como historial. Ya no representa la fase
actual ni debe utilizarse para determinar el siguiente paso.

### Fase 1 - Orquestación local

- Crear carpeta orchestration.
- Documentar proyectos.
- Documentar agentes.
- Documentar seguridad.
- Crear Project Manager V1 en Oxkio.

Estado: sustituida por el roadmap operativo vigente.

### Fase 2 - Codex

- Verificar instalación de Codex.
- Probar Codex en tarea pequeña.
- Crear protocolo de revisión antes de commit.
- Definir Codex como agente programador supervisado.

Estado: parcialmente incorporada al roadmap estratégico; no es la fase activa.

### Fase 3 - Rentabilización

- Priorizar Business Hunter.
- Cerrar MVP comercial.
- Preparar GIU MVP.
- Mantener Profesor IA como apoyo de marketing.

Estado: permanece como objetivo estratégico, no como fase técnica activa.

### Fase 4 - Conexiones

- GitHub.
- Gmail.
- Calendar.
- Google Drive.
- OneDrive.
- LucusHost.

Estado: Gmail y Calendar readonly completados; el resto permanece planificado.

### Fase 5 - Nube

- Revisar plan LucusHost Node.js.
- Subir primer panel interno.
- Preparar control desde móvil.

Estado: pendiente; no abrir antes de cerrar el bloque ejecutivo vigente.

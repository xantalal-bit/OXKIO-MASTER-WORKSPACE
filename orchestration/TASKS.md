# OXKIO TASKS

## Estado operativo vigente

- **Reconciliación 4F — 08/09/2026:** B6 / 5C.7B.3F CERRADA — PASS REAL
  (07/09/2026); 5C.7B.4 validada hasta 4E — PASS REAL en staging Cloud Run
  privado, con IAM + Firebase, Approval `postgres` y `BUSINESS_WRITES=0`.
  Rollback de Cloud Run definido y revisado documentalmente, no ejecutado.
  **POST-CLOSE — 08/09/2026: 4F = CERRADA / PASS;
  5C.7B.4 = CERRADA / PASS REAL / PUBLICADA**. Commit final del cierre:
  `3c5aa7e441e95eae3dc0adfce36f1f98ed9f257a`; `HEAD = origin/main` y árbol
  limpio verificados tras publicación, antes de esta edición POST-CLOSE.
  Las limitaciones técnicas pendientes siguen vigentes.
  **5C.7B.5 = CERRADA / PASS** (08/09/2026): 5C.7B.5A (logs, Cloud Logging)
  CERRADA/PASS READ-ONLY, 5C.7B.5B (métricas y coste, Cloud
  Monitoring/Billing) CERRADA/PASS READ-ONLY y 5C.7B.5C (alertas/SLO/
  presupuesto) CERRADA/PASS DOCUMENTAL, sin crear ninguna alerta, uptime
  check, dashboard, métrica custom, sink, budget ni API adicional; sin
  habilitar `billingbudgets.googleapis.com` ni `cloudbilling.googleapis.com`
  para uso activo. **5C.7B.6 = DEFINIDA / NO ABIERTA** (08/09/2026):
  resuelve la anomalía histórica 3D.5/5C.7B.6 —3D.5 no se reabre, queda
  cerrada/no abierta como antecedente histórico; sus obligaciones de
  pg_dump/export, destino, retención e identidad de backup se transfieren
  formalmente a 5C.7B.6 como único contenedor operativo, sin fases
  paralelas—; el restore diferido de 3D.6 no reabre 3D.6, su deuda se
  transfiere a la futura 6C y solo una prueba válida de 6C podrá
  satisfacerla; principio de cobertura fijado: DR parcial demostrado ≠ DR
  integral de OXKIO, mientras Memory, Operations/execution log, Executive
  Agenda, Project Registry, Security Inventory y Knowledge sigan siendo
  filesystem local sin recuperación demostrada; estructura definida
  6A (inventario, sin mutación/puerta humana) – 6B (backup verificable de
  Approval PostgreSQL, con PRE-6B read-only de Neon obligatorio antes de
  abrirla, puerta humana propia) – 6C (restore aislado, puerta humana
  propia, nunca sobre productivo, nunca PG→JSON) – 6D (DR + RPO/RTO sin
  cifras inventadas, puede cerrar «PARCIAL DEMOSTRADO») – 6E (evidencia y
  cierre documental, no abre 5C.7B.7 automáticamente). Esta definición no
  concede ninguna puerta humana, no abre 6A–6E, no ejecuta backup,
  restore, SQL, GCP, Neon, código ni manifiestos.
  **6A = CERRADA / PASS_WITH_LIMITATIONS READ-ONLY** (08/09/2026):
  inventario consolidado — Approval PostgreSQL/Neon (autoridad durable,
  crítica, sin backup/restore, prioridad 1); Approval JSON V2 (legacy/dev,
  no autoritativo donde `backend=postgres`, nunca rollback de PostgreSQL);
  GitHub/código (durable/reconstruible, drill de restauración nunca
  ejercitado); Artifact Registry (artefacto reconstruible, no backup de
  facto); Cloud Run (configuración reconstruible con intervención humana,
  manifest no es snapshot exacto); Secret Manager (credencial crítica, sin
  backup en claro, recreación/rotación bajo IAM); Memory, Project
  Registry, Executive Agenda y Strategic Memory (autoridad local, alta,
  sin cobertura); Operations/execution log (autoridad local, alta, con
  cobertura incidental parcial vía Git); Security Inventory (autoridad
  local, crítica, sin cobertura); Knowledge (local, parcialmente
  reconstruible); OAuth Gmail/Calendar (credencial, recuperación por
  reautorización/revocación/rotación, no backup); Firebase Auth
  (dependencia durable externa, DR del proveedor UNKNOWN);
  `OXKIO_ADMIN_FIREBASE_UIDS` clasificado como CONFIGURACIÓN SENSIBLE, no
  credencial fuerte.
  Limitaciones registradas (razón del WITH_LIMITATIONS): (1)
  `backend/core/executionLog.json` trackeado en Git — cobertura
  incidental/reconstruible parcial, no gobernada, no destrackeado en esta
  tarea; (2) `backend/executive/executiveAgendaStore.json` trackeado en
  Git, contradiciendo la intención del `.gitignore` para stores —
  anomalía/higiene pendiente separada, no destrackeada ni corregido el
  `.gitignore` aquí; (3) bloque histórico de Approval JSON V2 en el canon
  marcado **SUPERSEDED** por B6 CERRADA/PASS REAL, sin borrar la
  historia. UNKNOWN de Neon (plan, PITR, retención, restore nativo,
  branching/time travel, necesidad de `pg_dump`) transferido íntegro al
  PRE-6B, sin bloquear el cierre de 6A. Prioridades fijadas para fases
  futuras: 1) Approval PostgreSQL/Neon, 2) Security Inventory, 3)
  procedimiento de recuperación de Secret Manager, 4) Memory/Project
  Registry/Executive Agenda/Strategic Memory, 5) Operations/execution
  log. **No se declara DR completo de OXKIO.**
  **PRE-6B = CERRADO / PASS READ-ONLY** (08/09/2026): verificación visual
  real del proyecto Neon `OXKIO` (organización `XANTALAL`), realizada
  directamente por José Antonio en la consola web ya autenticada (la
  extensión de navegador de esta sesión no estaba conectada; ningún
  acceso automatizado se ejecutó contra Neon). Evidencia confirmada:
  plan **Free**; branch producción; región **AWS Europe Central 1
  (Fráncfort)**; **PostgreSQL 18**; compute predeterminado 0,25↔2 CU,
  observado suspendido/inactivo durante la inspección; 1 database/1
  compute; Data API no habilitada; VPC no configurada; **ventana PITR
  real de 6 horas**; restore disponible con vista previa; **sin
  snapshots actuales ni programados**, creación manual disponible,
  programación avanzada requiere mejora de plan. Uso puntual observado
  (compute 0,66 CU-hrs, storage 32,21 MB, history 178,67 kB, network
  1,44 MB) registrado como evidencia operacional puntual, sin
  extrapolar coste ni declararlo coste cero. No se ejecutó restore,
  snapshot, branch, SQL, conexión ni cambio de configuración.
  Trazabilidad: 6A se cerró y publicó en `17f18ce7...`; después, como
  parte del propio PRE-6B (no de 6A), se realizó primero una consulta
  read-only de documentación oficial pública de Neon (sin acceso visual
  al proyecto real en ese momento), que quedó PASS PARCIAL/INCOMPLETO;
  la evidencia visual real, obtenida después, confirma únicamente los
  datos proyecto-específicos verificables en consola (plan, región,
  versión, compute, PITR 6h, ausencia de snapshots); soporte de
  `pg_dump`/`pg_restore` y comportamiento de branching permanecen
  sustentados por la documentación oficial, no por las capturas. Ambas
  fuentes se conservan sin contradicción. Decisión arquitectónica
  fijada para 6B: **NEON NATIVO + PG_DUMP INDEPENDIENTE** (PITR de 6h
  confirmado visualmente e insuficiente en solitario; `pg_dump` según
  documentación oficial; independencia de proveedor = decisión
  arquitectónica de OXKIO; PG→JSON nunca como rollback; secretos nunca
  exportados como backup); esta decisión no abre 6B, solo prepara su
  diseño. Observación sobre PostgreSQL 18 en preview, detectada durante
  la consulta documental del PRE-6B (no registrada en 6A), queda como
  **riesgo tecnológico separado**, pendiente de reverificación
  específica, fuera del cierre DR.
  **6B = DEFINIDA / NO ABIERTA** (08/09/2026): activo inicial Approval
  PostgreSQL/Neon. Artefacto: `pg_dump` formato custom (`-Fc`), un único
  artefacto principal por ejecución, nombre determinista
  (proyecto/activo + timestamp UTC + id de ejecución), sin fijar nombre
  exacto definitivo. Conexión: endpoint unpooled, credencial efímera o
  recuperada en runtime, nunca impresa ni persistida fuera del mecanismo
  autorizado. Dos identidades distintas, no confundibles: (B.1) identidad
  ejecutora del proceso —
  `oxkio-backup-prod@oxkio-runtime-prod.iam.gserviceaccount.com` existe,
  inventariada como candidata para ejecutar/orquestar el backup; no se
  afirma que autentique directamente contra PostgreSQL; sin permisos IAM
  concedidos ni afirmados aquí — y (B.2) identidad/rol PostgreSQL de
  backup (PG-BKP), prevista/reservada en 3D.5 pero no materializada, sin
  credencial operativa ni privilegios demostrados, no creada en esta
  tarea; pendiente resolver rol exacto, privilegios mínimos, mecanismo de
  autenticación, custodia de su credencial y relación con B.1. PG-APR
  humana persistente, PG-RUN con privilegios excesivos y credenciales
  administrativas generales quedan excluidas como solución permanente;
  se aplica mínimo privilegio.
  Destino: requisito (fuera de Neon, preferiblemente fuera del dominio
  administrativo de `oxkio-runtime-prod`), sin proveedor definitivo —
  **PENDIENTE DE DECISIÓN PRE-EJECUCIÓN**; sin contratación, bucket ni
  subida. Cifrado en tránsito y en reposo obligatorios; clave aplicativa,
  si existe, nunca junto al backup. Integridad: tamaño, SHA-256,
  timestamp, origen, versión PostgreSQL, resultado `pg_dump`,
  resultado de validación, id de ejecución. Verificación: PASS futuro
  exige exit code 0, artefacto no vacío, checksum calculado, inspección
  sin mutación cuando sea posible, destino/retención gobernados, cero
  secretos expuestos — nunca válido solo por existir el archivo (eso es
  6C para restore). Retención: mínimo más de una generación, protección
  frente a sobrescritura, superar la ventana PITR de 6h; cifra numérica
  = PENDIENTE, cualquier propuesta futura se marca PROPUESTA, no
  decisión. Privacidad: dump tratado como activo sensible, sin email,
  chat, Git, carpeta pública, logs con contenido ni terceros. Recovery
  metadata: manifiesto no secreto (asset, environment, source_provider,
  id de BD no secreto, versión PostgreSQL, formato, `created_at` UTC,
  checksum, tamaño, versión de herramienta, resultado, clase de
  retención, `restore_tested=false`), nunca password/connection
  string/token/secreto. Fail-closed ante credencial no disponible,
  versión `pg_dump` incompatible, TLS inseguro, destino no gobernado,
  checksum fallido, artefacto vacío, path inesperado o secreto en
  output. Puerta humana separada obligatoria para la ejecución real,
  autorizando origen, identidad/credencial, destino, retención, cifrado
  y ejecución de `pg_dump`. 6B nunca restaura, cambia autoridad,
  sustituye PostgreSQL ni usa JSON — eso pertenece a 6C. 8 pendientes
  pre-ejecución registrados (destino, retención numérica, cifrado
  aplicativo, identidad ejecutora exacta [B.1, sin permisos IAM
  resueltos], rol/credencial PostgreSQL de backup PG-BKP [B.2, distinto
  de B.1], versión `pg_dump`, custodia, política de acceso) que no
  impiden definir 6B pero sí impiden ejecutarla.
  **5C.7B.6 sigue ABIERTA**, sin abrir 6B. **6C–6E = NO ABIERTAS.
  5C.7B.7 = NO ABIERTA**; no se abre ninguna fase posterior.
  Evidencia y límites: documento canónico
  `XANTALAL/00_GOVERNANCE/5C.7B-ARQUITECTURA-EJECUTABLE-RUNTIME.md`, secciones
  «Reconciliación documental 4F y propuesta de cierre 5C.7B.4 — 08/09/2026»,
  «Cierre canónico 5C.7B.5 — Logs, métricas, alertas y presupuesto —
  08/09/2026», «Definición canónica 5C.7B.6 — Backup, export, restore y
  DR — 08/09/2026», «Cierre documental 6A — Inventario, autoridad y
  criticidad — 08/09/2026», «Cierre documental PRE-6B — Verificación
  real Neon — 08/09/2026» y «Definición canónica 6B — Backup/export
  verificable — 08/09/2026».
  Las entradas históricas fechadas y sus avisos SUPERSEDED se conservan.
  **Consolidación documental PRE-6B — Destino, retención e identidades
  de backup (08/09/2026):** subfases de diseño pre-ejecución
  (`PRE-6B.1B` destino, `PRE-6B.2` retención, `PRE-6B.3` identidades),
  distintas del `PRE-6B` singular ya cerrado (verificación Neon).
  **PRE-6B.1B = PASS READ-ONLY**: destino primario candidato OVHcloud
  Object Storage Standard 3-AZ París, alternativa técnicamente válida
  Scaleway Object Storage París, secundario Google Drive/One manual/
  humano, buffer local solo temporal; Object Lock propuesto en modo
  Governance, no Compliance. **PRE-6B.2 = PASS READ-ONLY**: propuesta
  pre-ejecución GFS ligero (diarios 7, semanales 4, mensuales 3,
  generaciones lógicas aproximadas, no necesariamente objetos físicos
  distintos); frecuencia diaria como propuesta inicial para Cliente
  Cero, pendiente de validar contra el RPO futuro de 6D — no
  justificada por el PITR de 6h de Neon, que cubre un dominio de fallo
  distinto al de `pg_dump` independiente; regla `OBJECT_LOCK_EXPIRY <=
  LIFECYCLE_EXPIRY`, sin asumir reintento automático de lifecycle
  bloqueado. **PRE-6B.3 = CERRADA / PASS READ-ONLY** (tras ratificación
  humana explícita de José Antonio en esta misma consolidación): B.1
  (`oxkio-backup-prod@...`) confirmado como identidad GCP de
  orquestación, no rol PostgreSQL, sin permisos IAM concedidos; diseño
  de B.2 en dos roles — `PG-BKP-ROLE` (NOLOGIN, portador de privilegios,
  incluido `BYPASSRLS` como excepción de diseño justificada) y
  `PG-BKP-LOGIN` (LOGIN, credencial rotable) —, ninguno materializado.
  **Corrección de formulación**: `pg_dump` sin `BYPASSRLS` contra tablas
  con `FORCE ROW LEVEL SECURITY` (confirmado en `003`/`004` de
  Approval) **falla con error (fail-closed)**, no exporta 0 filas
  silenciosamente — cualquier formulación previa en ese sentido queda
  corregida. Alcance del backup ratificado como **dominio Approval
  únicamente** (`oxkio.approval_items` y futuros objetos del mismo
  owner), excluyendo Mission Queue sin implicar que no necesite backup
  en el futuro. Ningún rol PostgreSQL, secreto, bucket, credencial real
  ni `pg_dump` se crea/ejecuta en esta consolidación, que es
  exclusivamente documental. **Estado final: 5C.7B.6 = ABIERTA; 6A =
  CERRADA / PASS_WITH_LIMITATIONS READ-ONLY; PRE-6B = CERRADO / PASS
  READ-ONLY; PRE-6B.1B = PASS READ-ONLY; PRE-6B.2 = PASS READ-ONLY;
  PRE-6B.3 = CERRADA / PASS READ-ONLY; 6B = DEFINIDA / NO ABIERTA; 6C–6E
  = NO ABIERTAS; 5C.7B.7 = NO ABIERTA.** Evidencia: documento canónico
  `XANTALAL/00_GOVERNANCE/5C.7B-ARQUITECTURA-EJECUTABLE-RUNTIME.md`,
  sección «Consolidación documental PRE-6B — Destino, retención e
  identidades de backup — 08/09/2026».
  **Apertura 6B tramo OFFLINE — 6B.1 toolchain y 6B.2 wrapper `pg_dump`
  (09/09/2026):** bajo autorización humana explícita de José Antonio
  limitada a implementar y validar **sin conexión real**. **6B.1 =
  PASS**: PostgreSQL client tools locales verificados por ruta absoluta
  en `C:\Program Files\PostgreSQL\18\bin` — `pg_dump`, `pg_restore` y
  `psql`, los tres `18.6`, coincidiendo en versión mayor con el
  PostgreSQL 18 canónico de Neon; resuelve el pendiente (6) de la
  sección M **solo en su vertiente local**, no en la identidad ejecutora
  B.1. **6B.2 = PASS OFFLINE**: wrapper seguro implementado en
  `backend/services/backup/pg-dump-wrapper.js` con tests focales en
  `backend/services/backup/pg-dump-wrapper.test.js`, reutilizando
  `backend/security/secret-runtime.js` (`redact`/`[REDACTED]`) y el
  contrato anti-`connectionString` de campos discretos de
  `backend/repositories/postgres-approval-factory.js`, sin crear ningún
  subsistema paralelo. Credencial efímera inyectada por el llamador —
  nunca leída de `process.env` — colocada solo en el entorno del proceso
  hijo, construido por lista blanca con purga previa de cualquier `PG*`
  heredada, y liberada por limpieza lógica de referencias (no se afirma
  borrado seguro de RAM); nunca en `argv`, `.env`, entorno
  User/Machine, Git ni logs. `PGSSLMODE=verify-full` y
  `PGCHANNELBINDING=require` impuestos por código y no debilitables;
  endpoint DIRECTO obligatorio, `-pooler` aborta sin intentar corregirse;
  formato custom, artefacto único, nombre determinista `asset + UTC +
  executionId`, salida fuera del repositorio, de OneDrive y de `.git`,
  sin overwrite. `--no-owner`/`--no-privileges` **no se emiten**:
  decisión diferida a 6C (`PENDING_6C`). Alcance dominio Approval
  únicamente, con Mission Queue en lista de exclusión explícita y el
  modo `owner_resolved` reservado como contrato que **falla como
  PENDIENTE** en vez de inventar una lista rígida, porque resolverlo
  exige el catálogo real de Neon. `ValidateOnly` devuelve solo datos no
  secretos (host redactado, nombres de variables sin valores, nunca
  `PGPASSWORD`) y no lanza `pg_dump`; matiz declarado: la puerta de
  versión sí ejecuta una sonda local `pg_dump --version`, sin red ni
  credenciales, inyectable y doblada en tests. Fail-closed POST diseñado
  y probado con dobles (exit code, señal/timeout, artefacto ausente,
  tamaño 0), con tamaño y SHA-256 en el camino correcto, `stdout`/
  `stderr` saneados y errores reportados por lista blanca de campos.
  `pg_restore --list` implementado y probado solo offline con fixture
  sintético. La evidencia se **devuelve**, no se persiste:
  `backend/core/executionLogger.js` se descartó deliberadamente como
  sumidero por escribir en `executionLog.json`, trackeado en Git.
  `FOCAL = 34/34 PASS`; `RELATED = 211/211 PASS, 2 SKIP` preexistentes
  bloqueados por entorno. **Hallazgo nuevo**: `verify-full` exige una CA
  raíz resoluble (en Windows `%APPDATA%\postgresql\root.crt` si no se
  fija `PGSSLROOTCERT`); no se ha verificado qué mecanismo usará la
  identidad ejecutora futura y queda como pendiente pre-ejecución.
  **No se conectó a Neon, no se ejecutó `pg_dump` real, no se creó
  `PG-BKP-ROLE` ni `PG-BKP-LOGIN`, no hubo SQL mutativo,
  `GRANT`/`REVOKE`, `BYPASSRLS` real, secretos, IAM, OVHcloud, bucket,
  Object Lock/lifecycle, backup real ni subida de archivos.** **Estado
  final: 5C.7B.6 = ABIERTA; 6B = ABIERTA EN SU TRAMO OFFLINE; 6B.1 =
  PASS; 6B.2 = PASS OFFLINE; 6C–6E = NO ABIERTAS; 5C.7B.7 = NO
  ABIERTA.** La ejecución real de 6B sigue exigiendo la puerta humana
  separada de la sección K. Evidencia: documento canónico
  `XANTALAL/00_GOVERNANCE/5C.7B-ARQUITECTURA-EJECUTABLE-RUNTIME.md`,
  sección «Apertura 6B tramo OFFLINE — 6B.1 toolchain y 6B.2 wrapper
  `pg_dump` — 09/09/2026».
  **6B.3A — CA raíz + alcance dinámico Approval (09/09/2026):**
  `6B.3A = PASS_WITH_LIMITATIONS OFFLINE`, estrictamente offline sobre
  `backend/services/backup/pg-dump-wrapper.js`. CA: evidencia oficial
  (PostgreSQL 18 `libpq-connect.html`, `release-16.html`; hilo oficial
  `pgsql-hackers` abril 2025; documentación oficial de Neon) confirma
  `sslrootcert=system` disponible desde libpq 16 (local = 18.6, OK) pero
  **no fiable en Windows** para usuarios sin almacén OpenSSL propio —
  corroborado por la propia Neon, que documenta que Windows no ofrece un
  archivo de raíces CA utilizable y recomienda descarga manual; Neon usa
  `ISRG Root X1` (Let's Encrypt), ampliamente presente en `ca-certificates`
  de Linux mantenido. Decisión: **SYSTEM TRUST STORE condicionado por
  plataforma** — recomendado para la identidad ejecutora real (Cloud
  Run/Linux), no forzado en Windows. Wrapper: nueva constante
  `SSL_ROOT_CERT_SYSTEM` y `validateSslRootCert` — acepta `'system'` tal
  cual, exige ruta absoluta existente en cualquier otro caso (relativa =
  `backup_ssl_root_cert_invalid`, inexistente =
  `backup_ssl_root_cert_missing`), y `ValidateOnly` solo publica una
  categoría (`unset`/`system`/`explicit-file`), nunca la ruta real.
  Alcance dinámico: comparadas 5 estrategias (lista explícita, catálogo
  real, inferencia por migraciones, manifiesto versionado, combinación);
  elegida la combinación **manifiesto versionado + resolver inyectable**,
  con **igualdad exacta de conjuntos** exigida entre ambos — cualquier
  discrepancia en cualquier dirección es `backup_scope_catalog_mismatch`,
  cualquier owner distinto es `backup_scope_catalog_unexpected_owner`,
  cualquier fallo o resultado vacío del resolver es
  `backup_scope_catalog_unavailable`, y ningún objeto de Mission Queue se
  acepta aunque venga del propio catálogo resuelto
  (`backup_scope_out_of_domain`). Nuevo archivo versionado
  `backend/services/backup/approval-domain-manifest.js`
  (`EXPECTED_APPROVAL_OBJECTS`/`EXPECTED_APPROVAL_TABLES`, hoy solo
  `oxkio.approval_items`). Sin manifiesto y sin resolver inyectados
  explícitamente, `owner_resolved` sigue fallando cerrado como
  PENDIENTE — capacidad estrictamente opt-in, sin activación por
  inercia. Privilegios de catálogo: **GAP documentado, no hecho
  canónico** — no se encontró cita oficial exacta que confirme lectura
  de `pg_catalog` sin privilegios adicionales para PostgreSQL 18;
  pendiente de verificación empírica antes de implementar la consulta
  real. `validateOnly` pasó de síncrona a `async` (cambio de contrato
  interno, sin consumidores externos todavía). `FOCAL = 47/47 PASS`
  (antes 34, +13 nuevos); `RELATED = 224/224 PASS, 2 SKIP` preexistentes
  por entorno. **`COUNCIL_REQUIRED = YES`**: se solicita ratificación de
  Xatai + Gemini/Antigravity sobre si `PGSSLROOTCERT=system` se adopta
  como CA por defecto para la ejecución real, dado que la imagen base
  concreta de Cloud Run no está verificada. **No se conectó a Neon, no se
  ejecutó `pg_dump` real, no hubo SQL, no se creó `PG-BKP`, no se
  concedió `BYPASSRLS` real, no se creó ni leyó ningún secreto, no se
  tocó IAM, OVHcloud ni ningún bucket, y no se produjo ningún backup.**
  **Estado final: 5C.7B.6 = ABIERTA; 6B = ABIERTA EN SU TRAMO OFFLINE;
  6B.1 = PASS; 6B.2 = PASS OFFLINE; 6B.3A = PASS_WITH_LIMITATIONS
  OFFLINE; 6C–6E = NO ABIERTAS; 5C.7B.7 = NO ABIERTA.** Evidencia:
  documento canónico
  `XANTALAL/00_GOVERNANCE/5C.7B-ARQUITECTURA-EJECUTABLE-RUNTIME.md`,
  sección «6B.3A — CA raíz + alcance dinámico Approval — 09/09/2026».
  **6B.3D — Variante offline de imagen de backup (09/09/2026):**
  `6B.3D = PASS OFFLINE`. Consejo de 6B.3A/6B.3B/6B.3C resuelto en
  código: `PGSSLROOTCERT=system` adoptado como política Linux (sin
  root.crt propio); base pinneada por rama (`node:22-alpine3.24`), no
  por digest exacto todavía (digest observado en build,
  `sha256:c610fcdf...3aa32`, registrado como evidencia, no congelado).
  `Dockerfile`: `dependencies` reutilizada sin cambios; nueva etapa
  compartida `app` (COPY de aplicación factorizadas); dos targets
  hermanos derivados — `runtime` (HTTP, sigue siendo la última etapa,
  build sin `--target` sin cambios de contrato, sin
  `postgresql18-client`) y `backup` (nuevo, añade únicamente `apk add
  --no-cache postgresql18-client` sin fijar versión, vuelve a `USER
  node`). Validado con Docker real (arrancado, un único pull, sin
  push): target HTTP sin pg_dump/pg_restore/psql (confirmado ausentes);
  target backup con los tres en `18.6`, Alpine real `3.24.1`, trust
  store `/etc/ssl/cert.pem`→`ca-certificates.crt` con **ISRG Root X1
  confirmado presente**, sin certificado propio añadido
  (`find /etc/ssl/certs/ca-certificates.crt` únicamente), sin ejecutar
  como root, sin secretos en variables de entorno. Nuevos tests
  colocados en `deploy/`: `dockerfile.test.js` (estático, sin Docker,
  10/10 PASS, verifica el contrato del propio archivo) y
  `dockerfile-build.test.js` (con Docker real, auto-omitido si no
  disponible, 9/9 PASS, construye y elimina imágenes con tag efímero
  por ejecución). `FOCAL = 19/19 PASS`; `RELATED = 71/71 PASS`
  (`backend/runtime/*.test.js` + `pg-dump-wrapper.test.js`, sin
  cambios de código, confirmados en verde). **No se conectó a Neon, no
  se ejecutó `pg_dump` real, no se produjo backup, no hubo SQL, no se
  creó `PG-BKP`, no se concedió `BYPASSRLS`, no se creó ni leyó ningún
  secreto, no se tocó IAM, OVHcloud ni ningún bucket, no se hizo push
  de ninguna imagen a ningún registry y no se desplegó nada en Cloud
  Run/GCP.** **Estado final: 5C.7B.6 = ABIERTA; 6B = ABIERTA EN SU
  TRAMO OFFLINE; 6B.1 = PASS; 6B.2 = PASS OFFLINE; 6B.3A =
  PASS_WITH_LIMITATIONS OFFLINE; 6B.3B = PASS_WITH_LIMITATIONS
  READ-ONLY; 6B.3C = PASS_WITH_LIMITATIONS READ-ONLY; 6B.3D = PASS
  OFFLINE; 6C–6E = NO ABIERTAS; 5C.7B.7 = NO ABIERTA.** Evidencia:
  documento canónico
  `XANTALAL/00_GOVERNANCE/5C.7B-ARQUITECTURA-EJECUTABLE-RUNTIME.md`,
  sección «6B.3D — Variante offline de imagen de backup — 09/09/2026».
  **6B.3E — Runner offline del backup (09/09/2026):** `6B.3E = PASS
  OFFLINE`. Nuevo `backend/services/backup/backup-runner.js`, sin
  reimplementar nada: delega toda la logica de `pg_dump` en
  `createPgDumpWrapper()` (`validateOnly`/`runExport`/`resolveArtifactPath`)
  y consume `EXPECTED_APPROVAL_TABLES` de `approval-domain-manifest.js`
  directamente, sin lista propia. CLI (`main()`) reutiliza el patron ya
  existente de `persistence-poc-runner.js` (`if (require.main ===
  module)`, `process.exitCode`, salida JSON saneada). Contrato de
  proveedor de secreto `{ async getBackupCredential() }` (misma forma
  que los providers de `secret-runtime.js`) y de catalogo
  `resolveApprovalCatalog` reutilizado tal cual del wrapper — sin
  ninguno de los dos inyectado, falla cerrado
  (`runner_secret_provider_missing` / `runner_catalog_provider_missing`)
  antes de tocar nada. Dos modos: `validate-only` (nunca abre red, nunca
  lanza `pg_dump`, default del CLI) y `execute` (contrato interno,
  requiere `mode==='execute'` Y `allowExecute===true` simultaneos —
  `--execute` sin `--allow-execute` en el CLI queda bloqueado). TLS no
  configurable desde fuera: siempre `verify-full`/`require`,
  `PGSSLROOTCERT=system` por defecto (politica de 6B.3D), solo
  overridable a un archivo explicito. **Integracion Docker sin ningun
  cambio de Dockerfile**: el runner ya vive en el target `backup` via la
  etapa compartida `app`; invocado explicitamente dentro del contenedor
  real construido (`docker run oxkio-backup:... node
  backend/services/backup/backup-runner.js --validate-only ...`) sin
  providers reales inyectados (ninguno existe todavia en el repo) →
  exit code 1, `runner_secret_provider_missing`, cero literales
  `postgres://`/`PASSWORD` en la salida — confirmado empiricamente, no
  solo en tests. Confirmado tambien que ningun CMD/ENTRYPOINT del target
  backup invoca el runner automaticamente. `FOCAL = 98/98 PASS`
  (backup-runner.test.js 30/30 nuevo + pg-dump-wrapper.test.js 47/47 +
  dockerfile.test.js 10/10 + dockerfile-build.test.js 11/11, con 2 tests
  nuevos de integracion real del runner en contenedor). `RELATED =
  177/177 PASS, 2 SKIP` preexistentes por entorno, ajenos a este cambio.
  **No se conecto a Neon, no se ejecuto `pg_dump` real, no se produjo
  backup, no hubo SQL, no se creo `PG-BKP`, no se concedio `BYPASSRLS`,
  no hubo `GRANT`/`REVOKE`, no se creo ni leyo ningun secreto real, no
  se toco IAM, OVHcloud ni ningun bucket, no se subio ningun artefacto,
  no se creo ningun Cloud Run Job y no se desplego nada en GCP.**
  **Estado final: 5C.7B.6 = ABIERTA; 6B = ABIERTA EN SU TRAMO OFFLINE;
  6B.1 = PASS; 6B.2 = PASS OFFLINE; 6B.3A = PASS_WITH_LIMITATIONS
  OFFLINE; 6B.3B = PASS_WITH_LIMITATIONS READ-ONLY; 6B.3C =
  PASS_WITH_LIMITATIONS READ-ONLY; 6B.3D = PASS OFFLINE; 6B.3E = PASS
  OFFLINE; 6C–6E = NO ABIERTAS; 5C.7B.7 = NO ABIERTA.** Evidencia:
  documento canónico
  `XANTALAL/00_GOVERNANCE/5C.7B-ARQUITECTURA-EJECUTABLE-RUNTIME.md`,
  sección «6B.3E — Runner offline del backup — 09/09/2026».





- G0002.5B.2E está cerrada, versionada y publicada en `e4c79ff`.
- El commit atómico Confirmation → Mission superó 179/179 pruebas:
  PostgreSQL Integration 22/22, contratos 65/65 y servicios 92/92.
- G0002.5B.2F está cerrada arquitectónicamente, sin contratación ni despliegue.
- Fase 1.1 está aprobada y cerrada con el sobre de carga canónico en
  `XANTALAL/00_GOVERNANCE/G0002.5B.2F-ARQUITECTURA-PRODUCTIVA-POSTGRESQL-CLIENTE-CERO.md`.
- Fase 1.2 está aprobada y cerrada: Neon Launch es la selección arquitectónica y
  Google Cloud SQL Enterprise la contingencia; Supabase queda tercero.
- Fase 1.3 está aprobada y cerrada con la arquitectura operativa Neon para Cliente Cero.
- Fase 1.4 está aprobada y cerrada; no quedan bloqueantes arquitectónicos.
- 5C.7B.3 está abierta; 5C.7B.3A está aprobada y cerrada en
  `XANTALAL/00_GOVERNANCE/5C.7B.3A-CONTRATO-SECRETOS-MATRIZ-CUSTODIA.md`.
- 5C.7B.3B está cerrada y publicada en `4a5076c`.
- 5C.7B.3C está cerrada; 3C.1 y 3C.2 están cerradas.
- 3C.1 creó el proyecto dedicado `oxkio-runtime-prod`, vinculó billing y activó
  Secret Manager API.
- 3C.2 creó las tres service accounts sin claves ni roles de proyecto y demostró
  mínimo privilegio con canario sintético: runtime permitido; migration y backup
  denegados; limpieza completa, cero secretos operativos, cero bindings temporales
  y coste atribuible USD 0.
- Aclaración: las tres service accounts de 3C.2 (runtime, migración, backup) existen y
  se reutilizarán en 3D; lo eliminado fue exclusivamente el canario sintético.
- 5C.7B.3D queda abierta como contenedor; 3D.1 está cerrada (proyecto Neon Free
  XANTALAL/OXKIO creado en Frankfurt, PostgreSQL 18, endpoints pooled/direct
  confirmados visualmente, sin tarjeta/gasto/plan de pago, Neon Auth desactivado;
  reversibilidad del proyecto demostrada documentalmente sin borrado real, según
  fuentes oficiales Neon fechadas 11/08/2026).
- 3D.2 está **cerrada** (13/08/2026). La puerta humana de ejecución de 3D.2 fue
  concedida y ya está **consumida**: no habilita ninguna acción adicional. Se
  crearon `oxkio_mission_owner` y `oxkio_mission_runtime` por SQL controlado, se
  aplicaron 001/002 y el `verify` final dio 33/33 en transacción de solo lectura,
  sin escribir ninguna fila y con las credenciales temporales retiradas del
  entorno al terminar.
- Límite registrado: 3D.2 demuestra RLS **configurado** (`ENABLE` + `FORCE`,
  políticas y privilegios acotados), **no** aislamiento funcional entre dos scopes
  mediante escritura de filas. Esa validación pertenece a 3D.6.
- 3D.3 está **cerrada** (13/08/2026). T1–T5 se ejecutaron bajo puertas humanas
  separadas y **todas resultaron PASS**: TLS estricto con CA y hostname verificados
  y fallo cerrado en ambos casos, `rejectUnauthorized=true`, certificado vigente,
  **`SCRAM-SHA-256-PLUS` demostrado positivamente** y anti-downgrade validado
  offline. Las credenciales temporales se eliminaron del entorno al terminar.
- Límite registrado: lo anterior se demuestra **mediante sonda**, no en el runtime
  productivo, que sigue sin política TLS cableada.
- 3D.4 está **CERRADA** (15/08/2026). Se abrió el 13/08/2026 solo en modo controlado de
  planificación/preparación y exigía una puerta humana nueva y explícita para cualquier
  ejecución real. Esa puerta **se concedió el 15/08/2026**, se usó para las Puertas A y B
  de PG-RUN y quedó **consumida**: no habilita ninguna acción adicional.
- Alcance de 3D.4 **sin cambios**: secretos PostgreSQL reales en Secret Manager,
  ligados a las tres service accounts de 3C.2. El inventario **read-only** de esas
  identidades, primera tarea de 3D.4, quedó **resuelto el 14/08/2026** (ver pendiente
  12); **solo PG-RUN** como secreto inicial, con
  URL sin parámetros de consulta ni `sslmode` y prohibición de usarla como
  `connectionString`; `roles/secretmanager.secretAccessor` solo para la identidad de
  runtime y solo sobre ese secreto. **PG-MIG** reservado a operaciones/migraciones
  controladas y **PG-BKP** en 3D.5: **ninguno de los dos se ha materializado**.
- **PG-RUN = POOLED confirmado empíricamente (15/08/2026)**: una única TP1 con la
  sonda endurecida `oxkio-3d4-pooler-cb-probe.js` dio **PASS** contra el endpoint
  pooled real —`pg` 8.22.0, TLS autorizado con `rejectUnauthorized=true`,
  `enableChannelBinding=true`, mecanismo negociado **`SCRAM-SHA-256-PLUS`**, conexión
  completada y `SELECT 1` correcto, con la identidad `oxkio_mission_runtime` y cero
  reintentos—. No se propone cambio a DIRECT; la documentación genérica de PgBouncer
  queda subordinada a esta medición del proveedor real. La salida solo mostró
  hostname enmascarado y las variables de credencial se retiraron del entorno.
  Confirmar POOLED no materializaba por sí solo PG-RUN; esa autorización llegó después
  como puerta humana separada.
- **PG-RUN MATERIALIZADO (15/08/2026)**. Bajo puerta humana concedida y ya
  **consumida**, el operador ejecutó manualmente en la consola web las Puertas A y B:
  el secreto `OXKIO_MISSION_PG_RUNTIME_URL` existe en `oxkio-runtime-prod` con
  **exactamente Version 1, habilitada** y cifrado administrado por Google; sobre el
  propio secreto figura la service account de runtime
  `oxkio-runtime-prod@oxkio-runtime-prod.iam.gserviceaccount.com` con el rol que la
  consola muestra como «Usuario con acceso a secretos de Secret Manager», sin condición
  IAM. El ID técnico `roles/secretmanager.secretAccessor` es la correspondencia
  esperada de ese rol predefinido, **no** un dato leído literalmente de la pantalla.
  Junto a ese binding explícito figura `xantalal@gmail.com` como **Propietario
  heredado**, de modo que la identidad de runtime **no** es el único sujeto capaz de
  leer el secreto. Migración y backup no aparecen en los permisos del secreto, y la
  vista IAM del proyecto no mostró bindings de proyecto para las tres service accounts.
  Evidencia verificada por el operador en consola, no medición automatizada. OXKIO no
  usó `gcloud` ni accedió al valor del secreto.
- **Criterios de cierre de 3D.4, satisfechos uno a uno** tras auditoría formal:
  inventario de las tres service accounts (14/08/2026); PG-RUN como único secreto
  inicial; PG-MIG y PG-BKP sin materializar; formato de PG-RUN sin parámetros de
  consulta ni `sslmode` y con la prohibición de usarla como `connectionString`; mínimo
  privilegio a nivel del propio secreto; y TLS productivo expresamente fuera del alcance
  de 3D.4. Evidencia adicional registrada: replicación **«Replicado automáticamente»**,
  cifrado **«Administrada por Google»**, rotación «Sin programar», vencimiento «Nunca», y
  los tres eventos de auditoría del secreto —`CreateSecret`, `AddSecretVersion` sobre la
  versión 1 y `SetIamPolicy`— en ese orden. El payload nunca se recuperó ni se registró.
- Cerrar 3D.4 acredita **custodia y acceso**, no consumo: no demuestra que ningún
  runtime lea PG-RUN. Los pendientes A–I quedan **transferidos**, no ejecutados —
  percent-decode al consumidor productivo; `optional` y fallo cerrado al contrato/runtime
  productivo; TLS y channel binding al pendiente transversal de runtime/composición;
  consumo y lectura real desde Secret Manager a runtime/Cloud Run posterior; conexión
  runtime→Neon a 3D.6/pruebas reales; despliegue funcional y retirada del Owner humano a
  fases posteriores.
- El cierre de 3D.4 no abrió por sí mismo ninguna subfase. Tras evaluar las candidatas,
  **3D.6 queda abierta el 15/08/2026 exclusivamente en modo de planificación
  documental**. Esa apertura **no autoriza** Neon, SQL, escritura o truncado de filas,
  credenciales reales, lectura de PG-RUN, Secret Manager, IAM, `gcloud`, código
  productivo, `server.js`, `environment-contract.js`, TLS de composición, despliegue,
  PG-MIG, PG-BKP, `pg_dump` ni restore: la ejecución exige una **segunda puerta humana**
  nueva y explícita, ya que la de 3D.4 quedó consumida. **3D.5, 5C.7B.3E y 5C.7B.3F
  siguen cerradas/no abiertas.** **ESTADO HISTÓRICO SUPERADO** en cuanto a Neon/SQL:
  el 16/08/2026 esa segunda puerta se concedió de forma efímera para una única
  ejecución real de Tier 1, con veredicto PASS — ver detalle en el punto 16. 3D.5 y
  3E siguen cerradas/no abiertas también tras esa ejecución. **3F queda DEFINIDA el
  16/08/2026** (persistencia definitiva de ApprovalQueue/ApprovalRepository,
  prerrequisito de Runtime 24/7 y 5C.7B.7 — ver governance doc). **Superado
  17/08/2026:** B1 (`PostgresApprovalRepository` offline) CERRADA/PUBLICADA en
  `a721285`; B2 (decisiones productivas de identidad/secreto/esquema/RLS/
  grants/TLS) CERRADA documental; B3 (migración SQL offline
  `003_approval_items.sql`) CERRADA/PUBLICADA en `e94e6f1` (17/08/2026); B3.1
  (corrección de ownership — `oxkio_approval_owner` propio, separado de
  `oxkio_mission_owner`) CERRADA/PUBLICADA en `b8117e4` (17/08/2026); **B4.A**
  (identidades PostgreSQL `oxkio_approval_owner`/`oxkio_approval_runtime`)
  CERRADA documental el 19/08/2026, PASS CON OBSERVACIONES; **B4.B** (puente
  de privilegios — `CREATE ON SCHEMA oxkio` a `oxkio_approval_owner` + fila
  temporal `set_option=true` independiente de la basal `cloud_admin`) CERRADA
  el 19/08/2026, PASS REAL; **B4.B.2** (`USAGE ON SCHEMA oxkio` concedido a
  `oxkio_approval_owner` y `oxkio_approval_runtime`, resolviendo la
  observación abierta de B4.B) CERRADA el 20/08/2026, PASS REAL; **B4.C
  CERRADA (20/08/2026) — PASS REAL** — Puerta
  A (secreto `OXKIO_APPROVAL_PG_RUNTIME_URL` materializado en Secret Manager,
  Version 1 habilitada) CERRADA el 19/08/2026, PASS REAL; Puerta B (IAM
  `roles/secretmanager.secretAccessor` concedido a
  `oxkio-runtime-prod@oxkio-runtime-prod.iam.gserviceaccount.com`
  exclusivamente sobre ese recurso) CERRADA el 20/08/2026, PASS REAL; **B4.D
  CERRADA (21/08/2026) — PASS REAL ESTRUCTURAL**: `oxkio.approval_items`
  materializada vía `003_approval_items.sql` (sha256
  `45e1b076947fdf9bea2bd8e54d959b105fdf1b24bfb7487a9cd9cb16678b32c2`), verify
  catalog-only 32/32 PASS. **B4.D.1 CERRADA (21/08/2026) — PASS REAL
  FUNCIONAL**: hallazgo real del GUC `app.client_id` vacío (tras `SET
  LOCAL`/`set_config` puede quedar en `''`, no `NULL`, en una conexión
  reutilizada) corregido por `004_approval_items_client_id_guard.sql` (sha256
  `3af18fbc708569e60a7a72161366743f85ca999b78bb0429d5ab43d7805351cf`, verify
  14/14 PASS, `003` intacto); precheck real 13/13 PASS y probe funcional real
  15/15 PASS contra Neon (runtime real pooled, TLS/SCRAM-SHA-256-PLUS, RLS
  A/B, fail-closed sin scope, CAS básico, cero residuo); no demuestra CAS
  concurrente ni wiring productivo. **B4.D.2 CERRADA (24/08/2026) — PASS
  REAL CONCURRENTE**: probe real 14/14 PASS con dos conexiones físicas
  distintas y ambas transacciones simultáneamente activas contra Neon
  (backends `pg_backend_pid()` distintos verificado con ambas TX vivas);
  carrera CAS real (`UPDATE ... WHERE version = $2`, mismo SQL productivo de
  `approve()`, sin inventar semántica nueva) con exactamente un ganador
  (XOR real; ganador de la ejecución de cierre: B); estado final
  `version=2` y `approved_by` correspondiente al ganador; cleanup
  administrativo verificado (`deleted=1`); residuo sintético cero por id y
  por tag; sin errores asíncronos de conexión en A/B/admin. Las 4 FALLO
  observadas en una ejecución de auditoría previa fueron defectos del
  *runner de prueba* (comparación de `version` bigint devuelta como string
  por `pg` contra un número, y pérdida del scope RLS de sesión tras el
  `COMMIT` de la conexión ganadora), corregidas sin tocar `CAS_APPROVE_SQL`,
  las migraciones `003`/`004`, RLS, roles ni permisos. **B4.E CERRADA
  (24/08/2026) — PASS REAL FUNCIONAL DEL CICLO DE VIDA RESTANTE DE
  APPROVAL**: probe real definitivo 19/19 PASS contra Neon real —
  `reject` (pending→rejected, version=2) y su reintento con version stale
  (rowCount=0, stale_version); `claimExecution` (transición correcta,
  attemptCount=1, execution_id fijado) y un intento con status incorrecto
  (rowCount=0, status_conflict); `completeExecution` correcto
  (status=executed, version=4) y con execution_id incorrecto (rowCount=0,
  execution_id_mismatch); `failExecution` correcto (status=execution_failed,
  version=4) y con execution_id incorrecto (rowCount=0,
  execution_id_mismatch); `expire` (status=expired, version=2);
  `reclaimExpiredExecutions` devolviendo exclusivamente la fila con lease
  vencido, nunca la fila control con lease vigente, ambas sin mutar
  (status=executing). Los 7 estados de `approval_items_status_ck`
  ejercitados realmente (pending/approved/rejected/executing/executed/
  execution_failed/expired). Cleanup: 9 filas sintéticas creadas, 9
  eliminadas por UUID exacto, residuo final cero por id y por tag; sin
  errores asíncronos en runtime/admin. **Incidencia previa (defecto de
  runner, no schema gap):** el primer probe real falló con `23514`
  (`approval_items_timestamps_ck`) porque el runner retrodataba
  `execution_started_at`/`updated_at` para simular un lease vencido —
  el código productivo real nunca retrodata esas columnas. Corregido
  exclusivamente en el runner: timestamps siempre reales, lease vencido
  demostrado desplazando únicamente el parámetro `now` de
  `reclaimExpiredExecutions()`, y reporting de cleanup ahora visible
  incluso ante una excepción real. Sin cambios a `CAS_APPROVE_SQL`,
  `003`/`004`, RLS, roles ni permisos en ningún momento. **Límites
  explícitos**: no demuestra wiring productivo, no demuestra runtime
  24/7, no adelantaba B5/B6 en ese momento; B4.F fue ejecutada y cerrada posteriormente el 06/09/2026, y B5 fue abierta después con B5.1 limitada a composición offline, no toca Mission Queue, no afirma
  concurrencia adicional más allá de la ya demostrada en B4.D.2 (solo
  `approve()`). B4.F queda CERRADA posteriormente el 06/09/2026 — PASS REAL. B5 fue ABIERTA después y queda CERRADA el 06/09/2026 — PASS; B5.1 queda CERRADA OFFLINE; B5.2 queda CERRADA OFFLINE — wiring productivo preparado pero no activado —; B5.3 queda CERRADA OFFLINE — config/startup productivo fail-closed demostrado sin red — y B6 sigue NO ABIERTA (**SUPERSEDED 07/09/2026 — B6 / 5C.7B.3F cerrada PASS REAL; ver documento canónico: XANTALAL/00_GOVERNANCE/5C.7B-ARQUITECTURA-EJECUTABLE-RUNTIME.md, sección «Cierre canónico B6 / 5C.7B.3F — 07/09/2026»**). Mission Queue
  no tocada.
  **Regularización documental 18/08/2026:** este estado de B3/B3.1 no había
  quedado reflejado en `ROADMAP.md`/`TASKS.md` hasta hoy — ver governance
  doc, «Regularización 18/08/2026». **Regularización documental 19/08/2026:**
  cierre de B4.A, B4.B y B4.C/Puerta A — ver governance doc, «Regularización
  19/08/2026». **Regularización documental 20/08/2026:** cierre de B4.B.2
  (USAGE estructural Approval), de B4.C/Puerta B y de B4.C completa — ver
  governance doc, «Regularización 20/08/2026 — B4.B.2 / USAGE estructural
  Approval» y «Regularización 20/08/2026 — Cierre de B4.C / Puerta B».
  **Regularización documental 21/08/2026:** cierre de B4.D (materialización
  estructural de `oxkio.approval_items`) y de B4.D.1 (migración 004 y prueba
  funcional real) — ver governance doc, «Regularización 21/08/2026 — Cierre
  de B4.D» y «Regularización 21/08/2026 — Migración 004 y cierre de B4.D.1».
  **Regularización documental 24/08/2026:** cierre de B4.D.2 (CAS
  concurrente real de Approval, probe 14/14 PASS) — ver governance doc,
  «Regularización 24/08/2026 — Cierre de B4.D.2». **Regularización
  documental 24/08/2026 (cierre B4.E):** cierre de B4.E (validación
  funcional real del ciclo de vida restante de Approval, probe 19/19
  PASS) — ver governance doc, «Regularización 24/08/2026 — Cierre de
  B4.E».
- Motivo de priorizar 3D.6 sobre 3D.5: el riesgo abierto de mayor impacto no es la
  pérdida de datos —la base tiene el esquema de 001/002 y **cero filas productivas**—
  sino que el aislamiento por RLS está **configurado y no demostrado funcionalmente**,
  límite que 3D.2 registró. Abrir antes 3D.5 exigiría identidad de backup, credencial y
  destino para proteger una base sin datos, y produciría un backup sin restauración
  demostrada, porque «restore» pertenece a 3D.6.
- Alcance documentado de 3D.6: aislamiento RLS entre scopes sintéticos, imposibilidad de
  lectura y escritura cruzadas, no escalada del rol de runtime, CAS sobre `version`,
  rollback, timeout, **reversión estructural con residuo sintético cero**, portabilidad
  de migraciones y validación integral mínima. Dos componentes quedan
  **BLOQUEADOS/DIFERIDOS**: **restore**, hasta que exista un dump producido bajo 3D.5, y
  la **concurrencia (E)**, que exige estado COMMITeado compartido entre sesiones y por
  tanto una identidad capaz de revertirlo. Se propone admitir cierre parcial formal de
  3D.6 registrando ambos límites.
- Precisión sobre H: `oxkio_mission_runtime` no tiene `DELETE` ni `TRUNCATE`, y **no se
  ampliarán sus privilegios ni se creará una identidad de limpieza** para facilitar una
  prueba. La garantía de Tier 1 es reversión estructural —todo dentro de una transacción
  que siempre termina en `ROLLBACK`— más verificación posterior independiente con residuo
  cero. Es más fuerte que un borrado y compatible con el mínimo privilegio.
- **Corrección de H tras la auditoría independiente (15/08/2026)**: el conteo residual se
  hace **después del `ROLLBACK`, en transacciones nuevas y fijando `app.tenant_id`,
  `app.user_id` y `app.client_id`** en cada scope comprobado. Sin scope fijado, la propia
  RLS oculta las filas y devuelve un **cero vacío**: la primera versión del artefacto
  incurría en ese fallo y habría dado un PASS falso. Límite declarado: la identidad de
  runtime solo verifica residuo **dentro de los scopes que puede escribir**, sin
  inspección global y sin owner/admin; por eso **H solo puede ser PASS si C está
  demostrada**, y en caso contrario es **INCONCLUSA, nunca PASS**.
- **Precisión sobre G**: tiene veredicto propio. PASS si `statement_timeout` interrumpe la
  sentencia lenta y la transacción sigue gobernada por su savepoint; **INCONCLUSA** si la
  sentencia completa pese al límite. G no acredita aislamiento ni seguridad, solo control
  de tiempo.
- Volumen real de Tier 1: dataset de 6 filas, de las que **inserta 3** en el scope A, más
  **1** intento cruzado que debe ser rechazado y revertido; máximo 4 simultáneos en la
  transacción y **0 persistidas**.
- Precisión sobre I/J: la sonda **no repite** el `verify` 33/33 de 3D.2; comprueba el
  subconjunto de catálogo relevante para 3D.6 y lo **contrasta** con aquella evidencia.
  Cualquier contradicción es FAIL CLOSED.
- Los tests de integración de `backend/services/mission-queue/` y el runner de
  `backend/repositories/poc/` usan `new Pool({ connectionString })` sin `ssl` ni
  `enableChannelBinding`: **no están autorizados a ejecutarse contra Neon real durante
  3D.6**. No se modifican; su endurecimiento exigiría auditoría y puerta propias. Pueden
  leerse como especificación, nunca ejecutarse.

## Pendientes transferidos — no abiertos

1. Transferir a 3D los secretos PostgreSQL reales, TLS, RLS, roles y backups PostgreSQL.
2. Transferir a 3E OAuth real, access/refresh tokens y retirada del filesystem local.
3. Mantener para fases posteriores Cloud Run, RPO/RTO, retirada del Owner humano e higiene
   de APIs automáticas.
4. Exigir otra puerta humana antes de crear secretos operativos, contratar cualquier
   plan o servicio de pago (incluido Launch), desplegar, gastar, activar TLS
   productivo, crear el rol de backup o ejecutar pruebas con escritura contra Neon.
   La puerta concedida para 3D.2 quedó consumida con su cierre y no se extiende a
   3D.3–3D.6 ni a ninguna otra fase.
5. No cambiar PostgreSQL por MySQL ni contratar un VPS autogestionado para aprovechar
   LucusHost; el alojamiento compartido actual no admite PostgreSQL remoto.
6. Mantener Firestore, JSON productivos, OAuth y stores reales intactos.
7. Mantener el objetivo IAM/Secret Manager en USD 0–0,20/mes; una previsión igual o
   superior a USD 1/mes exige revisión humana y nunca autoriza ampliación automática.
8. **Cumplido en 3D.3**: la verificación TLS/SSL estricta quedó definida y
   demostrada con T1–T5, todas PASS — TLS obligatorio, CA válida, hostname
   verificado, SNI correcto, `rejectUnauthorized=true`, sin depender de
   `sslmode=require`, sin pasar la `connectionString` completa a `pg`,
   `enableChannelBinding=true` y `SCRAM-SHA-256-PLUS` afirmado positivamente. La
   política sigue vigente para todo cliente PostgreSQL futuro. Mantener runtime
   pooled y administración/migración direct.
9. **Cumplido en 3D.2**: `oxkio_mission_owner` y `oxkio_mission_runtime` se crearon
   exclusivamente por SQL controlado, nunca por consola Neon (hallazgo de seguridad
   11/08/2026: los roles creados por consola/CLI/API reciben `neon_superuser`,
   incompatible con el mínimo privilegio exigido). Verificada la ausencia de
   `neon_superuser`. La regla sigue vigente para cualquier rol futuro, incluido el
   rol de backup de 3D.5.
10. Conservar el runner efímero de 3D.2 en
    `C:\Users\janta\AppData\Local\OXKIO\tools\oxkio-3d2-apply.js` (sha256
    `506fbdfa9acf20b7d38175fb0f04aaef191d3330547ea382b963bd58e44af1a9`) al menos
    hasta el cierre de 3D.6: porta el SQL de rollback y reproduce la evidencia en
    solo lectura. Está fuera del repositorio, de OneDrive y de Temp, sin secretos
    embebidos, y **no debe versionarse en Git**.
11. Conservar igualmente la sonda de 3D.3 en
    `C:\Users\janta\AppData\Local\OXKIO\tools\oxkio-3d3-tls-probe.js` (sha256
    `0185de026abff7f73e13e3fcbbca371e810f6a5d370c330aee15379e311f8bcc`, selftest
    offline 20/20) al menos hasta el cierre de 3D.6: reproduce la evidencia TLS y
    será necesaria para revalidarla tras cualquier subida de `pg`, en especial la que
    invierta la semántica de `sslmode`. Mismas condiciones: fuera del repositorio, de
    OneDrive y de Temp, sin secretos embebidos, y **no debe versionarse en Git**.
12. **RESUELTO el 14/08/2026 — inventario de service accounts de 3C.2.** Los IDs
    exactos ya **constan** en la documentación canónica
    (`XANTALAL/00_GOVERNANCE/5C.7B-ARQUITECTURA-EJECUTABLE-RUNTIME.md`, sección
    «Inventario canónico de service accounts (3C.2)»), verificados en solo lectura
    por el operador humano en Google Cloud Console dentro del proyecto
    `oxkio-runtime-prod`:
    - runtime — `oxkio-runtime-prod@oxkio-runtime-prod.iam.gserviceaccount.com`;
    - migración — `oxkio-migration-prod@oxkio-runtime-prod.iam.gserviceaccount.com`;
    - backup — `oxkio-backup-prod@oxkio-runtime-prod.iam.gserviceaccount.com`.

    Las tres están habilitadas y **sin claves administradas por usuario**, sin
    cuentas adicionales ni duplicadas. Resolver este pendiente **no abre** la
    ejecución real de 3D.4 ni autoriza ningún binding IAM: son identificadores, no
    credenciales.
13. **PENDIENTE de contrato** — `OXKIO_MISSION_PG_RUNTIME_URL` sigue declarada
    **`optional`** en `backend/config/environment-contract.js`. Antes de cualquier
    runtime productivo deberá existir **fallo cerrado** si el secreto falta, es
    inválido o ha sido revocado, conforme al punto 8 del contrato 5C.7B.3A. Es código
    productivo: no se toca en la apertura de 3D.4.
14. **Conservar la sonda de 3D.4** en
    `C:\Users\janta\AppData\Local\OXKIO\tools\oxkio-3d4-pooler-cb-probe.js` (sha256
    `bef3f96ddd604d3781545b3a8dd18d25c68bdcd9c9b2a68b51b2e9f24224828b`, selftest
    offline 47/47) al menos hasta el cierre de 3D.6: reproduce la evidencia POOLED /
    channel binding. Mismas condiciones que el runner de 3D.2 y la sonda de 3D.3:
    fuera del repositorio, de OneDrive y de Temp, sin secretos embebidos, y **no debe
    versionarse en Git**.
15. **LECCIÓN TÉCNICA VIGENTE — construcción de URIs PostgreSQL.** Una contraseña
    válida de runtime puede contener caracteres reservados de URI. Usuario y
    contraseña **deben percent-encodearse antes de incorporarlos al userinfo**; nunca
    se codifican protocolo, host, puerto, path ni separadores estructurales. La regla
    aplica a todo consumidor futuro de PG-RUN, PG-MIG y PG-BKP, y es compatible con la
    prohibición de pasar la URL a `pg` como `connectionString`: el consumidor parsea y
    **percent-decodifica** el userinfo antes de fijar los campos. No se registra
    ninguna contraseña ni qué carácter concreto contiene.
16. **Conservar la sonda de 3D.6** en
    `C:\Users\janta\AppData\Local\OXKIO\tools\oxkio-3d6-rls-cas-probe.js` (sha256
    `3e953e9371fe7e916fdd5cb6756439a318aae2ad3aadf4a96955ffb07d40b4d8`, 59 154 bytes,
    selftest offline 49/49, `node --check` OK, **hash sin cambios tras la ejecución
    real**) al menos hasta el cierre de 3D.6. Sustituye a la versión inicial
    `a0637866…`, **invalidada** por la auditoría independiente, y a la versión
    preparada del 15/08/2026 —sha256 `22ad1ff9…76540ef`, 57 802 bytes,
    `EXECUTION_AUTHORIZED = false`—, ahora **SUPERADA** por la preparación controlada
    del 16/08/2026. El único cambio funcional de esta versión de la sonda es
    `EXECUTION_AUTHORIZED = true` (primer cerrojo levantado) más la corrección de la
    única aserción del selftest que presuponía ese cerrojo en `false`; ninguna otra
    lógica cambió. **ESTADO HISTÓRICO SUPERADO** (válido solo antes de la ejecución
    real): `EXECUTION_AUTHORIZED = true` no habilitaba por sí sola ejecución real
    mientras la segunda puerta `OXKIO_3D6_GATE` seguía sin concederse; `tp1` sin ella
    fallaba cerrado antes de tocar la red (verificado offline con `OXKIO_3D6_PG_URL`
    y `OXKIO_REPO_ROOT` ficticios).
    **ESTADO VIGENTE — Tier 1 real (16/08/2026).** La segunda puerta fue concedida por
    José Antonio de forma efímera y exclusiva para una única ejecución (su frase nunca
    se solicitó, mostró ni registró; no permanece abierta). Con PG-RUN cargado
    localmente desde Secret Manager sin exponerlo, se ejecutó una única vez `tp1`
    contra el endpoint pooled real de Neon: `current_user` verificado
    `oxkio_mission_runtime`; RLS `enabled=true`/`forced=true` en ambas tablas; residuo
    tras `ROLLBACK` con `app.*` fijado = **0 misiones, 0 confirmaciones** en A y B;
    escritura cruzada, `row_security=off` y `SET ROLE` propietario rechazados
    (SQLSTATE `42501`); timeout activado (SQLSTATE `57014`); 0 reintentos. Veredictos:
    **A/B/C PASS, K PASS, D/CAS PASS, G/timeout PASS, F/H PASS — veredicto global
    PASS**. El resumen de privilegios observado (`INSERT, SELECT`, sin `UPDATE`) es un
    falso negativo ya documentado de `information_schema.table_privileges` para roles
    `INHERIT FALSE` (hallazgo 3 de 3D.2); el PASS de D/CAS es evidencia funcional
    directa de que `UPDATE` a nivel de columna existe y opera. Un intento previo, sin
    `OXKIO_REPO_ROOT`, falló cerrado en fase local antes de tocar la red y no cuenta
    como conexión a Neon. Tras la ejecución, `OXKIO_3D6_PG_URL`, `OXKIO_3D6_GATE` y
    `OXKIO_REPO_ROOT` se eliminaron de la sesión y se comprobó `False` para las tres.
    **Con esto, 3D.6 Tier 1 (A–K) queda CERRADA.** No habilita Tier 2/E (sigue
    **BLOQUEADA/DEFERIDA**), restore (sigue **DIFERIDO**) ni 3D.5/3E (cerradas/no
    abiertas). **3F queda DEFINIDA el 16/08/2026** (persistencia definitiva de
    ApprovalQueue/ApprovalRepository). **Superado 17/08/2026:** B1
    (`PostgresApprovalRepository` offline) CERRADA/PUBLICADA en `a721285`; B2
    (decisiones productivas: identidad `oxkio_approval_runtime`, secreto
    `OXKIO_APPROVAL_PG_RUNTIME_URL`, esquema conceptual, RLS, grants, TLS)
    CERRADA documental; B3 (migración SQL offline) CERRADA/PUBLICADA en
    `e94e6f1`; B3.1 (ownership separado de Mission Queue) CERRADA/PUBLICADA en
    `b8117e4`; B4.A (identidades PostgreSQL Approval) CERRADA documental el
    19/08/2026, PASS CON OBSERVACIONES; B4.B (puente de privilegios) CERRADA
    el 19/08/2026, PASS REAL; B4.B.2 (USAGE ON SCHEMA oxkio para owner+
    runtime Approval) CERRADA el 20/08/2026, PASS REAL; B4.C CERRADA
    (20/08/2026) — PASS REAL (Puerta A
    — secreto materializado — CERRADA 19/08/2026, PASS REAL; Puerta B — IAM
    concedido exclusivamente sobre ese recurso — CERRADA 20/08/2026, PASS
    REAL); B4.D CERRADA (21/08/2026) — PASS REAL ESTRUCTURAL
    (`oxkio.approval_items` materializada, verify catalog-only 32/32 PASS);
    B4.D.1 CERRADA (21/08/2026) — PASS REAL FUNCIONAL (gap del GUC
    `app.client_id` vacío corregido por `004_approval_items_client_id_guard.sql`,
    verify 14/14 PASS, `003` intacto; precheck real 13/13 y probe funcional
    real 15/15 PASS; CAS concurrente y wiring productivo pendientes de
    microfase posterior no abierta); B4.D.2 CERRADA (24/08/2026) — PASS REAL
    CONCURRENTE (probe real 14/14 PASS: dos conexiones con transacciones
    simultáneamente activas, CAS XOR con exactamente un ganador, version
    final=2, cleanup verificado, residuo cero; sin cambios a CAS productivo,
    003/004, RLS, roles ni permisos); B4.E CERRADA (24/08/2026) — PASS REAL
    FUNCIONAL DEL CICLO DE VIDA RESTANTE DE APPROVAL (probe real definitivo
    19/19 PASS: reject/claimExecution/completeExecution/failExecution/
    expire/reclaimExpiredExecutions y execution_id_mismatch demostrados
    contra Neon real, los 7 estados ejercitados realmente, cleanup 9/9
    filas eliminadas por UUID exacto y residuo cero; incidencia previa
    23514 fue defecto de runner — timestamps retrodatados — corregida sin
    tocar SQL productivo, 003/004, RLS, roles ni permisos; no demuestra
    wiring productivo ni concurrencia adicional más allá de B4.D.2); B4.F CERRADA posteriormente el 06/09/2026 — PASS REAL; B5 CERRADA posteriormente el 06/09/2026 — PASS, con B5.1 CERRADA OFFLINE, B5.2 CERRADA OFFLINE — wiring productivo preparado pero no activado — y B5.3 CERRADA OFFLINE — config/startup productivo fail-closed demostrado sin red —; B6 no abierta (**SUPERSEDED 07/09/2026 — B6 / 5C.7B.3F cerrada PASS REAL; ver documento canónico: XANTALAL/00_GOVERNANCE/5C.7B-ARQUITECTURA-EJECUTABLE-RUNTIME.md, sección «Cierre canónico B6 / 5C.7B.3F — 07/09/2026»**) —
    ver governance doc, «Regularización 17/08/2026», «Regularización
    18/08/2026», «Regularización 19/08/2026», «Regularización 20/08/2026»,
    «Regularización 21/08/2026 — Cierre de B4.D», «Regularización
    21/08/2026 — Migración 004 y cierre de B4.D.1», «Regularización
    24/08/2026 — Cierre de B4.D.2» y «Regularización 24/08/2026 — Cierre
    de B4.E».
    Modificar cualquier bandera de la sonda invalida el hash y exige
    selftest, auditoría y autorización nuevas. Mismas condiciones que el runner de
    3D.2 y las sondas de 3D.3 y 3D.4: fuera del repositorio, de OneDrive y de Temp,
    sin secretos embebidos, y **no debe versionarse en Git**.
17. **PENDIENTE TRANSVERSAL DE RUNTIME/COMPOSICIÓN** — Cablear la política TLS
    demostrada en 3D.3 en la raíz de composición del runtime productivo. Hoy el
    código productivo **no tiene ninguna configuración TLS** y los repositorios
    reciben el pool inyectado. Es **obligatorio antes de cualquier conexión o
    despliegue productivo**. Su propietario y su fase exacta se decidirán al preparar
    3D.4 o en una puerta posterior: **no se asigna a 3D.4 en este cierre** y no
    amplía su alcance canónico, que sigue siendo exclusivamente los secretos
    PostgreSQL reales en Secret Manager.

El cierre de 5C.7B.3C no autoriza crear secretos operativos, desplegar, migrar,
contratar o gastar. El cierre de 3D.1 tampoco autoriza ninguna de estas acciones.
El cierre de 3D.2 no autoriza TLS productivo, secretos reales en Secret Manager,
rol de backup, pruebas con escritura, datos reales, contratación ni gasto, y **no
abre automáticamente 3D.3**. El cierre de 3D.3 no autoriza Secret Manager, rol de
backup, pruebas con escritura, datos reales, cambios de código productivo,
`server.js`, despliegue ni 3D.4–3D.6, y **no abre automáticamente 3D.4**. Dentro de
3D.4, la puerta humana del 15/08/2026 autorizó exclusivamente las Puertas A y B de
PG-RUN y quedó **consumida**. El cierre de 3D.4 tampoco autoriza nuevas versiones,
cambios de IAM, PG-MIG, PG-BKP, TLS productivo, `environment-contract.js`, `server.js`,
despliegue ni 3D.5–3D.6, y **no abre automáticamente ninguna subfase**. OAuth real sigue
esperando a 3E.

## Historial sustituido — lista inicial del 22/06/2026

Estas tareas se conservan como trazabilidad y ya no determinan el siguiente paso.

1. Crear Centro de Mando de Proyectos en Oxkio.
2. Inventariar proyectos activos.
3. Preparar integración con Codex como agente programador.
4. Mantener Business Hunter como prioridad de rentabilización.
5. Crear estructura base de GIU.
6. Preparar Knowledge Hub para Google Drive, OneDrive, Gmail, GitHub y Learning Heroes.
7. Revisar LucusHost para despliegue Node.js.
8. Mantener aprobación humana obligatoria.

## Regla operativa

No añadir nuevas ideas grandes sin cerrar primero tareas monetizables.

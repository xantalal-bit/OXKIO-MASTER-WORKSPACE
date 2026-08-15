# OXKIO TASKS

## Estado operativo vigente

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
- 3D.4 queda **abierta únicamente en modo controlado de planificación/preparación**
  (13/08/2026). Esta apertura **no autoriza** `gcloud`, Google Cloud, creación de
  secretos o versiones, cambios de IAM, Secret Manager real, credenciales, Neon, SQL,
  `server.js`, código productivo, TLS productivo ni backup. La ejecución real exige
  una puerta humana nueva y explícita.
- Alcance de 3D.4 **sin cambios**: secretos PostgreSQL reales en Secret Manager,
  ligados a las tres service accounts de 3C.2. El inventario **read-only** de esas
  identidades, primera tarea de 3D.4, quedó **resuelto el 14/08/2026** (ver pendiente
  12); **solo PG-RUN** como secreto inicial, con
  URL sin parámetros de consulta ni `sslmode` y prohibición de usarla como
  `connectionString`; `roles/secretmanager.secretAccessor` solo para la identidad de
  runtime y solo sobre ese secreto. **PG-MIG** reservado a operaciones/migraciones
  controladas y **PG-BKP** en 3D.5: ninguno se materializa.
- **PG-RUN = POOLED confirmado empíricamente (15/08/2026)**: una única TP1 con la
  sonda endurecida `oxkio-3d4-pooler-cb-probe.js` dio **PASS** contra el endpoint
  pooled real —`pg` 8.22.0, TLS autorizado con `rejectUnauthorized=true`,
  `enableChannelBinding=true`, mecanismo negociado **`SCRAM-SHA-256-PLUS`**, conexión
  completada y `SELECT 1` correcto, con la identidad `oxkio_mission_runtime` y cero
  reintentos—. No se propone cambio a DIRECT; la documentación genérica de PgBouncer
  queda subordinada a esta medición del proveedor real. La salida solo mostró
  hostname enmascarado y las variables de credencial se retiraron del entorno.
  Confirmar POOLED **no materializa** PG-RUN ni autoriza Secret Manager o IAM.
- 3D.5–3D.6 permanecen cerradas/no abiertas. 5C.7B.3E–F permanecen cerradas.

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
16. **PENDIENTE TRANSVERSAL DE RUNTIME/COMPOSICIÓN** — Cablear la política TLS
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
`server.js`, despliegue ni 3D.4–3D.6, y **no abre automáticamente 3D.4**. La apertura
de 3D.4 es **solo de planificación** y no autoriza `gcloud`, Google Cloud, secretos,
versiones, IAM, credenciales ni 3D.5–3D.6. OAuth real sigue esperando a 3E.

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

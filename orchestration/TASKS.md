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
  siguen cerradas/no abiertas.**
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
    `22ad1ff997fdf69c27c90d20f6a28026f05a74453ba846ec15288b43076540ef`, 57 802 bytes,
    selftest offline 49/49) al menos hasta el cierre de 3D.6. Sustituye a la versión
    inicial `a0637866…`, **invalidada** por la auditoría independiente. Está aprobada
    **solo como
    artefacto offline para auditoría**: `EXECUTION_AUTHORIZED = false` en su propio
    código hace que `tp1` y `tp2` fallen cerrado antes de tocar la red, y **la segunda
    puerta humana sigue sin conceder**. Modificar esa bandera invalida el hash y exige
    selftest, auditoría y autorización nuevas. Mismas condiciones que el runner de 3D.2 y
    las sondas de 3D.3 y 3D.4: fuera del repositorio, de OneDrive y de Temp, sin secretos
    embebidos, y **no debe versionarse en Git**.
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

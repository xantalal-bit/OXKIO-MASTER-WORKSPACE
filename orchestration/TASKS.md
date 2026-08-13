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
- 3D.3 queda **abierta únicamente en modo controlado de planificación/preparación**
  (13/08/2026). Esta apertura **no autoriza** conexión real a Neon, credenciales ni
  la ejecución de las pruebas T1–T5, que constan como plan futuro no ejecutado. La
  ejecución TLS real exige una puerta humana nueva y explícita.
- 3D.4–3D.6 permanecen cerradas/no abiertas. 5C.7B.3E–F permanecen cerradas.

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
8. **PENDIENTE** — Definir y demostrar en 3D.3 la verificación TLS/SSL estricta
   exigida por Neon en el cliente Node. La política, registrada en la arquitectura,
   exige: TLS obligatorio; CA válida; hostname verificado; SNI correcto;
   `rejectUnauthorized=true`; no depender de `sslmode=require`; no pasar la
   `connectionString` completa a `pg` cuando pueda sobrescribir la política TLS;
   `enableChannelBinding=true`; y **fallo cerrado si no se demuestra
   `SCRAM-SHA-256-PLUS`**. `sslmode=require` observado en el proyecto Free no cierra
   este requisito. `pg@8.22.0` soporta channel binding pero **no está activado** en
   el runner de 3D.2, de modo que su uso **no está demostrado**. Tampoco existe
   todavía política TLS en el código productivo. Mantener runtime pooled y
   administración/migración direct.
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

El cierre de 5C.7B.3C no autoriza crear secretos operativos, desplegar, migrar,
contratar o gastar. El cierre de 3D.1 tampoco autoriza ninguna de estas acciones.
El cierre de 3D.2 no autoriza TLS productivo, secretos reales en Secret Manager,
rol de backup, pruebas con escritura, datos reales, contratación ni gasto, y **no
abre automáticamente 3D.3**. La apertura de 3D.3 es **solo de planificación** y no
autoriza conexión real a Neon, credenciales, ejecución de T1–T5, cambios de código
productivo ni 3D.4–3D.6. OAuth real sigue esperando a 3E.

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

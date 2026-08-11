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
- 5C.7B.3D queda abierta en modo controlado de planificación; 3D.1 está cerrada
  (proyecto Neon Free XANTALAL/OXKIO creado en Frankfurt, PostgreSQL 18, endpoints
  pooled/direct confirmados visualmente, sin tarjeta/gasto/plan de pago, Neon Auth
  desactivado; reversibilidad del proyecto demostrada documentalmente sin borrado
  real, según fuentes oficiales Neon fechadas 11/08/2026). 3D.2 queda como
  siguiente subfase a proponer, sin apertura a ejecución; 3D.3–3D.6 permanecen
  cerradas/no abiertas. 5C.7B.3E–F permanecen cerradas.

## Pendientes transferidos — no abiertos

1. Transferir a 3D los secretos PostgreSQL reales, TLS, RLS, roles y backups PostgreSQL.
2. Transferir a 3E OAuth real, access/refresh tokens y retirada del filesystem local.
3. Mantener para fases posteriores Cloud Run, RPO/RTO, retirada del Owner humano e higiene
   de APIs automáticas.
4. Exigir otra puerta humana antes de crear secretos operativos, contratar cualquier
   plan o servicio de pago (incluido Launch), desplegar, gastar, aplicar
   migraciones/roles reales o abrir 3D.2; El cierre de 3D.1 no autoriza ninguna de estas acciones ni abre automáticamente 3D.2.
5. No cambiar PostgreSQL por MySQL ni contratar un VPS autogestionado para aprovechar
   LucusHost; el alojamiento compartido actual no admite PostgreSQL remoto.
6. Mantener Firestore, JSON productivos, OAuth y stores reales intactos.
7. Mantener el objetivo IAM/Secret Manager en USD 0–0,20/mes; una previsión igual o
   superior a USD 1/mes exige revisión humana y nunca autoriza ampliación automática.
8. Definir y demostrar en 3D.3 la verificación TLS/SSL estricta (`verify-full`/
   `channel_binding`) exigida por Neon en el cliente Node; `sslmode=require` ya
   observado en el proyecto Free no cierra ese requisito. Mantener runtime pooled y
   administración/migración direct.

El cierre de 5C.7B.3C no autoriza crear secretos operativos, desplegar, migrar,
contratar o gastar. El cierre de 3D.1 tampoco autoriza ninguna de estas acciones
ni abre automáticamente 3D.2. PostgreSQL real espera a la ejecución de 3D.2 en
adelante y OAuth real a 3E.

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

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
  con T1–T5 ejecutadas y superadas. La siguiente subfase canónica es 3D.4 — Secret
  Manager —, que queda **a proponer y sin apertura a ejecución**. 3D.5–3D.6
  permanecen cerradas; 5C.7B.3E–F permanecen cerradas.
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
- 5C.7B.3D: abierta como contenedor; 3D.1, 3D.2 y 3D.3 cerradas; 3D.4 siguiente
  subfase a proponer, sin apertura a ejecución; 3D.5–3D.6 cerradas/no abiertas;
  5C.7B.3E–F: cerradas / no abiertas.
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

- 5C.7B.3D.4–3D.6 a ejecución real (secretos, rol de backup, pruebas con escritura); TLS productivo cableado en el runtime; 5C.7B.3E–F.
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

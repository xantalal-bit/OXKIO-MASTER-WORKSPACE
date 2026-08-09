# OXKIO ROADMAP

## Estado operativo vigente

- Código de bloque: 5C.7
- Última microfase cerrada: G0002.5B.2E — commit atómico Confirmation → Mission
- Microfase abierta: G0002.5B.2F — Arquitectura productiva PostgreSQL para Cliente Cero
- Bloque actual: Runtime Permanente e Infraestructura
- Fases 1.1 y 1.2 de G0002.5B.2F: aprobadas y cerradas; 5C.7B.3 permanece cerrada
- Selección arquitectónica: Neon Launch; contingencia: Google Cloud SQL Enterprise.
- Objetivo inmediato: preservar el sobre de carga y la selección; esperar autorización expresa.
- Siguiente paso recomendado: no abrir Fase 1.3 sin autorización.
- Último hito publicado: G0002.5B.2E, commit `e4c79ff`.
- Documento canónico del sobre de carga:
  `XANTALAL/00_GOVERNANCE/G0002.5B.2F-ARQUITECTURA-PRODUCTIVA-POSTGRESQL-CLIENTE-CERO.md`.

## Evidencia publicada G0002.5B.2E

- Implementación: completada para el commit atómico Confirmation → Mission.
- PostgreSQL Integration: 22/22 pruebas aprobadas.
- Contratos: 65/65 pruebas aprobadas.
- Servicios: 92/92 pruebas aprobadas.
- Total: 179/179 pruebas aprobadas.
- Commit y publicación: completados en `e4c79ff`.
- Continuidad: G0002.5B.2F abierta únicamente en arquitectura; Fase 1.3 no abierta.

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

- Fase 1.3 de G0002.5B.2F.
- 5C.7B.3.
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

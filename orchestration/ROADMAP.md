# OXKIO ROADMAP

## Estado operativo vigente

- Código de bloque: 5C.7
- Subfase activa: 5C.7B — Arquitectura Ejecutable del Runtime
- Bloque actual: Runtime Permanente e Infraestructura
- Fase actual: 5C.7 — Runtime Permanente 24/7
- Objetivo inmediato: preparar staging selectivo del backend cloud-ready neutral validado.
- Siguiente paso recomendado: revisar y autorizar staging exclusivo de 5C.7B.1.
- Siguiente fase prevista: 5C.7 — Runtime Permanente 24/7.
- Último hito publicado: 5C.6D.1 — Gmail Draft supervisado.
- Resumen de la sesión: 5C.6D.1 cerrada oficialmente el 27/07/2026. Gmail Draft real, SAFE_DRAFT_ONLY, cero envíos, ausencia de duplicados, sincronización ExecutionService–Approval Queue–Dashboard y auditoría de aceptación validadas.

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

## Evidencia de cierre

- Implementación: completada
- Integración: completada
- Pruebas: completadas; 531/531
- Piloto manual: completado en Node con puertos 3000 y 3107; Docker bloqueado por entorno
- Auditoría: pendiente
- Documentación canónica: actualizada
- Observer alineado: completado
- Validación del Supervisor: completada
- Staging selectivo preparado: pendiente
- Commit: pendiente
- Publicación: pendiente

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

- Envío de Gmail.
- Calendar Execution.
- Automatizaciones y activación de otros agentes.

## Advertencias evidenciadas

- El árbol de trabajo contiene cambios históricos y runtime ajenos a 5C.7B que deben permanecer separados.
- Los tokens OAuth reales siguen en filesystem local y deben rotarse antes de cualquier despliegue.
- Memoria, Approval Queue y logs siguen ligados a JSON local; no admiten runtime multiinstancia.
- Firestore existe fuera del código, pero todavía no tiene repositorios ni aislamiento multiusuario implementados.
- La excepción `draftExecutionEnabled` debe permanecer cerrada a Gmail Draft y separada de `executionEnabled=false`.
- Las evidencias y auditorías ya aceptadas no se repetirán salvo invalidación objetiva del contexto.

## Decisión de arquitectura 5C.7B

- Candidata principal pendiente de auditoría externa: Cloud Run + Firebase Authentication + Firestore.
- Alternativa secundaria candidata: Railway manteniendo Firebase Authentication.
- Primera auditoría Antigravity: recibida; veredicto APROBADA CON CORRECCIONES.
- Riesgos aceptados: JSON multiinstancia, secretos locales, filesystem efímero, idempotencia persistente y desacoplamiento de trabajos duraderos.
- PostgreSQL, Redis/BullMQ y Railway no se aceptan como decisiones obligatorias.
- Runtime y persistencia definitivos: pendientes de pruebas y métricas.
- LucusHost: `unknown` hasta obtener datos verificables del plan.
- Estado: 5C.7B.1 LISTA PARA STAGING SELECTIVO; no lista para despliegue.
- Segunda auditoría Antigravity: tras el piloto remoto y antes de probadores.
- Prohibido activar Cloud Run, Blaze, Firestore nuevo, Secret Manager o facturación durante 5C.7B.1.
- Documento canónico: `XANTALAL/00_GOVERNANCE/5C.7B-ARQUITECTURA-EJECUTABLE-RUNTIME.md`.

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

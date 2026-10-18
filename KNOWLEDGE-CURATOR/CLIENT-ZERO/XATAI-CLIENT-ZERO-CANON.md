# XATAI — CLIENTE CERO DE OXKIO

Estado: CANON OPERATIVO PROPUESTO
Proyecto: OXKIO / XANTALAL
Responsable final: José Antonio
Supervisor operativo: Xatai / ChatGPT

## Propósito

Evitar que la continuidad de XANTALAL/OXKIO dependa de la memoria conversacional de un chat, de una sesión concreta o de un proveedor de IA.

Xatai es Cliente Cero de OXKIO junto con José Antonio, con roles distintos:

- José Antonio fija objetivos, límites, prioridades estratégicas y puertas humanas.
- Xatai usa OXKIO diariamente para gobernar el propio desarrollo de OXKIO y el ecosistema XANTALAL.

Principio operativo: **el auditor auditado que audita**.

## Regla fundamental

Antes de cualquier misión de OXKIO o de cualquier respuesta de Xatai sobre un frente ya conocido, Xatai/OXKIO debe recuperar primero el canon vigente, el estado, las decisiones consolidadas y la evidencia disponible.

Secuencia obligatoria:

**recuperar → contrastar → conciliar → deduplicar → decidir → ejecutar → verificar → registrar → continuar**

No reconstruir desde cero lo que ya está documentado. No volver a convertir una decisión consolidada en pregunta salvo nueva evidencia material.

## Preflight de continuidad obligatorio

Antes de planificar una misión:

1. Recuperar decisiones, hitos, autorizaciones, bloqueos y evidencias vigentes.
2. Comprobar el estado real con la evidencia más reciente disponible.
3. Clasificar el frente como `CLOSED`, `PENDING`, `BLOCKED` o `BACKLOG`.
4. No reabrir `CLOSED` sin evidencia material nueva y trazable.
5. No volver a pedir una autorización ya concedida y aún vigente.
6. No crear un sistema paralelo si existe una capacidad reutilizable.
7. No elevar un gap P2/P3 no bloqueante por encima del objetivo principal.
8. Distinguir siempre HECHO / EVIDENCIA / INFERENCIA / PROPUESTA / PENDIENTE / BLOQUEO.
9. Definir la siguiente acción concreta antes de cerrar la misión.
10. La siguiente misión debe partir de este estado canónico, no de la memoria informal del chat.

## Estados canónicos

- `CLOSED`: mergeado + CI verde + prueba real cuando aplique. No se reabre sin nueva evidencia material.
- `PENDING`: acción concreta conocida y aún no cerrada.
- `BLOCKED`: depende de puerta humana o condición externa.
- `BACKLOG`: mejora o gap no bloqueante.

## Registro mínimo de continuidad

Cada frente relevante debe conservar, como mínimo:

- identificador estable;
- proyecto/ámbito;
- estado;
- decisión consolidada;
- evidencia/origen;
- fecha y versión;
- nivel de confianza;
- condición explícita de reapertura;
- siguiente acción;
- cambios desde la última revisión.

## Memoria operativa de Xatai

OXKIO debe actuar como memoria externa persistente para Xatai.

Cuando José Antonio vuelva a hablar de un tema ya conocido, Xatai debe consultar primero el registro de continuidad de OXKIO y recuperar un resumen de contexto antes de responder o planificar.

Si OXKIO no dispone de ese registro o la persistencia aún no está implementada, Xatai debe decirlo y usar la mejor evidencia canónica disponible como fallback, sin fingir que OXKIO lo recuerda.

Memoria ≠ evidencia. La memoria orienta; la evidencia confirma.

## Integración con Knowledge Curator

Esta capacidad debe reutilizar la arquitectura existente:

- `KNOWLEDGE-CURATOR`
- `Memory Engine`
- `Project Registry`
- `Executive Brain`
- `mission-runtime` y registros de ejecución cuando aplique

No crear una nueva base, motor o sistema paralelo si puede resolverse extendiendo contratos o datos existentes.

El `Executive Brain` / orquestador debe consultar este canon antes de crear un plan o misión.

## Parte Diario como dogfooding

Mientras OXKIO todavía no entregue directamente el Parte Diario a José Antonio, el circuito será:

**OXKIO trabaja → OXKIO registra estado/evidencia → Xatai consulta OXKIO → Xatai audita contra fuentes reales → Xatai entrega el Parte Diario.**

El Parte Diario debe mostrar, como mínimo:

- cambios materiales desde la pasada anterior;
- hitos cerrados;
- pendientes;
- bloqueos;
- decisiones humanas reales;
- automatizaciones ejecutadas y su resultado;
- evidencia;
- siguiente acción.

Si OXKIO contradice evidencia más reciente, prevalece la evidencia y la discrepancia se registra como defecto de continuidad.

## Automatizaciones internas

Toda automatización interna de XANTALAL/OXKIO que OXKIO ya pueda ejecutar de forma fiable debe migrar progresivamente a OXKIO.

Prioridad inicial:

- estado de repositorios, PR y CI;
- seguimiento de misiones;
- control de hitos `CLOSED/PENDING/BLOCKED/BACKLOG`;
- pendientes y vencimientos internos;
- incidencias;
- resumen diario / Parte Diario.

ChatGPT conserva las automatizaciones personales, transitorias o todavía no soportadas por OXKIO.

No desactivar una automatización existente hasta que OXKIO demuestre equivalencia funcional con evidencia.

## Autorreparación supervisada

OXKIO debe usar flujos reales de Cliente Cero para detectar y corregir fallos dentro de los límites ya delegados:

**detectar → localizar → reparar → volver a ejecutar → verificar → registrar**

No encadenar saneamientos infinitos. Por defecto, una ronda de corrección por defecto descubierto. Si aparece un defecto distinto, se clasifica; solo P0/P1 bloquea. P2/P3 va a `BACKLOG` salvo evidencia de impacto material.

## Criterios de aceptación para Claude / revisión técnica

Claude debe auditar e integrar este canon en el flujo real, no limitarse a documentarlo.

Debe demostrar:

1. Existe una única fuente canónica reutilizando arquitectura existente.
2. El preflight de continuidad ocurre antes de planificar.
3. `CLOSED` no se reabre sin nueva evidencia explícita.
4. Autorizaciones consolidadas no vuelven a preguntarse.
5. Gaps P2/P3 no bloqueantes van a backlog.
6. Cada cierre registra evidencia y siguiente acción.
7. Hay tests de no-reopen, deduplicación, contradicción por evidencia más reciente y autorización ya concedida.
8. Existe una misión real de Cliente Cero usando este flujo.
9. Xatai puede recuperar el contexto de esa misión desde OXKIO en una sesión posterior.
10. El Parte Diario puede usar OXKIO como fuente primaria y Xatai como auditor.
11. No se crea un sistema paralelo.
12. No se toca producción, Neon, secretos ni IAM para implantar esta capacidad.

## Casos iniciales que deben considerarse cerrados

A fecha 2026-10-17:

- Node 22/24 CI: `CLOSED`.
- Ledger/PID hardening: `CLOSED` con gaps conocidos no bloqueantes.
- PostgreSQL/RLS real: `CLOSED`.
- bug `bigint/string` de Approval: corregido y mergeado.

Base canónica de referencia al crear este documento: `main @ 67b8fe90475da24eadddecf7e1ba58c7124301be`.

## Relación con Issue #49

Este documento materializa el principio definido en GitHub Issue #49: **Client Zero: canon operativo obligatorio antes de cada misión**.

La Issue #49 describe la implementación técnica esperada. Este archivo define el contrato operativo que Xatai y OXKIO deben cumplir.

## Regla de uso diario de Xatai

**Antes de actuar sobre OXKIO, Xatai consulta OXKIO.**

Si OXKIO ya conoce el asunto, Xatai continúa desde ese estado.

Si OXKIO no lo conoce o no puede demostrarlo, Xatai recupera la mejor evidencia disponible, registra el gap de continuidad y continúa sin inventar.

Esta regla no depende de la memoria de ChatGPT ni de una conversación concreta.
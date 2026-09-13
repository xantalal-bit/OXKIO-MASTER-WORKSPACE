# MASTER ROADMAP XANTALAL

**Reconciliación:** 13/09/2026 — Plan Maestro auditado V0.2 integrado en el documento existente.
**Decisión final:** José Antonio.
**Coordinación, auditoría y seguimiento:** Xatai / ChatGPT.
**Estado documental:** VIGENTE — PM-01 CERRADO. PM-02…PM-32 pendientes de revisión individual.
**Alcance:** gobierno y planificación ejecutiva de XANTALAL, OXKIO y productos asociados.

## Gobierno y fuentes

1. [Decision Registry XANTALAL](DECISION-REGISTRY-XANTALAL-MASTER.md): fuente canónica de decisiones y estado ejecutivo. Este roadmap organiza el trabajo; no sustituye ni duplica el registro.
2. Este mismo Master Roadmap: único roadmap operativo maestro; integra PM-01…PM-32.
3. [Chat de gobierno y Parte Diario, 13/09/2026, 10:50](https://chatgpt.com/c/6aa664c2-611c-83eb-b0ef-ce893b9aa6ff): centro diario de revisión, decisión y seguimiento.
4. OXKIO técnico: continúa exclusivamente en su chat y documentación técnica existentes. Aquí solo se mantienen estado, hitos, dependencias, decisiones, bloqueos y planificación general.

Reutilizar fuentes y capacidades existentes, incluido [Knowledge Curator](../../KNOWLEDGE-CURATOR/KNOWLEDGE-CURATOR-MASTER.md). No crear otro Plan Maestro, registro ni sistema paralelo.

Precedencia para reconciliar: evidencia técnica actual y documentos canónicos → decisión humana explícita más reciente → documento maestro vigente → histórico compatible → recuerdo conversacional no verificado. La evidencia acredita hechos, no concede permisos. Ante discrepancia, distinguir hecho, propuesta y decisión, y resolverla con trazabilidad sin borrar lo sustituido.

## Método de revisión y límites

**FASE A FASE. PUNTO POR PUNTO. SIN PRISA PERO SIN PAUSA Y A BUEN RITMO.**

Para cada PM:
1. Recuperar el estado real y contrastar evidencia.
2. Confirmar vigencia y clasificar: VIGENTE / MODIFICAR / CERRAR / EN ESPERA / BLOQUEADO.
3. Confirmar prioridad P0 / P1 / P2 / P3.
4. Asignar responsable: José + Xatai / Xatai autónomo / automatización / tercero-herramienta.
5. Determinar automatizable SÍ/NO, tareas autónomas de Xatai, decisiones de José y dependencias.
6. Fijar siguiente acción concreta y registrar evidencia con ubicación.
7. Cerrar la revisión del punto antes de pasar al siguiente, dejando fecha + estado + evidencia + pendiente + punto exacto de reanudación.

Cerrar la revisión no equivale a declarar ejecutado el producto ni autoriza su puesta en marcha. La secuencia general es recuperar → contrastar → decidir → ejecutar dentro del alcance autorizado → validar → dejar evidencia; commit o producción solo cuando correspondan al trabajo.

Reglas transversales:
- José Antonio conserva la decisión final. La IA asesora, analiza, propone, alerta y automatiza dentro de límites autorizados.
- Xatai dirige y audita; Claude Code es ejecutor preferente para repositorio y otros ejecutores pueden apoyar dentro del alcance autorizado. Ningún ejecutor decide por sí solo cambios materiales de arquitectura, coste, seguridad, permisos o publicación.
- No ejecutar cambios materiales sin autorización cuando corresponda.
- España preferente; UE como máximo salvo excepción justificada y decidida por José. Aplicar DR-010 por servicio/endpoint/función, con datos minimizados y proveedor sustituible.
- Revisar legal antes de piloto, publicación o comercialización.
- OXKIO: `executionEnabled=false` salvo autorización expresa.
- Gmail: `SAFE_DRAFT_ONLY` cuando aplique.
- No afirmar «guardado», «registrado» o «archivado» sin evidencia y ubicación.
- Conservar decisiones sustituidas como SUPERSEDED/HISTÓRICO; deduplicar entradas de distintos chats.
- Esta reconciliación solo modifica este archivo: no modifica el Decision Registry, no implanta servicios y no activa automatizaciones.

## Estado ejecutivo al 13/09/2026

La aprobación del chat de gobierno fija este inventario y sus prioridades; no acredita que todos los frentes estén auditados o ejecutados.

- Conciliación histórica multichat: todavía en ejecución; reutilizar fuentes consolidadas, sin auditorías repetitivas.
- Seguridad global / Bitwarden: revisión P0 pendiente, incluyendo separación personal, negocio y secretos técnicos.
- XANTALALSHOP: web vigente `preview.xantalalshop.com`, V3.1 / preview; requiere trabajo conjunto, completar contenido y preparar gestor seguro. WordPress antiguo es histórico.
- Automatización XANTALALSHOP y automatizaciones anteriores: **PAUSADAS**, según estado de apertura aprobado. No se ha inspeccionado ni alterado su configuración en esta actualización documental.
- Parte Diario: **NO activado**. Horario previsto 18:30, adelantable a petición; implantación pendiente de revisión del Plan Maestro.
- Business Hunter, GIU, Xose + OXI, Media Orchestrator, relatos, registros/radares y ALPHA: incluidos en el inventario inferior, pendientes de revisión y decisión en su punto.

### OXKIO — resumen exclusivo de PM-20 / PM-21

Objetivo: consolidar OXKIO como Director Ejecutivo IA readonly y preparar una transición supervisada, sin abrir ejecución general.

**Último cierre canónico:** 6B.4D = CERRADA / PASS REAL, documentado en 6B.4E el 11/09/2026: materialización de `oxkio_backup_role` / `oxkio_backup_login` y privilegios mínimos. Fuente: [cierre canónico 6B.4E](5C.7B-ARQUITECTURA-EJECUTABLE-RUNTIME.md), [commit de evidencia 1fbb0a8](https://github.com/xantalal-bit/OXKIO-MASTER-WORKSPACE/commit/1fbb0a892600bd8e07fd136feebf075ce655edbb).

**Límite de evidencia:** se verifica aquí el cierre documental del repositorio. La fuente distingue evidencia directa offline y ejecución real reportada por el operador humano autorizado; esta reconciliación no verifica Neon de forma independiente.

**Siguiente frontera:** 6B.5 — password y custodia segura de la credencial PG-BKP — **NO ABIERTA**. Depende de su revisión y autorización técnica específica. Password, Secret Manager, IAM y backup real siguen pendientes según ese cierre; no declarar backup operativo ni recuperación ante desastres completa. 5C.7B.6 sigue abierta; 6C, 6D, 6E y 5C.7B.7 no abiertas.

El detalle y la secuencia se consultan en la documentación técnica y en el [roadmap técnico existente](../../orchestration/ROADMAP.md); no se reproducen aquí ni se ejecutan desde PM-01. La custodia enlaza ejecutivamente con PM-08…PM-11 y PM-31.

Comité multi-IA futuro: planned; modelos externos no habilitados y ejecución no habilitada. Comparaciones futuras solo con opiniones sanitizadas y autorización aplicable; ninguna IA sustituye la aprobación del Cliente Cero.

## Plan Maestro vigente PM-01…PM-32

Las prioridades reproducen V0.2 aprobada. **Solo PM-01 está cerrado. Todos los demás puntos están PENDIENTES DE REVISIÓN INDIVIDUAL, no abiertos por esta integración.** Su clasificación, responsable, automatizable SÍ/NO, autonomía, decisiones humanas, dependencias y evidencia se fijarán al revisar cada punto; no se inventan resultados de auditoría.

Las siguientes acciones son preparación para esa revisión, no autorización de ejecución material. Las relaciones indicadas entre puntos se confirmarán al revisarlos.

| PM | Frente y alcance | Prioridad aprobada | Siguiente acción / resultado |
|---|---|---|---|
| PM-01 | Consolidar y actualizar este Master Roadmap | P0 | CERRADO; ver cierre y evidencia al final. |
| PM-02 | Implantar Parte Diario único XANTALAL | P0 | Recuperar el formato y canal existentes; contrastarlos con los diez contenidos fijados abajo; proponer el flujo único sin activarlo. |
| PM-03 | Parte Diario a las 18:30, hora española; adelantable a petición | P0 | Tras PM-02, concretar horario Europe/Madrid y adelanto a petición, evitando dos partes del mismo día. |
| PM-04 | Revisar todas las automatizaciones pausadas una por una | P0 | Recuperar inventario y configuración real; clasificar cada una y detectar duplicidades, manteniendo la pausa. |
| PM-05 | Mantener Decision Registry como fuente canónica | P0 transversal | Comprobar referencias y decisiones pendientes de conciliación; no crear otro registro. |
| PM-06 | Continuar conciliación histórica multichat | P1 | Recuperar solo evidencia faltante y contradicciones; reutilizar Knowledge Curator y el registro existente. |
| PM-07 | Integrar diariamente cierres relevantes de otros chats | P1 | Enlazar cierres y novedades materiales en el parte único; deduplicar sin copiar conversaciones. |
| PM-08 | Bitwarden / Credential Vault global: verificar estado real alcanzado | P0 | Contrastar lo realmente configurado con DR-009; distinguir diseño, implantación y pendientes. |
| PM-09 | Bitwarden: personal, negocio y secretos técnicos; MFA, recuperación y backup | P0 | Revisar separación de ámbitos, recuperación y verificación por lotes; no autorizar acceso general de OXKIO a la bóveda personal. |
| PM-10 | Revisar y asegurar artefactos sensibles de recuperación localizados | P0 | Verificar custodia y exposición sin copiar secretos al roadmap; proponer medidas para decisión humana. |
| PM-11 | Inventario de cuentas, accesos, proveedores y credenciales | P0/P1 | Localizar inventarios existentes, responsables y huecos; referenciar ubicaciones seguras sin incluir valores secretos. |
| PM-12 | Inventario de suscripciones, costes, capacidades y herramientas infrautilizadas | P1 | Contrastar uso y coste real, solapamientos y capacidades únicas antes de proponer cambios. |
| PM-13 | Capability Map: Gmail, Outlook, Calendar, GitHub, Drive, Copilot, NotebookLM, plugins, conectores y demás capacidades | P1 | Reutilizar el mapa existente y comprobar acceso y límites reales; no confundir disponibilidad con autorización. |
| PM-14 | Soberanía de datos: España preferente / UE máximo salvo excepción justificada | P1 transversal | Contrastar residencia por servicio, endpoint y función con DR-010; elevar excepciones justificadas a José. |
| PM-15 | Identity / Age / Jurisdiction para OXKIO y futuros servicios | P1 | Revisar DR-011 y separar autenticación, edad y jurisdicción con minimización de datos. |
| PM-16 | XANTALALSHOP V3.1 / preview: completar web vigente | P1 | Recuperar estado y pendientes de preview.xantalalshop.com conforme a DR-005; revisar con José. |
| PM-17 | XANTALALSHOP: contenido, legal básico, formulario, enlaces, assets, responsive, SEO y gate de publicación | P1 | Contrastar cada pendiente con la preview; preparar validación y puerta humana antes de publicar. |
| PM-18 | Gestor de contenidos XANTALALSHOP seguro | P1 | Definir edición, preview, publicación y rollback reutilizando lo existente y evitando cambios continuos de estructura/configuración. |
| PM-19 | Favicon 3D localizado; animación/GIF a futuro | P3 | Confirmar ubicación y uso del asset existente; conservar animación/GIF como futuro. |
| PM-20 | OXKIO técnico exclusivamente en su chat técnico | P0 para José | Mantener aquí solo estado, hitos, dependencias, decisiones y bloqueos; remitir la ejecución al frente técnico. |
| PM-21 | Incorporar el cierre exacto del último bloque OXKIO y mantenerlo actualizado | P0 | Revalidar el resumen ejecutivo inferior contra el cierre canónico; actualizar solo ante evidencia nueva. |
| PM-22 | Business Hunter: auditar estado y decidir espera/reactivación | P2 | Recuperar evidencias existentes y presentar a José la decisión; no reactivar por inclusión en este plan. |
| PM-23 | GIU: reconciliar estado y decidir papel futuro | P3 | Recuperar alcance y resultados previos antes de proponer su continuidad. |
| PM-24 | Xose + OXI: contenido, redes, posicionamiento y monetización | P2 | Reconciliar activos y trabajo vigente; concretar el siguiente entregable y sus dependencias. |
| PM-25 | Media Orchestrator: validar motores y pipeline sustituible | P2 | Aplicar DR-012: contrastar casos reales, calidad, consistencia, coste, velocidad, intentos y límites antes de elegir motor. |
| PM-26 | Relatos / historias audiovisuales personalizadas y producto digital urgente | P2/P3 | Recuperar propuesta y activos; concretar producto y prioridad con José, vinculándolo a PM-24/PM-25. |
| PM-27 | Registro Maestro IA / herramientas / competidores | P2 | Deduplicar el registro existente y clasificar PROBAR / VIGILAR / IGNORAR conforme a DR-013; actualizar solo novedades materiales. |
| PM-28 | Radar de cambios materiales: OpenAI, Claude, Gemini y otros proveedores | P2 | Definir relevancia e integración en el parte; automatización por decidir tras revisión. |
| PM-29 | Correo Gmail + Outlook: revisión filtrada integrada en Parte Diario | P1 | Concretar filtros y alcance autorizado; mantener SAFE_DRAFT_ONLY cuando aplique; automatización por decidir. |
| PM-30 | Radar de ayudas, subvenciones y financiación | P1 | Definir oportunidades y criterios; no crear empresa salvo oportunidad que lo justifique y decisión de José; automatización por decidir. |
| PM-31 | Backups / custodia / recuperación XANTALAL-OXKIO | P1 | Auditar lo existente y completar huecos de diseño; coordinar con PM-08…PM-11 y PM-21 sin declarar backup operativo por el cierre de roles. |
| PM-32 | ALPHA / estudio financiero | P2 | Recuperar estado y resultados para que José decida mantener, pausar o cerrar. |

## Automatizaciones y Parte Diario único

Todas las automatizaciones anteriores permanecen **PAUSADAS hasta su revisión individual**. No reactivar ninguna automáticamente ni activar nuevas. En PM-04 cada una se clasificará MANTENER / MODIFICAR / ELIMINAR / MANUAL / INTEGRAR EN PARTE DIARIO. Tras cerrar la revisión del Plan Maestro se decidirán solo las necesarias y sin duplicidades; la clasificación no ejecuta cambios por sí misma.

El único Parte Diario se consolidará en el chat de gobierno existente, a las **18:30 Europe/Madrid**, adelantable a petición de José. Estos son requisitos para PM-02/PM-03, no una programación ni activación:

1. Estado general.
2. Qué se cerró.
3. Qué avanzó Xatai.
4. Qué ejecutaron automatizaciones aprobadas.
5. Qué requiere decisión de José.
6. Qué quedó bloqueado.
7. Cambios de prioridad.
8. Correo relevante.
9. Resumen de los chats realmente utilizados ese día.
10. Punto exacto de reanudación para el día siguiente.

Incluir solo hechos ocurridos. Si un chat no tuvo actividad, no inventar resumen. Sin ejecuciones de automatizaciones aprobadas, indicarlo como tal. Enlazar la evidencia de cierres, sin duplicarla.

## Reconciliación de las fases históricas

Las fases 1–7 se conservan abajo íntegramente como trazabilidad. Sus estados antiguos no constituyen el tablero vigente ni autorizan ejecución.

| Referencia histórica | Tratamiento vigente |
|---|---|
| Fase 1 — Gobierno y mando | Reconciliada mediante PM-01…PM-07 y política de ejecutores; tareas restantes conservadas, sin darlas por concluidas. |
| Fase 2 — Knowledge Platform | Arquitectura existente a reutilizar en PM-05/PM-06/PM-13/PM-27; sin autorización nueva de implementación. |
| Fase 3 — Cliente Cero PENDIENTE | SUPERSEDED como fotografía global actual; consultar resumen OXKIO PM-20/PM-21, sin presumir completas todas las tareas antiguas. |
| Fase 4 — Business Hunter | MODIFICAR: revisar en PM-22. |
| Fase 5 — Credential Vault | MODIFICAR / ELEVAR: PM-08…PM-11, seguridad P0 con PM-11 P0/P1. |
| Fase 6 — Automatización supervisada PENDIENTE | SUPERSEDED parcialmente como estado global; reconocer avances OXKIO sin habilitar ejecución. Revisión en PM-04 y PM-20/PM-21. |
| Fase 7 — Escalado | EN ESPERA como futuro, sin nueva apertura. |
| Regla universal idea → capacidad → agente → validación → commit → producción | SUPERSEDED como regla universal; reemplazada por el método adaptado al tipo de trabajo. |
| Regla Codex | SUPERSEDED parcialmente por la política de ejecutores y control humano indicada arriba. |

## Histórico conservado — fases 1–7 y regla anterior

> HISTÓRICO / TRAZABILIDAD. Texto anterior conservado desde «Fase 1»; los estados y la Regla Codex de este bloque deben leerse con la reconciliación precedente. No prevalecen sobre el Plan Maestro vigente.

## Fase 1 — Gobierno y mando

Estado: EN CURSO

Tareas:
- Master Roadmap
- Backlog de ideas
- Decision Registry
- Estado global
- reglas de ejecución Codex
- Gobernanza GPT-5.6 Sol/Terra/Luna (política activa; verificación de disponibilidad, enrutamiento y métricas pendientes)

## Fase 2 — Knowledge Platform

Estado: EN CURSO

Tareas:
- Knowledge Runtime
- Knowledge Registry
- Discovery Engine
- OneDrive Connector V0
- OneDrive Discovery V1
- Recognition Engine
- Knowledge Curator
- Knowledge Discovery & Intelligence Agent (prioridad alta; aprobada para estudio futuro; no implementar antes de la auditoría técnica previa)
- Knowledge Index
- Knowledge Search

## Fase 3 — Cliente Cero Operativo

Estado: PENDIENTE

Tareas:
- Briefing Buenos días
- Agenda real
- Gmail real
- Memoria real
- Recordatorios
- Hechos reales
- Tareas diarias

## Fase 4 — Business Hunter

Estado: PENDIENTE

Nota (2026-08-17): "ecoSoft" retirado del título de esta fase por ser
denominación legacy/prohibida (ver `orchestration/PROJECTS.md`, sección
"Nomenclatura"). No se reinterpreta el alcance ni las tareas de la fase.

Tareas:
- Leer oportunidades
- Priorizar leads
- Preparar correos
- Seguimiento
- Briefing comercial diario

## Fase 5 — Credential Vault

Estado: PENDIENTE

Tareas:
- Inventario de credenciales
- Bóveda segura
- Permisos
- Auditoría
- Acceso bajo autorización

## Fase 6 — Automatización supervisada

Estado: PENDIENTE

Tareas:
- Propuestas
- Aprobaciones
- Ejecución
- Logs
- Auditoría

## Fase 7 — Escalado XANTALAL

Estado: PENDIENTE

Tareas:
- Cliente 1
- Cliente 2
- Plantillas
- Onboarding
- Gobierno por cliente
- Memoria por cliente

## Regla Codex

Codex no decide arquitectura.
Codex ejecuta tareas definidas.
Codex valida.
Codex informa.
ChatGPT dirige arquitectura.
José Antonio aprueba.

## Cierre PM-01 y punto exacto de reanudación

- **Fecha:** 13/09/2026.
- **Estado:** PM-01 CERRADO — auditoría con dictamen MODIFICAR y reconciliación documental aplicada a este único Master Roadmap.
- **Prioridad / responsable:** P0 / José Antonio + Xatai.
- **Automatizable:** NO para decisiones y reconciliación; comprobaciones rutinarias posteriores potencialmente parciales, sin activarlas.
- **Autonomía ejecutada:** recuperar fuentes, integrar la reconciliación aprobada y validar cobertura, histórico, límites y alcance de un solo archivo.
- **Decisión humana:** aprobación «unificamos y ampliamos pero sin duplicar y lo dejamos listo» en el chat de gobierno enlazado, seguida de encargo explícito de actualizar exclusivamente este documento.
- **Evidencia:** versión previa del archivo, blob `e2c383ebee4c3658aa210c3325b759b8c82269e1`; Decision Registry consultado, blob `7a9a827a444f193d2af2289f4b75bee05b460a6a`; cierre OXKIO en commit `1fbb0a892600bd8e07fd136feebf075ce655edbb`; cambio de este mismo archivo trazable en su historial Git.
- **Validación documental:** 32 entradas PM consecutivas con prioridades aprobadas; fases 1–7 y regla anterior conservadas; fuente canónica de decisiones referenciada; OXKIO resumido con frontera no abierta; pausa y límites explícitos.
- **Pendiente:** PM-02…PM-32 siguen pendientes de revisión individual. No se declara conciliación multichat total ni se registra esta actualización como cambio ya aplicado al Decision Registry.
- **Punto exacto de reanudación:** **PM-02 — Parte Diario único XANTALAL, paso 1: recuperar el estado real del formato y canal existentes y contrastar evidencia con los diez requisitos anteriores.** A continuación aplicar el método punto por punto y decidir con José su implantación. **PM-02 no se abre ni se implanta en esta actualización.**

# REGISTRO MAESTRO — ECOSISTEMA IA / HERRAMIENTAS / PROMPTS / COMPETIDORES

**Estado:** EN DESARROLLO — conciliación histórica desde 2026-07-01
**Fecha de inicio:** 2026-09-08
**Supervisor:** Xatai aplicando método OXKIO
**Fuente canónica asociada:** `DECISION-REGISTRY-XANTALAL-MASTER.md`

---

## PROPÓSITO

Centralizar y reconciliar toda la información recibida desde chats, capturas, imágenes, archivos, web, pruebas y auditorías sobre IAs, herramientas, competidores, prompts, cursos, conectores, plugins, MCP, automatizaciones y capacidades.

Este documento no sustituye las fuentes originales. Registra el conocimiento derivado, su estado y trazabilidad.

Regla: una captura o imagen no equivale a una decisión. Debe existir una ficha consolidada con resultado de auditoría y estado.

---

## REGLAS DE INGESTA

Cada nueva entrada se clasifica como:

- `NUEVA`: auditar y añadir.
- `DUPLICADO`: enlazar con la ficha existente y no repetir trabajo.
- `ACTUALIZACIÓN`: modificar la ficha existente manteniendo histórico.
- `CONFLICTO`: investigar antes de cambiar el estado canónico.

Estados operativos posibles:

`PROBAR` / `VIGILAR` / `AUXILIAR` / `PRIORIDAD ALTA` / `BAJA PRIORIDAD` / `NO ADOPTAR AHORA` / `DESCARTADO` / `SUPERSEDED`.

Nunca recomendar una herramienta solo por afiliación o comisión. Utilidad y credibilidad primero.

---

## HALLAZGO DE AUDITORÍA SOBRE DÓNDE ESTABA EL CONOCIMIENTO

Entre julio y septiembre de 2026, parte de las capturas e imágenes quedó conservada en la Library de ChatGPT, incluyendo numerosos lotes de imágenes y screenshots. Sin embargo, las decisiones derivadas no fueron persistidas de forma uniforme en Git.

Otra parte quedó únicamente en:

- contexto de chats;
- memoria/resúmenes recuperables;
- pegados de auditorías en Library;
- documentos locales o repo cuando una tarea técnica sí terminó en archivo/commit.

Por tanto, frases históricas como `ya está guardado`, `ya lo auditamos` o `está repetido` pudieron apoyarse en memoria/contexto sin una ficha persistente única. Desde 2026-09-08 esto deja de considerarse persistencia canónica suficiente.

---

## ENTRADAS RECUPERADAS Y RECONCILIADAS — PRIMERA PASADA

### Higgsfield AI
**Estado:** PROBAR — PRIORIDAD ALTA
**Categoría:** audiovisual / generación / orquestación / MCP
**Utilidad:** Media Orchestrator, relatos, microhistorias, heráldica audiovisual, Xose/OXI.
**Decisión:** proveedor sustituible, nunca núcleo dependiente de OXKIO.
**Pendiente:** validar web con caso `Ramón el Farolas`; comparar calidad, consistencia, coste, velocidad, intentos, límites y condiciones MCP/API.
**Riesgo:** no asumir que ventajas Unlimited de web se aplican a MCP/API.

### OpenArt / OpenArt Director
**Estado:** PROBAR — PRIORIDAD ALTA
**Categoría:** vídeo / historias largas / audiovisual
**Decisión:** candidato prioritario de prueba; no aprobado todavía.
**Caso de prueba:** `Ramón el Farolas`.
**Objetivo:** verificar historias de 2–5 minutos, consistencia de personajes, audio/voz y coste real; valorar sustitución parcial de la cadena Media Orchestrator.

### Midjourney
**Estado:** PROBAR / REVISAR COSTE-USO
**Categoría:** imagen / edición
**Decisión relevante:** repetir prueba con V8.2 Edit antes de decidir renovación/cancelación; no juzgar por pruebas fallidas de versiones anteriores.
**Pendiente:** comparar utilidad real frente a alternativas del Media Orchestrator.

### MeiGen.ai
**Estado:** PROBAR — PRIORIDAD ALTA
**Categoría:** image-to-prompt / generación / referencias / API-MCP
**Pendiente:** prueba funcional y coste/integración.

### PromptHero
**Estado:** AUXILIAR / PRIORIDAD ALTA COMO FUENTE
**Categoría:** prompt intelligence / inspiración / análisis de prompts
**Decisión:** utilizar como fuente, no como núcleo del sistema.

### Lexica.art
**Estado:** AUXILIAR
**Categoría:** búsqueda/reverse image search / inspiración visual
**Decisión:** útil como herramienta secundaria.

### Abacus.ai
**Estado:** COMPETIDOR / VIGILAR
**Categoría:** plataforma de IA/agentes/modelos
**Motivo:** comparación estratégica con OXKIO por amplitud de modelos/agentes y bajo coste aparente.
**Regla:** estudiar lecciones de producto/precio/orquestación sin cambiar la visión diferencial de OXKIO por reacción competitiva.

### Merlin AI
**Estado:** VIGILAR
**Categoría:** asistente multi-IA / productividad
**Uso:** benchmark de simplificación, agregación y experiencia de usuario.

### Cosmos AI
**Estado:** VIGILAR / COMPETIDOR
**Categoría:** orquestación / IA de IAs
**Motivo:** similitud conceptual con vocabulario/orquestación OXKIO; analizar sin alarmismo ni copiar arquitectura.

### Nubion AI
**Estado:** REGISTRADO / VIGILAR
**Categoría:** competidor/herramienta IA
**Pendiente:** mantener ficha mínima y revisar novedades materiales.

### ChatGO
**Estado:** COMPETIDOR / LECCIONES UX
**Lecciones consolidadas:** simplicidad móvil, memoria fiable, onboarding claro y precios transparentes.

---

## CAPABILITY MAP / PROMPTS / MODIFICADORES

### Colecciones virales de prompts y “skills”
**Estado:** REGLA CANÓNICA

No guardar colecciones virales de forma literal sin auditoría.

Clasificación:
- A = válido y nuevo;
- B = válido pero redundante, consolidar;
- C = plantilla/caso de uso;
- D = obsoleto, no fiable o monetización opaca, no guardar.

Las etiquetas virales de “skills imprescindibles” se consolidan por capacidad funcional real, no como decenas de skills independientes.

### Sistema de Modificadores Operativos
**Estado:** CANÓNICO

Conservar catálogo propio consolidado y seleccionar/combinarlos automáticamente cuando aporte valor. Evitar crear comandos nuevos que dupliquen capacidades existentes.

Incluye, entre otros, familias de revisión, crítica, predicción, OODA, red-team, monetización, pricing, upsell, oferta, competencia, sociales, explicación, comparación, tablas, checklist, brainstorming, prompting y fuentes.

---

## HERRAMIENTAS / CONECTORES / PLUGINS

### Auditoría de capacidades disponibles pero no utilizadas
**Estado:** PRIORIDAD ALTA — PENDIENTE/EN CONCILIACIÓN

Objetivo: auditar herramientas, apps, conectores, plugins/skills e integraciones disponibles o activadas pero no conectadas/utilizadas.

Matriz objetivo:

`herramienta -> capacidad -> conexión requerida -> coste -> datos/permisos -> utilidad real -> solapamiento -> decisión`

Principio: antes de desarrollar una capacidad propia, comprobar si ya existe una integración fiable que pueda reutilizarse.

---

## FORMACIÓN / FUENTES

### Google Gemini formación oficial
**Estado:** REGISTRADO

Recursos oficiales identificados:
- Skillshop: fundamentos y productividad con Gemini.
- Google Skills: Workspace con Gemini.
- Prompting Essentials / AI Boost Bites.

Uso: formación práctica; no confundir curso con capacidad técnica del producto.

---

## MEDIA ORCHESTRATOR

**Estado:** PRIORIDAD ESTRATÉGICA

Principio rector:

`pipeline estable -> proveedores sustituibles -> elegir motor por microtarea`

Validación manual inicial con 2–3 motores usando caso común y métricas:
- calidad útil;
- consistencia;
- coste;
- velocidad;
- número de intentos;
- límites/licencias;
- API/MCP/automatización.

Todo proveedor audiovisual nuevo debe incorporarse a esta matriz, no abrir un proyecto paralelo.

---

## MONETIZACIÓN Y AFILIACIÓN

**Estado:** REGLA CANÓNICA

No limitar herramientas afiliables a publicidad web. Considerar también Shorts, Reels, TikTok, YouTube y demostraciones comparativas/tutoriales.

Priorizar coincidencia de:

`utilidad real + contenido demostrable/viral + API/MCP/automatización + afiliación`

OXI puede actuar como activo creativo/comercial cuando aporte valor, sin recomendar herramientas únicamente por comisión.

---

## PENDIENTES DE CONCILIACIÓN HISTÓRICA JULIO -> 8 SEPTIEMBRE 2026

- recorrer Library por fecha y lotes de imágenes/capturas;
- identificar cada lote que originó una decisión;
- reconciliar decisiones sobre IAs/herramientas/competidores no incluidas todavía;
- recuperar colecciones de prompts/modificadores y marcar duplicados;
- revisar conversaciones sobre vídeo, imagen, voz, agentes, MCP y conectores;
- conciliar cursos/formación y fuentes de aprendizaje;
- enlazar cada ficha con evidencia cuando exista;
- marcar explícitamente decisiones históricas sustituidas.

Esta auditoría no se considerará completa hasta cubrir julio, agosto y septiembre hasta la fecha y clasificar cada hallazgo material.

# DECISION REGISTRY XANTALAL — MASTER

**Versión:** 0.1
**Estado:** EN DESARROLLO — P0 CONCILIACIÓN MULTICHAT
**Fecha de inicio:** 2026-09-08
**Propietario humano:** José Antonio
**Supervisor IA provisional:** Xatai, aplicando el método de OXKIO hasta que OXKIO asuma el relevo

---

## 1. PROPÓSITO

Esta es la fuente canónica de decisiones y estado ejecutivo de XANTALAL/OXKIO.

Los chats, documentos, correos, repositorios, conectores, auditorías y fuentes externas son entradas de conocimiento; no son por sí solos la fuente final de verdad.

Toda decisión material conciliada debe terminar aquí o enlazada desde aquí con estado explícito, trazabilidad y sustituciones.

Objetivo principal: evitar pérdida de conocimiento, duplicidades, auditorías infinitas y re-apertura accidental de decisiones ya consolidadas.

---

## 2. REGLA DE GOBIERNO

Antes de afirmar el estado de un frente, Xatai/OXKIO debe:

1. Recuperar el estado canónico existente.
2. Contrastar la nueva evidencia con repositorio, documentación y contexto recuperable.
3. Clasificar la novedad.
4. No reabrir decisiones consolidadas sin nueva evidencia.
5. Mantener histórico y rollback sin confundirlo con lo vigente.
6. Actualizar este registro cuando exista un cambio material.
7. Diferenciar claramente análisis, propuesta, aprobación, ejecución y evidencia.

Los cambios relevantes de arquitectura, coste, seguridad, permisos, publicación, legal/compliance o riesgo requieren decisión humana de José Antonio.

---

## 3. ESTADOS CANÓNICOS

- `CANÓNICO / VIGENTE`: estado actual que debe gobernar el trabajo.
- `EN EJECUCIÓN`: trabajo activo y autorizado.
- `PENDIENTE`: aprobado o identificado, pero aún no ejecutado.
- `BLOQUEADO`: no puede avanzar sin requisito previo.
- `SUPERSEDED / EN DESUSO`: sustituido por una decisión posterior; conservar para trazabilidad.
- `HISTÓRICO / ROLLBACK`: conservar por seguridad, referencia o reversión.
- `DESCARTADO`: no usar salvo nueva evidencia explícita.
- `POR CONCILIAR`: conocido pero todavía no reconciliado contra todas las fuentes disponibles.

---

## 4. MÉTODO OXKIO APLICADO A XATAI

Mientras OXKIO no sea autónomo, Xatai operará conceptualmente con su flujo:

`Entrada -> IntentAnalyzer -> ExecutiveBrain -> Memory/Knowledge -> RuleEngine -> Proposal -> Approval -> Execution -> Log/Persistencia -> Supervisor`

No se crea un sistema paralelo. Esta operación es dogfooding del propio OXKIO y debe generar requisitos reutilizables por OXKIO.

---

## 5. DECISIONES CANÓNICAS YA RECONCILIADAS

### DR-001 — Fuente única de verdad multichat
**Estado:** CANÓNICO / VIGENTE

Todos los chats relacionados con XANTALAL, OXKIO, web, herramientas, monetización, seguridad y demás frentes son puertas de entrada al mismo proyecto. No deben funcionar como silos.

La memoria conversacional no se considera repositorio canónico suficiente. Las decisiones materiales deben persistir en el repositorio y ser revisables desde futuros chats.

---

### DR-002 — No borrar decisiones sustituidas
**Estado:** CANÓNICO / VIGENTE

Las decisiones antiguas no se eliminan cuando puedan servir como trazabilidad o rollback. Deben marcarse como `SUPERSEDED / EN DESUSO` o `HISTÓRICO / ROLLBACK`, con enlace a la decisión vigente.

---

### DR-003 — Evitar auditorías repetitivas
**Estado:** CANÓNICO / VIGENTE

Una auditoría no es progreso por sí misma. No repetir auditorías para reconstruir estados ya consolidados salvo evidencia nueva, discrepancia real o riesgo técnico que lo justifique.

El sistema debe poder responder siempre: QUÉ EXISTE / QUÉ ESTÁ HECHO / QUÉ ESTÁ EN CURSO / QUÉ SIGUE / QUÉ ESTÁ BLOQUEADO / QUÉ DECISIÓN REQUIERE JOSÉ ANTONIO.

---

### DR-004 — Consejo IA base
**Estado:** CANÓNICO / VIGENTE

`ChatGPT + Gemini + Claude` forman el consejo/mesa base de consultores y asesores de XANTALAL.

Claude Pro/Claude Code no es candidato ordinario a recorte: se usa de forma recurrente en OXKIO para auditorías, reparaciones y ejecución técnica, y ayuda a evitar consumo innecesario de Work.

Otras herramientas y suscripciones se valorarán por coste, uso real, capacidad única, solapamiento y posible incorporación al consejo.

**Sustituye:** cualquier clasificación previa que tratase Claude Pro como candidato prioritario de cancelación.

---

### DR-005 — Web canónica de XANTALALSHOP/XANTALAL
**Estado:** CANÓNICO / VIGENTE

La web que debe completarse y preparar para publicación/posicionamiento es:

`preview.xantalalshop.com`

El diseño ya estaba consolidado. Quedan por completar apartados, imágenes/contenidos y preparación de salida/SEO.

No se había publicado OXKIO todavía.

La web WordPress antigua no debe utilizarse como estado vigente de este frente.

---

### DR-006 — Web WordPress antigua
**Estado:** SUPERSEDED / EN DESUSO para el frente de publicación actual

Se conserva únicamente como histórico/referencia. No usarla para inferir el estado de la web canónica actual.

**Sustituida por:** DR-005.

---

### DR-007 — Knowledge Curator como base, no sistema paralelo
**Estado:** CANÓNICO / VIGENTE

El repositorio ya contiene `KNOWLEDGE-CURATOR/KNOWLEDGE-CURATOR-MASTER.md`, cuya misión es centralizar conocimiento autorizado, detectar duplicados, mantener versiones, trazabilidad, obsolescencia e histórico, y alimentar Executive Brain y Memory Engine.

La conciliación multichat actual debe reutilizar esta arquitectura y el Decision Registry previsto; no crear otro gestor de conocimiento paralelo.

---

### DR-008 — Decision Registry
**Estado:** EN EJECUCIÓN

El `BACKLOG-ESTRATEGICO.md` ya contemplaba `Decision Registry` como BACKLOG. Esta necesidad pasa a ejecución documental inmediata mediante este archivo maestro.

Objetivo: que cualquier chat futuro pueda consultar una fuente persistente antes de responder sobre estado, decisión o siguiente paso.

---

### DR-009 — Seguridad / bóveda global
**Estado:** PENDIENTE — DISEÑO AVANZADO

La bóveda debe cubrir todo el ecosistema de José Antonio/XANTALAL, no solo OXKIO.

Separar como mínimo:
- credenciales humanas/personales;
- credenciales de negocio compartibles;
- secretos técnicos/API/máquinas/agentes.

OXKIO no debe tener acceso general a la bóveda personal.

Bitwarden EU es candidato principal para credenciales humanas. La capa de secretos técnicos debe mantenerse separada conceptualmente; Bitwarden Secrets Manager e Infisical quedan como opciones a evaluar según necesidad real.

No ejecutar migración hasta plan controlado, MFA/recuperación y verificación por lotes.

---

### DR-010 — Soberanía/residencia de datos
**Estado:** CANÓNICO / VIGENTE como criterio arquitectónico

Regla objetivo:

`España primero -> UE explícita segundo -> global solo cuando el servicio sea sustituible y los datos estén minimizados.`

El Model Router futuro debe considerar una clasificación de residencia por servicio/endpoint/feature, no solo por proveedor: `EU_STRICT`, `EU_PREFERRED`, `GLOBAL_ALLOWED`.

---

### DR-011 — Identity / Age / Jurisdiction
**Estado:** PENDIENTE — DISEÑO

Separar autenticación, age assurance y jurisdicción. Evitar custodiar documentos de identidad si puede utilizarse una attestation externa que solo devuelva la prueba mínima necesaria.

No tratar Firebase Auth como sustituto de los tres problemas.

---

### DR-012 — Media Orchestrator
**Estado:** CANÓNICO / PRIORIDAD ESTRATÉGICA

Proveedor audiovisual sustituible, pipeline estable. Validar manualmente con casos reales y comparar calidad, consistencia, coste, velocidad, intentos y límites antes de fijar proveedor principal.

Higgsfield/OpenArt/Midjourney y otros motores deben evaluarse por microtarea, utilidad real y capacidad de automatización/API/MCP, sin dependencia del núcleo de OXKIO.

---

### DR-013 — Registro Maestro de herramientas/competidores
**Estado:** CANÓNICO / VIGENTE

Toda IA, herramienta, web, proveedor, competidor o idea relevante debe catalogarse, no descartarse por baja utilidad inmediata.

Nueva entrada: auditar y clasificar.
Duplicado sin novedad: no reprocesar.
Actualización material: actualizar ficha existente.
Conflicto: investigar antes de consolidar.

Estados orientativos: PROBAR / VIGILAR / AUXILIAR / BAJA PRIORIDAD / NO ADOPTAR / IGNORAR según contexto.

---

### DR-014 — Sistema de modificadores y calidad
**Estado:** CANÓNICO / VIGENTE

Mantener el Sistema de Modificadores Operativos consolidado y la metacapa de Inteligencia Crítica/Modo Genio. No multiplicar comandos virales redundantes: extraer capacidades útiles, consolidarlas y descartar ruido.

---

### DR-015 — Control humano
**Estado:** CANÓNICO / VIGENTE

La IA asesora, analiza, propone, alerta, compara y puede automatizar dentro de límites autorizados. José Antonio conserva la decisión final en asuntos relevantes, especialmente legales, regulatorios, contractuales, patrimoniales, éticos, de seguridad, coste y arquitectura.

---

## 6. ESTADO P0 — CONCILIACIÓN MULTICHAT

**Estado actual:** EN EJECUCIÓN

La conciliación no se considera completa todavía.

Fuentes a reconciliar progresivamente:
1. Repositorio `xantalal-bit/OXKIO-MASTER-WORKSPACE`.
2. Knowledge Curator y gobierno XANTALAL ya existentes.
3. Chats y contexto histórico recuperable.
4. Archivos de conversación y Library cuando existan.
5. Google Drive/OneDrive/documentos autorizados cuando sean pertinentes.
6. Evidencia técnica del repo, commits, ADR y estado de runtime.

Criterio de precedencia:
- evidencia técnica actual y documentos canónicos;
- decisión humana explícita más reciente;
- documento maestro vigente;
- decisión histórica compatible;
- recuerdo conversacional no verificado.

No declarar conciliación total hasta revisar las fuentes suficientes para cada frente.

---

## 7. BACKLOG EJECUTIVO PARA LA CONCILIACIÓN

1. Inventariar documentos de gobierno existentes y evitar duplicados.
2. Reconciliar estado técnico real de OXKIO contra Git/ADR/runtime.
3. Reconciliar web `preview.xantalalshop.com` y su backlog real.
4. Reconciliar Registro Maestro de herramientas/competidores/cursos/prompts.
5. Reconciliar seguridad, Credential Vault y secretos técnicos.
6. Reconciliar suscripciones/capacidades/costes.
7. Reconciliar Media Orchestrator y monetización.
8. Reconciliar legal/compliance y salida comercial.
9. Convertir contradicciones en entradas `SUPERSEDED` explícitas.
10. Establecer actualización rutinaria del Decision Registry tras decisiones materiales.

---

## 8. REGLA DE USO DESDE CUALQUIER CHAT

Ante una petición como `Xatai, estado ejecutivo`, `seguimos con OXKIO`, `mira esta herramienta`, `esto ya te lo mandé` o equivalente:

1. Consultar primero esta fuente canónica y documentos enlazados cuando estén disponibles.
2. Recuperar contexto adicional solo si hace falta.
3. Distinguir hecho de supuesto.
4. Actualizar el registro si la conversación cambia materialmente el estado.
5. No decir `guardado` salvo que se especifique dónde quedó persistido o que se trate explícitamente de memoria conversacional no canónica.

---

## 9. LIMITACIÓN DECLARADA

Xatai no puede asumir que posee acceso exhaustivo y simultáneo a todos los chats históricos únicamente por memoria conversacional. Cuando una decisión sea crítica, debe apoyarse en esta persistencia y en fuentes recuperables.

Por ello, desde esta fecha `guardado en el proyecto` significará persistido en fuente canónica/repo o documento enlazado. Si solo está en contexto/memoria, debe decirse claramente.

---

## 10. SIGUIENTE HITO

Emitir el primer `ESTADO EJECUTIVO CONCILIADO XANTALAL/OXKIO` basado en repo + decisiones multichat recuperables, con:

`HECHO | EN CURSO | SIGUIENTE | BLOQUEADO | SUPERSEDED | DECISIONES JOSÉ ANTONIO | XATAI TRABAJANDO`

Hasta ese hito, P0 de conciliación prevalece sobre generar nuevas auditorías repetitivas del backlog paralelo.

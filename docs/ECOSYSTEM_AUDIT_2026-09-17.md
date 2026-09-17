# Auditoría ecosistema IA — 2026-09-17

**Estado:** INVESTIGADO / IMPLEMENTADO EN RAMA (documentación) / NO CANÓNICO / NO PRODUCCIÓN  
**Rama:** `agent/oxkio-autonomy-bootstrap`

## 1. Higgsfield — decisión: PROBAR / PRIORIDAD ALTA

### Evidencia oficial verificada
- Higgsfield mantiene un **plugin oficial para ChatGPT** y conexión MCP para Claude y otros agentes.
- En ChatGPT se instala desde el Plugins Directory; no requiere API key manual, pero sí cuenta/autorización y una suscripción activa para el uso completo.
- Higgsfield Marketing Studio permite importar producto por URL o imagen y generar piezas como anuncios, UGC, marketplace, posters y motion graphics.
- El flujo oficial de marketing puede hacer que el agente redacte guion, seleccione modelo y genere piezas desde la conversación.
- Las generaciones conectadas consumen créditos Higgsfield según modelo/resolución. La política de “unlimited” de la web no debe asumirse en el plugin.

### Decisión XANTALAL/OXKIO
- **PROBAR — ALTA**, pero no activar conexión ni pagar sin puerta humana.
- Uso objetivo: benchmark y posible proveedor del futuro Media/Marketing Agent de OXKIO.
- No asumir como verificado el claim del Reel “60 anuncios, 6 idiomas y autopublicación a Meta” hasta encontrar documentación oficial específica de ese flujo.
- Preservar arquitectura vendor-neutral: Higgsfield debe ser un adaptador reemplazable, no el cerebro del sistema.

## 2. SuperCool — decisión: VIGILAR / BENCHMARK

### Evidencia oficial verificada
- SuperCool se comercializa como plataforma all-in-one de vídeo con guion, imagen, voz, música, edición y exportación en un único workflow.
- La web oficial publicita un precio promocional bajo y acceso a múltiples modelos/procesos desde una misma interfaz.

### Cautelas
- Sus comparativas “reemplaza X herramientas” y ahorros son marketing del propio proveedor; no tratarlos como equivalencia funcional demostrada.
- Antes de considerar contratación: verificar límites reales, créditos, licencias, calidad, privacidad, residencia de datos y costes efectivos por producción.

### Decisión
- **VIGILAR / BENCHMARK**, sin contratación por ahora.
- Valor principal: benchmark para Media Orchestrator y política de reducción de SaaS redundantes.

## 3. Google AI stack — decisión: CONSOLIDAR, NO DUPLICAR

### Evidencia oficial verificada
- Google AI Studio sigue ampliando Build/vibe coding e integración con Workspace.
- Nano Banana forma parte del stack creativo de Google y se integra en AI Studio/Gemini.
- NotebookLM evolucionó en 2026 y fue renombrado oficialmente como **Gemini Notebook**.
- Google AI Pro/Ultra aportan mayores límites en AI Studio, pero producción a escala sigue orientándose a API.

### Auditoría de la infografía “12 free Google AI tools”
- Es una simplificación de marketing, no un catálogo oficial exacto.
- Mezcla nombres de productos, funciones y etiquetas no oficiales o no equivalentes.
- “100% free / no subscription” no debe generalizarse a todo el conjunto.

### Decisión
- No crear nueva entrada por cada elemento de la infografía.
- Consolidar bajo la familia Google/Gemini ya existente y actualizar nombres vigentes cuando corresponda.

## 4. Web2 → Web3 “replacements” — decisión: DESCARTAR como guía

- La infografía compara servicios Web2 con proyectos Web3 como si fueran sustitutos equivalentes.
- No hay equivalencia funcional garantizada en coste, adopción, privacidad, soporte, interoperabilidad ni riesgo.
- Puede servir como curiosidad/observatorio, pero no como guía tecnológica para XANTALAL.

**Decisión:** NO registrar cada alternativa; solo rescatar proyectos concretos si aparece una necesidad real y se auditan individualmente.

## Conclusión

La única novedad con impacto operativo inmediato es **Higgsfield como plugin/MCP oficial y proveedor creativo conectable a ChatGPT/Claude**. Debe probarse cuando José autorice conexión/cuenta, bajo el patrón OXKIO: `Planner -> Media/Marketing Agent -> proveedor creativo -> Reviewer -> aprobación -> evidencia`.

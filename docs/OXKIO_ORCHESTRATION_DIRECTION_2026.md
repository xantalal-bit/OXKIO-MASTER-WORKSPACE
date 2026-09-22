# OXKIO — Dirección de arquitectura de orquestación IA 2026

Estado: DRAFT ESTRATÉGICO / IMPLEMENTADO EN RAMA `agent/oxkio-autonomy-bootstrap` / NO CANÓNICO / NO PRODUCCIÓN
Fecha: 2026-09-16
Método: fuentes oficiales únicamente; sin rumores ni rankings de terceros.

## 1. Conclusión ejecutiva

La dirección de OXKIO es compatible con la convergencia observable en los principales proveedores de IA. El mercado está evolucionando desde chatbots monolíticos hacia **sistemas agentes con harness/runtime, herramientas, skills, memoria, subagentes, protocolos abiertos, sandbox, evaluación, observabilidad y gobierno**.

OXKIO no debe convertirse en otro modelo fundacional. Su posición más sólida es ser un **control plane / coordinador / orquestador de IAs, agentes, skills, herramientas y workflows**, manteniendo bajo control propio las políticas, aprobaciones, evidencia, costes, memoria canónica y selección de proveedor.

## 2. Señales oficiales por proveedor

### OpenAI
- Agents API (public beta, 2026-09-10): harness administrado derivado de Codex, tareas largas, subagentes, sesiones duraderas, MCP, custom functions, tool search, sandbox gestionado o infraestructura propia/partners.
- Agents SDK: archivos, comandos, edición de código, tareas de largo horizonte y sandbox controlado.
- Implicación: separar harness de entorno; usar subagentes focalizados; permitir ejecución asíncrona; no reconstruir toda la infraestructura de bajo nivel si un harness maduro ya la resuelve.

Fuentes oficiales:
- https://openai.com/index/introducing-the-agents-api/
- https://openai.com/index/the-next-evolution-of-the-agents-sdk/

### Anthropic
- Claude Agent SDK: mismo sustrato que Claude Code, con subagentes, hooks, background tasks, permisos, memoria/contexto y checkpoints.
- Agent Skills: carpetas modulares de instrucciones, scripts y recursos; carga progresiva solo cuando son relevantes; reutilizables en apps, Claude Code y API.
- MCP: estándar abierto para conectar agentes con herramientas/sistemas, donado a la Agentic AI Foundation bajo Linux Foundation.
- Implicación: skills como objetos de primera clase, permisos y checkpoints, conectividad estandarizada y reversible.

Fuentes oficiales:
- https://www.anthropic.com/news/enabling-claude-code-to-work-more-autonomously
- https://www.anthropic.com/research/skills
- https://www.anthropic.com/news/donating-the-model-context-protocol-and-establishing-of-the-agentic-ai-foundation
- https://github.com/anthropics/skills

### Google
- ADK + Vertex AI Agent Engine: runtime gestionado, sesiones, Memory Bank, sandbox de ejecución de código, observabilidad, evaluación, IAM/identidad de agente y despliegue de agentes de distintos frameworks.
- A2A: protocolo abierto para descubrimiento, delegación y colaboración entre agentes de distintos proveedores/frameworks; diseñado para tareas largas y con humanos en el bucle.
- Google separa MCP (herramientas/contexto) de A2A (agente-a-agente).
- Implicación: OXKIO debe hablar MCP hacia tools y prepararse para A2A hacia agentes externos.

Fuentes oficiales:
- https://developers.googleblog.com/a2a-a-new-era-of-agent-interoperability/
- https://developers.googleblog.com/developers-guide-to-ai-agent-protocols/
- https://docs.cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/overview
- https://docs.cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/memory-bank/quickstart-adk

### Microsoft
- Copilot Studio converge en agente + conocimiento + tools + skills + modelo + connected agents + memoria + evaluación + publicación + monitorización.
- Multi-agent orchestration: agentes especializados, inline/connected agents, contexto compartido y mejores prácticas explícitas; Microsoft advierte que multiagente no siempre es necesario.
- Agent Skills: paquetes portables basados en especificación abierta, reutilizables entre agentes.
- Implicación: separar Skill de Tool, diseñar ciclo de vida completo y escoger multiagente solo cuando aporte valor.

Fuentes oficiales:
- https://learn.microsoft.com/en-us/microsoft-copilot-studio/agents-experience/overview
- https://learn.microsoft.com/en-us/microsoft-copilot-studio/agents-experience/skills-overview
- https://learn.microsoft.com/en-us/microsoft-copilot-studio/guidance/multi-agent-patterns

### AWS
- Bedrock Agents Classic entra en maintenance mode para nuevos clientes; la dirección pasa a AgentCore.
- AgentCore Harness: loop gestionado, herramientas, contexto, estado persistente, recuperación ante fallos, sesión aislada con filesystem/shell, skills, memoria y web; model-agnostic y con cambio de modelo por sesión.
- Implicación: el "harness" es infraestructura commodity; OXKIO debe conservar la capa de decisión/gobierno y poder sustituir el runtime.

Fuentes oficiales:
- https://aws.amazon.com/about-aws/whats-new/2026/06/amazon-bedrock-agentcore-harness-generally-available/
- https://aws.amazon.com/about-aws/whats-new/2026/04/agentcore-new-features-to-build-agents-faster/
- https://docs.aws.amazon.com/en_us/bedrock/latest/userguide/agents-multi-agent-collaboration.html

### Salesforce
- Agentforce 2026: primary agent + agentes especializados + shared context + task routing + A2A + observabilidad + model choice.
- Multi-Agent Orchestration ya se usa como capa para ventas, servicio, comercio y operaciones.
- Salesforce señala explícitamente límites cognitivos de agentes con demasiadas responsabilidades y evoluciona hacia subagentes especializados.
- Implicación: un único punto de entrada para el usuario y especialistas detrás; no exponer complejidad al cliente.

Fuentes oficiales:
- https://www.salesforce.com/agentforce/multi-agent-orchestration
- https://www.salesforce.com/news/stories/summer-2026-product-release-announcement/
- https://www.salesforce.com/news/linked-content/agentforce-360-product-deep-dive/

### IBM
- watsonx Orchestrate: coordinación central de agentes, tools, workflows y foundation models; soporta ReAct, Plan-Act y orquestación determinista; AI Gateway puede enrutar entre Granite, OpenAI, Anthropic, Gemini, Mistral y Llama con gobierno/observabilidad.
- Implicación: OXKIO debe poder combinar razonamiento agencial y workflows deterministas bajo una misma capa.

Fuente oficial:
- https://www.ibm.com/products/watsonx-orchestrate/multi-agent-orchestration

### NVIDIA
- NeMo Agent Toolkit: framework-agnostic, envuelve agentes existentes y soporta Router Agent, Parallel Executor, Sequential Executor, Tool Calling y memoria automática.
- Compatible con múltiples frameworks y proveedores.
- Implicación: no casarse con un framework; adaptadores y contratos comunes por encima de runtimes concretos.

Fuentes oficiales:
- https://docs.nvidia.com/nemo/agent-toolkit/latest/
- https://docs.nvidia.com/nemo/agent-toolkit/1.6/components/agents/index.html

### Meta / ecosistema abierto
- Llama Stack estandariza componentes de aplicaciones agentic, RAG, tool use y despliegue en local/on-prem/cloud; la dirección estratégica es interoperabilidad y despliegue flexible.
- Implicación: conservar opción OSS/on-prem y no depender exclusivamente de APIs cerradas.

Fuentes oficiales:
- https://ai.meta.com/blog/future-of-ai-built-with-llama/
- https://ai.meta.com/blog/llama-3-2-connect-2024-vision-edge-mobile-devices/

## 3. Convergencias que ya parecen estructurales

1. **Harness / Runtime**: el modelo solo no basta; se necesita bucle de ejecución, herramientas, contexto, recuperación, estado y entorno.
2. **Especialización multiagente**: principal/coordinador + especialistas/subagentes cuando la misión justifica descomposición.
3. **Skills modulares**: expertise empaquetado, portable, cargado bajo demanda.
4. **MCP para tools/contexto** y **A2A para agente-a-agente**.
5. **Memoria y sesiones duraderas**, pero con separación entre contexto de trabajo y memoria canónica.
6. **Sandbox y aislamiento**: filesystem/shell/código dentro de entornos controlados.
7. **Human-in-the-loop y permisos mínimos** para acciones materiales.
8. **Observabilidad/evaluación/tracing** como requisito de producción, no accesorio.
9. **Model choice / routing** creciente: calidad, coste, velocidad, privacidad, disponibilidad y especialización.
10. **Tareas asíncronas y de larga duración** con checkpoint/retry/recovery.
11. **Interoperabilidad y portabilidad** para evitar reescrituras y lock-in.

## 4. Ajuste recomendado para OXKIO

### OXKIO como Control Plane

Mantener bajo propiedad de XANTALAL:
- Planner / Supervisor;
- Policy Engine y Approval Queue;
- Model Router y budgets;
- Skill/Expert Registry;
- Agent Registry / capability discovery;
- Evidence Logger / audit trail;
- memoria canónica y clasificación de datos;
- evaluación, métricas y criterios de calidad;
- reglas de escalado humano.

Delegar mediante adaptadores cuando convenga:
- harness OpenAI Agents API;
- Claude Agent SDK;
- Google ADK/Agent Engine;
- n8n/workflow engine para pasos deterministas;
- futuros runtimes AWS/NVIDIA/OSS.

### Regla fundamental

OXKIO debe elegir **el mínimo nivel de autonomía necesario**:
1. función/regla determinista;
2. skill;
3. agente único;
4. workflow con agente;
5. varios agentes especializados;
6. agente remoto A2A.

No usar multiagente por marketing: usarlo cuando reduzca contexto, permita paralelismo, revisión independiente, aislamiento de permisos o especialización real.

## 5. Arquitectura objetivo revisada

José / Usuario
→ OXKIO Executive (única puerta de entrada)
→ Planner + Policy
→ Capability Discovery
   - Skill Registry
   - Agent Registry / A2A cards
   - Tool Registry / MCP
   - Model Router
→ Runtime Adapter
   - deterministic workflow
   - OpenAI harness
   - Claude harness
   - Google ADK
   - OSS/other
→ Specialist Agent(s) / Skills
→ Reviewer / Security / Evaluator
→ Approval Queue si acción material
→ Executor
→ Evidence + Metrics + Memory update

## 6. Qué NO hacer

- crear cientos de agentes estáticos por catálogo;
- meter 30–50 herramientas en el contexto de un único agente;
- delegar Policy/Approval al mismo agente que ejecuta;
- usar memoria propietaria de un proveedor como única verdad;
- acoplar OXKIO a n8n, OpenAI, Claude o Gemini como núcleo inseparable;
- activar conectores con privilegios amplios;
- considerar una tarea "PASS" sin pruebas/evidencia;
- confundir automatización determinista con razonamiento agencial;
- vender "agentes" sin un outcome empresarial medible.

## 7. Prioridades técnicas derivadas

### P0 — ahora
1. Schema real de Skill/Expert Registry.
2. Agent Registry con metadata compatible conceptualmente con A2A Agent Card.
3. Model Router mínimo con adapters OpenAI/Anthropic/Gemini y fallback gobernado.
4. Run/Evidence record común para cualquier agente/runtime.
5. Policy Gate / human escalation contract compartido.
6. Evals básicas: éxito, tool use, seguridad, coste, latencia y corrección humana.

### P1 — después
7. MCP Tool Gateway/registry.
8. Durable Run Queue: estado, checkpoint, retry, timeout, cancelación y recovery.
9. Workflow Engineer + motor determinista/n8n adapter.
10. Memoria canónica desacoplada de memoria efímera del proveedor.
11. A2A adapter cuando exista un caso real de agente externo.

### P2 — capitalización
12. Plantillas de outcomes: captación/ventas, atención, reporting, administración y contenido.
13. Un front door OXKIO; especialistas invisibles al cliente.
14. Métrica comercial por proceso: tiempo ahorrado, coste, conversión, errores, SLA y correcciones humanas.

## 8. Evaluación del rumbo actual

### Bien encauzado
- IA de IAs / orquestador, no un nuevo foundation model.
- Model Router multi-proveedor.
- Planner + Supervisor + especialistas.
- Skills reutilizables.
- Workflow/automation engine complementario a agentes.
- Approval Queue y gobierno humano.
- Evidence Logger.
- SAFE_DRAFT_ONLY / executionEnabled=false durante maduración.
- independencia de proveedor.

### A reforzar
- interoperabilidad MCP/A2A desde contratos, sin sobredesarrollar aún;
- durable execution con checkpoints/recovery;
- identity/permissions por agente;
- evals automáticas como gate de promoción CANDIDATE→TESTED→ACTIVE;
- memoria canónica propia;
- coste/latencia como parte del routing;
- separar estrictamente control plane de runtime/harness.

## 9. Veredicto estratégico

La hipótesis XANTALAL/OXKIO está alineada con la dirección pública de los principales actores. La industria no converge en "un único superagente", sino en **orquestadores que coordinan especialistas, skills, herramientas y modelos con protocolos abiertos, memoria, sandbox, evaluación, observabilidad y gobierno humano**.

La ventaja defendible de OXKIO no será inventar el harness más potente, sino ser la capa que decide **qué capacidad usar, con qué IA, bajo qué permisos, a qué coste, con qué evidencia y cuándo pedir intervención humana**.

Nombre interno recomendado del posicionamiento técnico: **OXKIO Agentic Control Plane / Orquestador IA de IAs**.

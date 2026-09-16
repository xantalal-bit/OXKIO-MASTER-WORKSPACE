# XANTALAL Expert & Skills Library

Estado: DRAFT / IMPLEMENTADO EN RAMA `agent/oxkio-autonomy-bootstrap` / NO CANÓNICO / NO PRODUCCIÓN
Fecha: 2026-09-16

## 1. Objetivo

Crear una biblioteca interna, reutilizable y auditable de **skills** y **expert agents** para XANTALAL/OXKIO. No se trata de importar cientos de perfiles por volumen, sino de disponer de capacidades expertas que OXKIO pueda descubrir, seleccionar, combinar, medir y reutilizar.

## 2. Diferencia entre Skill y Expert Agent

- **Skill**: procedimiento especializado y repetible. Define entradas, pasos, herramientas permitidas, controles, formato de salida, referencias y criterios de calidad.
- **Expert Agent**: rol especializado que puede combinar varias skills, razonar sobre una misión y colaborar con otros agentes bajo Supervisor/Policy Gate.

Regla: si una tarea puede resolverse con una skill determinista o semiestructurada, no crear un agente nuevo. Crear Expert Agent solo cuando aporte juicio, aislamiento de contexto, revisión independiente o paralelismo real.

## 3. Arquitectura objetivo

José / objetivo
→ OXKIO Executive
→ Planner
→ Skill/Expert Registry
→ Model Router
→ Skill o Expert Agent
→ Reviewer / Security / Supervisor
→ Approval Queue cuando aplique
→ Evidence Logger

La biblioteca NO sustituye orchestrator, supervisor, approvalQueue, actionExecutor, executionLogger ni Memory Engine. Se integra con la arquitectura existente.

## 4. Dominios iniciales

1. Dirección y estrategia: CEO/COO/CTO/CMO/CFO advisor, planificación, escenarios, pricing, oferta, modelo de negocio.
2. Ventas y Business Hunter: investigación de leads, scoring, propuesta, objection handling, pipeline, seguimiento draft-only.
3. Marketing y crecimiento: posicionamiento, copy, SEO/AEO, campañas, analítica, competencia, growth experiments.
4. Finanzas y administración: presupuestos, cash-flow, costes, unit economics, facturas, reporting. Sin pagos autónomos.
5. Legal/compliance: contratos, privacidad, GDPR, EU AI Act, DPIA, riesgo contractual. Solo apoyo; revisión profesional cuando corresponda.
6. Operaciones: procesos, proveedores, compras preparatorias, capacidad, SOPs, control documental.
7. Seguridad: threat modeling, secretos, IAM review, prompt injection, supply chain, red-team.
8. Investigación: deep research, grants/funding, mercado, producto, competidores, dossier.
9. Producto/ingeniería: arquitectura, código, tests, QA, debugging, review, documentación técnica.
10. Contenido/Media Orchestrator: guion, storyboarding, imagen, vídeo, voz, publicación preparada, analítica.
11. Xose/OXI: estrategia editorial, hooks, guiones, distribución, patrocinio/afiliación, repurpose.
12. Atención/soporte: clasificación, respuesta draft, troubleshooting, escalado humano.

## 5. Estados de una skill/agente

- `CANDIDATE`: descubierto, no auditado.
- `AUDITED`: licencia, seguridad, alcance y calidad revisados.
- `ADAPTED`: convertido al estándar XANTALAL/OXKIO.
- `TESTED`: probado con casos y criterios de éxito.
- `ACTIVE`: permitido para uso real dentro de políticas.
- `WATCH`: útil pero no justifica integración ahora.
- `DEPRECATED`: retirado o sustituido.

Nunca ejecutar directamente una skill externa marcada solo como `CANDIDATE`.

## 6. Ficha mínima de registro

Cada entrada debe conservar:

- id / nombre / versión;
- dominio y misión;
- tipo: skill | expert-agent | evaluator | tool;
- fuente y autor;
- licencia;
- fecha de auditoría;
- modelos compatibles;
- herramientas necesarias;
- red/archivos/secrets requeridos;
- clasificación de datos permitida;
- coste estimado;
- riesgos y limitaciones;
- aprobación necesaria;
- tests y métricas;
- estado;
- rollback/deprecación.

## 7. Política de incorporación externa

Antes de reutilizar GitHub u otra fuente:

1. verificar repositorio/autor y actividad;
2. revisar licencia y restricciones comerciales;
3. leer `SKILL.md`, scripts y dependencias;
4. buscar instrucciones peligrosas, exfiltración, ejecución arbitraria o prompt injection;
5. separar conocimiento útil de integraciones no necesarias;
6. adaptar a contratos y permisos de OXKIO;
7. probar con datos sintéticos/no sensibles;
8. medir calidad, coste, tiempo y correcciones humanas;
9. activar solo si supera al método existente.

No copiar masivamente cientos de skills al repositorio.

## 8. Fuentes candidatas a auditar

- `anthropics/skills`: referencia oficial pública del formato Agent Skills.
- `anthropics/knowledge-work-plugins`: referencia oficial; incluye plugin de small business con skills de finanzas, ventas, marketing, operaciones y contratación.
- `borghei/Claude-Skills`: biblioteca comunitaria grande y multi-proveedor; candidato para descubrimiento, NO confianza automática.
- otras bibliotecas especializadas de negocio/marketing: solo tras auditoría individual.

La procedencia externa aporta ideas y aceleración, no autoridad.

## 9. Portabilidad

Preferencia XANTALAL: formato proveedor-neutral cuando sea viable.

Una skill debe poder exponerse mediante contratos de entradas/salidas claros y ser utilizable por OpenAI/Codex, Claude, Gemini u otro worker compatible. Los detalles exclusivos de un proveedor se aíslan mediante adaptadores.

## 10. Seguridad

- ninguna skill obtiene secretos por texto/prompt;
- acceso mínimo por herramienta;
- red deny-by-default cuando sea viable;
- archivos y rutas allowlisted;
- toda ejecución material pasa Policy Gate/Approval cuando corresponda;
- skills externas no pueden modificar Policy Engine, Approval Queue ni sus propios permisos;
- legal/finanzas/HR de alto impacto no sustituyen revisión humana/profesional;
- evidencia y coste por misión.

## 11. Capitalización futura

La biblioteca puede convertirse en activo propio de XANTALAL:

- uso interno para acelerar XANTALALSHOP, OXKIO, Business Hunter y Xose/OXI;
- paquetes de capacidades por cliente/sector;
- automatizaciones y expertos configurados sobre la instancia del cliente;
- consultoría + implantación + mantenimiento;
- futuro marketplace/catálogo solo cuando licencias y madurez lo permitan.

No comercializar contenido de terceros sin comprobar licencia y derechos de redistribución.

## 12. Primera ola recomendada

No arrancar con 279/368 perfiles. Crear primero un núcleo pequeño medible:

- Planner
- Research Expert
- Business/Strategy Advisor
- Sales/Lead Qualification Expert
- Marketing/Content Expert
- Finance Analyst
- Compliance/Privacy Reviewer
- Security/Red-Team
- Code Expert
- Test/QA Expert
- Evidence/Audit
- Workflow Engineer
- Media Expert

Cada uno debe ganar autonomía mediante evidencia.

## 13. Criterio de éxito

La biblioteca es útil si reduce tiempo de José y aumenta calidad/repetibilidad sin aumentar riesgo ni dependencia de proveedor. Medir: tasa de éxito, coste, tiempo, correcciones humanas, defectos, reutilización y valor económico generado.

## 14. Siguiente paso técnico

1. definir schema JSON del registry;
2. crear loader/selector integrado con Planner/Supervisor;
3. registrar solo las capacidades internas existentes;
4. auditar 3–5 skills externas de alto valor;
5. adaptar una primera skill completa y probarla en sandbox;
6. comparar contra baseline sin skill.

## 15. Benchmark público: Prow (letsprow.com)

Estado de la evaluación: `AUDITED-AS-BENCHMARK` / NO ADOPTADO / NO CONECTADO.

Prow se presenta públicamente como una plataforma de automatización con workflows, integraciones externas y “empleados de IA”. En material público mostrado por José aparecen ideas de orquestación entre especialistas, intervención humana, skills/habilidades, base de conocimiento, aprendizaje continuo, selección de modelos, gestión de errores, acciones seguras y soporte MCP. Estas afirmaciones comerciales se usan solo como benchmark funcional; no se consideran verificadas internamente ni autorización para copiar implementación propietaria.

### Ideas que SÍ encajan con OXKIO

1. **Especialistas orquestados**: varios agentes/skills para una misma misión bajo un coordinador.
2. **Human-in-the-loop**: aprobación explícita antes de acciones materiales.
3. **Skills bajo demanda**: capacidad reutilizable elegida según tarea.
4. **Knowledge/context layer**: documentos y memoria como contexto controlado.
5. **Model-agnostic routing**: elegir modelo según tarea/coste/riesgo.
6. **Error recovery loop**: detectar fallo, diagnosticar, corregir en entorno seguro, reintentar y escalar si persiste.
7. **Safe actions**: permisos mínimos, allowlists y Policy Gate.
8. **MCP/adapters**: superficie estándar para herramientas sin acoplar el núcleo a un proveedor.
9. **Observabilidad**: cada misión debe producir estado, acciones, errores, coste y evidencia.

### Ideas que NO se deben copiar literalmente

- interfaz, nombres, branding, copy comercial o gráficos;
- arquitectura interna no pública;
- prompts, documentación privada o lógica obtenida por reverse engineering;
- dependencias o flujos cuya licencia no esté comprobada.

### Diferencia estratégica buscada

Prow se toma como referencia de mercado, no como base tecnológica. XANTALAL/OXKIO debe conservar su arquitectura propia: Executive + Planner + Skill/Expert Registry + Model Router + Supervisor + Policy Gate/Approval Queue + Action Executor + Evidence Logger. El objetivo no es “empleados de IA” como metáfora comercial, sino capacidades auditables y sustituibles que puedan operar con varios proveedores y bajo gobierno humano.

### Decisión provisional

- **NO contratar ni conectar Prow ahora**.
- **NO intentar clonar la plataforma**.
- **SÍ incorporar de forma independiente los patrones genéricos que ya coinciden con la hoja de ruta OXKIO**.
- Mantener Prow como `WATCH / BENCHMARK` y revisar solo si aparece una capacidad diferencial que ahorre desarrollo real o acelere comercialización sin lock-in significativo.

### Razones

- gran parte de los patrones mostrados ya están en la arquitectura objetivo de OXKIO;
- adoptar otra plataforma central crearía dependencia y duplicaría Supervisor/Approval/Router/Workflow Engine;
- los términos públicos de Prow limitan su uso a la organización contratante y prohíben reverse engineering, copia o desarrollo derivado a partir de su implementación propietaria;
- XANTALAL todavía no necesita añadir otra cuenta, suscripción y custodio de datos para validar conceptos que podemos construir de forma propia y portable;
- si en el futuro el coste de construir una capacidad concreta supera claramente el de integrarla, se reabre la decisión.

### Próximo paso derivado

Usar el benchmark para el diseño del registry, del selector de skills y del futuro Workflow Engineer, empezando por funcionalidades internas y pruebas sintéticas. Mantener separado “benchmark funcional” de “implementación propia”, con evidencia de procedencia y sin copiar componentes propietarios.

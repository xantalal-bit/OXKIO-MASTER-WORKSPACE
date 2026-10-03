# XATAI Core V2.1: capacidades reales supervisadas

Primer circuito de valor sobre el Mission Engine V2: `company-opportunity(target, sellerProfile)`.

```
SUPERVISOR
├── RESEARCH_COORDINATOR      research-agent (web oficial) · web-research-agent (mismo dominio)
├── DATA_COORDINATOR          memory-agent (opcional) · data-analysis-agent · opportunity-agent
├── COMMUNICATION_COORDINATOR email-agent (Gmail metadatos, opcional) · proposal-agent · communication-agent
└── verifier-agent            verificación independiente de cada tarea y de la misión
→ revisión humana (commercial.handoff, NEEDS_APPROVAL): APROBAR / MODIFICAR / DESCARTAR
```

## Estado honesto de las capacidades

| Capacidad | Estado | Qué hace de verdad |
|---|---|---|
| `research.company` | PARTIAL | GET HTTPS público de la web oficial indicada (SSRF bloqueado, robots.txt, límites). Sin buscador. |
| `research.web` | PARTIAL | Páginas del mismo dominio oficial enlazadas desde la portada. Sin buscador. |
| `web.search` | NOT_IMPLEMENTED | No hay proveedor de búsqueda aprobado ni conectado. |
| `data.analyze`, `opportunity.analyze`, `proposal.compose`, `communication.compose` | AVAILABLE | Código local determinista, sin modelo ni coste externo. |
| `memory.search` | AVAILABLE (opcional) | `MemoryEngine.searchMemory`, si la composición la conecta. |
| `gmail.read` | AVAILABLE (opcional) | Solo metadatos de asunto, solo con un email de contacto dado por una persona. |
| `commercial.handoff` | Puerta humana | Nunca se ejecuta por un agente. |
| `gmail.send`, `gmail.draft` en Gmail | Sin cambios | Envío prohibido; crear el borrador en Gmail sigue pasando por la Approval Queue. |

## Frontera de confianza

`trusted-toolbox.js` obtiene el registrar una única vez y no lo entrega nunca. Los agentes (`company-opportunity-agents.js`) son funciones puras que reciben herramientas acotadas y datos. Antes de registrar evidencia, el toolbox comprueba:

- que cada hecho sea una **cita literal** de una fuente registrada de la misma misión;
- que ninguna cifra aparezca si no la contiene un hecho o el perfil del vendedor;
- que no haya afirmaciones prohibidas, URLs o emails ajenos, contenido marcado como inyección ni secretos;
- que una inferencia no se presente como necesidad observada.

Después liga cada salida por `outputDigest`.

## Prueba real controlada

```
node scripts/xatai-company-opportunity-demo.js --company "Nombre" --website https://www.ejemplo.com/ \
  --profile backend/services/executive-brain/mission-capabilities/seller-profiles/example-erp-automation.json
```

Solo hace lecturas públicas. No contacta, no envía ni publica nada. El perfil incluido es un **ejemplo**: hay que sustituirlo por el perfil real del vendedor.

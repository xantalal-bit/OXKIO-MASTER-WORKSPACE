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
| `research.company` | PARTIAL | GET HTTPS público de la web oficial indicada. Sin buscador. |
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

## Lector web: confinamiento y SSRF

`fetchPage(url, { allowedSite })` aplica las mismas comprobaciones en la primera petición y en cada redirect:

- **Destino:** HTTPS, puerto 443, sin credenciales y dentro del sitio autorizado. El sitio es el host exacto o su gemelo con o sin `www`, nunca un sufijo. Un redirect fuera del sitio da `off_site_redirect` y no se sigue.
- **DNS:** se resuelve una vez por salto y todas las direcciones deben ser públicas. La conexión HTTPS se fija a esa IP validada mediante un `lookup` propio, así que una segunda resolución no puede llevarla a localhost, a una red privada o al servicio de metadatos (DNS rebinding). TLS se sigue verificando contra el nombre de host.
- **robots.txt** (subconjunto de RFC 9309) se comprueba para la URL que realmente se lee, en cada salto y para cada origen:
  - el grupo propio prevalece sobre `*`;
  - gana la regla más larga y, en empate, `Allow`;
  - se admiten `*` y `$`;
  - 4xx significa permitido;
  - 5xx, error de red o un redirect de robots fuera del sitio significan prohibido.

El toolbox vuelve a comprobar el destino final antes de registrar nada.

## Cadena de autoridad

`WEB SOURCE → FACTS → ANALYSIS → OPPORTUNITIES → PROPOSAL → COMMUNICATION → HUMAN REVIEW`

Las etapas posteriores no pueden alterar, ampliar ni inventar el significado certificado por las anteriores. Para garantizarlo, los agentes no escriben ninguna frase que certifique algo: solo seleccionan. Ninguna defensa depende de listas de palabras prohibidas.

| Etapa | El agente entrega (esquema cerrado) | Lo construye `semantic-canon.js` |
|---|---|---|
| Investigación (web, memoria, Gmail) | `{ id, label, excerpt, sourceRef }` por hecho, enlaces del mismo sitio y códigos de incertidumbre | Enunciado del hecho a partir de la etiqueta (lista cerrada) y la cita literal de una fuente registrada |
| Análisis | `factIds`, hechos marcados como sospechosos, contradicciones y códigos | Hechos canónicos reconstruidos desde las etapas anteriores |
| Oportunidades | `{ id, serviceId, level, basisFactIds }` | Necesidad, evidencia, solución, beneficio y preguntas, desde el perfil |
| Propuesta | `selectedOpportunityIds`, `situationFactIds` | Propuesta completa y recomendación (copias exactas) |
| Comunicación | `greeting`, `situationFactIds` (solo hechos públicos de la web) y `selectedOpportunityIds` | Email, mensaje corto, seguimiento y briefing, con plantillas fijas |

Reglas que aplica la capa de confianza:

- **Fundamento de las oportunidades.** Una INFERENCE necesita que cada hecho base cite una `inferenceSignal` del servicio. Una OBSERVED necesita una `explicitNeedSignal`. Ambas señales vienen del perfil, nunca del agente.
- **El análisis no puede omitir.** Debe conservar todos los hechos utilizables, y solo puede apartar los duplicados exactos y los sospechosos. Debe declarar como mínimo las contradicciones que detecta el canon.
- **Listas cerradas.** Los parámetros y las unidades vienen de listas cerradas.
- **Integridad en la revisión.** El paquete de revisión rechaza cualquier hecho cuyo enunciado no coincida con su etiqueta y su cita, o que no sea idéntico en todas las etapas. También rechaza cualquier copia de oportunidad a la que le falte un campo trazado o lo tenga alterado.
- **Señales del perfil.** El campo `signals` del perfil se acepta como nombre antiguo de `inferenceSignals`.

## Procedencia y aislamiento

- **Procedencia canónica.** Cada hecho tiene una procedencia que no se puede cambiar: `PUBLIC_WEB`, `INTERNAL_MEMORY` o `GMAIL`. La asigna la capa de confianza según el tipo de fuente que registró el toolbox; el agente nunca la decide. Cada etapa de investigación emite IDs con su propio prefijo (`cr`, `wr`, `mem`, `gm`).
- **Solo `PUBLIC_WEB` se atribuye a la empresa.**
  - Una oportunidad OBSERVED exige que todos sus hechos base sean `PUBLIC_WEB`.
  - Una oportunidad con base interna queda como INTERNAL: sirve para razonar y para el briefing interno, pero no puede justificar un contacto ni aparecer en un mensaje.
  - Los mensajes solo citan hechos `PUBLIC_WEB`.
- **Aislamiento.** El agente recibe una copia aislada (`structuredClone`, congelada en profundidad solo como defensa añadida). El toolbox valida contra su propio estado: las dependencias parseadas desde los strings de salida, que están ligados por digest, y un registro de cada hecho y oportunidad canónicos que ha emitido. Lo que no coincide byte a byte con algo emitido se rechaza.

## Contradicciones: unidades y ámbito

Solo se comparan cifras de la misma unidad canónica, y solo cuando la equivalencia es fuerte:

- `workforce` = empleados, trabajadores, employees, workers, numberOfEmployees.
- `stores` = tiendas, stores.
- `countries` = países, countries.
- `offices` = oficinas, offices.
- `customers` = clientes, customers.
- `warehouses` = almacenes, warehouses.

Las unidades cuyo significado depende del contexto (establecimientos, centros, sedes, delegaciones, locations, profesionales) nunca se comparan con otras.

No hay contradicción si las dos citas declaran expresamente lugares distintos («en España» frente a «en Francia»; hay algunos alias prudentes de país) o años distintos. Si el ámbito es desconocido, se mantiene la contradicción por prudencia.

## Decisión de contacto

Sin ninguna oportunidad respaldada por hechos (incluidas las que solo se apoyan en cifras contradictorias), el resultado es `DO_NOT_CONTACT_YET`. En ese caso no hay email, mensaje ni seguimiento, solo un briefing interno, y la revisión muestra «NO CONTACTAR TODAVÍA». El adaptador de la Approval Queue no encola nada.

## Prueba real controlada

```
node scripts/xatai-company-opportunity-demo.js --company "Nombre" --website https://www.ejemplo.com/ \
  --profile backend/services/executive-brain/mission-capabilities/seller-profiles/example-erp-automation.json
```

Solo hace lecturas públicas. No contacta, no envía ni publica nada. El perfil incluido es un **ejemplo**: hay que sustituirlo por el perfil real del vendedor.

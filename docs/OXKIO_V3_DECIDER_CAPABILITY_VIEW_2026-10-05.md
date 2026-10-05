# OXKIO V3 — capacidades realmente disponibles para el decisor — evidencia 2026-10-05

## Incidencia

En la validación real del contrato del decisor (PR #31), Luna se ofreció a revisar calendario, correo o documentos aunque no estaban operativos. El decisor y el planner recibían `Object.keys(DEFINITIONS)`: las 9 primitivas en bruto, sin su estado (`mission-runtime.js` y `capability-manager.js`).

## Arquitectura reutilizada (sin registro paralelo)

- `catalogue(handle)` del Capability Manager: la misma verdad que la persona ve al preguntar qué capacidades tiene OXKIO (conexiones, validación de lectura, flujo de conexión por cuenta, capacidades declaradas y puerta humana).
- `learning.degraded()` de Self Repair: el cortacircuitos por capacidad.
- `authorizeEgress` con el descriptor de egress de la conexión: el mismo control que `readSource` aplica antes de buscar.
- Reglas existentes: guardar en memoria solo a petición expresa (`rememberConsent`) y la propuesta de archivos pasa por la ApprovalQueue.
- Tres campos de metadatos en `DEFINITIONS` (el registro existente):
  - `explicitRequest` (memory.remember);
  - `approval` (storage.propose);
  - `sendsRequest` (web.search).

## Semántica

| Estado | Origen | ¿Planificable? |
|---|---|---|
| AVAILABLE_NOW | catálogo AVAILABLE (conectada y con lectura validada, o local) | sí |
| AVAILABLE_WITH_APPROVAL | AVAILABLE y su resultado es una propuesta (`approval`) | sí; el runtime la deja en NEEDS_APPROVAL |
| NEEDS_CONNECTION | catálogo NEEDS_CONNECTION (ausente, caducada o sin validar, con flujo de conexión) | sí; el runtime pide la conexión y la misión espera |
| BLOCKED | `explicitRequest`; puerta humana (`external.write`); el Privacy Gate rechazaría esta petición en esa conexión | no |
| UNAVAILABLE | sin flujo de conexión para la cuenta; declarada sin implementar; degradada por Self Repair | no |

El decisor recibe `[{id, status}]` y una restricción que explica cada estado y recuerda que un estado nunca concede ejecución. El plan se valida solo contra los ids planificables y después pasa igual por `validatePlan`, los huecos de conexión, la cola de aprobación y el Privacy Gate de cada paso. Sin la vista del runtime, al planner no se le ofrece nada.

## Lo que ve hoy el decisor (Cliente Cero, cableado de producción)

- **AVAILABLE_NOW:** memory.search, web.search, research.web, data.analyze.
- **NEEDS_CONNECTION:** calendar.read y gmail.read (adaptador instalado, lectura aún no validada).
- **UNAVAILABLE:** documents.read, storage.propose, recordatorios, Drive, OneDrive, Outlook, PDF/adjuntos.
- **BLOCKED:** memory.remember y external.write.

## Evidencia

- `capability-view.test.js` (7 tests): las cinco categorías, la conexión caducada o sin validar, el Privacy Gate (identificador, DNI, categoría especial), la degradación, solo primitivas existentes como planificables, la vista congelada y sin campos de autoridad, y el planner sin vista que no recibe nada.
- `executive-conversation.test.js` (3 tests por HTTP):
  - el decisor recibe exactamente la vista efectiva anotada, nunca el catálogo en bruto;
  - un plan con una capacidad UNAVAILABLE o BLOCKED se rechaza (`planning_invalid_plan`) sin crear misión;
  - un plan con una capacidad NEEDS_CONNECTION solo pide la conexión, sin leer nada;
  - una petición con un identificador no llega al decisor.
- Regresiones sin cambios: el contrato C1/C2 del decisor, el Privacy Gate y `executionEnabled=false`. La batería Cliente Cero de 20 casos da un resultado idéntico al de d09edee.

## Riesgos y pendientes

- Una conexión sin validar (Cliente Cero: correo y agenda) aparece como NEEDS_CONNECTION aunque el runtime intentaría leerla si se planifica. Es honesto («conecta o valida») y la lectura sigue sus gates, pero el modelo no la ofrecerá como operativa hasta que una lectura la valide.
- Un plan con una capacidad NEEDS_CONNECTION crea una misión que espera conexión. Es el comportamiento existente de los gaps.
- El modelo puede seguir mencionando capacidades no disponibles en su mensaje: la restricción lo prohíbe, pero el validador del mensaje no lo comprueba. Medirlo requiere llamadas reales, no autorizadas aquí.

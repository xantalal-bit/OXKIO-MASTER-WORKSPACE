# OXKIO V3: operación integral supervisada

Base: ef2651ddf7530a3c7c26242625299f75afab9336 (PR #22 fusionado).
Rama: feat/oxkio-v3-integral-supervised-operation.

## Auditoría de brecha V2.1 → contrato V3

V2.1 ya contiene Mission Engine, Agent Registry/Router, Evidence Registry,
Verifier, Sentinel, Privacy Gate, Cost Gate/Controller, contratos de misión y el
canon comercial con procedencia inmutable. No se sustituyen.

La brecha es el enlace entre esas piezas y el usuario autenticado: el chat usa
un circuito fijo y las fuentes privadas familiares no tienen conexiones propias.
La proyección existente bloquea a familiares antes de usar tokens de Cliente Cero.
El OAuth Google actual es de Cliente Cero; no se reutiliza para otro usuario.

El mínimo añadido es una composición que enlaza identidad resuelta, recursos
privados, conexiones y procedimientos acíclicos con el motor existente. La única
extensión del motor es la pausa entre tareas, sin consumir un intento. Su política
A1 y executionEnabled=false permanecen intactas.

| Pieza | Responsabilidad |
| --- | --- |
| scope-session | Membership Resolver existente → handle opaco → comprobación de autoridad en cada operación |
| capability-manager | Primitivas componibles, planes acíclicos, selección de recursos y permisos mínimos |
| mission-runtime | Un motor/evidencias por misión, estados por propietario, cola acotada, cancelación y reanudación |
| chat-gateway / server-composition | Entrada desde Firebase existente, lenguaje sencillo, continuidad de conversación |
| memory-store | MemoryEngine existente con repositorio atómico por propietario y fallo cerrado ante corrupción |
| approval-factory | ApprovalQueue existente, archivo y scope separados por propietario |
| resource-adapters | Clientes read-only en closures trusted; búsqueda y fetch separados |
| adaptive-planner | Proveedor de razonamiento y CostController existentes, con gates de privacidad y presupuesto |

## Autoridad y aislamiento

El cuerpo del chat admite únicamente query, conversationId, action, missionId e
includeDetails. Ningún tenant, token, permiso, conexión, proveedor o planner se
acepta desde él. La identidad procede de req.oxkioIdentity, después del filtro
Firebase existente. Membership Resolver vuelve a comprobarla en cada operación.

Un handle de sesión se valida mediante WeakMap. Claves de recursos codifican
[tenantId, clientId, userId], sin concatenaciones ambiguas. Los archivos usan un
hash de esa tupla; ningún identificador humano se convierte en una ruta.

Misiones, memoria, workflows, conversaciones, colas de aprobación, costes y
telemetría privada pertenecen al propietario completo. Adivinar un ID de misión
ajena produce mission_not_found. Las conexiones verifican tenant, client y user;
se comprueban antes y después de una lectura, incluyendo revocación concurrente.
Viewer puede leer pero no recordar información. Guardar memoria requiere petición
humana explícita; el planner no puede conceder ese permiso.

La capa trusted toma resultados del conector, valida propietario y tamaño, asigna
procedencia y genera evidencia ligada al output exacto. Un agente recibe una copia
profunda congelada y solo puede seleccionar IDs ya emitidos. El canon valida
contra el snapshot original. No puede escribir texto, origen o procedencia.

PUBLIC_DISCOVERY identifica descubrimiento, no evidencia del contenido de una
página. PUBLIC_WEB solo aparece después del fetch. INTERNAL_MEMORY, GMAIL,
CALENDAR e INTERNAL_DOCUMENT permanecen distintos. Los datos privados no pasan
al buscador ni se transforman en comunicación externa. La misión empresarial
invoca exclusivamente el circuito y canon V2.1 originales.

## Composición y autoconversación operativa

Intención → plan de primitivas → conexiones/permisos → consulta → contraste de
fuentes → resultado canónico → verificación independiente → aprendizaje → cierre.

El motor enruta por agentes/coordinadores existentes. Su Sentinel cambia la
estrategia ante fallos y limita hipótesis/reintentos. Las trazas técnicas quedan
fuera de la respuesta normal; includeDetails permite inspección por el propietario.
No hay agentes certificando su propio éxito ni conversaciones indefinidas.

El reconocedor local ofrece una base sin coste, con límites explícitos de vocabulario.
Un planner inyectado puede resolver intenciones nuevas componiendo las mismas
primitivas. El plan es una propuesta no confiable: se rechazan herramientas nuevas,
ciclos, campos de autoridad y escrituras de memoria no solicitadas. Los workflows
verificados se reutilizan únicamente dentro del propietario, sin reutilizar sus
fuentes privadas como conocimiento global.

El adaptador de planner natural reutiliza el proveedor y el CostController. No
lee credenciales ni crea un proveedor. Requiere proveedor ready, precio revisado,
política CONFIDENTIAL permitida y presupuesto aprobado positivo. El presupuesto
por defecto es cero. Cuenta llamadas, tokens y coste conocido por propietario;
reserva antes de llamar. Multi-AI no se activa: no hay evidencia que justifique
multiplicar coste en estos escenarios deterministas.

## Conexiones

Un recurso ausente produce NEEDS_CONNECTION con razón, permiso mínimo, alcance,
límites y cómo autorizar sin contraseña. Install pertenece exclusivamente a la
composición trusted/callback OAuth; nunca al cuerpo del chat. Disconnect invalida
lecturas en vuelo. Resume mantiene el ID, la intención y los permisos originales.

Gmail/Outlook usan la primitiva mail; Google/Microsoft Calendar usan calendar;
Drive/OneDrive/documentos usan storage. Los adaptadores deben aportar su cliente
OAuth ya autorizado para el propietario. Esta implementación no crea tokens,
clientes OAuth familiares, consentimientos reales ni un proveedor de búsqueda.
Los escenarios usan fakes controlados que declaran origin=fixture.

createPublicResearchAdapters usa el fetcher V2.1 para DNS público, HTTPS,
redirecciones, robots y límites. Search descubre URLs, fetch las vuelve a validar
y lee únicamente las fuentes solicitadas. No se usan como contenido los snippets.

## Concurrencia, persistencia y recuperación

Cuatro misiones de propietarios distintos pueden ejecutar simultáneamente. La
admisión serializa misiones de un mismo propietario para evitar carreras de memoria.
Hay límites de cola, por propietario y de registros; exceso produce backpressure.
Prioridades son acotadas, cada fallo queda en su misión. Timeouts y AbortSignal
invalidan resultados tardíos. Un cliente debe respetar AbortSignal para liberar
sus recursos de red; el runtime no acepta su resultado después del deadline.

Pause se aplica entre tareas; una lectura ya iniciada termina sin publicar el
resultado hasta resume. Cancel invalida el resultado y no permite reanudar.

MemoryEngine conserva memoria y registros de misión en un repositorio local
atómico. El estado trusted y las evidencias completadas pueden restaurarse para
reanudar; una ejecución interrumpida no se declara exitosa. Es almacenamiento de
un proceso, no una garantía transaccional multiinstancia. La fábrica del store es
sustituible; PostgreSQL/RLS y despliegue multiinstancia quedan fuera de esta entrega.
Conversaciones se recuperan desde las misiones almacenadas. Conexiones se deben
restablecer desde autorización trusted después de un reinicio.

## Gates y piloto

La integración se alcanza por POST /api/executive/chat tras la autenticación
existente. OXKIO_V3_ENABLED no se activa en esta entrega. Al habilitarla se requiere
OXKIO_V3_MEMORY_ROOT absoluto y dedicado. No se cambia la allowlist familiar ni
se abre un endpoint nuevo. La rama contiene código, no un despliegue.

Las facturas producen propuesta de organización y una entrada en la ApprovalQueue
por usuario, sin executionPayload. La estructura se decide humanamente. No se
almacenan adjuntos en servicios externos ni se crean carpetas. No hay envío,
publicación, aprobación automática o bypass de gates.

Piloto: arquitectura y escenarios locales verificables para ~10 personas. La
prueba real necesita decisión humana de activación/despliegue, conexiones privadas
por usuario y un entorno revisado. No se declara listo para usuarios reales antes
de esas condiciones. No se afirma integración real de Outlook/Drive/OneDrive.

## Evidencia reproducible

node --test backend/services/supervised-operation/*.test.js
node --test backend/services/executive-brain/mission-capabilities/provenance-regressions.test.js
node --test

Las pruebas específicas usan motor/verificador/Sentinel reales, MemoryEngine y
ApprovalQueue reales en temporales, y frontera HTTP real sobre streams de petición.
Solo las fuentes externas y el modelo opcional son fixtures. A–J están cubiertos:
agenda, correo, memoria, investigación sin URL, facturas, empresa V2.1, diez usuarios
concurrentes, acceso cruzado, autorrecuperación y resolución de capability gaps.

También se ejercitan revocación, permisos, IDs falsificados, mutación de referencias,
procedencia, corrupción, reinicio, cancelación, pausas, backpressure, timeouts,
fallo de proveedor/verificación, aprendizaje y costes aislados. Todos los archivos
temporales se eliminan al finalizar.

Limitaciones adicionales: el análisis local es conservador y no equivale a un
asesor general; no extrae adjuntos/PDF ni metadatos fiscales completos. No hay
recordatorios programados, escrituras externas, migraciones, autorreparación de
código en producción ni CAS entre procesos. Los costes reales externos sin usage
siguen desconocidos. La telemetría agregada solo cuenta eventos, sin mensajes,
IDs de usuario, documentos, correo ni contenido privado.

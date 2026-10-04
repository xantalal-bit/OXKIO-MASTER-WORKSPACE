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
| adaptive-planner | Proveedor de razonamiento existente, Privacy Gate y presupuesto diario aprobado (0 por defecto) |
| intention-interpreter | Lenguaje natural → objetivo, contexto, restricciones, capacidades, plan y resultado explícito |
| egress-privacy | Clasificación de todo texto que sale de OXKIO y enrutado por el Privacy Gate existente |
| cost-ledger | Contabilidad por propietario/misión/modelo/herramienta con cost-policy y catálogo revisado |
| self-repair | Diagnóstico, clase de fallo, aprendizaje por propietario y cortacircuitos por capacidad |
| integrity | Sello HMAC de cada registro persistido; la clave la inyecta la composición |

## Autoridad y aislamiento

El cuerpo del chat admite únicamente query, conversationId, action, missionId e
includeDetails, más los objetos calendar/gmail que ya envía el cliente web, que se
ignoran (nunca son identidad ni conexión). Ningún tenant, token, permiso, conexión,
proveedor o planner se acepta desde él. Sin conversationId cada usuario tiene una
conversación por defecto, siempre ligada a su uid, para que "continúa" funcione. La identidad procede de req.oxkioIdentity, después del filtro
Firebase existente. Membership Resolver vuelve a comprobarla en cada operación.

Un handle de sesión se valida mediante WeakMap. Claves de recursos codifican
[tenantId, clientId, userId], sin concatenaciones ambiguas. Los archivos usan un
hash de esa tupla; ningún identificador humano se convierte en una ruta.

Misiones, memoria, workflows, conversaciones, colas de aprobación, costes y
telemetría privada pertenecen al propietario completo. Adivinar un ID de misión
ajena produce mission_not_found. Las conexiones verifican tenant, client y user;
se comprueban antes y después de una lectura, incluyendo revocación concurrente.
Viewer puede leer pero no recordar información. Guardar memoria requiere petición
humana explícita; el planner no puede conceder ese permiso. El rol owner que recibe
un familiar significa propietario de su propia partición [clientId, clientId, uid]:
V3 no expone ninguna administración de tenant ni global a ningún rol.

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

El intérprete local convierte la petición en objetivo, contexto, restricciones,
capacidades, plan y un resultado explícito: CAN_EXECUTE, NEEDS_INFORMATION,
NEEDS_CONNECTION, NEEDS_CAPABILITY, NEEDS_APPROVAL o BLOCKED. Cada capacidad declara
el vocabulario de su dominio; el plan se compone, no se busca una frase. Lo que V3
no implementa (Drive, OneDrive, Outlook, PDF/adjuntos, recordatorios) está declarado
y produce NEEDS_CAPABILITY, nunca una conjetura. Escrituras externas producen
NEEDS_APPROVAL; pagos, borrados, credenciales y despliegues, BLOCKED.
Solo cuando el intérprete no reconoce ninguna capacidad participa el planner, que
compone las mismas primitivas; cualquier fallo o salida inválida del planner vuelve
al resultado determinista seguro. El plan es una propuesta no confiable: se rechazan herramientas nuevas,
ciclos, campos de autoridad y escrituras de memoria no solicitadas. Los workflows
verificados se reutilizan únicamente dentro del propietario, sin reutilizar sus
fuentes privadas como conocimiento global.

El adaptador de planner natural reutiliza el proveedor de razonamiento existente.
No usa el CostController de Executive Chat (canon: un único propietario funcional),
no lee credenciales ni crea un proveedor. Requiere proveedor ready, Privacy Gate
(la petición se trata al menos como CONFIDENTIAL), precio revisado en el catálogo y
presupuesto diario aprobado positivo (OXKIO_V3_PLANNER_DAILY_BUDGET_USD, 0 por
defecto). El cost-ledger reserva antes de llamar y liquida con el uso real, en el
store sellado del propietario: un reinicio no reabre el presupuesto y una reserva
sin liquidar sigue contando. Registra coste por propietario, misión, modelo y
llamadas por herramienta (sin precio inventado). Multi-AI no se activa: no hay evidencia que justifique
multiplicar coste en estos escenarios deterministas.

## Conexiones

Un recurso ausente produce NEEDS_CONNECTION con razón, permiso mínimo, alcance,
límites y cómo autorizar sin contraseña; si la cuenta no tiene flujo de conexión
disponible, lo dice. Una autorización caducada, revocada o insuficiente durante la
misión no se reintenta a ciegas: la tarea espera, se pide reconectar y la misión
continúa desde ese punto sin repetir los pasos ya verificados. Install pertenece exclusivamente a la
composición trusted/callback OAuth; nunca al cuerpo del chat. Disconnect invalida
lecturas en vuelo. Resume mantiene el ID, la intención y los permisos originales.

Gmail y Calendar reutilizan los lectores private-context existentes (los mismos
del dashboard de Executive Chat). Hoy solo existen para la autorización Google de
Cliente Cero; para cualquier otro usuario V3 responde NEEDS_CONNECTION indicando
que la conexión aún no está disponible para su cuenta. Drive/OneDrive/Outlook,
PDF/adjuntos y recordatorios no están implementados: contrato de adaptador listo
(read → items, scopes, origin, egress), sin integración. Esta implementación no
crea tokens, clientes OAuth familiares, consentimientos ni proveedor de búsqueda.

Todo texto que sale de OXKIO pasa por egress-privacy y el Privacy Gate: SECRET
nunca sale; identificadores (email, IBAN, DNI/NIE, teléfono/tarjeta, URL con
parámetros) o categorías especiales ligadas a una persona son CONFIDENTIAL y solo
salen hacia un proveedor aprobado para ello; lo demás es PUBLIC según política. La
búsqueda envía solo los términos del tema, nunca contenido de correo, memoria o
documentos; el fetch solo lee enlaces descubiertos por la búsqueda pública.

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
atómico, compactado (una fila por registro) y sellado: cada fila lleva un HMAC sobre
[propietario, tipo, id, valor] con OXKIO_V3_INTEGRITY_KEY. Una fila editada, movida
a otro propietario o intercambiada falla cerrada (stored_integrity_invalid) y nunca
se restaura como evidencia. No detecta la sustitución por una copia anterior
íntegra del mismo propietario (rollback); queda como deuda. El estado trusted y las evidencias completadas pueden restaurarse para
reanudar; una ejecución interrumpida no se declara exitosa. Es almacenamiento de
un proceso, no una garantía transaccional multiinstancia. La fábrica del store es
sustituible; PostgreSQL/RLS y despliegue multiinstancia quedan fuera de esta entrega.
Conversaciones se recuperan desde las misiones almacenadas. Conexiones se deben
restablecer desde autorización trusted después de un reinicio.

## Gates y piloto

La integración se alcanza por POST /api/executive/chat tras la autenticación
existente, solo para los uid de OXKIO_V3_COHORT_UIDS; el resto de identidades,
Cliente Cero incluido salvo que se liste, siguen en el Executive Chat existente.
Rollback: quitar el uid (o el flag) y reiniciar; los datos V3 quedan sellados en
su raíz. OXKIO_V3_ENABLED no se activa en esta entrega. Al habilitarla se requieren
OXKIO_V3_MEMORY_ROOT absoluto y dedicado y OXKIO_V3_INTEGRITY_KEY (≥32 bytes,
secreto registrado; sin ella V3 no se compone y todo sigue en el chat existente). No se cambia la allowlist familiar ni
se abre un endpoint nuevo. La rama contiene código, no un despliegue.
Custodia de la clave (04/10/2026): OXKIO_V3_INTEGRITY_KEY vive solo en Secret
Manager (oxkio-runtime-prod), versión 1 fijada. Start-Oxkio.ps1 la carga en
Process únicamente con OXKIO_V3_ENABLED=true y falla cerrado si no la obtiene; en
Cloud Run se referenciará con secretKeyRef key "1". Nunca en disco, .env, logs ni
repositorio. Rotar = migración deliberada (verificar con la clave vieja y re-sellar
con la nueva); una clave distinta nunca abre registros antiguos (stored_integrity_invalid).

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

Autorreparación gobernada: detectar → diagnosticar (código saneado) → clasificar
(conexión, seguridad, privacidad, timeout, salida inválida, proveedor) → cambiar
estrategia y reintentar solo lo reintentable (el ámbito reducido limita resultados)
→ verificar → registrar aprendizaje por propietario y capacidad (solo códigos) →
continuar. Si una capacidad falla de forma consecutiva entre misiones, se abre un
cortacircuitos (CAPABILITY_GAP) hasta un enfriamiento; nada modifica código,
credenciales ni autoridad.

audit-regressions.test.js reproduce cada hallazgo de la auditoría del 03/10/2026.

Limitaciones adicionales: el análisis local es conservador y no equivale a un
asesor general; no extrae adjuntos/PDF ni metadatos fiscales completos. No hay
recordatorios programados, escrituras externas, migraciones, autorreparación de
código en producción ni CAS entre procesos. Los costes reales externos sin usage
siguen desconocidos. La telemetría agregada solo cuenta eventos, sin mensajes,
IDs de usuario, documentos, correo ni contenido privado.

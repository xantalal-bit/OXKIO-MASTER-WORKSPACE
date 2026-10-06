# OXKIO V3 — continuidad de misión tras reconexión y cambio de conversación — evidencia 2026-10-06

## Misión real que lo origina

A las 19:36 del 06/10/2026, con la PR #35 ya activa, Cliente Cero escribió: «Organízame lo que tengo pendiente y dime qué debería hacer primero hoy.»

- Luna planificó memoria + agenda + correo + análisis.
- La memoria estaba vacía. La agenda devolvió `connection_expired`.
- La misión `mission-74fc1d0c…` quedó en NEEDS_CONNECTION con la promesa «di «continúa»».

## Causa

- «Conectar Google» saca la página entera hacia Google (`app/index.html:1097`).
- La página guarda el `conversationId` solo en memoria (`index.html:724-734`), así que al volver se crea otro.
- El gateway localiza la misión por esa conversación: el mapa `latest`, en memoria, y el registro `conversation`, ambos indexados por `conversationId`.

Por eso, en la conversación nueva «continúa» no encontraba la misión. Además, la conexión caducada solo se reemplaza al reanudar, así que repetir la orden volvía a dar «caducado». Lo reproduje antes de corregirlo con la composición de producción y conexiones fixture.

## Auditoría

1. **Cómo se localiza hoy la misión:**
   - el gateway marca `resuming` solo si `latest` tiene esa conversación y el texto es una continuación;
   - el runtime (`start`) reanuda `stored.missionId` del registro de **esa** conversación si su estado vivo es reanudable;
   - `action=resume` usa `body.missionId` o `latest`.
2. **Qué índices hay:** `store.list(handle,'mission')` del almacén sellado. Usa un fichero por propietario, con la clave `[tenantId, clientId, userId]`, y cada fila sellada con su propietario. No hace falta ningún índice nuevo.
3. **Qué estados son reanudables:** los ya definidos en `start`, que son NEEDS_CONNECTION, WAITING_RESOURCE y PAUSED.
4. **Lo que nunca es candidato:** NEEDS_INFORMATION (incluido `objective_unmet`), COMPLETED, CANCELLED, FAILED y BLOCKED.

## Cambio mínimo (gateway + runtime, sin sistemas nuevos)

### Runtime: `resumeTarget(handle, conversationId, text)`

Solo actúa cuando llega una continuación inequívoca («continúa», «sigue», «reanuda», «reinténtalo», «ya está conectado», «ya lo he conectado») en una conversación **sin** misión reanudable propia. Entonces busca en las misiones del mismo propietario:

- **0 candidatas:** el camino de siempre; no se inventa ninguna misión.
- **1 candidata:** se reanuda esa misma misión.
- **Más de 1:** se presenta una lista breve (la intención de cada una y qué espera) y se pide el número. No se ejecuta nada hasta la elección, y la recencia nunca elige.

La respuesta a la lista («2», «la segunda»…) solo se acepta en esa conversación, mientras dure su contexto, y solo para misiones que sigan en espera. «Hazlo», «listo» o «vale» nunca reanudan una misión de otra conversación.

### Gateway

- Si el runtime devuelve una misión, `resuming` pasa a ser verdadero, así que la conexión caducada se reemplaza por una nueva (sin verificar hasta su primera lectura), igual que en la reanudación de siempre.
- Llama al `resume` existente.
- Antepone «Retomo la tarea «…» desde donde la dejamos.». Si la conexión funciona lo dice el estado real; nunca se promete.

### `recordTurn`

La conversación nueva guarda el objetivo de la misión retomada, con la privacidad de ese objetivo, en lugar del «continúa» suelto.

Sin cambios: el intérprete, el decisor, el verificador, el criterio de objetivo cumplido, la puerta de privacidad, OAuth, los adaptadores y `executionEnabled=false`.

## Persistir conversationId en el navegador (auditado, no implementado)

Guardar `conversationId` en `sessionStorage` sería trivial y sobreviviría al viaje de ida y vuelta a Google en la misma pestaña. No lo implemento por tres razones:

- La aplicación no usa almacenamiento del navegador en ningún sitio, y el comentario de `index.html` lo descarta a propósito.
- No cubriría volver en otra pestaña ni después de cerrar el navegador.
- La recuperación por la misión guardada ya resuelve el problema.

La fuente canónica es la misión persistida, no la pestaña.

## Evidencia determinista

`cross-conversation-resume.test.js` tiene 6 tests. Cinco fallan en main (cfe872a); el de 0 candidatas pasa en los dos casos porque protege el comportamiento existente.

- **Caso real:** agenda caducada → NEEDS_CONNECTION → se reconecta → «continúa» en una conversación **nueva**. Resultado:
  - el **mismo** `missionId`;
  - 0 llamadas nuevas al modelo;
  - lee la agenda y el correo, verifica y termina COMPLETED;
  - «Retomo la tarea «Organízame…» desde donde la dejamos.»;
  - el material privado nunca llega al proveedor y `executionEnabled=false`.
- **Misma conversación:** el camino de siempre, sin el aviso «Retomo».
- **Conexión todavía caducada:** se retoma la misma misión, que vuelve a esperar sin lecturas y sin prometer que la conexión funciona.
- **0 candidatas:** no se crea misión; se aclara como antes.
- **2 candidatas:** lista sin códigos, sin ids y sin datos de resultados; nada se reanuda antes de elegir. «la segunda» reanuda solo esa misión, sin llamada al modelo, y la otra sigue en espera.
- **Aislamiento:** otro usuario del mismo tenant y otro tenant no ven la misión, y `resume` les devuelve `mission_not_found`.
- **Estados:** NEEDS_INFORMATION (`objective_unmet`), COMPLETED y CANCELLED no son candidatos. «hazlo», «listo», «vale» y «sí» no reanudan nada.

Resultados:

- V3 + executive-brain: 511/511.
- Suite completa secuencial: 1826 tests, 1810 PASS, 0 FAIL, 16 SKIP (los mismos).
- Baterías Cliente Cero (`cliente-cero` y `semantic`): idénticas a main.
- Escaneo de secretos por patrones del diff: 0 coincidencias.
- Sin llamadas reales a Luna: es un cambio de continuidad, no de razonamiento, y se demuestra entero con fixtures.

## Riesgos

- La lista de candidatas muestra la intención literal de cada misión, recortada a 90 caracteres. Es texto de la propia persona y no sale de su partición, pero se ve en la pantalla.
- Una persona con más de 5 misiones en espera solo ve las 5 más recientes para elegir. Lo más reciente solo ordena la lista; nunca decide.
- La elección vale mientras dura el contexto de la conversación (20 minutos). Después hay que volver a decir «continúa».
- La misión real `mission-74fc1d0c…` es la única en espera del almacén de Cliente Cero. Al activar esta PR, «continúa» después de reconectar la retomará.

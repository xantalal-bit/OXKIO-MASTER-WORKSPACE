# OXKIO V3 — P1 análisis privado local — evidencia 2026-10-06

## Misión real que lo origina

A las 20:02 del 06/10/2026, José escribió «continúa» y se retomó la misión «Organízame lo que tengo pendiente y dime qué debería hacer primero hoy.». Leyó agenda (1 evento) y correo (5 mensajes). La puerta de privacidad bloqueó el análisis, porque el contenido era CONFIDENTIAL y no hay proveedor autorizado. `data.analyze` dejó pasar los elementos sin analizar y la misión terminó COMPLETED con `objectiveSatisfied:true`, con una lista sin priorizar llena de caracteres invisibles.

## Hallazgo previo a P1: Gmail perdía sus señales en producción

`buildGmailPrivateContext` vuelve a normalizar los mensajes que el lector ya había normalizado. En ese segundo paso ya no hay `labelIds`, así que `unread` e `important` salían siempre `false`.

Lo reproduje en main 11b76f2 con un cliente de Gmail falso: el lector da `unread:true` e `important:true`, y el contexto privado da `false/false`. Afecta también al Executive Chat V2, cuya priorización (`buildPrioritizationAnswer`) nunca recibía un correo urgente.

**Corrección:** la normalización es idempotente. Sin `labelIds`, conserva las señales que el mensaje ya trae. **Esto corrige el comportamiento de V2**: a partir de ahora ve las señales reales. Va más allá del «solo campos aditivos» de P1.8 y está señalado para la auditoría.

## Cambio

### Reutilización

- `classifyMailPriority`, la función del Executive Chat, no cambia.
- A su lado, en `mail-priority.js`, se añade `classifyMailSignals`. Cuenta la estrella como importancia y trata las categorías promociones y social como ruido, salvo que el mensaje tenga estrella. Un correo solo no leído sigue en «revisar», nunca «urgente».
- `extractSenderName` se mueve sin cambios desde el orquestador de V2 a `mail-priority.js`, para reutilizarlo sin cargar V2.

### Señales (P1.1)

- `normalizeGmailMessage` añade `starred` y `category` (Gmail ya devuelve las etiquetas `CATEGORY_*` en la llamada de metadatos; no hace falta ningún permiso nuevo).
- Los adaptadores de V3 entregan el texto más señales cerradas:
  - correo: no leído, importante, destacado, categoría y fecha;
  - agenda: inicio y si dura todo el día.
- `validateItems` conserva solo esa lista cerrada, y únicamente para la fuente a la que pertenece: Gmail o Calendar, nunca páginas públicas. La fecha se normaliza; una categoría desconocida o un inicio inválido se descartan.
- Todo sigue siendo CONFIDENTIAL y queda sellado bajo su propietario.

### Limpieza (P1.2)

- Se eliminan los caracteres invisibles de formato (`\p{Cf}`, U+034F) y se normalizan los espacios. Las letras, los acentos y los emoji se conservan.
- El remitente aparece por su nombre, sin dirección.

### Análisis local (P1.3)

`local-analysis.js` se ejecuta solo cuando la puerta de privacidad bloquea el contenido y hay señales de correo o de agenda.

Orden:
1. Correos urgentes (importante, o con estrella, y sin leer).
2. Eventos con hora de hoy que todavía no han pasado.
3. Correos importantes o con estrella.
4. Correos sin leer.

Clasificación del resto:
- **Contexto:** eventos de todo el día de hoy, de mañana y de los próximos días.
- **Ruido:** promociones y redes sociales.
- **Informativos:** correos ya leídos.
- **Notas:** elementos sin señales (la memoria).

La salida solo contiene ids de elementos y códigos fijos, nunca texto. `firstAction` es la primera prioridad, o `null` si no hay ninguna accionable.

### Respuesta (P1.4)

Se construye a partir de los elementos citados y de los códigos fijos: agenda de hoy, mañana, próximos días, primera acción y su motivo, después, ruido, informativos y notas. El pie dice: «Lo he analizado aquí, sin enviar tus datos fuera de OXKIO».

### Verificación (P1.5)

`verifyLocalAnalysis` comprueba que el análisis tenga exactamente las claves y los códigos permitidos, que cada id citado exista en la entrada y se cite una sola vez, y que `firstAction` sea la primera prioridad o `null` sin prioridades.

El resultado se vuelve a verificar contra los elementos que finalmente se guardan. La traza registra `LOCAL_ANALYSIS` con `verified`.

### Certificación (P1.6 y P1.7)

Si `data.analyze` se omitió (por privacidad, porque fallaron los recursos o porque el resultado no era verificable) y no hay un análisis local verificado:

- el estado es `NEEDS_CAPABILITY`, un resultado de la arquitectura existente;
- el diagnóstico es `analysis_unavailable`;
- se muestra un resultado parcial («…no doy la tarea por terminada»);
- se invalida el workflow existente y no se aprende ninguno;
- la misión queda cerrada para la reanudación.

## Tests

`private-local-analysis.test.js` tiene 8 tests y cubre los 20 casos pedidos, incluido el contraste con la misión real:

- cumpleaños mañana → «Mañana: ELENA - Cumpleaños.», nunca como primera acción;
- 2 notificaciones de LinkedIn y 2 promociones (una de ellas importante y sin leer) → «Otros 4 mensajes … no los pondría por delante»;
- un aviso ya leído → informativo;
- la gestoría, importante y sin leer → «Primero revisaría el correo de Gestoría Ejemplo («Modelo 303…»), porque está marcado como importante y todavía no lo has leído.»;
- si nada es accionable → «No veo nada en lo que he consultado que pida actuar primero hoy.»

**Tests existentes ajustados al contrato nuevo.** Ninguno cambia lo que protege:

- `gmail-private-provider.test.js` (V2): la lista blanca de claves incluye `starred` y `category`.
- Cuatro tests de V3 esperaban COMPLETED con los elementos sin analizar, que es justo el defecto: tres por privacidad y uno por fallo del proveedor. Ahora esperan `NEEDS_CAPABILITY` con `analysis_unavailable`.
- En tres ficheros de continuidad, las fixtures de correo y agenda emiten señales como los adaptadores de producción, con fechas relativas al día actual.

**Resultados:**

- Suites de V3, executive-brain, private-context, dashboard, executive y Executive Chat: 738/738.
- Suite completa secuencial: 1834 tests, 1818 PASS, 0 FAIL, 16 SKIP (los mismos).
- Baterías Cliente Cero: idénticas a main.
- Escaneo de secretos por patrones: 0 coincidencias.
- 0 llamadas a modelos y 0 OAuth. Coste: 0 USD.

## Riesgos

- La calidad depende de las señales de Google: «importante» es su heurística, y las categorías solo existen si están activas las pestañas de Gmail.
- El lector sigue trayendo los 5 últimos correos de la bandeja de entrada (P2). Con una bandeja sin pendientes reales, la respuesta correcta es «no veo nada accionable».
- La corrección de idempotencia cambia lo que ve el Executive Chat V2: ahora sí verá correos urgentes. Es una corrección, pero cambia su comportamiento.
- El remitente y el asunto se recuperan del texto del elemento (formato «remitente — asunto — extracto»). Un asunto que contenga « — » se mostraría recortado.

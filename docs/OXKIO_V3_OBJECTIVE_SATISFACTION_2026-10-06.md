# OXKIO V3 — PASS técnico ≠ objetivo cumplido — evidencia 2026-10-06

## Misión real que lo origina

El 06/10/2026 a las 18:52, Cliente Cero escribió en `app/index.html`: «Organízame lo que tengo pendiente y dime qué debería hacer primero hoy.» La petición se envió a `POST /api/executive/chat` y la atendió V3. Ocurrió lo siguiente:

- Luna (1 llamada, 0,000395 USD) planificó solo `memory.search`, la única fuente que se podía usar en ese momento.
- La memoria estaba vacía (no había ningún registro `memory`), así que la lectura devolvió `items: []`.
- El verificador técnico dio 8/8 PASS y la misión terminó COMPLETED.
- El gateway respondió «No he encontrado resultados en tus fuentes.»
- Se guardó un workflow reutilizable [memory.search] para esa misma frase.
- Gmail y Calendar estaban en la vista del decisor como NEEDS_CONNECTION y planificables, pero no se usaron.

## Causa raíz confirmada

1. **Cierre:** `mission-runtime.run` marca COMPLETED cuando el motor da PASS. `missionVerdict` exige evidencia técnica por tarea, no que el objetivo esté satisfecho, y nada distinguía «la fuente no tiene datos» de «tarea resuelta».
   - Precisión: el `satisfied:false` del contrato persistido es un campo estático que nunca se recalcula. También vale `false` en las 3 misiones de investigación pública que sí resolvieron su objetivo, así que no es una señal calculada.
2. **Aprendizaje:** el workflow se guardaba en cualquier cierre COMPLETED. Repetir la frase exacta habría reutilizado [memory.search] sin pasar por el decisor.
3. **Selección:** el contrato del decisor no decía qué fuentes requiere un objetivo sobre los asuntos actuales de la persona.
4. **Experiencia de usuario:** el texto fijo decía «tus fuentes» cuando solo se había consultado una, y además vacía.

## Cambio mínimo (reutiliza V3; sin nuevos verificadores, motores ni planificadores)

- `mission-runtime.js`: si la verificación técnica da PASS pero el último paso es un análisis (`DERIVED`) que no recibió material, y quedan fuentes personales planificables sin consultar según `decisionView`, entonces:
  - la misión no se cierra: queda en `NEEDS_INFORMATION`, con `diagnosis.class = 'objective_unmet'`;
  - la lectura vacía se conserva como evidencia;
  - no se aprende ningún workflow;
  - si existía uno para esa frase, se marca `objectiveSatisfied:false` sin borrarlo;
  - la misión no se puede reanudar como si estuviera en espera (`terminal_mission`).

  Una consulta que no encuentra nada sigue siendo una respuesta válida y termina COMPLETED: «¿Tengo correos de X?» con 0 resultados.
- Workflows: solo se reutilizan los marcados con `objectiveSatisfied:true`. Los históricos sin esa marca, como el de la misión real, y los invalidados vuelven a pasar por el decisor.
- `adaptive-planner.js`: se añade una regla general. Cuando el objetivo necesita los asuntos actuales de la persona (lo pendiente, urgente o con plazo, sus prioridades, qué hacer primero), se planifica cada fuente personal donde pueda estar esa información, tanto AVAILABLE_NOW como NEEDS_CONNECTION, más el análisis; no se limita a la única fuente utilizable ahora. Los consejos, ideas, métodos y plantillas no necesitan fuentes.
- `chat-gateway.js`:
  - si el objetivo no se cumplió, el mensaje dice qué se comprobó, dónde puede estar la información (etiquetas de la vista de capacidades, sin ids ni estados) y que no se da la tarea por terminada;
  - una consulta vacía nombra la fuente consultada.

Lo que no cambia: la autoridad, las conexiones y la puerta de privacidad siguen siendo deterministas, y `executionEnabled=false`.

## Evidencia determinista

`objective-satisfaction.test.js` tiene 7 tests. Cinco fallan sin el cambio; los otros dos protegen la continuidad y los consejos sin fuentes, que ya funcionaban:

- contrato: la regla general existe y no contiene la frase de la persona;
- análisis sin material con agenda y correo pendientes: NEEDS_INFORMATION, mensaje natural sin códigos, 1 sola llamada, 0 lecturas, `executionEnabled=false`, y no se puede reanudar;
- una misión que no cumplió su objetivo no se reutiliza: la misma petición vuelve al decisor;
- consulta vacía de correo: COMPLETED, «He consultado tu correo y no he encontrado resultados.», y se reutiliza; un análisis con material termina COMPLETED sin enviar el correo privado al proveedor;
- 5 paráfrasis de objetivos ejecutivos: misión esperando conexión de agenda y correo; tras «Ya lo he conectado», la misma misión termina COMPLETED sin otra llamada;
- consejos (ideas, explicar, plantilla): sin misión y sin lecturas;
- el workflow histórico sin marca (con la forma del que dejó la misión real) no se reutiliza y queda marcado; uno satisfecho que después no cumple su objetivo se invalida conservando su `missionId`.

Ajuste en `mission-runtime.test.js`: el test de composición dinámica analizaba una memoria vacía y esperaba COMPLETED, que es justo el falso cierre que se corrige. Ahora siembra una nota antes y conserva su propósito.

Suites:

- V3 + executive-brain: 504/504.
- Completa secuencial: 1819 tests, 1803 PASS, 0 FAIL, 16 SKIP (los mismos 16 de la PR #34).
- Baterías Cliente Cero (`cliente-cero` y `semantic`) en main y en la rama: solo cambia un texto. La consulta explícita de una memoria vacía sigue terminando COMPLETED y ahora dice «He consultado tu memoria y no he encontrado resultados.»
- Escaneo de secretos por patrones del diff: 0 coincidencias.

## Validación real (4 llamadas, rama d49adc4, 0,0017970 USD)

Cada petición se ejecutó en su propia composición, con memoria vacía y sin conexiones. Si Luna planificaba, se activaban conexiones fixture (sin OAuth ni datos reales) y se reanudaba con «Ya lo he conectado».

| Petición (paráfrasis nueva) | Luna | Resultado |
|---|---|---|
| Repasa mis temas abiertos y dime cuál debería atacar antes. | `plan`: memoria + agenda + correo + análisis | Misión esperando conexión → reanudada sin llamada → COMPLETED; workflow `objectiveSatisfied:true` |
| ¿Qué me queda por cerrar esta semana? | ídem | ídem |
| Ponme en orden lo que tengo entre manos para mañana. | ídem | ídem |
| Dame un método sencillo para decidir qué hacer primero cada mañana. | `answer` | Sin misión, sin lecturas |

No hubo códigos internos en ninguna respuesta. Al reanudar, el análisis se omitió por privacidad: es contenido CONFIDENTIAL sin proveedor autorizado, se listan los elementos y no se hace ninguna llamada.

## Riesgos restantes

- La salvaguarda del runtime actúa solo cuando el plan incluye un análisis. Si Luna volviera a planificar solo `memory.search`, sin análisis, la misión cerraría como consulta vacía, aunque ahora nombrando la fuente. En 4 de 4 llamadas reales planificó bien, pero son pocas muestras para medir la frecuencia.
- Una misión con el objetivo sin cumplir no es reanudable: tras conectar, hay que pedirlo de nuevo, y entonces el decisor planificará con las fuentes ya conectadas.
- Sigue sin haber análisis local de datos CONFIDENTIAL: se listan los elementos y no se priorizan. Queda fuera de alcance.

## Addendum (06/10/2026): auditoría de Xatai, dos huecos cerrados

Las secciones anteriores describen la primera versión (d49adc4). Este addendum la sustituye en dos puntos:

1. Una certificación de objetivo que dependía de que Luna incluyera `data.analyze`.
2. Una misión sin el objetivo cumplido que obligaba a repetir la orden.

### Auditoría de señales deterministas

El runtime conserva la intención, el plan, la vista de capacidades y la lectura del intérprete determinista. **No existe una señal determinista completa sobre la naturaleza del objetivo** («consulta» frente a «organizar»): con el plan [memory.search], las dos peticiones son idénticas para el runtime. Ampliar el vocabulario del intérprete habría sido una heurística frágil.

Sí existe una señal determinista del **alcance**: si la persona delimitó las fuentes nombrándolas («mi memoria», «correo», «agenda»…), lo detecta el intérprete canónico, no un modelo.

### Garantía determinista

- Un resultado vacío solo responde el objetivo dentro del alcance que la persona delimitó y que se consultó entero.
- Si el alcance lo infirió un modelo, un resultado vacío **nunca** certifica el objetivo mientras queden fuentes personales planificables sin consultar, sea cual sea el plan que eligiera el modelo.
- Si el fallo es por exceso de prudencia, el resultado es una pregunta o una espera, nunca un COMPLETED falso.

### Reanudación sin repetir la orden

Las fuentes necesarias las deciden:

- las propias palabras de la persona (las fuentes nombradas que falten se añaden sin llamar al modelo), o
- **una sola vez**, el decisor existente, al que se le da la evidencia: las etiquetas de lo consultado, nunca su contenido.

La **misma** misión se amplía con esos pasos (`validatePlan`) y su estado del motor se vuelve a planificar. Después pasa por los `gaps` existentes hasta NEEDS_CONNECTION, solicita únicamente esas conexiones y se reanuda con «continúa». Las lecturas ya hechas se repiten, porque son locales y deterministas.

NEEDS_INFORMATION queda para lo que solo la persona puede aportar: la pregunta del decisor, o «dime dónde puede estar esa información» si nadie pudo decidirlo.

### Tests

`objective-satisfaction.test.js` tiene 8 tests. Usa un decisor fixture que **reproduce el fallo observado**, planificando solo memoria. Los 5 tests de los huecos fallan con la versión d49adc4.

Cinco tests anteriores esperaban COMPLETED sobre una memoria vacía con alcance inferido. Ahora siembran la memoria que consultan y conservan su propósito (presupuesto, precios, reutilización, memoria local).

Resultados:

- V3 + executive-brain: 505/505.
- Suite completa secuencial: 1820 tests, 1804 PASS, 0 FAIL, 16 SKIP.
- Baterías: solo cambia el texto de la consulta vacía de memoria.
- Escaneo por patrones: 0 coincidencias.

### Validación real (3 llamadas, rama 62559a9, 0,0014220 USD)

| Petición | Luna | Resultado |
|---|---|---|
| Mira qué asuntos tengo abiertos y dime por dónde empiezo. | `plan`: memoria + agenda + correo + análisis | NEEDS_CONNECTION con agenda y correo → reanudada sin llamada → COMPLETED; workflow `objectiveSatisfied:true` |
| ¿Hay algo en mi correo de la comunidad de vecinos? (correo conectado y vacío) | `plan`: correo + memoria + análisis | COMPLETED «He consultado tu correo y tu memoria y no he encontrado resultados.»; sin replanificación |
| ¿Qué técnica me recomiendas para no procrastinar con lo importante? | `answer` | Sin misión ni lecturas |

Luna no cometió el fallo en ninguna de las 7 llamadas reales de hoy. El camino de corrección (replanificar o NEEDS_INFORMATION) solo está probado con tests deterministas.

### Riesgos restantes

- Si la persona no nombra la fuente, una consulta simple que no encuentra nada («¿me ha escrito la gestoría?») cuesta una llamada más para replanificar y puede terminar en una pregunta en lugar de un «no hay nada». Es el lado prudente de la garantía.
- Se replanifica una sola vez. Si el decisor vuelve a quedarse corto, la misión termina en NEEDS_INFORMATION; nunca en COMPLETED.
- Un resultado **no vacío** de un alcance inferido se sigue certificando, aunque falten fuentes. Queda fuera de esta corrección.
- Luna puede añadir fuentes locales que no se pidieron (la memoria en la consulta de correo). No supone ninguna conexión ni permiso nuevo.

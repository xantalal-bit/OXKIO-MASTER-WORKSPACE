# OXKIO V3 — comprensión semántica de intención — evidencia 2026-10-05

## Causa raíz

`intention-interpreter` decidía por vocabulario y `mission-runtime.start()` solo consultaba al decisor cuando el intérprete no reconocía nada (NEEDS_INFORMATION). Por eso:

- «factura» (vocabulario de `gmail.read`) llevaba al correo una pregunta sobre Verifactu;
- «reunión» (vocabulario de `calendar.read`) leía la agenda para pedir ideas;
- «alquilar o comprar» quedaba BLOCKED: `action()` trataba el infinitivo «comprar» como una orden de pago.

La cognición existía, pero no llegaba a intervenir.

## Determinista (sin cambios de autoridad)

- Marcador de secreto y credenciales.
- Órdenes de pago, irreversibles o de despliegue, y órdenes de comunicación o reserva. Un infinitivo solo cuenta como orden si se le pide a OXKIO («¿puedes comprar…?»).
- Órdenes de recordatorio y tareas futuras, y el consentimiento para guardar en memoria.
- Introspección y orientación, y la pregunta directa de agenda («¿qué tengo mañana?»).
- Investigación pública explícita y memoria.
- Seguimientos y reanudación, privacidad, validación del plan, conexiones, aprobación, coste y verificación.

## Comprensión semántica

El intérprete marca `semantic: true` cuando su resultado depende de interpretar vocabulario:

- fuentes privadas elegidas por palabra (correo, factura, reunión, documento, archivo, carpeta);
- verbos de edición genéricos (crea, añade, modifica, actualiza, mueve);
- menciones de capacidades declaradas sin implementar (PDF, Drive, OneDrive, Outlook, recordatorio como sustantivo);
- todo lo que antes acababa en NEEDS_INFORMATION.

Con cognición disponible, el decisor existente lee primero el objetivo frente a la vista efectiva de capacidades (PR #32) y responde, pide aclaración o planifica. Si no hay cognición, o si falla o se rechaza (privacidad, presupuesto, salida inválida, plan con algo no disponible), se mantiene la lectura determinista, con la misma autoridad que antes. Queda trazado como `SEMANTIC_FALLBACK` / `DETERMINISTIC_FALLBACK`.

## Arquitectura reutilizada

No hay motor, registro, planner ni router nuevos. Se reutilizan:

- `interpretIntention`: una marca y la distinción entre orden y mención;
- el decisor de `adaptive-planner`: cuatro restricciones genéricas, sin los ejemplos de la misión;
- `decisionView`, el Privacy Gate, el ledger, `validatePlan`, los huecos de conexión y la ApprovalQueue.

## Privacidad

Las peticiones que antes bloqueaba «pagar» o «transferir» podían pasar a la cognición. Una cifra con moneda ligada a quien habla mediante un verbo en primera persona («necesito pagar 300 €», «tengo 5.000 € ahorrados») ahora es CONFIDENTIAL y no sale. Un precio en una pregunta general sigue siendo INTERNAL.

## Evidencia determinista

- `semantic-understanding.test.js` (8 tests):
  - 17 puertas deterministas que nunca llegan al modelo;
  - caminos rápidos;
  - 28 peticiones (casos A–K y N con paráfrasis) marcadas para comprensión, ninguna bloqueada;
  - por HTTP, con un decisor doble:
    - A/B/D/F/H/J responden sin leer fuentes ni pagar;
    - C/E/I planifican la fuente y piden la conexión;
    - K vuelve a la lectura determinista («no disponible para tu cuenta»);
    - N busca en memoria;
    - L/M/G no pasan por el modelo;
    - la visibilidad no concede autoridad;
    - respaldo sin cognición, con fallo del proveedor y por privacidad.
- `egress-privacy.test.js` (+1): cifra en primera persona CONFIDENTIAL; precio general INTERNAL.
- Suite V3: 177/177. Suite completa secuencial: 1805 tests, 1789 PASS, 0 FAIL, 16 SKIP.
- Batería Cliente Cero ampliada (28 casos):
  - **sin cognición**, solo cambian los cuatro infinitivos usados como tema, que pasan de BLOCKED/NEEDS_APPROVAL a pedir aclaración;
  - **con cognición**, todo lo que depende de interpretar vocabulario pasa por el decisor y lo demás sigue igual;
  - **batería original de 20 casos**: solo cambian los cinco enrutados erróneos que encontró la auditoría.

## Validación real (4 llamadas, rama ba65172, 0,001249 USD)

| Petición | Decisión de Luna | Resultado |
|---|---|---|
| Cinco ideas para la reunión del lunes con el equipo | `answer`, 5 ideas, `plan: []` | Respuesta útil, sin leer la agenda (antes pedía conectarla) |
| ¿Me compensa alquilar o comprar un coche por trabajo? | `clarify`: pide datos para calcular | Comparación, no pago (antes BLOCKED) |
| Organízame las prioridades de esta semana | `clarify`: pide tareas, plazos y tiempo | No supone agenda ni correo |
| Revisa reuniones del lunes y correos pendientes | `clarify`: «necesito que conectes o valides calendario y Gmail» y pregunta qué lunes | Respeta el estado de cada capacidad, pero no planifica |

Sin rechazos C1/C2 ni de otro tipo, y `executionEnabled=false`. Son cuatro muestras: evidencia de comportamiento, no una estadística.

## Riesgos y pendientes

- **Exceso de aclaraciones:** 3 de 4 llamadas pidieron aclaración. En «alquilar o comprar» podría haber dado un marco general.
- **Fuentes que hacen falta:** en la petición que necesitaba agenda y correo, Luna pidió conectar en lugar de planificar, así que no se guarda una misión que se pueda reanudar con «continúa». Además afirmó una fecha concreta.
- **Respuestas de conocimiento:** «Explícame qué es Verifactu» sigue limitado por la regla «sin afirmar hechos externos» y por el catálogo público de 2 URLs.
- **Coste y latencia:** cada petición basada en vocabulario hace ahora una llamada al decisor (unos 0,0003 USD y 3–4 s).
- **Verbos genéricos sin cognición:** «Crea una lista…» sin cognición sigue en NEEDS_APPROVAL. Con cognición la decide el decisor.

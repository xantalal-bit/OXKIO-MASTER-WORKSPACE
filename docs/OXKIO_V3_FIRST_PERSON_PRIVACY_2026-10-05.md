# OXKIO V3 — privacidad semántica de primera persona — evidencia 2026-10-05

## Decisión canónica (Xatai, 05/10/2026)

La primera persona («mi», «me», «mis», «nuestro»…) no convierte por sí sola una petición en CONFIDENTIAL. La clase depende del contenido efectivo, del contexto recuperado y de lo que realmente sale del perímetro local. Ante duda material, falla cerrado. SECRET nunca sale.

Sustituye la regla del 04/10/2026 («las referencias en primera persona no cambian», `OXKIO_V3_PERSONAL_HEURISTIC_2026-10-04.md`).

## Incidencia

En la auditoría funcional del 05/10/2026 (batería Cliente Cero de 20 casos), «Quiero organizar mejor mi trabajo de esta semana…» no llegaba nunca al razonamiento gobernado. `mentionsPerson` (cualquier «mi») elevaba el suelo a CONFIDENTIAL. La misma petición sin «mi» («Hazme una lista de tareas priorizada para esta semana») sí llegaba.

## Cambio (sin clasificador paralelo)

- `egress-privacy.js`:
  - `mentionsPerson` no cambia. La regla de categoría especial sigue usándola, así que «mi depresión», «mi hipoteca» o «mi nómina» siguen en CONFIDENTIAL.
  - Nuevo `identifiesPerson`: detecta un nombre completo (la regla PERSONAL existente) o un tercero concreto por relación («mi jefe», «mis hijos», «nuestro abogado»). Esto, y no la primera persona, es lo que eleva una petición por sí sola.
  - `classifyEgress` añade datos financieros privados:
    - vocabulario: sueldo, préstamo, ingresos, patrimonio, saldo, cuenta bancaria, pensión, declaración de la renta, IRPF;
    - `financial_amount_personal`: una cifra con moneda ligada a quien habla («mi préstamo de 20.000 €», «gano 3.000 € al mes»). Un precio en una pregunta general («portátiles de 900 €») no cuenta.
- `governed-reasoning.js`: el suelo CONFIDENTIAL de la petición usa `identifiesPerson`. Se mantienen las fuentes privadas (`derivedFromPrivate`), los identificadores, los secretos y las categorías especiales sobre el texto que sale.
- `mission-runtime.js`: la marca `derivedFromPrivate` de la conversación y el mensaje de respaldo usan la misma regla. Un resultado con fuentes privadas sigue marcando la conversación, y un seguimiento no la rebaja.

Sin cambios en la política B, los proveedores, el presupuesto, la autoridad ni `executionEnabled=false`.

## Evidencia

- Tests nuevos: `egress-privacy.test.js` (3) y `executive-conversation.test.js` (4: A/B, C/D, E y F por HTTP).
- Tres tests adaptados al nuevo canon. Cada uno conserva su propósito con un caso que sigue siendo sensible por contenido:
  - «mi empresa» → «mi jefe» y «mi préstamo de 20.000 €»;
  - «mis contratos» → «mi socio»;
  - «clientes para mi empresa» → «mi hipoteca de 180.000 €».
- Suite V3: 155/155. Suite completa secuencial: 1783 tests, 1767 PASS, 0 FAIL, 16 SKIP.
- Batería Cliente Cero de 20 casos, antes y después: solo cambian el caso 2 y su seguimiento, que pasan de PRIVACY_BLOCKED a llegar al decisor. Los casos sensibles (PII, salario/hipoteca, contraseña) siguen igual y el modo sin razonamiento es idéntico.
- Llamada real a Luna (1 de 2 autorizadas, tope de 0,01 USD), con el código de la rama:
  - «Analiza mi hipoteca de 180.000 €…» → CONFIDENTIAL, 0 llamadas;
  - caso 2 → INTERNAL, enviado solo el texto de la petición, 0,0007056 USD.
- Luna respondió, pero el decisor rechazó su salida (`planning_invalid_action`) y la persona recibió la aclaración determinista. El recorrido de privacidad queda validado; la forma de salida del decisor queda pendiente (abajo).

## Riesgo residual

- `RELATION` y `OWN_MONEY` son listas cerradas. Un tercero sin nombre ni relación listada («la chica de recepción») o una cifra propia sin marcador («3.000 € al mes de alquiler») no se detectan solo por el texto. La categoría especial, los identificadores y las fuentes privadas siguen aplicándose.
- «Ingresos» y «saldo» junto a «mi» elevan también conversaciones de negocio («los ingresos de mi empresa»): falso positivo seguro.

## Pendientes registrados (no tratados aquí)

1. Decisor: Luna devuelve una salida que el decisor rechaza (`planning_invalid_action`) para un objetivo abierto. Hay que capturar la forma y decidir si se acepta.
2. La investigación pública se limita al catálogo curado (2 URLs). Fuera de él: BLOCKED `sources_not_found` con un mensaje opaco.
3. El intérprete por vocabulario enruta mal: «reunión»→agenda, «factura»→correo, «comprar una oficina»→BLOCKED.
4. La memoria solo encuentra coincidencias literales («preferencias» no encuentra «prefiero»).
5. El fallback a Terra no está conectado en runtime: solo Luna.
6. `QUALITY_PERSISTENCE_EPHEMERAL` en el arranque con Approval en postgres.
7. El mensaje de respaldo PRIVACY_BLOCKED tiene un tono comercial («¿a quién quieres llegar?») que no encaja con peticiones no comerciales.

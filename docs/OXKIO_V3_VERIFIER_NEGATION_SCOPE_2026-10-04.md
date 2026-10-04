# OXKIO V3 — Verifier: alcance de las negaciones — evidencia 2026-10-04

## Incidencia

En la validación real en español (1 llamada a Luna sobre 3da0c9b), 2 de 5 hallazgos se descartaron con `claim_negation_changed`, aunque eran fieles:

- **#3:** la cita dice «la propuesta **no confiere** derechos a los particulares» y el claim dice «**en lugar de conferir** derechos». Es equivalente, pero la regla solo contaba palabras de negación.
- **#4:** la cita reúne 4 frases. El claim afirma la segunda solo en parte («no se regulan en absoluto») y omite otras dos negaciones de esa misma frase («no pueden regularlas», «no se aplican las leyes»).

Ambos fallaban en el lado seguro: perdían utilidad, no fiabilidad.

## Cambio (sin relajar garantías)

- **Negaciones equivalentes** («en lugar de», «en vez de»): cuentan como negación solo si niegan **la misma palabra** que una negación de la cita (alcance: la siguiente palabra de contenido, saltando clíticos, comparada en 4 letras). Así «confiere derechos en lugar de regular» sigue rechazándose, porque mueve la negación a otro verbo.
- **Comprobación por frase de la cita:** negaciones y salvedades se exigen en cada frase de la cita que el claim afirma (comparte con ella 2 o más raíces, o un tercio de las suyas). Una frase de relleno que el claim no toca deja de penalizar. Si ninguna frase cumple el umbral, se aplica la cita entera, como antes. Una frase reformulada con sinónimos sigue cubierta por el anclaje léxico global del 60 %.
- Las cláusulas de una misma frase **no** se separan: hacerlo permitiría perder un «…, pero no en español». Por eso el #4 sigue rechazado. Para ese caso se añade una instrucción al modelo: si una frase citada tiene varias negaciones o salvedades, el claim las conserva todas o cita solo las frases que afirma.

## Evidencia

- Salida real española (última llamada): 3 → **4** hallazgos verificados; el #3 se recupera y el #4 sigue descartado.
- Salidas reales inglesas de F8 (2 ejecuciones): resultado idéntico (5/7 y 6/7). Los rechazos correctos por mezcla de fuentes y por «only» omitido se mantienen.
- Tests nuevos: #3 aceptado; inversión con equivalencia rechazada; #4 rechazado; frase de relleno sin penalizar; frase afirmada que pierde su negación o su salvedad, rechazada; reformulación con sinónimos de una frase negada, rechazada.
- Suite afectada: 461/461. Suite secuencial: 1737 tests, 1721 PASS, 0 FAIL, 16 SKIP. Secretos: 0.
- Sin llamadas reales a modelos en esta fase.

## Riesgo residual

- El recuento de negaciones no comprende el significado: una inversión que conserve el mismo número de negaciones sobre las mismas palabras no se detecta (ya ocurría antes).
- Una frase de la cita que el claim reformula casi por completo con sinónimos podría quedar fuera de la comprobación por frase; el anclaje global del 60 % lo hace improbable, y los tests de ataque lo cubren.

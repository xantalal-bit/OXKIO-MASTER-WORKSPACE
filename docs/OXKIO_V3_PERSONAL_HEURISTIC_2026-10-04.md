# OXKIO V3 — heurístico PERSONAL del Privacy Gate — evidencia 2026-10-04

## Incidencia

Detectada en F8 (PR #26). La investigación pública en español quedaba bloqueada con la autorización B:

1. `PERSONAL` leía cualquier par de palabras con mayúscula como un nombre propio: «Reglamento General», «Parlamento Europeo», «Inteligencia Artificial»… La petición subía a CONFIDENTIAL (suelo de `mentionsPerson`).
2. La regla `special_category_personal` se aplicaba también al texto de las páginas públicas. En Wikipedia, «tratamiento» junto a «Parlamento Europeo» bastaba para bloquear la síntesis.
3. Cuando el análisis no se hacía (o no se pedía), la respuesta volcaba las páginas completas sin explicar por qué.

## Cambio

- `egress-privacy.js`:
  - Un par con mayúscula deja de ser «persona» solo si **ambas** palabras son vocabulario institucional o legal (lista cerrada, ES/EN). Una palabra corriente basta para mantener el nombre («Ana Real», «Carlos Banco»), y una institución desconocida sigue tratándose como persona (falla cerrado).
  - Un artículo o preposición en mayúscula al **inicio** de un par se ignora («La Comisión Europea»), pero no tras un nombre («María La Fuente» sigue siendo persona).
  - Las referencias en primera persona («mi», «nuestro»…) no cambian.
  - Nuevo `publicText`: el texto leído de fuentes públicas sigue sometido a secretos e identificadores, pero no a la regla de categoría especial. La petición de la persona y cualquier fuente privada conservan todas las reglas; la procedencia privada sigue elevando a CONFIDENTIAL.
- `governed-reasoning.js` y `mission-runtime.js`: la síntesis separa la petición y las fuentes privadas (`egressText`) del texto público (`publicText`). Todo lo que sale sigue clasificado.
- `chat-gateway.js`:
  - Si se omite el análisis, se explica el motivo en lenguaje natural (privacidad, dato sensible, sin respaldo comprobable o no disponible), con un motivo fijo registrado en `cognitionSkipped`.
  - Las páginas públicas se listan como referencias (primera frase + enlace), no completas. Lo mismo cuando se leen sin un paso de análisis. Los datos privados se muestran como antes.

Sin cambios en la política B, los proveedores, el presupuesto, la autoridad ni `executionEnabled=false`.

## Evidencia

- Corpus (18 nombres institucionales ES/EN, 13 referencias a personas): antes 18/18 falsos positivos y 0 falsos negativos; ahora 0/18 y 0/13.
- Páginas reales de es.wikipedia (RGPD y Ley de IA), clasificadas sin llamadas a modelos: antes CONFIDENTIAL (`special_category_personal`); ahora INTERNAL. La misma investigación nombrando a «Juan Pérez» sigue en CONFIDENTIAL.
- Tests nuevos: `egress-privacy.test.js` (corpus, categoría especial con persona, texto público con identificador o secreto, procedencia privada) y 3 extremo a extremo por HTTP:
  - investigación en español con instituciones → analizada como INTERNAL;
  - persona nombrada → 0 llamadas y respuesta que explica la privacidad sin volcar páginas;
  - lectura pública sin análisis → referencias.
- Suite afectada: 457/457. Suite secuencial: 1733 tests, 1715 PASS, 16 SKIP. Los 2 fallos de hash congelado de migraciones son el artefacto CRLF conocido de un worktree nuevo: con los `.sql` en LF pasan 28/28 y no hay cambio de contenido.
- Escaneo de secretos de los archivos cambiados: 0.

## Riesgo residual

- La lista institucional es cerrada: una institución no listada sigue bloqueándose (falso positivo seguro). Un nombre de persona formado solo por dos palabras de la lista (p. ej. «Real Banco») dejaría de detectarse; es improbable y está documentado.
- La regla de identificadores sigue aplicándose al texto público: una página con cifras largas (teléfonos, poblaciones) puede seguir elevando a CONFIDENTIAL.

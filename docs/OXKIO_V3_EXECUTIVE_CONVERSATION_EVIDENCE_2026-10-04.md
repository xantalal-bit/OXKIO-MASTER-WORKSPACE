# OXKIO V3 — conversación ejecutiva integrada — evidencia 2026-10-04

## Decisión y alcance

Continuación autorizada por failover. Se reutilizó `exec-conversation`, rama `feat/oxkio-v3-executive-conversation`, inicialmente limpia y basada en `45c9ef01fab23d2727f8e34a92e4f598e2e03538` (main tras PR #25). No se creó otro runtime, proveedor ni endpoint. No merge, despliegue, consentimiento OAuth, nuevas credenciales, gasto real ni apertura familiar.

## Ejecución

Adaptive Planner usa Governed Reasoning y clasifica el JSON completo que sale. El piso predeterminado sigue CONFIDENTIAL; INTERNAL requiere configuración humana existente. Contexto privado y referencias personales elevan la clasificación. Answer/clarify no crean misión; plan pasa validación canónica y usa Mission Engine. Orientación general se separa de introspección técnica y de investigación pública explícita.

Contexto mínimo por propietario/conversación en el almacén sellado existente: objetivo, último turno y respuesta, procedencia, auditoría acotada y caducidad de 20 minutos. No se envía toda la memoria. Hazlo conserva aprobaciones; solo reanuda estados reanudables. Un workflow verificado evita repetir decisiones pagadas.

Verifier (corregido en la segunda pasada y tras F8, ver abajo): cada hallazgo lleva una cita literal (comparada en forma canónica) de cada fuente que cita, que no puede omitir una negación o salvedad de su frase, y una afirmación fiel a esa cita (mismas cifras, mismas negaciones, salvedades conservadas y vocabulario mayoritariamente de la cita). Conclusión y comparación son inferencias sobre los hallazgos, sin cifras nuevas, y se presentan a la persona etiquetadas como inferencia. Esto comprueba fidelidad textual de los hallazgos, NO verdad universal ni la validez semántica de la inferencia. Las páginas públicas se recortan en su última frase completa dentro de 2000 caracteres.

Análisis requiere fuentes pertinentes; propuestas de organización requieren documentos/correo; lectura web requiere descubrimiento público directo. Toda ejecución material continúa deshabilitada.

## Evidencia

- Nuevos tests: 25 PASS / 0 FAIL / 0 SKIP, proveedor simulado y frontera HTTP local efímera.
- Suite completa secuencial: `node --test --test-concurrency=1`: 1750 total, 1734 PASS / 0 FAIL / 16 SKIP. Los SKIP corresponden a PostgreSQL aislado, Docker y Firestore Emulator no disponibles. No se declaran validados esos servicios.
- Una ejecución paralela previa mostró interferencia en fixtures del chat heredado. La ejecución secuencial completa pasó; no se modificó ese chat ni se atribuyó el fallo a una causa probada.
- Escenarios A/B: orientación útil e introspección real; cero misiones y cero llamadas.
- C/I: asesoramiento gobernado con ledger, sin misión operativa.
- D/G: objetivo personal y seguimiento mantienen privacidad, cero llamadas externas.
- E: continuidad pertinente, separación por usuario/conversación.
- F: investigación sin tema pide aclaración; hazlo no amplía autoridad.
- H: afirmación inventada con ID válido falla; fallback autorizado conserva respaldo.
- J: trabajo público usa misión, descubrimiento, fuentes y respuesta con referencias.
- Reinicio de composición fixture conserva contexto; manipulación de fila sellada falla cerrado.
- Regresiones: reutilización de workflow sin nueva llamada, falsas afirmaciones de envío rechazadas, fuente mayor de 600 caracteres conserva calificadores.
- Llamadas reales a Luna/proveedores: 0. Coste externo real: 0 USD. Los importes de tests son sintéticos; no se afirma calidad validada con modelo real.
- Escaneo de patrones de credenciales en los 12 archivos de código/tests cambiados: 0 coincidencias. Esto no sustituye una revisión humana general de secretos.
- `git diff --check`: PASS.

## Auditoría independiente

Revisor en solo lectura: no encontró P1 concreto de fuga entre propietarios o ampliación de autoridad. P1 de síntesis corregido con regresiones. P2 de límites de fuentes, doble llamada al reutilizar workflow y dos formas de falsa ejecución corregidos; revisor comprobó cierre por inspección. No quedan esos hallazgos abiertos.

## Segunda pasada de corrección (auditoría de Claude, 04/10/2026)

Hallazgos de la auditoría tras el failover y su corrección:

- P1 — Verifier: la primera versión exigía claim = quote = texto íntegro de la fuente, y conclusión/comparación = copia de los hallazgos. Eso anulaba el análisis (la respuesta repetía cada fuente tres veces) y no cabía en `SYNTHESIS_MAX_OUTPUT_TOKENS=2000` con fuentes reales. Ahora se aplica el diseño F6 descrito arriba; el límite de salida pasa a 4000; el claim va en el idioma de la cita para que su fidelidad sea verificable; la respuesta muestra «Valoración (inferencia…)», «Hallazgos» y «Comparación (inferencia)».
- P2 — «¿Qué puedes hacer?» vuelve a ser introspección técnica (diseño F2) y se restaura en su test. La orientación ejecutiva cubre «qué puedes hacer por mí», «en qué/cómo me puedes ayudar» y «por dónde empezamos».
- P2 — El TTL de 20 minutos limita solo el contexto que puede ver el modelo. El puntero a la última misión se conserva y se evalúa por su estado vivo, de modo que «continúa» o «ya lo he conectado» reanudan una misión `NEEDS_CONNECTION`, `WAITING_RESOURCE` o `PAUSED` aunque haya pasado el TTL. Una aprobación pendiente sigue sin concederse.
- P3 — Una petición BLOCKED se registra sin contenido; un «hazlo» posterior responde que sigue bloqueada, en lugar de recurrir a un objetivo anterior. Las misiones creadas por un plan conversacional se registran en su conversación.
- Nota: `FOLLOW_UP` del gateway no es código muerto (decide la reinstalación del adaptador al reconectar); se mantiene.

Evidencia de la segunda pasada:

- Tests del verifier reescritos (10): sustentan valoración y comparación inferidas; rechazan ID válido inventado, fragmento que omite una negación, cifra, negación o salvedad cambiadas, cita ausente en una fuente atribuida, cifras nuevas en la inferencia, enlaces e instrucciones de la fuente.
- Restaurados los fixtures con análisis real en continuidad cognitiva («conviene Alfa», «Son complementarios»).
- Nuevos: reanudación tras TTL más «hazlo» tras bloqueo; recorte de página por frase completa.
- Suite local secuencial (sin los 2 tests que lanzan PowerShell/lanzadores, no tocados aquí y ejecutados por CI): tras la validación final de F8, 1720 tests, 1704 PASS / 0 FAIL / 16 SKIP. Puerto 3000 de producción `ready` antes y después.
## F8 — llamadas reales a Luna (autorizadas por José Antonio, 04/10/2026)

Alcance: máximo 2 llamadas, política B, suelo INTERNAL, solo PUBLIC/INTERNAL no sensible, tope de 0,10 USD. La clave se leyó de Secret Manager solo en memoria del arnés (fuera del repositorio), sin mostrarse ni persistirse. Hubo un tope duro de llamadas en el arnés.

| # | Turno | Resultado real | Coste |
|---|---|---|---|
| 1a | Investigación RGPD/Ley de IA con fuentes en español y nombres en mayúsculas | Privacy Gate: CONFIDENTIAL (`special_category_personal`). 0 llamadas; respuesta = fuentes en bruto | 0 |
| 1b | Consejo de captación de clientes | Luna respondió; el decisor rechazó la salida (`planning_invalid_output`); aclaración genérica | 0,0002134 USD |
| 2 | Misma investigación en minúsculas, fuentes en inglés (gate comprobado antes en local: INTERNAL) | Luna sintetizó; el Verifier rechazó (`quote_not_supported`); respuesta = fuentes en bruto | 0,001768 USD |

Total: 2 llamadas reales, 0,0019814 USD. Ninguna ejecución, aprobación ni escritura; `executionEnabled=false`; escaneo de secretos de las evidencias: 0.

Defectos encontrados por F8 y corregidos:

- Decisor (P1 para la conversación real): el filtro de «acción completada» quitaba las tildes, así que confundía el imperativo formal del consejo («cree», «publique», «envíe») con el pretérito («creé», «envié»). Además, un `plan: []` junto a una respuesta se trataba como plan. Ahora el pretérito se detecta con tilde, un plan vacío no es un plan, y los rechazos llevan códigos distintos (`planning_invalid_shape|plan|action|message`) para diagnosticarlos sin contenido.
- Verifier (P1): el texto real extraído tiene puntos perdidos, números de cita, paréntesis eliminados y espacios sueltos, que un modelo limpia al citar. La cita se compara ahora en forma canónica y puede ser un fragmento contiguo, pero se rechaza (`quote_drops_context`) si su frase de contexto contiene una negación o salvedad que la cita omite. Tests con el texto real de las dos páginas.
- Reproducción offline del turno 2 (páginas reales, modelo simulado, sin llamada): COMPLETED, INTERNAL, 2 hallazgos verificados, valoración y comparación etiquetadas como inferencia.

Hallazgo preexistente de main, NO cambiado en esta PR (decisión de política de privacidad): `PERSONAL` trata cualquier par de palabras con mayúscula («Reglamento General», «Parlamento Europeo») como un nombre propio, y junto a términos como «tratamiento» eleva fuentes públicas a CONFIDENTIAL. Falla de forma segura, pero bloquea la investigación pública en español. Además, cuando la cognición se omite, la respuesta vuelca las fuentes en bruto sin explicar por qué.

## F8 — validación real final (2 llamadas más, autorizadas; tope de 0,05 USD)

| # | Turno | Resultado real | Coste |
|---|---|---|---|
| 3 | Consejo de captación de clientes | **Decisor validado.** Luna devolvió `{"action":"clarify", …, "plan":[]}`, el caso corregido, y fue aceptado (`attempts: []`). La persona recibe una pregunta concreta (servicio, zona, cliente ideal, canal actual, presupuesto, objetivo). Sin misión. | 0,0002746 USD |
| 4 | Investigación RGPD/Ley de IA (fuentes en inglés, gate INTERNAL) | **Verifier: rechazo** (`quote_not_supported`); respuesta = fuentes en bruto. Salida del modelo capturada. | 0,0020004 USD |

Total de F8 (4 llamadas): 0,0042564 USD. `executionEnabled=false`; sin ejecución, aprobación ni escritura; escaneo de secretos de evidencias y fixture: 0.

Diagnóstico offline del turno 4 (7 hallazgos reales, fixture `synthesis-verifier.f8-luna.fixture.json`):

- 2, 4 y 5 ya se aceptaban.
- 1 y 3: la cita unía frases no consecutivas. Corregido: cada frase de la cita se comprueba por separado, con su contexto protegido.
- 7: claim fiel que desarrolla «EU» dos veces; el anclaje léxico contaba duplicados. Corregido: cada raíz cuenta una vez.
- 3: el claim omite la salvedad «only» de su cita → `claim_qualifier_dropped`. **Rechazo correcto.**
- 6: afirma algo de la Ley de IA con una cita del RGPD → `claim_not_supported`. **Rechazo correcto.**

Con las correcciones, 5 de 7 hallazgos pasan. El Verifier sigue siendo «todo o nada», así que esta salida concreta continúa rechazada. Se refuerza la instrucción: un hallazgo afirma solo lo que dice su propia cita y conserva todas sus salvedades; las relaciones entre fuentes van en la comparación. La eficacia de esa instrucción con Luna real NO está validada (no se hizo una tercera llamada, por mandato).

Decisión de diseño pendiente (no cambiada): ¿la síntesis debe descartar los hallazgos sin respaldo y mostrar solo los verificados, avisando de cuántos se descartaron, en lugar de rechazarla entera? Hoy se rechaza entera: más seguro, pero con poca utilidad en la práctica.

## Pendiente separado — fuera de esta PR

Heurístico `PERSONAL` del Privacy Gate (main): falsos positivos como «Reglamento General» o «Parlamento Europeo», que bloquean de forma segura pero incorrecta la investigación pública en español. Además, cuando se omite la cognición, la respuesta vuelca las fuentes en bruto sin explicarlo. No se modifica aquí.

## Estado operativo separado y siguiente

Checkout canónico comprobado limpio en `45c9ef0`. Al finalizar la primera pasada, el puerto 3000 rechazaba conexiones: la tarea programada había terminado con 0xC000013A (señal de consola) entre las 17:01 y las 17:33. No hay relación causal demostrable con esta PR, que no está desplegada. Se recuperó a las 18:04 relanzando la tarea existente, y se verificaron health, ready, 401, sellos, coste y logs. Esta PR no activa las mejoras en el servidor actual. Revisar la disponibilidad persistente por separado y obtener decisión humana antes de merge, restart/activación o despliegue. La beta familiar permanece cerrada.
